import fs from 'fs';
import path from 'path';

const TMP_FILE = path.join('/tmp', 'chscms_db.json');

export function getInitialData() {
  return {
    meta: { system: 'Central Hills SC Club Management System', season: '2026/2027', updated_at: new Date().toISOString().slice(0, 10) },
    club_settings: { club_name: 'Central Hills SC', nickname: 'The Mountaineers', founded_year: '2023', home_ground: 'Kacheri TC Ground', season: '2026/2027', currency: 'UGX', custom_logo_data: '' },
    players: [
      { id: 'PL-001', full_name: 'Brian Mugisha', jersey_name: 'MUGISHA', jersey_number: 1, position: 'Goalkeeper', date_of_birth: '2001-04-12', phone: '+256 772 410 112', guardian_contact: 'Sarah Mugisha (+256 701 332 901)', national_id: 'CM01042108892K', medical_notes: 'Fit & Cleared', status: 'Active', joined_date: '2023-03-10' },
      { id: 'PL-002', full_name: 'Denis Kato', jersey_name: 'KATO', jersey_number: 4, position: 'Defender', date_of_birth: '2002-08-19', phone: '+256 782 650 319', guardian_contact: 'Peter Kato (+256 752 889 410)', national_id: 'CM02081904412H', medical_notes: 'Fit & Cleared', status: 'Active', joined_date: '2023-03-12' }
    ],
    registration_requests: [],
    uniform_stock: [
      { id: 'STK-01', item_name: 'Home Match Jersey (Forest/Lime)', kit_type: 'Home Kit', size_category: 'Player', size: 'M', unit_price_ugx: 65000, quantity_available: 12 }
    ],
    uniform_orders: [],
    transactions: [],
    membership_fees: [],
    training_sessions: [],
    attendance_records: [],
    matches: [],
    equipment: [],
    notices: []
  };
}

function isAdminRequest(req) {
  return (req.headers.cookie || '').split(';').some(cookie => cookie.trim() === 'chscms_admin=true');
}

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (!fs.existsSync(TMP_FILE)) {
    try {
      fs.writeFileSync(TMP_FILE, JSON.stringify(getInitialData(), null, 2));
    } catch (e) {
      console.error('Error creating tmp file:', e);
    }
  }

  if (req.method === 'GET') {
    try {
      const data = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
      if (!isAdminRequest(req)) data.registration_requests = [];
      return res.status(200).json(data);
    } catch (e) {
      return res.status(200).json(getInitialData());
    }
  }

  if (req.method === 'PUT') {
    if (!isAdminRequest(req)) {
      return res.status(401).json({ error: 'Administrator authorization is required.' });
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body) {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      const currentData = fs.existsSync(TMP_FILE)
        ? JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'))
        : getInitialData();
      body.registration_requests = Array.isArray(currentData.registration_requests)
        ? currentData.registration_requests
        : [];
      fs.writeFileSync(TMP_FILE, JSON.stringify(body, null, 2));
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}