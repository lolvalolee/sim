// server/routes/student.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const STU = requireAuth(['student']);

// ── GET SESSION (or create new) ───────────────────────────────
router.get('/session', STU, (req, res) => {
  let session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(req.user.id);

  if (!session) {
    // Create new session
    const assignment = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(req.user.id);
    if (!assignment) return res.status(404).json({ error: 'No assignment. Contact your lecturer.' });

    const today = new Date();
    const startDate = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;
    const id = uuidv4();

    db.prepare(`INSERT INTO sessions (id,student_id,assignment_id,start_date) VALUES (?,?,?,?)`)
      .run(id, req.user.id, assignment.id, startDate);

    session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  }

  if (session.status === 'stopped') {
    return res.status(403).json({ error: 'session_stopped', message: 'Вашу сесію зупинив лектор. Зверніться до лектора.' });
  }

  // Load assignment letters
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(session.assignment_id);
  const letterIds = JSON.parse(assignment?.letter_ids || '[]');
  const letters = letterIds
    .map(lid => db.prepare('SELECT * FROM letters WHERE id=?').get(lid))
    .filter(Boolean)
    .map(l => ({
      ...l,
      missing: JSON.parse(l.missing),
      dirs: JSON.parse(l.dirs),
    }));

  // Load threads and chats
  const emailThreads = db.prepare('SELECT * FROM email_threads WHERE session_id=?').all(session.id);
  const carrierChats = db.prepare('SELECT * FROM carrier_chats WHERE session_id=?').all(session.id);
  const orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=?').all(session.id);

  res.json({
    session: {
      id: session.id,
      status: session.status,
      timer_ms: session.timer_ms,
      timer_day: session.timer_day,
      start_date: session.start_date,
      profit: session.profit,
      rates: JSON.parse(session.rates),
    },
    letters,
    email_threads: emailThreads.map(t => ({ ...t, messages: JSON.parse(t.messages) })),
    carrier_chats: carrierChats.map(c => ({ ...c, messages: JSON.parse(c.messages), deal_status: c.deal_status })),
    order_progress: orderProgress,
  });
});

// ── SAVE STATE (heartbeat every 30s) ─────────────────────────
router.post('/session/save', STU, (req, res) => {
  const { timer_ms, timer_day, profit } = req.body;
  const session = db.prepare('SELECT id,status FROM sessions WHERE student_id=?').get(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  db.prepare('UPDATE sessions SET timer_ms=?, timer_day=?, profit=? WHERE id=?')
    .run(timer_ms || 0, timer_day || 1, profit || 0, session.id);

  res.json({ ok: true });
});

// ── EMAIL THREAD ──────────────────────────────────────────────
router.get('/threads/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  let thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?')
                 .get(session.id, req.params.letterId);
  if (!thread) return res.json({ messages: [] });
  res.json({ messages: JSON.parse(thread.messages) });
});

router.post('/threads/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { messages } = req.body;
  const existing = db.prepare('SELECT id FROM email_threads WHERE session_id=? AND letter_id=?')
                     .get(session.id, req.params.letterId);
  if (existing) {
    db.prepare('UPDATE email_threads SET messages=?, updated_at=datetime("now") WHERE id=?')
      .run(JSON.stringify(messages), existing.id);
  } else {
    db.prepare('INSERT INTO email_threads (id,session_id,letter_id,messages) VALUES (?,?,?,?)')
      .run(uuidv4(), session.id, req.params.letterId, JSON.stringify(messages));
  }
  res.json({ ok: true });
});

// ── CARRIER CHAT ──────────────────────────────────────────────
router.get('/chats/:carrierId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?')
                 .get(session.id, req.params.carrierId);
  if (!chat) return res.json({ messages: [], deal_status: 'none' });
  res.json({ messages: JSON.parse(chat.messages), deal_status: chat.deal_status });
});

router.post('/chats/:carrierId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { messages, deal_status } = req.body;
  const existing = db.prepare('SELECT id FROM carrier_chats WHERE session_id=? AND carrier_id=?')
                     .get(session.id, req.params.carrierId);
  if (existing) {
    db.prepare('UPDATE carrier_chats SET messages=?, deal_status=?, updated_at=datetime("now") WHERE id=?')
      .run(JSON.stringify(messages), deal_status || 'none', existing.id);
  } else {
    db.prepare('INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,?)')
      .run(uuidv4(), session.id, req.params.carrierId, JSON.stringify(messages), deal_status || 'none');
  }
  res.json({ ok: true });
});

// ── ORDER PROGRESS ────────────────────────────────────────────
router.post('/orders/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { status, client_freight, carrier_id, carrier_freight, carrier_plate, carrier_driver } = req.body;
  const existing = db.prepare('SELECT id FROM order_progress WHERE session_id=? AND letter_id=?')
                     .get(session.id, req.params.letterId);

  if (existing) {
    db.prepare(`UPDATE order_progress SET
      status=COALESCE(?,status), client_freight=COALESCE(?,client_freight),
      carrier_id=COALESCE(?,carrier_id), carrier_freight=COALESCE(?,carrier_freight),
      carrier_plate=COALESCE(?,carrier_plate), carrier_driver=COALESCE(?,carrier_driver),
      updated_at=datetime('now') WHERE id=?`)
      .run(status||null, client_freight||null, carrier_id||null, carrier_freight||null,
           carrier_plate||null, carrier_driver||null, existing.id);
  } else {
    db.prepare(`INSERT INTO order_progress (id,session_id,letter_id,status,client_freight,carrier_id,carrier_freight,carrier_plate,carrier_driver)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), session.id, req.params.letterId, status||'new',
           client_freight||null, carrier_id||null, carrier_freight||null,
           carrier_plate||null, carrier_driver||null);
  }

  // Update profit
  const orders = db.prepare('SELECT client_freight, carrier_freight FROM order_progress WHERE session_id=?').all(session.id);
  const profit = orders.reduce((sum, o) => sum + ((o.client_freight||0) - (o.carrier_freight||0)), 0);
  db.prepare('UPDATE sessions SET profit=? WHERE id=?').run(profit, session.id);

  res.json({ ok: true, profit });
});

// ── AI PROXY ──────────────────────────────────────────────────
const aiLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_AI_REQUESTS_PER_MINUTE) || 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many AI requests. Please wait.' }
});

router.post('/ai', STU, aiLimiter, async (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { system, messages, max_tokens } = req.body;
  if (!system || !messages) return res.status(400).json({ error: 'system and messages required' });

  // Basic profanity check
  const STOP_WORDS = ['хуй','пизда','блядь','fuck','shit','bitch'];
  const lastMsg = messages[messages.length-1]?.content || '';
  if (STOP_WORDS.some(w => lastMsg.toLowerCase().includes(w))) {
    return res.status(400).json({ error: 'profanity_blocked' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: max_tokens || 800,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

function getSession(studentId) {
  return db.prepare('SELECT * FROM sessions WHERE student_id=?').get(studentId);
}

module.exports = router;
