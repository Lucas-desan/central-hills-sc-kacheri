export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Set-Cookie', 'chscms_admin=false; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  return res.status(200).json({ success: true, authenticated: false });
}