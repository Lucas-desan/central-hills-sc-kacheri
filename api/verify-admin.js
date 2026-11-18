export default function handler(req, res) {
  // 1. Ensure the request method is POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: `Method ${req.method} Not Allowed` });
  }

  try {
    // 2. Parse the body safely (handles both raw text and parsed JSON)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { pin } = body || {};

    // 3. Match against your environment variable (or a fallback PIN for testing)
    const expectedPin = process.env.ADMIN_PIN || "1234567";

    if (pin === expectedPin) {
      return res.status(200).json({ success: true, message: "Authorized successfully" });
    }

    return res.status(401).json({ success: false, message: "Invalid Admin PIN" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error processing request" });
  }
}