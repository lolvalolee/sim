// server/routes/student.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const STU = requireAuth(['student']);

// ── GET SESSION (or create new) ───────────────────────────────
router.get('/session', STU, (req, res) => {
  // Знаходимо групу студента і перевіряємо чи стартувала симуляція
  const member = db.prepare('SELECT group_id FROM group_members WHERE student_id=?').get(req.user.id);
  if (!member) return res.status(404).json({ error: 'No group. Contact your lecturer.' });

  const group = db.prepare('SELECT id,start_date,started_at,rates FROM groups WHERE id=?').get(member.group_id);
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  // Якщо група ще не стартувала — повертаємо заглушку (200 OK, не помилка)
  if (!group.started_at) {
    return res.json({
      not_started: true,
      start_date: group.start_date || null,
    });
  }

  let session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(req.user.id);

  if (!session) {
    // Create new session — start_date і rates беруться з групи
    const assignment = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(req.user.id);
    if (!assignment) return res.status(404).json({ error: 'No assignment. Contact your lecturer.' });

    const startDate = group.start_date;
    const groupRates = group.rates || '[41.5,41.65,41.8,41.7,41.9]';
    const id = uuidv4();
    const version = new Date().toISOString();

    db.prepare(`INSERT INTO sessions (id,student_id,assignment_id,start_date,rates,version) VALUES (?,?,?,?,?,?)`)
      .run(id, req.user.id, assignment.id, startDate, groupRates, version);

    session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  }

  if (session.status === 'stopped') {
    return res.status(403).json({ error: 'session_stopped', message: 'Вашу сесію зупинив лектор. Зверніться до лектора.' });
  }

  // Перевірка завершення симуляції (5 днів пройшло)
  if ((session.timer_day || 1) > 5) {
    return res.json({
      ended: true,
      profit: session.profit || 0,
      timer_day: session.timer_day,
    });
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
      version: session.version || '',
    },
    letters,
    email_threads: emailThreads.map(t => ({ ...t, messages: JSON.parse(t.messages) })),
    carrier_chats: carrierChats.map(c => ({ ...c, messages: JSON.parse(c.messages), deal_status: c.deal_status })),
    order_progress: orderProgress,
  });
});

// GET /api/student/session/version — легкий polling для перевірки версії
// Не повертає всі дані — тільки версію і статус
router.get('/session/version', STU, (req, res) => {
  const session = db.prepare('SELECT version, status FROM sessions WHERE student_id=?').get(req.user.id);
  if (!session) return res.json({ exists: false });
  res.json({
    exists: true,
    version: session.version || '',
    status: session.status,
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
    db.prepare("UPDATE email_threads SET messages=?, updated_at=datetime('now') WHERE id=?")
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
    db.prepare("UPDATE carrier_chats SET messages=?, deal_status=?, updated_at=datetime('now') WHERE id=?")
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

// GET /api/student/carriers — all active carriers
router.get('/carriers', STU, (req, res) => {
  const carriers = db.prepare(
    'SELECT id,name,person,phone,dirs,vehicle_types,reliability,availability,personality,nationality FROM carriers WHERE active=1 AND COALESCE(for_exchange,0)=0 ORDER BY nationality,name'
  ).all();
  res.json(carriers);
});
// ─── CONFIRMATION (Підтвердження угоди) ─────────────────────────────
// Дві окремі точки входу:
//   POST /orders/:letterId/confirm-client   — з модалки у чаті з замовником
//   POST /chats/:carrierId/confirm-carrier  — з модалки у чаті з перевізником
//
// Логіка для обох:
//   1. Студент вписав у формі: рейс (для перевізника), ціну, дату
//   2. AI читає переписку і перевіряє чи дані відповідають обговореному
//   3. Якщо approve → стан рейсу оновлюється, AI пише підтвердження
//   4. Якщо reject → AI пише уточнюючу репліку, угода НЕ закривається
//      (модалка залишається відкритою на клієнті щоб студент виправив)

const appBuilder = require('../utils/application-builder');
const agreementChecker = require('../utils/agreement-checker');

// Helper: запис в order_events (журнал)
function logOrderEvent(sessionId, letterId, type, payload){
  try {
    db.prepare('INSERT INTO order_events (id,session_id,letter_id,type,payload) VALUES (?,?,?,?,?)')
      .run(uuidv4(), sessionId, letterId, type, JSON.stringify(payload || {}));
  } catch(e) {
    console.error('logOrderEvent failed:', e.message);
  }
}

// Helper: обчислення нового стану рейсу
// Залежить від client_agreed_at і carrier_agreed_at
function computeOrderState(op){
  if (!op) return 'new';
  const hasClient = !!op.client_agreed_at;
  const hasCarrier = !!op.carrier_agreed_at;

  if (hasClient && hasCarrier) {
    // Перевіряємо чи був перетрейд → closed_changed
    if ((op.renegotiated_count || 0) > 0) return 'closed_changed';
    return 'closed';
  }
  if (hasClient) return 'client_agreed';
  if (hasCarrier) return 'carrier_agreed';

  // Якщо є переписка але домовленостей нема
  if (op.client_freight || op.carrier_id) return 'in_progress';

  return 'new';
}

// ─── ПІДТВЕРДЖЕННЯ З ЗАМОВНИКОМ ───
// Body: { price: number, date: "DD.MM.YYYY" }
router.post('/orders/:letterId/confirm-client', STU, async (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const letterId = req.params.letterId;
  const { price, date } = req.body || {};

  if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'invalid_price' });
  if (!date || !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) return res.status(400).json({ error: 'invalid_date' });

  // Завантажуємо лист
  const letter = db.prepare('SELECT * FROM letters WHERE id=?').get(letterId);
  if (!letter) return res.status(404).json({ error: 'letter_not_found' });

  // Замовник
  const client = letter.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(letter.client_id) : null;

  // Тред email
  const thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?').get(session.id, letterId);
  const messages = thread ? JSON.parse(thread.messages || '[]') : [];

  // Має бути хоч одне повідомлення від студента
  const studentMsgs = messages.filter(m => m.role === 'student' || m.role === 'user');
  if (studentMsgs.length === 0) {
    return res.status(400).json({ error: 'no_conversation', message: 'Спочатку напишіть замовнику і обговоріть умови.' });
  }

  // Будуємо рядок переписки для AI
  const chatHistory = messages.filter(m => !m.loading).map(m => {
    const role = (m.role === 'student' || m.role === 'user') ? 'Експедитор' : 'Замовник';
    return `${role}: ${m.text || m.content || ''}`;
  }).join('\n');

  const route = (() => {
    try {
      const dirs = JSON.parse(letter.dirs || '[]');
      return dirs.join(' → ');
    } catch(e) { return ''; }
  })();

  const originalLetter = {
    route,
    proposedPrice: letter.freight_fixed ? letter.freight_amount : (letter.freight_min || letter.freight_amount || ''),
    loadDate: '', // дата вираховується відносно симуляції — для AI не критично
  };

  const prompt = agreementChecker.buildClientCheckPrompt({
    chatHistory,
    route: route || '?',
    price: parseFloat(price),
    date,
    clientName: client?.person || letter.from_name || 'Замовник',
    originalLetter,
  });

  // Виклик AI
  let aiVerdict;
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        system: prompt,
        messages: [{ role: 'user', content: '[Перевір переписку і дай відповідь у JSON]' }],
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return res.status(502).json({ error: 'ai_error', details: txt.slice(0, 200) });
    }
    const data = await aiRes.json();
    const aiText = (data.content && data.content[0] && data.content[0].text) || '';
    aiVerdict = agreementChecker.parseAiVerdict(aiText);
  } catch (e) {
    return res.status(502).json({ error: 'ai_unavailable', details: String(e).slice(0, 200) });
  }

  const { verdict, mismatches, reply_message } = aiVerdict;
  const isApprove = verdict === 'approve';

  // Додаємо повідомлення замовника у тред
  const now = new Date().toISOString();
  const newMsg = {
    role: 'ai',
    text: reply_message || (isApprove ? 'Підтверджую. Готую заявку.' : 'Уточніть будь ласка.'),
    timestamp: now,
  };

  // Якщо APPROVE — генеруємо заявку (вкладення або текст)
  if (isApprove) {
    const variant = appBuilder.pickVariant();
    let applicationData = appBuilder.buildApplicationData({
      letter,
      client,
      messages,
      simulationDate: session.start_date,
      vehicleScenario: 'asked_before',
    });

    // Підставляємо узгоджену з форми ціну
    applicationData.freight.amount_eur = parseFloat(price);
    applicationData.loading.date = date;

    let missingFields = [];
    if (variant === 'incomplete_attachment' || variant === 'incomplete_text') {
      missingFields = appBuilder.pickMissingFields();
      applicationData = appBuilder.applyMissingFields(applicationData, missingFields);
    }

    newMsg.attachment = {
      type: 'application',
      variant,
      data: applicationData,
      missing_fields: missingFields,
    };

    if (variant === 'text' || variant === 'incomplete_text') {
      newMsg.text = (reply_message ? reply_message + '\n\n' : '') + renderApplicationAsText(applicationData, missingFields);
    }
  }

  // Зберігаємо в email_threads
  messages.push(newMsg);
  if (thread) {
    db.prepare("UPDATE email_threads SET messages=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), thread.id);
  } else {
    db.prepare('INSERT INTO email_threads (id,session_id,letter_id,messages) VALUES (?,?,?,?)')
      .run(uuidv4(), session.id, letterId, JSON.stringify(messages));
  }

  // Якщо APPROVE — оновлюємо order_progress і журнал
  if (isApprove) {
    const opExists = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?').get(session.id, letterId);
    const attachment = newMsg.attachment;

    if (opExists) {
      db.prepare(`UPDATE order_progress SET
        application_sent=1,
        application_data=?,
        application_variant=?,
        application_missing=?,
        application_sent_at=?,
        confirm_blocked=1,
        client_agreed_price=?,
        client_agreed_date=?,
        client_agreed_at=datetime('now'),
        client_freight=?
        WHERE id=?`)
        .run(
          JSON.stringify(attachment.data),
          attachment.variant,
          JSON.stringify(attachment.missing_fields || []),
          now,
          parseFloat(price),
          date,
          parseFloat(price),
          opExists.id
        );
      // Обчислюємо новий state
      const fresh = db.prepare('SELECT * FROM order_progress WHERE id=?').get(opExists.id);
      const newState = computeOrderState(fresh);
      db.prepare('UPDATE order_progress SET state=? WHERE id=?').run(newState, opExists.id);
    } else {
      const newId = uuidv4();
      const newState = 'client_agreed'; // лише клієнт, перевізника ще нема
      db.prepare(`INSERT INTO order_progress
        (id,session_id,letter_id,status,state,client_freight,
         application_sent,application_data,application_variant,application_missing,
         application_sent_at,confirm_blocked,
         client_agreed_price,client_agreed_date,client_agreed_at)
        VALUES (?,?,?,?,?,?,1,?,?,?,?,1,?,?,datetime('now'))`)
        .run(newId, session.id, letterId, 'work', newState, parseFloat(price),
             JSON.stringify(attachment.data),
             attachment.variant,
             JSON.stringify(attachment.missing_fields || []),
             now,
             parseFloat(price),
             date);
    }

    logOrderEvent(session.id, letterId, 'client_agreed', {
      price: parseFloat(price),
      date,
      route,
    });
  } else {
    // reject — у журнал теж пишемо для дебагу
    logOrderEvent(session.id, letterId, 'client_confirm_rejected', {
      verdict,
      mismatches,
      attempted_price: parseFloat(price),
      attempted_date: date,
    });
  }

  res.json({
    verdict,
    mismatches: mismatches || [],
    message: newMsg,
    approved: isApprove,
  });
});

// ─── ПІДТВЕРДЖЕННЯ З ПЕРЕВІЗНИКОМ ───
// Body: { letterId: string, price: number, date: "DD.MM.YYYY" }
router.post('/chats/:carrierId/confirm-carrier', STU, async (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const carrierId = req.params.carrierId;
  const { letterId, price, date } = req.body || {};

  if (!letterId) return res.status(400).json({ error: 'letter_required' });
  if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'invalid_price' });
  if (!date || !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) return res.status(400).json({ error: 'invalid_date' });

  // Завантажуємо перевізника
  const carrier = db.prepare('SELECT * FROM carriers WHERE id=?').get(carrierId);
  if (!carrier) return res.status(404).json({ error: 'carrier_not_found' });

  // Завантажуємо лист (рейс на який підтверджуємо)
  const letter = db.prepare('SELECT * FROM letters WHERE id=?').get(letterId);
  if (!letter) return res.status(404).json({ error: 'letter_not_found' });

  // Тред чату з перевізником
  const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?').get(session.id, carrierId);
  const messages = chat ? JSON.parse(chat.messages || '[]') : [];

  // Має бути хоч одне повідомлення від студента
  const studentMsgs = messages.filter(m => m.role === 'student' || m.role === 'user');
  if (studentMsgs.length === 0) {
    return res.status(400).json({ error: 'no_conversation', message: 'Спочатку напишіть перевізнику.' });
  }

  // Будуємо переписку
  const chatHistory = messages.filter(m => !m.loading).map(m => {
    const role = (m.role === 'student' || m.role === 'user') ? 'Експедитор' : 'Перевізник';
    return `${role}: ${m.text || m.content || ''}`;
  }).join('\n');

  const route = (() => {
    try {
      const dirs = JSON.parse(letter.dirs || '[]');
      return dirs.join(' → ');
    } catch(e) { return ''; }
  })();

  const prompt = agreementChecker.buildCarrierCheckPrompt({
    chatHistory,
    route: route || '?',
    price: parseFloat(price),
    date,
    carrierName: carrier.person || carrier.name || 'Перевізник',
  });

  // Виклик AI
  let aiVerdict;
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        system: prompt,
        messages: [{ role: 'user', content: '[Перевір переписку і дай відповідь у JSON]' }],
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return res.status(502).json({ error: 'ai_error', details: txt.slice(0, 200) });
    }
    const data = await aiRes.json();
    const aiText = (data.content && data.content[0] && data.content[0].text) || '';
    aiVerdict = agreementChecker.parseAiVerdict(aiText);
  } catch (e) {
    return res.status(502).json({ error: 'ai_unavailable', details: String(e).slice(0, 200) });
  }

  const { verdict, mismatches, reply_message } = aiVerdict;
  const isApprove = verdict === 'approve';

  // Додаємо повідомлення перевізника у чат
  const now = new Date().toISOString();
  const newMsg = {
    role: 'ai',
    text: reply_message || (isApprove ? 'Підтверджую угоду.' : 'Уточніть будь ласка.'),
    timestamp: now,
  };
  messages.push(newMsg);

  // Зберігаємо чат
  if (chat) {
    db.prepare("UPDATE carrier_chats SET messages=?, deal_status=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), isApprove ? 'confirmed' : (chat.deal_status || 'talk'), chat.id);
  } else {
    db.prepare("INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,?)")
      .run(uuidv4(), session.id, carrierId, JSON.stringify(messages), isApprove ? 'confirmed' : 'talk');
  }

  // Якщо APPROVE — оновлюємо order_progress
  if (isApprove) {
    const opExists = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?').get(session.id, letterId);

    if (opExists) {
      // Перевіряємо чи цей рейс уже мав перевізника → перетрейд
      const isRenegotiation = !!opExists.carrier_id && opExists.carrier_id !== carrierId;
      const prevCarrierId = isRenegotiation ? opExists.carrier_id : null;

      db.prepare(`UPDATE order_progress SET
        carrier_id=?,
        carrier_freight=?,
        carrier_agreed_price=?,
        carrier_agreed_date=?,
        carrier_agreed_at=datetime('now'),
        renegotiated_count=COALESCE(renegotiated_count,0)+?,
        prev_carrier_id=COALESCE(?,prev_carrier_id)
        WHERE id=?`)
        .run(
          carrierId,
          parseFloat(price),
          parseFloat(price),
          date,
          isRenegotiation ? 1 : 0,
          prevCarrierId,
          opExists.id
        );

      const fresh = db.prepare('SELECT * FROM order_progress WHERE id=?').get(opExists.id);
      const newState = computeOrderState(fresh);
      db.prepare('UPDATE order_progress SET state=? WHERE id=?').run(newState, opExists.id);

      if (isRenegotiation) {
        logOrderEvent(session.id, letterId, 'carrier_renegotiated', {
          new_carrier_id: carrierId,
          new_price: parseFloat(price),
          new_date: date,
          prev_carrier_id: prevCarrierId,
        });
      } else {
        logOrderEvent(session.id, letterId, 'carrier_agreed', {
          carrier_id: carrierId,
          price: parseFloat(price),
          date,
        });
      }
    } else {
      // Новий запис — лише перевізник (замовник ще не закритий)
      const newId = uuidv4();
      db.prepare(`INSERT INTO order_progress
        (id,session_id,letter_id,status,state,
         carrier_id,carrier_freight,carrier_agreed_price,carrier_agreed_date,carrier_agreed_at)
        VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`)
        .run(newId, session.id, letterId, 'work', 'carrier_agreed',
             carrierId, parseFloat(price), parseFloat(price), date);

      logOrderEvent(session.id, letterId, 'carrier_agreed', {
        carrier_id: carrierId,
        price: parseFloat(price),
        date,
      });
    }
  } else {
    logOrderEvent(session.id, letterId, 'carrier_confirm_rejected', {
      verdict,
      mismatches,
      carrier_id: carrierId,
      attempted_price: parseFloat(price),
      attempted_date: date,
    });
  }

  res.json({
    verdict,
    mismatches: mismatches || [],
    message: newMsg,
    approved: isApprove,
    letterId,
  });
});

// Рендер заявки як текст для варіанта 'text' / 'incomplete_text'
function renderApplicationAsText(d, missing){
  const isMissing = (field) => missing && missing.includes(field);
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('ЗАЯВКА НА ПЕРЕВЕЗЕННЯ № ' + d.order_number);
  lines.push('Дата: ' + (d.order_date || ''));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (d.client) {
    lines.push('');
    lines.push('Замовник: ' + d.client.company);
    lines.push('Адреса: ' + d.client.address);
    if (d.client.vat_id) lines.push(d.client.vat_id);
    if (d.client.phone) lines.push('Тел.: ' + d.client.phone);
  }

  lines.push('');
  lines.push('━━ ТРАНСПОРТНИЙ ЗАСІБ ━━');
  lines.push('Тип ТЗ: ' + d.vehicle);

  lines.push('');
  lines.push('━━ ВАНТАЖ ━━');
  lines.push('Опис: ' + (d.cargo.description || '—'));
  if (d.cargo.weight_kg && !isMissing('weight')) lines.push('Вага: ' + d.cargo.weight_kg + ' кг');
  if (d.cargo.volume_m3 && !isMissing('pallets')) lines.push('Об\'єм: ' + d.cargo.volume_m3 + ' м³');
  if (d.cargo.pallets && !isMissing('pallets')) lines.push('Палет: ' + d.cargo.pallets + ' EPAL');

  lines.push('');
  lines.push('━━ ЗАВАНТАЖЕННЯ ━━');
  if (d.loading.date && !isMissing('load_date')) lines.push('Дата: ' + d.loading.date + (d.loading.time_window ? ', ' + d.loading.time_window : ''));
  lines.push('Адреса: ' + (d.loading.address || '—'));
  if (d.loading.contact_name) lines.push('Контакт: ' + d.loading.contact_name + (d.loading.contact_phone ? ', ' + d.loading.contact_phone : ''));

  lines.push('');
  lines.push('━━ МИТНИЦЯ ━━');
  if (d.customs_out) lines.push('Замитнення: ' + d.customs_out);
  if (d.customs_in) lines.push('Розмитнення: ' + d.customs_in);

  lines.push('');
  lines.push('━━ РОЗВАНТАЖЕННЯ ━━');
  lines.push('Адреса: ' + (d.unloading.address || '—'));
  if (d.unloading.contact_name) lines.push('Контакт: ' + d.unloading.contact_name + (d.unloading.contact_phone ? ', ' + d.unloading.contact_phone : ''));

  lines.push('');
  lines.push('━━ ФРАХТ ━━');
  if (d.freight.amount_eur) lines.push('Сума: €' + d.freight.amount_eur);
  if (d.freight.payment_terms) lines.push('Умови оплати: ' + d.freight.payment_terms);

  if (d.vehicle_data) {
    lines.push('');
    lines.push('━━ АВТО / ВОДІЙ ━━');
    lines.push('ТЗ: ' + d.vehicle_data.plate);
    lines.push('Водій: ' + d.vehicle_data.driver_name);
    lines.push('Тел.: ' + d.vehicle_data.driver_phone);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

module.exports = router;
