const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const DATA_FILE_NAME = 'club-data.json';
const AUTH_FILE_NAME = 'admin-auth.json';
const SESSION_COOKIE = 'chsc_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DB_ARRAY_FIELDS = [
  'players',
  'uniform_stock',
  'uniform_orders',
  'transactions',
  'membership_fees',
  'training_sessions',
  'attendance_records',
  'matches',
  'equipment',
  'notices'
];

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPin(pin, saved) {
  if (!saved || typeof saved.salt !== 'string' || typeof saved.hash !== 'string') return false;
  const actual = Buffer.from(hashPin(pin, saved.salt).hash, 'hex');
  const expected = Buffer.from(saved.hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try {
      cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      continue;
    }
  }
  return cookies;
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function containsForbiddenKey(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some(item => containsForbiddenKey(item, seen));
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'admin_pin') return true;
    if (containsForbiddenKey(child, seen)) return true;
  }
  return false;
}

function validateDatabase(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db) ||
      !db.meta || typeof db.meta !== 'object' ||
      !db.club_settings || typeof db.club_settings !== 'object' ||
      containsForbiddenKey(db) ||
      DB_ARRAY_FIELDS.some(field => !Array.isArray(db[field]))) {
    return false;
  }
  return true;
}

function sanitizeDatabase(db) {
  function stripSensitive(value) {
    if (Array.isArray(value)) return value.map(stripSensitive);
    if (!value || typeof value !== 'object') return value;

    const copy = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'admin_pin') continue;
      copy[key] = stripSensitive(child);
    }
    return copy;
  }

  return stripSensitive(structuredClone(db));
}

function createAppServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  const dataFile = path.join(dataDir, DATA_FILE_NAME);
  const authFile = path.join(dataDir, AUTH_FILE_NAME);
  const secureCookie = options.secureCookie ?? process.env.NODE_ENV === 'production';
  const sessions = new Map();
  const loginAttempts = new Map();
  let databaseWriteQueue = Promise.resolve();

  async function writeJsonAtomically(file, value) {
    await fs.mkdir(dataDir, { recursive: true });
    const temporaryFile = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporaryFile, file);
  }

  async function initialize() {
    await fs.mkdir(dataDir, { recursive: true });
    let authContents;
    try {
      authContents = await fs.readFile(authFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const initialPin = options.adminPin || process.env.ADMIN_PIN;
      if (typeof initialPin !== 'string' || initialPin.length < 8 || initialPin.length > 128) {
        throw new Error('Set ADMIN_PIN to an initial PIN between 8 and 128 characters before first startup.');
      }
      await writeJsonAtomically(authFile, hashPin(initialPin));
      return;
    }

    const savedAuth = JSON.parse(authContents);
    if (typeof savedAuth.salt !== 'string' || typeof savedAuth.hash !== 'string' ||
        !/^[a-f0-9]{32}$/.test(savedAuth.salt) || !/^[a-f0-9]{128}$/.test(savedAuth.hash)) {
      throw new Error('Administrator authentication data is invalid.');
    }
  }

  function getSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    return { key, session };
  }

  function requireAdmin(req, res) {
    const found = getSession(req);
    if (!found) {
      sendJson(res, 401, { error: 'Administrator authentication required.' });
      return null;
    }
    found.session.expiresAt = Date.now() + SESSION_TTL_MS;
    return found;
  }

  function checkSameOrigin(req, res) {
    const origin = req.headers.origin;
    if (!origin) {
      sendJson(res, 403, { error: 'Request origin could not be verified.' });
      return false;
    }
    try {
      if (new URL(origin).host !== req.headers.host) throw new Error('origin mismatch');
    } catch {
      sendJson(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return false;
    }
    return true;
  }

  async function handleApi(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      sendJson(res, 200, { authenticated: Boolean(getSession(req)) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/data') {
      try {
        const saved = await fs.readFile(dataFile, 'utf8');
        const database = sanitizeDatabase(JSON.parse(saved));
        if (!validateDatabase(database)) throw new Error('Stored database has an invalid shape.');
        sendJson(res, 200, database);
      } catch (error) {
        if (error.code === 'ENOENT') {
          sendJson(res, 200, null);
          return;
        }
        console.error('Unable to read club data:', error);
        sendJson(res, 500, { error: 'Club data could not be loaded.' });
      }
      return;
    }

    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST, PUT, DELETE' });
      return;
    }
    if (!checkSameOrigin(req, res)) return;

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.blockedUntil > Date.now()) {
        sendJson(res, 429, { error: 'Too many unsuccessful attempts. Try again in 15 minutes.' });
        return;
      }
      const body = await readJson(req);
      const pin = typeof body.pin === 'string' ? body.pin : '';
      const auth = JSON.parse(await fs.readFile(authFile, 'utf8'));
      if (pin.length > 128 || !verifyPin(pin, auth)) {
        const current = attempts && attempts.startedAt > Date.now() - LOGIN_WINDOW_MS
          ? attempts
          : { count: 0, startedAt: Date.now() };
        current.count += 1;
        if (current.count >= LOGIN_MAX_ATTEMPTS) current.blockedUntil = Date.now() + LOGIN_WINDOW_MS;
        loginAttempts.set(ip, current);
        sendJson(res, 401, { error: 'Incorrect administrator PIN.' });
        return;
      }
      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      const key = crypto.createHash('sha256').update(token).digest('hex');
      sessions.set(key, { expiresAt: Date.now() + SESSION_TTL_MS });
      const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? '; Secure' : ''}`;
      sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': cookie });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const found = getSession(req);
      if (found) sessions.delete(found.key);
      const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? '; Secure' : ''}`;
      sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': cookie });
      return;
    }

    const session = requireAdmin(req, res);
    if (!session) return;

    if (req.method === 'PUT' && url.pathname === '/api/data') {
      const submitted = await readJson(req);
      if (!validateDatabase(submitted)) {
        sendJson(res, 400, { error: 'The submitted club data is incomplete or invalid.' });
        return;
      }
      const clean = sanitizeDatabase(submitted);
      const write = databaseWriteQueue.catch(() => {}).then(() => writeJsonAtomically(dataFile, clean));
      databaseWriteQueue = write.catch(() => {});
      await write;
      sendJson(res, 200, { saved: true });
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/admin/pin') {
      const body = await readJson(req);
      if (typeof body.newPin !== 'string' || body.newPin.length < 8 || body.newPin.length > 128) {
        sendJson(res, 400, { error: 'The administrator PIN must be between 8 and 128 characters.' });
        return;
      }
      await writeJsonAtomically(authFile, hashPin(body.newPin));
      for (const key of sessions.keys()) {
        if (key !== session.key) sessions.delete(key);
      }
      sendJson(res, 200, { updated: true });
      return;
    }

    sendJson(res, 404, { error: 'API route not found.' });
  }

  function serveStatic(req, res, url) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, 400, { error: 'Invalid URL path.' });
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'club logo.jpeg'].includes(relativePath)) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }
    const file = path.join(ROOT, relativePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8'
    };
    fs.readFile(file).then(content => {
      res.writeHead(200, {
        'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    }).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        sendJson(res, 404, { error: 'Not found.' });
        return;
      }
      console.error('Unable to serve file:', error);
      sendJson(res, 500, { error: 'File could not be served.' });
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch(error => {
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        const status = error.statusCode || 500;
        if (status >= 500) console.error('API request failed:', error);
        sendJson(res, status, { error: status >= 500 ? 'The request could not be completed.' : error.message });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
      return;
    }
    serveStatic(req, res, url);
  });

  return { server, initialize };
}

if (require.main === module) {
  const { server, initialize } = createAppServer();
  initialize().then(() => {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, '0.0.0.0', () => {
      console.log(`Central Hills SC server listening on port ${port}`);
    });
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createAppServer };
