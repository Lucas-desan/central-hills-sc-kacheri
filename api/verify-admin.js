export default function handler(req, res) {
  // Only allow POST requests for security
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { pin } = req.body || {};
  
  // Pulls the password securely from Vercel Environment Variables
  const correctPin = process.env.ADMIN_PAGE || "18102001";

  if (pin === correctPin) {
    return res.status(200).json({ success: true, message: 'Authorized' });
  } else {
    return res.status(401).json({ success: false, message: 'Incorrect Admin PIN' });
  }
}