import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getInitialData } from './data.js';

const TMP_FILE = path.join('/tmp', 'chscms_db.json');
const POSITIONS = new Set(['Goalkeeper', 'Defender', 'Midfielder', 'Forward']);

function isAdminRequest(req) {
  return (req.headers.cookie || '').split(';').some(cookie => cookie.trim() === 'chscms_admin=true');
}

function readDatabase() {
  if (!fs.existsSync(TMP_FILE)) {
    fs.writeFileSync(TMP_FILE, JSON.stringify(getInitialData(), null, 2));
  }
  const data = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
  if (!Array.isArray(data.players)) data.players = [];
  if (!Array.isArray(data.registration_requests)) data.registration_requests = [];
  return data;
}

function writeDatabase(data) {
  fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2));
}

function getBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'POST') {
    let body;
    try {
      body = getBody(req);
    } catch {
      return res.status(400).json({ error: 'Invalid registration details.' });
    }

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const dateOfBirth = typeof body.date_of_birth === 'string' ? body.date_of_birth : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const position = typeof body.position === 'string' ? body.position : '';
    const guardianContact = typeof body.guardian_contact === 'string' ? body.guardian_contact.trim() : '';
    if (!fullName || fullName.length > 120 || !validDate(dateOfBirth) ||
        !phone || phone.length > 32 || !POSITIONS.has(position) || guardianContact.length > 120) {
      return res.status(400).json({ error: 'Enter a valid name, date of birth, position, and phone number.' });
    }

    try {
      const data = readDatabase();
      const request = {
        id: crypto.randomUUID(),
        full_name: fullName,
        date_of_birth: dateOfBirth,
        position,
        phone,
        guardian_contact: guardianContact,
        created_at: new Date().toISOString()
      };
      data.registration_requests.push(request);
      writeDatabase(data);
      return res.status(201).json({ success: true });
    } catch (error) {
      console.error('Unable to save player registration:', error);
      return res.status(500).json({ error: 'The registration could not be saved. Please try again later.' });
    }
  }

  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: 'Administrator authorization is required.' });
  }

  if (req.method === 'GET') {
    try {
      const data = readDatabase();
      return res.status(200).json({ requests: data.registration_requests });
    } catch (error) {
      console.error('Unable to read player registrations:', error);
      return res.status(500).json({ error: 'Player registrations could not be loaded.' });
    }
  }

  if (req.method === 'PATCH') {
    let body;
    try {
      body = getBody(req);
    } catch {
      return res.status(400).json({ error: 'Invalid transfer details.' });
    }
    if (body.action !== 'approve' || typeof body.request_id !== 'string') {
      return res.status(400).json({ error: 'Invalid transfer request.' });
    }

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const jerseyName = typeof body.jersey_name === 'string' ? body.jersey_name.trim().toUpperCase() : '';
    const jerseyNumber = Number(body.jersey_number);
    const position = typeof body.position === 'string' ? body.position : '';
    const dateOfBirth = typeof body.date_of_birth === 'string' ? body.date_of_birth : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!fullName || fullName.length > 120 || !jerseyName || jerseyName.length > 32 ||
        !Number.isInteger(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99 ||
        !POSITIONS.has(position) || !validDate(dateOfBirth) || !phone || phone.length > 32) {
      return res.status(400).json({ error: 'Enter valid squad details and assign a jersey number from 1 to 99.' });
    }

    try {
      const data = readDatabase();
      const requestIndex = data.registration_requests.findIndex(item => item.id === body.request_id);
      if (requestIndex < 0) {
        return res.status(404).json({ error: 'This registration request no longer exists.' });
      }
      const duplicate = data.players.find(player => Number(player.jersey_number) === jerseyNumber);
      if (duplicate) {
        return res.status(409).json({ error: `Jersey #${jerseyNumber} is already assigned to ${duplicate.full_name}.` });
      }

      const request = data.registration_requests[requestIndex];
      const player = {
        id: `PL-${String(data.players.reduce((max, item) => {
          const match = String(item.id || '').match(/(\d+)$/);
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0) + 1).padStart(3, '0')}`,
        full_name: fullName,
        jersey_name: jerseyName,
        jersey_number: jerseyNumber,
        position,
        date_of_birth: dateOfBirth,
        phone,
        guardian_contact: request.guardian_contact || '',
        national_id: '',
        medical_notes: 'Fit & Cleared',
        status: 'Active',
        joined_date: new Date().toISOString().slice(0, 10)
      };
      data.players.push(player);
      data.registration_requests.splice(requestIndex, 1);
      writeDatabase(data);
      return res.status(200).json({ success: true, player });
    } catch (error) {
      console.error('Unable to transfer player registration:', error);
      return res.status(500).json({ error: 'The registration could not be transferred. Please try again.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
