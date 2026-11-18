export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const cookieHeader = req.headers.cookie || '';
  const authenticated = cookieHeader.includes('chscms_admin=true');
  return res.status(200).json({ authenticated });
}