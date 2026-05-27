// server/routes/student.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const followupScheduler = require('../utils/followup-scheduler');
const incidentScheduler = require('../utils/incident-scheduler');
const incidentScenarios = require('../utils/incident-scenarios');

const STU = requireAuth(['student']);

// ── Призначення сценаріїв (1-8) для 8 листів сесії ──────────────
// Викликається при кожному GET /session — але реально щось робить
// тільки коли scenario_id ще не призначені (одноразово на сесію/призначення).
function assignScenariosIfNeeded(letterIds) {
  if (!letterIds || letterIds.length === 0) return;

  const letters = letterIds
    .map(lid => db.prepare('SELECT id, dirs, client_id, scenario_id FROM letters WHERE id=?').get(lid))
    .filter(Boolean);

  // Якщо хоча б у одного вже є scenario_id — нічого не робимо
  if (letters.some(l => l.scenario_id != null)) return;

  // Перевіряємо чи це 8 листів (як очікується). Якщо не 8 — все одно роздаємо.
  // Сценарії 1-8 у випадковому порядку.
  const scenarios = [1, 2, 3, 4, 5, 6, 7, 8];
  // Fisher-Yates shuffle
  for (let i = scenarios.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]];
  }

  // Якщо листів менше або більше ніж 8 — обрізаємо/повторюємо
  const assignments = [];
  for (let i = 0; i < letters.length; i++) {
    assignments.push(scenarios[i % scenarios.length]);
  }

  // Сценарії 6 і 7 (проблема на розмитненні) — тільки для імпорту в UA
  // Імпорт = "dirs" містить НЕ-UA країну для завантаження + UA для розвантаження
  // АБО (простіше): є митний перехід у маршруті (dirs.length >= 2)
  // Якщо лист "не імпорт" — поміняємо місцями з листом який імпорт
  const isImportLetter = (letter) => {
    try {
      const dirs = JSON.parse(letter.dirs || '[]');
      if (!Array.isArray(dirs) || dirs.length < 2) return false;
      // Імпорт: останній dir = UA, перший — НЕ UA
      const last = dirs[dirs.length - 1];
      const first = dirs[0];
      return last === 'UA' && first !== 'UA';
    } catch (e) { return false; }
  };

  // Шукаємо позиції з сценаріями 6 і 7 — якщо лист там НЕ імпорт, міняємо
  for (let scen of [6, 7]) {
    const pos = assignments.indexOf(scen);
    if (pos < 0) continue;
    if (isImportLetter(letters[pos])) continue; // вже все ок

    // Знайти лист який імпорт і у якого зараз сценарій НЕ 6/7
    let swapPos = -1;
    for (let i = 0; i < letters.length; i++) {
      if (i === pos) continue;
      if (assignments[i] === 6 || assignments[i] === 7) continue;
      if (isImportLetter(letters[i])) { swapPos = i; break; }
    }
    if (swapPos >= 0) {
      [assignments[pos], assignments[swapPos]] = [assignments[swapPos], assignments[pos]];
    }
    // Якщо нікого імпортного — лишаємо як є (хай буде на не-імпорті)
  }

  // Зберігаємо
  const updateStmt = db.prepare('UPDATE letters SET scenario_id=? WHERE id=?');
  for (let i = 0; i < letters.length; i++) {
    updateStmt.run(assignments[i], letters[i].id);
  }
  console.log(`[scenarios] Призначено сценарії: ${letters.map((l, i) => `${l.id.slice(0,8)}=R${assignments[i]}`).join(', ')}`);
}

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

  // Призначаємо scenario_id для листів цієї сесії якщо ще не призначені
  assignScenariosIfNeeded(letterIds);

  const letters = letterIds
    .map(lid => db.prepare('SELECT * FROM letters WHERE id=?').get(lid))
    .filter(Boolean)
    .map(l => {
      // Знаходимо параметри клієнта (місто) для зручності UI
      const client = l.client_id ? db.prepare('SELECT city FROM clients WHERE id=?').get(l.client_id) : null;
      let parsedDirs = [];
      try { parsedDirs = JSON.parse(l.dirs); } catch(e){}
      // Витягуємо to_city з адреси розвантаження або з тіла
      let fromCity = client?.city || '';
      let toCity = '';
      const route = (l.subject || '').match(/—\s*([^(]+)/);
      if (route) toCity = route[1].trim();
      return {
        ...l,
        missing: l.missing ? JSON.parse(l.missing) : [],
        dirs: parsedDirs,
        vehicle_alternatives: l.vehicle_alternatives ? JSON.parse(l.vehicle_alternatives) : [],
        hidden_data: l.hidden_data ? JSON.parse(l.hidden_data) : {},
        from_city: fromCity,
        to_city: toCity,
      };
    });

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
  const session = db.prepare('SELECT id, version, status FROM sessions WHERE student_id=?').get(req.user.id);
  if (!session) return res.json({ exists: false });

  // Швидкий запуск інцидентів для цієї сесії (миттєвість при polling)
  try { incidentScheduler.runDueIncidents(session.id); } catch (e) {}

  // Перечитуємо version бо runDueIncidents міг його змінити
  const fresh = db.prepare('SELECT version, status FROM sessions WHERE id=?').get(session.id);
  res.json({
    exists: true,
    version: fresh.version || '',
    status: fresh.status,
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

  // Q2 — якщо студент відповів на нагадування — пробуємо переносити/скасовувати тригери
  try {
    const lastStudentMsg = Array.isArray(messages)
      ? [...messages].reverse().find(m => m.role === 'student' || m.role === 'user')
      : null;
    if (lastStudentMsg?.text) {
      followupScheduler.handleStudentReplyToFollowup({
        db,
        sessionId: session.id,
        carrierId: req.params.carrierId,
        studentText: lastStudentMsg.text,
      });
    }
  } catch(e){}

  res.json({ ok: true });
});

// PATCH /api/student/chats/:carrierId/read
// Body: { indices: [0, 1, 5] } — індекси повідомлень які відмічаємо прочитаними
// Або: { all: true } — позначити всі непрочитані як прочитані
router.patch('/chats/:carrierId/read', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?')
    .get(session.id, req.params.carrierId);
  if (!chat) return res.json({ ok: true, updated: 0 });

  let messages = [];
  try { messages = JSON.parse(chat.messages || '[]'); } catch(e){}

  const { indices, all } = req.body || {};
  let updated = 0;
  if (all) {
    for (const m of messages) {
      if ((m.role === 'ai' || m.role === 'carrier') && !m.isSystem && m.read !== true) {
        m.read = true;
        updated++;
      }
    }
  } else if (Array.isArray(indices)) {
    for (const i of indices) {
      if (typeof i === 'number' && messages[i] && messages[i].read !== true) {
        messages[i].read = true;
        updated++;
      }
    }
  }

  if (updated > 0) {
    db.prepare("UPDATE carrier_chats SET messages=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), chat.id);
  }
  res.json({ ok: true, updated });
});

// GET /api/student/chats/unread-summary
// Повертає кількість непрочитаних по кожному перевізнику
// + загальну кількість непрочитаних повідомлень
router.get('/chats/unread-summary', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  // Швидкий запуск інцидентів для цієї сесії (миттєвість)
  try { incidentScheduler.runDueIncidents(session.id); } catch (e) {}

  const chats = db.prepare('SELECT carrier_id, messages, updated_at FROM carrier_chats WHERE session_id=?')
    .all(session.id);

  const byCarrier = {};
  let total = 0;
  for (const c of chats) {
    let messages = [];
    try { messages = JSON.parse(c.messages || '[]'); } catch(e){}
    // Рахуємо повідомлення від AI/carrier які не системні і не прочитані
    let unread = 0;
    let lastMsgTime = null;
    for (const m of messages) {
      if ((m.role === 'ai' || m.role === 'carrier') && !m.isSystem && m.read !== true) {
        unread++;
      }
      if (m.timestamp || m.time) {
        lastMsgTime = m.timestamp || m.time;
      }
    }
    byCarrier[c.carrier_id] = {
      unread,
      last_msg_time: lastMsgTime,
      updated_at: c.updated_at,
      total_msgs: messages.length,
    };
    total += unread;
  }
  res.json({ total, by_carrier: byCarrier });
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

  // Витягуємо РЕАЛЬНИЙ маршрут (міста, не лише країни) з листа
  const route = (() => {
    // Пріоритет 1: з subject листа — "Запит на перевезення: Коломия (UA) — Новий Сонч (PL)"
    if (letter.subject) {
      const m1 = letter.subject.match(/:\s*(.+?)\s*$/);
      if (m1 && m1[1].includes(' — ')) return m1[1].trim();
      const m2 = letter.subject.match(/(.+?)\s*[—–-]\s*(.+)$/);
      if (m2) return `${m2[1].trim()} — ${m2[2].trim()}`;
    }
    // Пріоритет 2: з body — "Маршрут: ..."
    if (letter.body) {
      const m = letter.body.match(/Маршрут:\s*(.+?)(?:\n|$)/);
      if (m) return m[1].trim();
      const m2 = letter.body.match(/Route:\s*(.+?)(?:\n|$)/);
      if (m2) return m2[1].trim();
    }
    // Фолбек: країни (як було)
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

  // Витягуємо РЕАЛЬНИЙ маршрут (міста, не лише країни) з листа
  const route = (() => {
    if (letter.subject) {
      const m1 = letter.subject.match(/:\s*(.+?)\s*$/);
      if (m1 && m1[1].includes(' — ')) return m1[1].trim();
      const m2 = letter.subject.match(/(.+?)\s*[—–-]\s*(.+)$/);
      if (m2) return `${m2[1].trim()} — ${m2[2].trim()}`;
    }
    if (letter.body) {
      const m = letter.body.match(/Маршрут:\s*(.+?)(?:\n|$)/);
      if (m) return m[1].trim();
      const m2 = letter.body.match(/Route:\s*(.+?)(?:\n|$)/);
      if (m2) return m2[1].trim();
    }
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

  // Якщо approve — плануємо followup-тригери "де заявка"
  // Тільки якщо є activна заявка для цього letter
  if (isApprove) {
    try {
      const activeApp = db.prepare(`
        SELECT * FROM applications
        WHERE session_id=? AND letter_id=? AND sent_to_carrier_at IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(session.id, letterId);

      if (activeApp) {
        followupScheduler.scheduleFollowups({
          db,
          session,
          application: activeApp,
          carrierId,
          sessionStartDateStr: session.start_date,
          loadDateStr: date,
        });
      }
      // Якщо заявки ще нема — followups запланються коли студент її створить
      // (можна додати окремо в POST /applications, але поки що тільки тут)
    } catch (e) {
      console.error('scheduleFollowups error:', e.message);
    }

    // Плануємо інциденти рейсу — ланцюжок подій від завантаження до доставки
    try {
      const chatForCarrier = db.prepare('SELECT id FROM carrier_chats WHERE session_id=? AND carrier_id=?')
        .get(session.id, carrierId);
      const letterScenario = db.prepare('SELECT scenario_id FROM letters WHERE id=?').get(letterId);
      // Перевіряємо чи вже не плановано інциденти для цього letter+carrier
      const alreadyPlanned = db.prepare(`
        SELECT COUNT(*) as cnt FROM incidents
        WHERE session_id=? AND letter_id=? AND state IN ('pending','triggered')
      `).get(session.id, letterId);
      if (alreadyPlanned.cnt === 0 && chatForCarrier && letterScenario) {
        // Конвертуємо date з формату DD.MM.YYYY в ISO
        let loadDateIso = null;
        const m = (date || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (m) loadDateIso = `${m[3]}-${m[2]}-${m[1]}T09:00:00.000Z`;
        incidentScheduler.scheduleInitialIncidents({
          sessionId: session.id,
          studentId: req.user.id,
          letterId,
          applicationId: null, // ще нема заявки в момент підтвердження
          scenarioId: letterScenario.scenario_id,
          carrierChatId: chatForCarrier.id,
          loadDateIso,
        });
      }
    } catch (e) {
      console.error('scheduleInitialIncidents error:', e.message);
    }
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

// ─── APPLICATIONS (Заявки) ─────────────────────────────────────
// Студент сам створює заявки після підтверджень (або раніше — як чорновик).
// Винагорода = client_freight - carrier_freight, але 0 якщо немає підтверджень з обома.
// Валідація НЕ блокує збереження — лише записує warnings для резюме.

const appValidator = require('../utils/application-validator');

// Обчислюємо наступний номер заявки для студента
function getNextApplicationNumber(studentId){
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT MAX(number_seq) as max_seq FROM applications WHERE student_id=? AND number_year=?')
    .get(studentId, year);
  const nextSeq = (row?.max_seq || 0) + 1;
  return { number_seq: nextSeq, number_year: year };
}

// GET /api/student/applications — список усіх заявок студента
router.get('/applications', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const rows = db.prepare(`
    SELECT * FROM applications WHERE session_id=? ORDER BY number_seq DESC
  `).all(session.id);

  const result = rows.map(r => ({
    ...r,
    validation_warnings: r.validation_warnings ? JSON.parse(r.validation_warnings) : [],
  }));
  res.json(result);
});

// GET /api/student/applications/:id — одна заявка
router.get('/applications/:id', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const row = db.prepare('SELECT * FROM applications WHERE id=? AND session_id=?').get(req.params.id, session.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  res.json({
    ...row,
    validation_warnings: row.validation_warnings ? JSON.parse(row.validation_warnings) : [],
  });
});

// POST /api/student/applications — створити заявку
router.post('/applications', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const body = req.body || {};

  // Базова валідація обов'язкових полів
  // R-поля з воркфлоу: Замовник, Перевізник, адреси завант./розв., вага,
  // тип вантажу, дата завант., тип ТЗ, номери, водій+тел, фрахти
  const required = {
    client_id: 'Замовник',
    carrier_id: 'Перевізник',
    load_address: 'Адреса завантаження',
    unload_address: 'Адреса розвантаження',
    cargo_description: 'Тип і характер вантажу',
    cargo_weight: 'Вага',
    load_date: 'Дата завантаження',
    vehicle_type: 'Тип ТЗ',
    truck_plate: '№ тягача',
    trailer_plate: '№ напівпричіпа',
    driver_name: 'Водій',
    driver_phone: 'Телефон водія',
    client_freight: 'Фрахт замовника',
    carrier_freight: 'Фрахт перевізника',
  };
  const missing = [];
  for (const [field, label] of Object.entries(required)) {
    const val = body[field];
    if (val === undefined || val === null || val === '') missing.push(label);
  }
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'missing_required',
      message: `Обов'язкові поля не заповнені: ${missing.join(', ')}`,
      missing,
    });
  }

  // Завантажуємо контекст для валідації (letter, order_progress)
  let letter = null, client = null, carrier = null, orderProgress = null;
  if (body.letter_id) {
    letter = db.prepare('SELECT * FROM letters WHERE id=?').get(body.letter_id);
    orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
      .get(session.id, body.letter_id);
  }
  if (body.client_id) {
    client = db.prepare('SELECT * FROM clients WHERE id=?').get(body.client_id);
  }
  if (body.carrier_id) {
    carrier = db.prepare('SELECT * FROM carriers WHERE id=?').get(body.carrier_id);
  }

  // Якщо letter_id не передано — пробуємо знайти letter за client_id
  // у поточному assignment студента
  if (!letter && body.client_id) {
    const assignment = session.assignment_id
      ? db.prepare('SELECT letter_ids FROM assignments WHERE id=?').get(session.assignment_id)
      : null;
    if (assignment?.letter_ids) {
      let letterIds = [];
      try { letterIds = JSON.parse(assignment.letter_ids); } catch(e){}
      if (letterIds.length > 0) {
        // Створюємо placeholder list для IN
        const placeholders = letterIds.map(() => '?').join(',');
        letter = db.prepare(
          `SELECT * FROM letters WHERE id IN (${placeholders}) AND client_id = ? LIMIT 1`
        ).get(...letterIds, body.client_id);
        if (letter) {
          orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
            .get(session.id, letter.id);
        }
      }
    }
  }

  // Запускаємо валідацію
  const warnings = appValidator.validateApplication({
    formData: body, orderProgress, letter, client, carrier,
  });

  // Обчислюємо винагороду
  const reward = appValidator.computeReward({ formData: body, orderProgress });

  // Генеруємо номер
  const { number_seq, number_year } = getNextApplicationNumber(req.user.id);

  // Зберігаємо
  const id = uuidv4();
  db.prepare(`INSERT INTO applications (
    id, session_id, student_id, number_seq, number_year,
    letter_id, client_id, carrier_id,
    load_address, customs_out, customs_in, unload_address, border_crossing,
    cargo_description, cargo_weight, cargo_volume, adr_class,
    load_date, unload_date,
    vehicle_type, vehicle_requirements,
    truck_plate, trailer_plate, driver_name, driver_phone,
    client_freight, carrier_freight, reward,
    additional_info, status, validation_warnings
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`).run(
    id, session.id, req.user.id, number_seq, number_year,
    letter?.id || null, body.client_id || null, body.carrier_id || null,
    body.load_address || null, body.customs_out || null, body.customs_in || null,
    body.unload_address || null, body.border_crossing || null,
    body.cargo_description || null, parseFloat(body.cargo_weight) || null,
    parseFloat(body.cargo_volume) || null, body.adr_class || null,
    body.load_date || null, body.unload_date || null,
    body.vehicle_type || null, body.vehicle_requirements || null,
    body.truck_plate || null, body.trailer_plate || null,
    body.driver_name || null, body.driver_phone || null,
    parseFloat(body.client_freight) || null,
    parseFloat(body.carrier_freight) || null,
    reward,
    body.additional_info || null,
    JSON.stringify(warnings),
  );

  // Якщо угода з обома вже закрита — плануємо followups одразу
  // (інакше followups плануються при confirm-carrier)
  if (orderProgress && orderProgress.client_agreed_at && orderProgress.carrier_agreed_at && body.carrier_id) {
    try {
      const justCreated = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
      followupScheduler.scheduleFollowups({
        db,
        session,
        application: justCreated,
        carrierId: body.carrier_id,
        sessionStartDateStr: session.start_date,
        loadDateStr: body.load_date,
      });
    } catch(e) {
      console.error('scheduleFollowups error on create:', e.message);
    }
  }

  res.json({
    id,
    number_seq,
    number_year,
    number_display: `${String(number_seq).padStart(4,'0')}/${number_year}`,
    reward,
    warnings,
    status: 'new',
  });
});

// PATCH /api/student/applications/:id — редагувати заявку
router.patch('/applications/:id', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const existing = db.prepare('SELECT * FROM applications WHERE id=? AND session_id=?')
    .get(req.params.id, session.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Не дозволяємо редагувати завершені заявки
  if (existing.status === 'completed') {
    return res.status(400).json({ error: 'cannot_edit', message: 'Заявку вже виконано, редагування неможливе.' });
  }

  const body = req.body || {};

  // Базова валідація (як у create)
  const required = {
    client_id: 'Замовник',
    carrier_id: 'Перевізник',
    load_address: 'Адреса завантаження',
    unload_address: 'Адреса розвантаження',
    cargo_description: 'Тип і характер вантажу',
    cargo_weight: 'Вага',
    load_date: 'Дата завантаження',
    vehicle_type: 'Тип ТЗ',
    truck_plate: '№ тягача',
    trailer_plate: '№ напівпричіпа',
    driver_name: 'Водій',
    driver_phone: 'Телефон водія',
    client_freight: 'Фрахт замовника',
    carrier_freight: 'Фрахт перевізника',
  };
  const missing = [];
  for (const [field, label] of Object.entries(required)) {
    const val = body[field];
    if (val === undefined || val === null || val === '') missing.push(label);
  }
  if (missing.length > 0) {
    return res.status(400).json({
      error: 'missing_required',
      message: `Обов'язкові поля не заповнені: ${missing.join(', ')}`,
      missing,
    });
  }

  // Контекст для валідації
  let letter = null, client = null, carrier = null, orderProgress = null;
  const letterId = body.letter_id || existing.letter_id;
  if (letterId) {
    letter = db.prepare('SELECT * FROM letters WHERE id=?').get(letterId);
    orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
      .get(session.id, letterId);
  }
  if (body.client_id) client = db.prepare('SELECT * FROM clients WHERE id=?').get(body.client_id);
  if (body.carrier_id) carrier = db.prepare('SELECT * FROM carriers WHERE id=?').get(body.carrier_id);

  // Якщо немає letter — пробуємо знайти за client_id у поточному assignment
  if (!letter && body.client_id) {
    const assignment = session.assignment_id
      ? db.prepare('SELECT letter_ids FROM assignments WHERE id=?').get(session.assignment_id)
      : null;
    if (assignment?.letter_ids) {
      let letterIds = [];
      try { letterIds = JSON.parse(assignment.letter_ids); } catch(e){}
      if (letterIds.length > 0) {
        const placeholders = letterIds.map(() => '?').join(',');
        letter = db.prepare(
          `SELECT * FROM letters WHERE id IN (${placeholders}) AND client_id = ? LIMIT 1`
        ).get(...letterIds, body.client_id);
        if (letter) {
          orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
            .get(session.id, letter.id);
        }
      }
    }
  }

  const warnings = appValidator.validateApplication({
    formData: body, orderProgress, letter, client, carrier,
  });

  const reward = appValidator.computeReward({ formData: body, orderProgress });

  db.prepare(`UPDATE applications SET
    letter_id=?, client_id=?, carrier_id=?,
    load_address=?, customs_out=?, customs_in=?, unload_address=?, border_crossing=?,
    cargo_description=?, cargo_weight=?, cargo_volume=?, adr_class=?,
    load_date=?, unload_date=?,
    vehicle_type=?, vehicle_requirements=?,
    truck_plate=?, trailer_plate=?, driver_name=?, driver_phone=?,
    client_freight=?, carrier_freight=?, reward=?,
    additional_info=?, validation_warnings=?,
    updated_at=datetime('now')
    WHERE id=?`).run(
    letter?.id || null, body.client_id || null, body.carrier_id || null,
    body.load_address || null, body.customs_out || null, body.customs_in || null,
    body.unload_address || null, body.border_crossing || null,
    body.cargo_description || null, parseFloat(body.cargo_weight) || null,
    parseFloat(body.cargo_volume) || null, body.adr_class || null,
    body.load_date || null, body.unload_date || null,
    body.vehicle_type || null, body.vehicle_requirements || null,
    body.truck_plate || null, body.trailer_plate || null,
    body.driver_name || null, body.driver_phone || null,
    parseFloat(body.client_freight) || null,
    parseFloat(body.carrier_freight) || null,
    reward,
    body.additional_info || null,
    JSON.stringify(warnings),
    req.params.id,
  );

  res.json({
    id: req.params.id,
    reward,
    warnings,
    updated: true,
  });
});

// GET /api/student/clients — список замовників (тих хто надсилав листи цьому студенту)
router.get('/clients', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  // Беремо замовників ТІЛЬКИ з листів поточного assignment студента
  // (а не всіх assignments — інакше після рестарту бачив би старих)
  if (!session.assignment_id) return res.json([]);
  const assignment = db.prepare('SELECT letter_ids FROM assignments WHERE id=?')
    .get(session.assignment_id);
  if (!assignment?.letter_ids) return res.json([]);

  let letterIds = [];
  try { letterIds = JSON.parse(assignment.letter_ids); } catch(e){}
  if (letterIds.length === 0) return res.json([]);

  const placeholders = letterIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT c.id, c.company, c.person, c.country
    FROM clients c
    INNER JOIN letters l ON l.client_id = c.id
    WHERE l.id IN (${placeholders})
    ORDER BY c.company
  `).all(...letterIds);
  res.json(rows);
});

// GET /api/student/all-carriers — повний список перевізників (для dropdown заявки)
router.get('/all-carriers', STU, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, person, phone FROM carriers
    WHERE active=1 AND COALESCE(for_exchange,0)=0
    ORDER BY name
  `).all();
  res.json(rows);
});

// GET /api/student/carriers/search?q=... — пошук для автокомпліту
// УВАГА: SQLite LOWER() і COLLATE NOCASE працюють тільки з ASCII.
// Для кирилиці нормалізуємо в Node.js (toLowerCase() українська працює коректно).
router.get('/carriers/search', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);

  // Беремо всіх активних — їх ~635, можна фільтрувати в пам'яті
  const all = db.prepare(`
    SELECT c.id, c.name, c.person, c.phone,
           CASE WHEN EXISTS(
             SELECT 1 FROM carrier_chats cc
             WHERE cc.session_id = ? AND cc.carrier_id = c.id
           ) THEN 1 ELSE 0 END AS had_chat
    FROM carriers c
    WHERE c.active=1 AND COALESCE(c.for_exchange,0)=0
  `).all(session.id);

  // Фільтр у Node.js — коректно з кирилицею
  const filtered = all.filter(c => {
    const name = (c.name || '').toLowerCase();
    const person = (c.person || '').toLowerCase();
    return name.includes(q) || person.includes(q);
  });

  // Сортуємо: спочатку ті з ким уже спілкувались, потім за алфавітом
  filtered.sort((a, b) => {
    if (a.had_chat !== b.had_chat) return b.had_chat - a.had_chat;
    return (a.name || '').localeCompare(b.name || '', 'uk');
  });

  res.json(filtered.slice(0, 20));
});

// ─── НАДСИЛАННЯ ЗАЯВКИ ПЕРЕВІЗНИКУ ────────────────────────────
// POST /api/student/applications/:id/send-to-carrier
// Body: { carrier_id }

router.post('/applications/:id/send-to-carrier', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const appId = req.params.id;
  const targetCarrierId = req.body?.carrier_id;

  if (!targetCarrierId) {
    return res.status(400).json({ error: 'carrier_required', message: 'Оберіть перевізника зі списку' });
  }

  // Завантажуємо заявку
  const app = db.prepare('SELECT * FROM applications WHERE id=? AND session_id=?')
    .get(appId, session.id);
  if (!app) return res.status(404).json({ error: 'application_not_found' });

  // Перевіряємо: угода має бути підтверджена з обома сторонами
  // (це означає що order_progress має client_agreed_at AND carrier_agreed_at)
  if (app.letter_id) {
    const op = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
      .get(session.id, app.letter_id);
    if (!op || !op.client_agreed_at || !op.carrier_agreed_at) {
      return res.status(400).json({
        error: 'deal_not_closed',
        message: 'Не можна надіслати заявку: спочатку підтвердіть угоду з замовником і перевізником.',
      });
    }
  }

  // Перевіряємо перевізника
  const carrier = db.prepare('SELECT * FROM carriers WHERE id=?').get(targetCarrierId);
  if (!carrier) return res.status(404).json({ error: 'carrier_not_found' });

  const now = new Date().toISOString();
  const msgId = uuidv4();

  // Збираємо дані заявки у структуру для вкладення
  let letter = null, client = null;
  if (app.letter_id) letter = db.prepare('SELECT * FROM letters WHERE id=?').get(app.letter_id);
  if (app.client_id) client = db.prepare('SELECT * FROM clients WHERE id=?').get(app.client_id);

  const attachment = {
    type: 'application_to_carrier',
    application_id: app.id,
    msg_id: msgId,
    data: {
      number_seq: app.number_seq,
      number_year: app.number_year,
      number_display: `${String(app.number_seq).padStart(4,'0')}/${app.number_year}`,
      created_date: now,
      // Сторони
      docaa: {
        company: 'Docaa LLC',
        address: 'м. Івано-Франківськ, вул. Української Дивізії 27',
        vat_id: 'ЄДРПОУ 37794411',
        phone: '+380 342 26 07 42',
      },
      carrier: {
        name: carrier.name,
        person: carrier.person,
        phone: carrier.phone,
      },
      // Маршрут
      load_address: app.load_address,
      customs_out: app.customs_out,
      border_crossing: app.border_crossing,
      unload_address: app.unload_address,
      customs_in: app.customs_in,
      // Вантаж
      cargo_description: app.cargo_description,
      cargo_weight: app.cargo_weight,
      cargo_volume: app.cargo_volume,
      adr_class: app.adr_class,
      // Дати
      load_date: app.load_date,
      unload_date: app.unload_date,
      // ТЗ
      vehicle_type: app.vehicle_type,
      vehicle_requirements: app.vehicle_requirements,
      truck_plate: app.truck_plate,
      trailer_plate: app.trailer_plate,
      driver_name: app.driver_name,
      driver_phone: app.driver_phone,
      // Фінанси (тільки фрахт перевізнику!)
      freight: app.carrier_freight,
      // Додатково
      additional_info: app.additional_info,
    },
  };

  // Додаємо повідомлення з вкладенням у carrier_chats
  const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?')
    .get(session.id, targetCarrierId);

  // Системне-вихідне повідомлення (від студента)
  const outMsg = {
    id: msgId,
    role: 'student',
    text: `📋 Надіслав заявку №${String(app.number_seq).padStart(4,'0')}/${app.number_year}`,
    timestamp: now,
    attachment,
    isSystem: true, // ознака — не звичайне повідомлення
  };

  // ТИМЧАСОВА реакція перевізника (поки не маємо текстів від користувача)
  const tempReplies = [
    'Прийняв заявку. Виходимо в рейс.',
    'Все ок, бачу заявку. Чекаю завантаження.',
    'Прийняв, виходимо за маршрутом.',
    'Ок, прийнято. Деталі ще раз перевірю.',
  ];
  const replyMsg = {
    role: 'ai',
    text: tempReplies[Math.floor(Math.random() * tempReplies.length)],
    timestamp: new Date(Date.now() + 1000).toISOString(),
    read: false,
  };

  let messages = [];
  if (chat) {
    try { messages = JSON.parse(chat.messages || '[]'); } catch(e){}
  }
  messages.push(outMsg);
  messages.push(replyMsg);

  if (chat) {
    db.prepare("UPDATE carrier_chats SET messages=?, deal_status='confirmed', updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), chat.id);
  } else {
    db.prepare("INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,'confirmed')")
      .run(uuidv4(), session.id, targetCarrierId, JSON.stringify(messages));
  }

  // Оновлюємо applications
  db.prepare(`UPDATE applications SET
    sent_to_carrier_at=?, sent_to_carrier_id=?, sent_message_id=?,
    updated_at=datetime('now')
    WHERE id=?`)
    .run(now, targetCarrierId, msgId, app.id);

  // Скасовуємо всі попередні followups для цієї заявки
  followupScheduler.cancelFollowups({ db, applicationId: app.id });

  // Записуємо подію
  if (app.letter_id) {
    try {
      db.prepare('INSERT INTO order_events (id,session_id,letter_id,type,payload) VALUES (?,?,?,?,?)')
        .run(uuidv4(), session.id, app.letter_id, 'application_sent_to_carrier', JSON.stringify({
          application_id: app.id,
          carrier_id: targetCarrierId,
          carrier_name: carrier.name,
        }));
    } catch(e){}
  }

  res.json({
    sent: true,
    msg_id: msgId,
    carrier_id: targetCarrierId,
    carrier_name: carrier.name,
    reply: replyMsg,
  });
});

// Хук — при підтвердженні угоди з перевізником ПЛАНУЄМО followups
// Це викликається з confirm-carrier endpoint. Знаходимо його і додаємо виклик.
// (зроблено нижче через wrapping middleware)

module.exports = router;
