const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { createClient } = require('@libsql/client');

const app = express();

app.use(cors());
app.use(express.json());

// On Vercel serverless, if no cloud DB URL is set, write to the writable /tmp directory
const dbUrl = process.env.TURSO_DATABASE_URL || (process.env.VERCEL ? 'file:/tmp/event_tickets.db' : 'file:event_tickets.db');

const db = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN
});

let dbInitialized = false;
async function ensureDB() {
  if (dbInitialized) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      guest_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT,
      ticket_category TEXT DEFAULT 'General Admission',
      qr_code_image TEXT,
      is_used INTEGER NOT NULL DEFAULT 0,
      scanned_at TEXT NULL,
      scanned_by TEXT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tickets_lookup ON tickets (id, is_used)
  `);
  dbInitialized = true;
}

// POST /api/generate-ticket
app.post('/api/generate-ticket', async (req, res) => {
  try {
    await ensureDB();
    const { guest_name, phone_number, email = '', ticket_category = 'General Admission' } = req.body;

    if (!guest_name || !phone_number) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: guest_name and phone_number are mandatory.'
      });
    }

    const ticketId = uuidv4();

    const qrDataUrl = await QRCode.toDataURL(ticketId, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: { dark: '#0f172a', light: '#FFFFFF' }
    });

    await db.execute({
      sql: `INSERT INTO tickets (id, guest_name, phone_number, email, ticket_category, qr_code_image, is_used)
            VALUES (?, ?, ?, ?, ?, ?, 0)`,
      args: [ticketId, guest_name.trim(), phone_number.trim(), email.trim(), ticket_category.trim(), qrDataUrl]
    });

    const result = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [ticketId] });
    const newTicket = result.rows[0];

    return res.status(201).json({
      success: true,
      message: 'Ticket and QR code permanently saved to database',
      ticket: {
        id: newTicket.id,
        guest_name: newTicket.guest_name,
        phone_number: newTicket.phone_number,
        email: newTicket.email,
        ticket_category: newTicket.ticket_category,
        is_used: Boolean(newTicket.is_used),
        scanned_at: newTicket.scanned_at,
        created_at: newTicket.created_at,
        qr_code: newTicket.qr_code_image
      },
      qr_code: newTicket.qr_code_image
    });
  } catch (error) {
    console.error('Error generating ticket:', error);
    return res.status(500).json({ success: false, error: 'Internal server error while generating ticket.' });
  }
});

// POST /api/scan-ticket
app.post('/api/scan-ticket', async (req, res) => {
  try {
    await ensureDB();
    let { ticket_id, scanned_by = 'Gate-Scanner-01' } = req.body;

    if (!ticket_id || typeof ticket_id !== 'string') {
      return res.status(400).json({ success: false, status: 'invalid', message: 'No ticket token provided.' });
    }

    ticket_id = ticket_id.trim();

    const updateResult = await db.execute({
      sql: `UPDATE tickets SET is_used = 1, scanned_at = datetime('now'), scanned_by = ? WHERE id = ? AND is_used = 0`,
      args: [scanned_by, ticket_id]
    });

    if (updateResult.rowsAffected === 1) {
      const ticketResult = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [ticket_id] });
      const updatedTicket = ticketResult.rows[0];
      return res.status(200).json({
        success: true,
        status: 'valid',
        message: 'Access Granted! Pass verified.',
        guest: {
          id: updatedTicket.id,
          guest_name: updatedTicket.guest_name,
          phone_number: updatedTicket.phone_number,
          ticket_category: updatedTicket.ticket_category,
          is_used: true,
          scanned_at: updatedTicket.scanned_at,
          scanned_by: updatedTicket.scanned_by
        }
      });
    }

    const existingResult = await db.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [ticket_id] });
    const existingTicket = existingResult.rows[0];

    if (existingTicket) {
      return res.status(409).json({
        success: false,
        status: 'already_used',
        message: `ALREADY USED! Scanned at ${existingTicket.scanned_at}`,
        guest: {
          id: existingTicket.id,
          guest_name: existingTicket.guest_name,
          phone_number: existingTicket.phone_number,
          ticket_category: existingTicket.ticket_category,
          is_used: true,
          scanned_at: existingTicket.scanned_at,
          scanned_by: existingTicket.scanned_by
        }
      });
    } else {
      return res.status(404).json({
        success: false,
        status: 'invalid',
        message: 'INVALID PASS! Ticket code not found in database.',
        scanned_token: ticket_id
      });
    }
  } catch (error) {
    console.error('Error validating ticket scan:', error);
    return res.status(500).json({ success: false, status: 'error', message: 'Internal server error validating ticket.' });
  }
});

// GET /api/tickets
app.get('/api/tickets', async (req, res) => {
  try {
    await ensureDB();
    const result = await db.execute('SELECT * FROM tickets ORDER BY created_at DESC');
    const tickets = result.rows;
    const total = tickets.length;
    const used = tickets.filter(t => t.is_used === 1).length;
    const remaining = total - used;

    return res.json({
      success: true,
      stats: { total, used, remaining },
      tickets: tickets.map(t => ({ ...t, is_used: Boolean(t.is_used), qr_code: t.qr_code_image }))
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/reset-ticket/:id
app.post('/api/reset-ticket/:id', async (req, res) => {
  try {
    await ensureDB();
    const { id } = req.params;
    const result = await db.execute({
      sql: `UPDATE tickets SET is_used = 0, scanned_at = NULL, scanned_by = NULL WHERE id = ?`,
      args: [id]
    });
    if (result.rowsAffected === 0) return res.status(404).json({ success: false, message: 'Ticket not found' });
    return res.json({ success: true, message: 'Ticket reset to unused successfully.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/tickets/:id
app.delete('/api/tickets/:id', async (req, res) => {
  try {
    await ensureDB();
    const { id } = req.params;
    const result = await db.execute({ sql: 'DELETE FROM tickets WHERE id = ?', args: [id] });
    if (result.rowsAffected === 0) return res.status(404).json({ success: false, message: 'Ticket not found in database.' });
    return res.json({ success: true, message: 'Ticket deleted from system successfully.' });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/tickets
app.delete('/api/tickets', async (req, res) => {
  try {
    await ensureDB();
    const result = await db.execute('DELETE FROM tickets');
    return res.json({ success: true, message: `Cleared all tickets from system (${result.rowsAffected} deleted).` });
  } catch (error) {
    console.error('Error clearing tickets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
