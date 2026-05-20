// server/routes/lecturer.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const LEC = requireAuth(['lecturer','superadmin']);

// ── GROUPS ────────────────────────────────────────────────────

// GET /api/lecturer/groups
router.get('/groups', LEC, (req, res) => {
  const rows = db.prepare(`
    SELECT g.*, COUNT(gm.student_id) as student_count
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.lecturer_id = ? AND g.active = 1
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// POST /api/lecturer/groups
router.post('/groups', LEC, (req, res) => {
  const { name, notes, start_date } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!start_date) return res.status(400).json({ error: 'start_date required' });
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(start_date)) {
    return res.status(400).json({ error: 'start_date must be DD.MM.YYYY' });
  }
  const id = uuidv4();
  db.prepare('INSERT INTO groups (id,name,lecturer_id,notes,start_date) VALUES (?,?,?,?,?)')
    .run(id, name.trim(), req.user.id, notes||'', start_date);
  res.status(201).json({ id, name, start_date });
});

// PATCH /api/lecturer/groups/:id
router.patch('/groups/:id', LEC, (req, res) => {
  const g = db.prepare('SELECT id,started_at FROM groups WHERE id=? AND lecturer_id=?').get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { name, notes, active, start_date } = req.body;
  if (name) db.prepare('UPDATE groups SET name=? WHERE id=?').run(name, req.params.id);
  if (notes !== undefined) db.prepare('UPDATE groups SET notes=? WHERE id=?').run(notes, req.params.id);
  if (active !== undefined) db.prepare('UPDATE groups SET active=? WHERE id=?').run(active?1:0, req.params.id);
  if (start_date !== undefined) {
    if (g.started_at) return res.status(400).json({ error: 'Cannot change start_date after simulation started. Reset start first.' });
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(start_date)) return res.status(400).json({ error: 'start_date must be DD.MM.YYYY' });
    db.prepare('UPDATE groups SET start_date=? WHERE id=?').run(start_date, req.params.id);
  }
  res.json({ ok: true });
});

// ── STUDENTS ──────────────────────────────────────────────────

// GET /api/lecturer/groups/:groupId/students
router.get('/groups/:groupId/students', LEC, (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });

  const rows = db.prepare(`
    SELECT u.id, u.email, u.name, u.active, u.last_login,
           s.status as sim_status, s.profit, s.timer_day, s.timer_ms,
           a.id as assignment_id
    FROM group_members gm
    JOIN users u ON u.id = gm.student_id
    LEFT JOIN sessions s ON s.student_id = u.id
    LEFT JOIN assignments a ON a.student_id = u.id AND a.group_id = gm.group_id
    WHERE gm.group_id = ?
    ORDER BY u.name
  `).all(req.params.groupId);
  res.json(rows);
});

// POST /api/lecturer/groups/:groupId/students — add student
router.post('/groups/:groupId/students', LEC, async (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });

  const { email, name, password } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'email, name, password required' });

  let student = db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!student) {
    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id,email,name,password,role,created_by) VALUES (?,?,?,?,?,?)')
      .run(id, email.trim().toLowerCase(), name.trim(), hash, 'student', req.user.id);
    student = { id };
  }

  const exists = db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND student_id=?').get(req.params.groupId, student.id);
  if (exists) return res.status(409).json({ error: 'Student already in group' });

  db.prepare('INSERT INTO group_members (group_id,student_id) VALUES (?,?)').run(req.params.groupId, student.id);

  // Auto-generate assignment
  const assignment = generateAssignment(student.id, req.params.groupId, req.user.id);

  res.status(201).json({ student_id: student.id, assignment_id: assignment.id });
});

// DELETE /api/lecturer/groups/:groupId/students/:studentId
router.delete('/groups/:groupId/students/:studentId', LEC, (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM group_members WHERE group_id=? AND student_id=?').run(req.params.groupId, req.params.studentId);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.studentId);
  res.json({ ok: true });
});

// ── ASSIGNMENTS ───────────────────────────────────────────────

// GET /api/lecturer/students/:studentId/assignment
router.get('/students/:studentId/assignment', LEC, (req, res) => {
  const a = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(req.params.studentId);
  if (!a) return res.status(404).json({ error: 'No assignment' });
  const letterIds = JSON.parse(a.letter_ids);
  const letters = letterIds.map(lid => db.prepare('SELECT * FROM letters WHERE id=?').get(lid)).filter(Boolean);
  res.json({ ...a, letters });
});

// PATCH /api/lecturer/students/:studentId/assignment — edit letter list
router.patch('/students/:studentId/assignment', LEC, (req, res) => {
  const { add_letter_id, remove_letter_id } = req.body;
  const a = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(req.params.studentId);
  if (!a) return res.status(404).json({ error: 'No assignment' });

  let ids = JSON.parse(a.letter_ids);
  if (add_letter_id && !ids.includes(add_letter_id)) ids.push(add_letter_id);
  if (remove_letter_id) ids = ids.filter(id => id !== remove_letter_id);

  db.prepare('UPDATE assignments SET letter_ids=? WHERE id=?').run(JSON.stringify(ids), a.id);
  res.json({ ok: true, letter_ids: ids });
});

// ── SIMULATION START CONTROL ──────────────────────────────────

// POST /api/lecturer/groups/:id/start — запуск симуляції для групи
router.post('/groups/:id/start', LEC, (req, res) => {
  const g = db.prepare('SELECT id,start_date,started_at FROM groups WHERE id=? AND lecturer_id=?')
              .get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (!g.start_date) return res.status(400).json({ error: 'start_date not set' });
  if (g.started_at) return res.status(400).json({ error: 'Already started' });

  // Валідація: start_date не має бути в минулому
  const parts = g.start_date.split('.');
  const startD = new Date(parseInt(parts[2]), parseInt(parts[1])-1, parseInt(parts[0]));
  const today = new Date();
  today.setHours(0,0,0,0);
  startD.setHours(0,0,0,0);
  if (startD.getTime() < today.getTime()) {
    return res.status(400).json({ error: 'start_date_in_past', message: 'Дата старту в минулому. Виправте дату й спробуйте знову.' });
  }

  db.prepare(`UPDATE groups SET started_at=datetime('now') WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// POST /api/lecturer/groups/:id/reset-start — скинути дату старту
// Обнуляє і start_date (щоб лектор міг ввести нову) і started_at
router.post('/groups/:id/reset-start', LEC, (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  db.prepare("UPDATE groups SET started_at=NULL, start_date=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── SESSION CONTROL ───────────────────────────────────────────

// POST /api/lecturer/sessions/:studentId/stop
router.post('/sessions/:studentId/stop', LEC, (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(req.params.studentId);
  if (!s) return res.status(404).json({ error: 'No active session' });
  db.prepare(`UPDATE sessions SET status='stopped', stopped_by=? WHERE student_id=?`)
    .run(req.user.id, req.params.studentId);
  res.json({ ok: true });
});

// POST /api/lecturer/sessions/:studentId/resume
router.post('/sessions/:studentId/resume', LEC, (req, res) => {
  db.prepare(`UPDATE sessions SET status='active', stopped_by=NULL WHERE student_id=?`)
    .run(req.params.studentId);
  res.json({ ok: true });
});

// POST /api/lecturer/sessions/:studentId/reset
// Скидає сесію і генерує новий набір листів
router.post('/sessions/:studentId/reset', LEC, (req, res) => {
  const studentId = req.params.studentId;

  // Get current session id before deleting
  const session = db.prepare('SELECT id FROM sessions WHERE student_id=?').get(studentId);

  // Delete in correct order (children first)
  if (session) {
    db.prepare('DELETE FROM email_threads WHERE session_id=?').run(session.id);
    db.prepare('DELETE FROM carrier_chats WHERE session_id=?').run(session.id);
    db.prepare('DELETE FROM order_progress WHERE session_id=?').run(session.id);
    db.prepare('DELETE FROM confirmations WHERE session_id=?').run(session.id).catch?.(() => {});
    db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);
  }

  // Delete old assignment and generate new one
  const oldAssignment = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(studentId);
  if (oldAssignment) {
    db.prepare('DELETE FROM assignments WHERE student_id=?').run(studentId);
  }

  // Find group for this student
  const member = db.prepare('SELECT group_id FROM group_members WHERE student_id=?').get(studentId);
  if (!member) return res.status(404).json({ error: 'Student not in any group' });

  // Generate fresh assignment
  const newAssignment = generateAssignment(studentId, member.group_id, req.user.id);

  res.json({ ok: true, new_assignment_id: newAssignment.id, letter_count: newAssignment.letter_ids.length });
});

// POST /api/lecturer/groups/:groupId/reset — рестарт всієї групи
// Скидає прогрес студентів, генерує нові набори листів,
// І ВСТАНОВЛЮЄ start_date = сьогодні, started_at = сьогодні (варіант A)
// Тобто симуляція одразу йде з новою датою.
router.post('/groups/:groupId/reset', LEC, (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });

  const members = db.prepare('SELECT student_id FROM group_members WHERE group_id=?').all(req.params.groupId);
  const results = [];

  for (const m of members) {
    const studentId = m.student_id;
    const session = db.prepare('SELECT id FROM sessions WHERE student_id=?').get(studentId);

    if (session) {
      db.prepare('DELETE FROM email_threads WHERE session_id=?').run(session.id);
      db.prepare('DELETE FROM carrier_chats WHERE session_id=?').run(session.id);
      db.prepare('DELETE FROM order_progress WHERE session_id=?').run(session.id);
      db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);
    }

    db.prepare('DELETE FROM assignments WHERE student_id=?').run(studentId);
    const newAssignment = generateAssignment(studentId, req.params.groupId, req.user.id);
    results.push({ student_id: studentId, letters: newAssignment.letter_ids.length });
  }

  // Оновлюємо start_date на СЬОГОДНІ + started_at = сьогодні
  // Симуляція стартує одразу з новою датою
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const todayStr = `${dd}.${mm}.${yyyy}`;
  db.prepare("UPDATE groups SET start_date=?, started_at=datetime('now') WHERE id=?")
    .run(todayStr, req.params.groupId);

  res.json({ ok: true, students_reset: results.length, results, new_start_date: todayStr });
});

// GET /api/lecturer/sessions/:studentId — view student progress
router.get('/sessions/:studentId', LEC, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(req.params.studentId);
  if (!session) return res.json({ no_session: true });

  const orders = db.prepare('SELECT * FROM order_progress WHERE session_id=?').all(session.id);
  const emailThreads = db.prepare('SELECT * FROM email_threads WHERE session_id=?').all(session.id);
  const chats = db.prepare('SELECT * FROM carrier_chats WHERE session_id=?').all(session.id);

  res.json({
    session: { ...session, state_json: undefined },
    orders,
    email_threads: emailThreads.map(t => ({ ...t, messages: JSON.parse(t.messages) })),
    chats: chats.map(c => ({ ...c, messages: JSON.parse(c.messages) })),
  });
});

// GET /api/lecturer/letters — all available letters
router.get('/letters', LEC, (req, res) => {
  const letters = db.prepare('SELECT id,code,type,country,from_name,company,subject,vehicle,dirs,active FROM letters ORDER BY code').all();
  res.json(letters);
});

// ── RATES ─────────────────────────────────────────────────────

// POST /api/lecturer/groups/:groupId/rates — set EUR/UAH rates for group
router.post('/groups/:groupId/rates', LEC, (req, res) => {
  const { rates } = req.body; // [41.5, 41.65, ...]
  if (!Array.isArray(rates) || rates.length !== 5) return res.status(400).json({ error: '5 rates required' });
  if (rates.some(r => typeof r !== 'number' || r < 10)) return res.status(400).json({ error: 'Each rate must be a number >= 10' });

  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });

  const ratesJson = JSON.stringify(rates);
  // Майстер — groups.rates
  db.prepare('UPDATE groups SET rates=? WHERE id=?').run(ratesJson, req.params.groupId);
  // Дублюємо в sessions.rates для тих студентів які вже мають сесію
  const members = db.prepare('SELECT student_id FROM group_members WHERE group_id=?').all(req.params.groupId);
  for (const m of members) {
    db.prepare('UPDATE sessions SET rates=? WHERE student_id=?').run(ratesJson, m.student_id);
  }
  res.json({ ok: true });
});

// GET /api/lecturer/groups/:groupId/rates — отримати поточні курси групи
router.get('/groups/:groupId/rates', LEC, (req, res) => {
  const g = db.prepare('SELECT rates FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  res.json({ rates: JSON.parse(g.rates || '[41.5,41.65,41.8,41.7,41.9]') });
});

// ── HELPER: generate assignment ───────────────────────────────
function generateAssignment(studentId, groupId, createdBy) {
  const allLetters = db.prepare('SELECT id,type FROM letters WHERE active=1').all();

  // True Fisher-Yates shuffle
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const complete = shuffle(allLetters.filter(l => l.type === 'complete'));
  const missing  = shuffle(allLetters.filter(l => l.type === 'missing'));
  const form     = shuffle(allLetters.filter(l => l.type === 'form'));

  // Check how many letters already used by other students in this group
  // to ensure variety across students
  const groupAssignments = db.prepare(
    'SELECT letter_ids FROM assignments WHERE group_id=?'
  ).all(groupId);

  // Count usage of each letter in this group
  const usageCount = {};
  groupAssignments.forEach(a => {
    JSON.parse(a.letter_ids).forEach(id => {
      usageCount[id] = (usageCount[id] || 0) + 1;
    });
  });

  // Sort by least used first to maximize variety
  const sortByUsage = arr => [...arr].sort((a, b) =>
    (usageCount[a.id] || 0) - (usageCount[b.id] || 0)
  );

  let selected = [];

  // Take least-used letters from each type — guaranteed 8 total
  // Distribution: 3 complete + 3 missing + 2 form = 8
  const pickComplete = sortByUsage(complete).slice(0, Math.min(3, complete.length));
  const pickMissing  = sortByUsage(missing).slice(0, Math.min(3, missing.length));
  const pickForm     = sortByUsage(form).slice(0, Math.min(2, form.length));

  selected.push(...pickComplete, ...pickMissing, ...pickForm);

  // If still less than 8 — fill from remaining letters
  if (selected.length < 8) {
    const selectedIds = new Set(selected.map(l => l.id));
    const remaining = shuffle(allLetters.filter(l => !selectedIds.has(l.id)));
    selected.push(...remaining.slice(0, 8 - selected.length));
  }

  // Final shuffle
  selected = shuffle(selected).slice(0, 8);

  // Fallback if DB is empty
  if (selected.length === 0) selected = allLetters.slice(0, 8);

  const id = uuidv4();
  db.prepare('INSERT INTO assignments (id,student_id,group_id,letter_ids,created_by) VALUES (?,?,?,?,?)')
    .run(id, studentId, groupId, JSON.stringify(selected.map(l => l.id)), createdBy);

  return { id, letter_ids: selected.map(l => l.id) };
}

// ── STUDENT DETAILS (для сторінки управління групою) ─────────

// GET /api/lecturer/students/:studentId/details — повна картина студента
// Повертає: статус сесії + метрики + список рейсів з прогресом
router.get('/students/:studentId/details', LEC, (req, res) => {
  const studentId = req.params.studentId;

  // Перевірка що цей студент у групі цього лектора
  const access = db.prepare(`
    SELECT g.id FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_id=? AND g.lecturer_id=?
  `).get(studentId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Student not found' });

  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(studentId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(studentId);
  if (!session) {
    return res.json({
      student: user,
      session: null,
      orders: [],
      metrics: null,
    });
  }

  // Загружаємо ордери і вкладаємо листи
  const assignment = db.prepare('SELECT letter_ids FROM assignments WHERE student_id=?').get(studentId);
  const letterIds = assignment ? JSON.parse(assignment.letter_ids) : [];
  const orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=?').all(session.id);

  const orders = letterIds.map(lid => {
    const letter = db.prepare('SELECT id,code,from_name,company,subject,vehicle,dirs FROM letters WHERE id=?').get(lid);
    if (!letter) return null;
    const op = orderProgress.find(o => o.letter_id === lid) || {};
    let carrier = null;
    if (op.carrier_id) {
      carrier = db.prepare('SELECT name,person FROM carriers WHERE id=?').get(op.carrier_id);
    }
    return {
      id: letter.id,
      code: letter.code,
      from: letter.from_name,
      company: letter.company,
      subject: letter.subject,
      vehicle: letter.vehicle,
      dirs: JSON.parse(letter.dirs || '[]'),
      status: op.status || 'new',
      client_freight: op.client_freight || null,
      carrier_freight: op.carrier_freight || null,
      carrier_name: carrier ? carrier.name : null,
      margin: (op.client_freight && op.carrier_freight) ? +(op.client_freight - op.carrier_freight).toFixed(2) : null,
    };
  }).filter(Boolean);

  // Метрики
  const emailThreadsCount = db.prepare('SELECT COUNT(*) as c FROM email_threads WHERE session_id=?').get(session.id).c;
  const carrierChatsCount = db.prepare('SELECT COUNT(*) as c FROM carrier_chats WHERE session_id=?').get(session.id).c;
  const closedCount = orders.filter(o => o.status === 'confirmed' || o.status === 'done').length;
  const totalMargin = orders.reduce((s, o) => s + (o.margin || 0), 0);
  const avgMargin = closedCount ? +(totalMargin / closedCount).toFixed(2) : 0;
  const totalRevenue = orders.reduce((s, o) => s + (o.client_freight || 0), 0);
  const marginPct = totalRevenue ? +(totalMargin / totalRevenue * 100).toFixed(1) : 0;

  const metrics = {
    profit: +totalMargin.toFixed(2),
    revenue: +totalRevenue.toFixed(2),
    closed: closedCount,
    total: 8,
    avg_margin_eur: avgMargin,
    avg_margin_pct: marginPct,
    email_threads: emailThreadsCount,
    carrier_chats: carrierChatsCount,
    timer_day: session.timer_day,
    is_complete: (session.timer_day || 0) > 5 || closedCount === 8,
  };

  res.json({
    student: user,
    session: {
      id: session.id,
      status: session.status,
      timer_day: session.timer_day,
      profit: session.profit,
      start_date: session.start_date,
      is_complete: metrics.is_complete,
    },
    orders,
    metrics,
  });
});

// ── SUMMARY (AI-резюме) ───────────────────────────────────────

const AI_RATE_LIMITER_LECT = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 10, // 10 AI-резюме на лектора/хв
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many AI requests. Please wait a minute.' }
});

// GET /api/lecturer/students/:studentId/summary
router.get('/students/:studentId/summary', LEC, (req, res) => {
  const studentId = req.params.studentId;
  // Перевірка доступу
  const access = db.prepare(`
    SELECT g.id FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_id=? AND g.lecturer_id=?
  `).get(studentId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Student not found' });

  const summary = db.prepare('SELECT * FROM student_summaries WHERE student_id=?').get(studentId);
  if (!summary) return res.json({ exists: false });
  res.json({
    exists: true,
    ai_text: summary.ai_text,
    lecturer_note: summary.lecturer_note || '',
    metrics_json: summary.metrics_json ? JSON.parse(summary.metrics_json) : null,
    generated_at: summary.generated_at,
    note_updated_at: summary.note_updated_at,
    sent_to_student: !!summary.sent_to_student,
    sent_at: summary.sent_at,
  });
});

// POST /api/lecturer/students/:studentId/summary/generate
// Генерує AI-резюме. Доступно тільки якщо симуляція завершена.
router.post('/students/:studentId/summary/generate', LEC, AI_RATE_LIMITER_LECT, async (req, res) => {
  const studentId = req.params.studentId;

  // Перевірка доступу + завантаження групи
  const group = db.prepare(`
    SELECT g.id,g.name FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_id=? AND g.lecturer_id=?
  `).get(studentId, req.user.id);
  if (!group) return res.status(404).json({ error: 'Student not found' });

  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(studentId);
  const session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(studentId);
  if (!session) return res.status(400).json({ error: 'Student has no session' });

  // Перевірка: симуляція завершена?
  const isComplete = (session.timer_day || 0) > 5;
  if (!isComplete) {
    // Опційно — рахуємо чи всі 8 рейсів закриті
    const orders = db.prepare('SELECT status FROM order_progress WHERE session_id=?').all(session.id);
    const closed = orders.filter(o => o.status === 'confirmed' || o.status === 'done').length;
    if (closed < 8) return res.status(400).json({ error: 'simulation_not_complete', message: 'Симуляція ще не завершена. Резюме доступне після 5 днів або закриття всіх 8 рейсів.' });
  }

  // Перевіряємо чи вже є резюме (якщо так — це reuse, не блокуємо)
  const existing = db.prepare('SELECT id,lecturer_note FROM student_summaries WHERE student_id=?').get(studentId);
  const keepNote = existing?.lecturer_note || '';

  // Збираємо контекст для AI
  const assignment = db.prepare('SELECT letter_ids FROM assignments WHERE student_id=?').get(studentId);
  const letterIds = assignment ? JSON.parse(assignment.letter_ids) : [];

  const emailThreads = db.prepare('SELECT * FROM email_threads WHERE session_id=?').all(session.id);
  const carrierChats = db.prepare('SELECT * FROM carrier_chats WHERE session_id=?').all(session.id);
  const orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=?').all(session.id);

  // Готуємо метрики
  let totalMargin = 0, totalRevenue = 0, closedCount = 0;
  const ordersDetail = [];
  for (const lid of letterIds) {
    const letter = db.prepare('SELECT * FROM letters WHERE id=?').get(lid);
    if (!letter) continue;
    const op = orderProgress.find(o => o.letter_id === lid) || {};
    const carrier = op.carrier_id ? db.prepare('SELECT name,person FROM carriers WHERE id=?').get(op.carrier_id) : null;
    const thread = emailThreads.find(t => t.letter_id === lid);
    const chat = op.carrier_id ? carrierChats.find(c => c.carrier_id === op.carrier_id) : null;
    const margin = (op.client_freight && op.carrier_freight) ? (op.client_freight - op.carrier_freight) : 0;
    if (op.status === 'confirmed' || op.status === 'done') closedCount++;
    if (op.client_freight) totalRevenue += op.client_freight;
    totalMargin += margin;

    ordersDetail.push({
      code: letter.code,
      from: letter.from_name,
      company: letter.company,
      subject: letter.subject,
      country: letter.country,
      lang: letter.lang || 'uk',
      vehicle: letter.vehicle,
      dirs: JSON.parse(letter.dirs || '[]'),
      body: letter.body || '',
      status: op.status || 'new',
      client_freight: op.client_freight,
      carrier_freight: op.carrier_freight,
      carrier_name: carrier?.name,
      margin: +margin.toFixed(2),
      margin_pct: op.client_freight ? +(margin / op.client_freight * 100).toFixed(1) : 0,
      email_messages: thread ? JSON.parse(thread.messages || '[]') : [],
      carrier_messages: chat ? JSON.parse(chat.messages || '[]') : [],
    });
  }

  const avgMarginPct = totalRevenue ? +(totalMargin / totalRevenue * 100).toFixed(1) : 0;

  const metrics = {
    profit: +totalMargin.toFixed(2),
    revenue: +totalRevenue.toFixed(2),
    closed: closedCount,
    total: 8,
    avg_margin_pct: avgMarginPct,
    email_threads: emailThreads.length,
    carrier_chats: carrierChats.length,
    docs_count: closedCount * 2, // приблизно: довідка+рахунок на закритий рейс
  };

  // Будуємо промпт
  const systemPrompt = buildSummarySystemPrompt();
  const userPrompt = buildSummaryUserPrompt(user, group, session, metrics, ordersDetail);

  // Виклик AI
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
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('AI error:', errText);
      return res.status(502).json({ error: 'AI service error', details: errText.slice(0, 200) });
    }

    const data = await aiRes.json();
    const aiText = (data.content && data.content[0] && data.content[0].text) || '';

    // Зберігаємо
    const now = new Date().toISOString();
    if (existing) {
      db.prepare(`UPDATE student_summaries SET
        ai_text=?, metrics_json=?, generated_at=?
        WHERE student_id=?`)
        .run(aiText, JSON.stringify(metrics), now, studentId);
    } else {
      db.prepare(`INSERT INTO student_summaries
        (id,student_id,group_id,ai_text,lecturer_note,metrics_json,generated_at)
        VALUES (?,?,?,?,?,?,?)`)
        .run(uuidv4(), studentId, group.id, aiText, keepNote, JSON.stringify(metrics), now);
    }

    res.json({
      ai_text: aiText,
      lecturer_note: keepNote,
      metrics_json: metrics,
      generated_at: now,
    });
  } catch (e) {
    console.error('Summary generation failed:', e);
    res.status(502).json({ error: 'AI service unavailable', details: String(e).slice(0, 200) });
  }
});

// PATCH /api/lecturer/students/:studentId/summary/note — зберігає коментар лектора
router.patch('/students/:studentId/summary/note', LEC, (req, res) => {
  const studentId = req.params.studentId;
  const access = db.prepare(`
    SELECT g.id FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE gm.student_id=? AND g.lecturer_id=?
  `).get(studentId, req.user.id);
  if (!access) return res.status(404).json({ error: 'Student not found' });

  const { lecturer_note } = req.body;
  if (typeof lecturer_note !== 'string') return res.status(400).json({ error: 'lecturer_note must be string' });

  const existing = db.prepare('SELECT id FROM student_summaries WHERE student_id=?').get(studentId);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE student_summaries SET lecturer_note=?, note_updated_at=? WHERE student_id=?')
      .run(lecturer_note, now, studentId);
  } else {
    db.prepare(`INSERT INTO student_summaries (id,student_id,group_id,lecturer_note,note_updated_at) VALUES (?,?,?,?,?)`)
      .run(uuidv4(), studentId, access.id, lecturer_note, now);
  }
  res.json({ ok: true });
});

// ── Helpers для промпта ───────────────────────────────────────
function buildSummarySystemPrompt(){
  return `Ти — досвідчений лектор-практик з логістики та експедиційної діяльності, який оцінює роботу студента-початківця.

Студент завершив 5-денну симуляцію роботи експедитора у компанії Docaa. Він обробляв 8 листів від замовників (різні країни ЄС, різні типи вантажу), шукав перевізників, торгувався, оформлював документи.

Твоя задача — написати РЕЗЮМЕ ЙОГО РОБОТИ для лектора. Не для студента — для викладача який потім проведе індивідуальний розбір.

ФОРМАТ РЕЗЮМЕ (строго дотримуйся):

👤 [Ім'я] ([email]) · Група: [назва]
📅 [дата старту] — [дата завершення]

📊 ПІДСУМОК
Прибуток: €X · Рейсів закрито: X/8 · Загальна оцінка: X.X/10

✅ СИЛЬНІ СТОРОНИ
• [3-5 пунктів, кожен з конкретним фактом і номером рейсу]

⚠️ СЛАБКІ СТОРОНИ
• [3-5 пунктів, конкретно: що зробив не так, чому це проблема, в якому рейсі]

🌟 ТОП-3 РЕЙСИ ЗА ПРИБУТКОМ
1. #X — [замовник] — €X (маржа X%)
2. #X — [замовник] — €X (маржа X%)
3. #X — [замовник] — €X (маржа X%)

📈 6 КРИТЕРІЇВ ОЦІНКИ
1. Швидкість відповідей: X/10 — [коротке пояснення]
2. Якість торгу з замовниками: X/10 — [пояснення]
3. Якість торгу з перевізниками: X/10 — [пояснення]
4. Правильність документів: X/10 — [пояснення]
5. Управління інцидентами: X/10 — [пояснення]
6. Прибутковість: X/10 — [пояснення]

💬 ЦИТАТА ДНЯ (опційно — лише якщо є реально показовий приклад зі студентського повідомлення, що ілюструє його сильну чи слабку сторону. Якщо нічого яскравого нема — ПРОПУСТИ цей блок повністю.)
"[коротка цитата]" — [контекст і чому це важливо]

🎓 РЕКОМЕНДАЦІЇ
• [2-4 конкретні поради для наступного разу]

ПРАВИЛА:
- Пиши українською, професійно але без зайвої формалістики
- Конкретика > загальні фрази. Замість "погано торгувався" → "на рейсі #03 (SC Roma SRL) погодився на €110 без зустрічної пропозиції — за нашою оцінкою можна було отримати €125"
- НЕ хвали без причини. Якщо студент справді щось зробив погано — пиши прямо.
- Бали 1-3 = погано, 4-6 = посередньо, 7-8 = добре, 9-10 = відмінно. Не завищуй.
- Не пиши воду на кшталт "удачі у подальшій кар'єрі" — це резюме для розбору, не привітання.
- Загальна оцінка = середнє з 6 критеріїв, округлене до десятих.
- Якщо студент НЕ закрив усі 8 рейсів — це окремо зазнач у слабких сторонах і знизь "Прибутковість".
- НЕ вигадуй факти яких немає в даних. Якщо немає інформації по якомусь критерію — постав 5/10 і напиши "недостатньо даних".
- Цитату давай ТІЛЬКИ якщо знайшов реально вартий уваги приклад. Не вигадуй просто щоб заповнити блок.

Довжина резюме: 300-500 слів. Не більше.`;
}

function buildSummaryUserPrompt(user, group, session, metrics, ordersDetail){
  const lines = [];
  lines.push('ДАНІ СТУДЕНТА:');
  lines.push(`Ім'я: ${user.name}`);
  lines.push(`Email: ${user.email}`);
  lines.push(`Група: ${group.name}`);
  lines.push(`Дата старту: ${session.start_date || '—'}`);
  lines.push(`Дата завершення: ${new Date().toLocaleDateString('uk-UA')}`);
  lines.push('');
  lines.push('ОБЧИСЛЕНІ МЕТРИКИ:');
  lines.push(`- Прибуток (маржа): €${metrics.profit}`);
  lines.push(`- Загальна виручка: €${metrics.revenue}`);
  lines.push(`- Рейсів закрито: ${metrics.closed}/8`);
  lines.push(`- Середня маржа %: ${metrics.avg_margin_pct}%`);
  lines.push(`- Імейл-тредів вели: ${metrics.email_threads}`);
  lines.push(`- Чатів з перевізниками: ${metrics.carrier_chats}`);
  lines.push(`- Документів сформовано (приблизно): ${metrics.docs_count}`);
  lines.push('');
  lines.push('═══════════════════════════════════════');
  lines.push('8 РЕЙСІВ ДЕТАЛЬНО');
  lines.push('═══════════════════════════════════════');

  ordersDetail.forEach((o, idx) => {
    lines.push('');
    lines.push(`═══ РЕЙС #${idx+1} (${o.code}): ${o.subject || '(без теми)'} ═══`);
    lines.push(`Замовник: ${o.company || '—'} (${o.country || '—'}, ${o.from || '—'})`);
    lines.push(`Напрямок: ${o.dirs.join(' → ')}`);
    lines.push(`Тип ТЗ: ${o.vehicle || '—'}`);
    lines.push(`Мова листа: ${o.lang}`);
    lines.push('');
    lines.push('ЛИСТ ВІД ЗАМОВНИКА:');
    lines.push((o.body || '(порожньо)').slice(0, 1500));
    lines.push('');
    lines.push('ПЕРЕПИСКА З ЗАМОВНИКОМ:');
    if (o.email_messages.length === 0) {
      lines.push('(студент не відписав замовнику)');
    } else {
      o.email_messages.forEach(m => {
        const who = m.role === 'user' ? '👤 СТУДЕНТ' : '✉️ ЗАМОВНИК';
        lines.push(`${who}: ${(m.content || '').slice(0, 600)}`);
      });
    }
    lines.push('');
    lines.push(`ПЕРЕВІЗНИК: ${o.carrier_name || '(не знайдено)'}`);
    lines.push(`Ціна продажу замовнику: ${o.client_freight ? '€'+o.client_freight : '—'}`);
    lines.push(`Ціна купівлі в перевізника: ${o.carrier_freight ? '€'+o.carrier_freight : '—'}`);
    lines.push(`Маржа: ${o.margin ? '€'+o.margin+' ('+o.margin_pct+'%)' : '—'}`);
    lines.push('');
    lines.push('ПЕРЕПИСКА З ПЕРЕВІЗНИКОМ:');
    if (o.carrier_messages.length === 0) {
      lines.push('(чат не відкрито)');
    } else {
      o.carrier_messages.forEach(m => {
        const who = m.role === 'user' ? '👤 СТУДЕНТ' : '🚚 ПЕРЕВІЗНИК';
        lines.push(`${who}: ${(m.content || '').slice(0, 600)}`);
      });
    }
    lines.push('');
    lines.push(`СТАТУС: ${o.status}`);
  });

  lines.push('');
  lines.push('═══════════════════════════════════════');
  lines.push('Тепер напиши резюме за форматом, який вказано в системній інструкції.');

  return lines.join('\n');
}

module.exports = router;
