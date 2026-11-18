export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { pin } = body || {};
    const expectedPin = process.env.ADMIN_PIN || '18102001';

    if (pin === expectedPin) {
      res.setHeader('Set-Cookie', 'chscms_admin=true; Path=/; HttpOnly; Secure; SameSite=Lax');
      return res.status(200).json({ success: true, authenticated: true });
    }

    return res.status(401).json({ error: 'Invalid Administrator PIN.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}