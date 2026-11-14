const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAppServer } = require('../server');

test('administrator API requires a server session and persists only hashed PINs', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chsc-auth-test-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const app = createAppServer({ dataDir, adminPin: 'TempAdminPin987', secureCookie: false });
  await app.initialize();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));

  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const origin = { Origin: baseUrl };
  const database = {
    meta: { system: 'test' },
    club_settings: { club_name: 'Test Club' },
    players: [],
    uniform_stock: [],
    uniform_orders: [],
    transactions: [],
    membership_fees: [],
    training_sessions: [],
    attendance_records: [],
    matches: [],
    equipment: [],
    notices: []
  };

  const unauthorizedWrite = await fetch(`${baseUrl}/api/data`, {
    method: 'PUT',
    headers: { ...origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(database)
  });
  assert.equal(unauthorizedWrite.status, 401);

  const crossOriginLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'TempAdminPin987' })
  });
  assert.equal(crossOriginLogin.status, 403);

  const failedLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'wrong-pin' })
  });
  assert.equal(failedLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'TempAdminPin987' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];

  const saved = await fetch(`${baseUrl}/api/data`, {
    method: 'PUT',
    headers: { ...origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(database)
  });
  assert.equal(saved.status, 200);

  const dataResponse = await fetch(`${baseUrl}/api/data`);
  assert.deepEqual(await dataResponse.json(), database);
  const invalidDatabase = await fetch(`${baseUrl}/api/data`, {
    method: 'PUT',
    headers: { ...origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...database,
      club_settings: { ...database.club_settings, admin_pin: 'must-not-be-saved' }
    })
  });
  assert.equal(invalidDatabase.status, 400);

  const pinUpdate = await fetch(`${baseUrl}/api/admin/pin`, {
    method: 'PUT',
    headers: { ...origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPin: 'ChangedAdminPin654' })
  });
  assert.equal(pinUpdate.status, 200);

  const storedAuth = await fs.readFile(path.join(dataDir, 'admin-auth.json'), 'utf8');
  assert.equal(storedAuth.includes('ChangedAdminPin654'), false);
  const storedHash = JSON.parse(storedAuth);
  assert.equal(
    crypto.scryptSync('ChangedAdminPin654', storedHash.salt, 64).toString('hex'),
    storedHash.hash
  );

  await fetch(`${baseUrl}/api/logout`, {
    method: 'POST',
    headers: { ...origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const oldPinLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'TempAdminPin987' })
  });
  assert.equal(oldPinLogin.status, 401);
  const newPinLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { ...origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: 'ChangedAdminPin654' })
  });
  assert.equal(newPinLogin.status, 200);

  const privateFile = await fetch(`${baseUrl}/server.js`);
  assert.equal(privateFile.status, 404);
  const privateDataFile = await fetch(`${baseUrl}/data/club-data.json`);
  assert.equal(privateDataFile.status, 404);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { ...origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: 'wrong-pin' })
    });
    assert.equal(response.status, attempt === 5 ? 429 : 401);
  }
});
