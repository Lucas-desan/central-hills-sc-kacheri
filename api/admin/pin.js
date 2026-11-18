export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { newPin } = body || {};

    if (!newPin || newPin.length < 8) {
      return res.status(400).json({ error: 'PIN must be at least 8 characters long.' });
    }

    return res.status(200).json({ success: true, message: 'Admin PIN updated successfully.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}