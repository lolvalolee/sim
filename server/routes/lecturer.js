// server/routes/lecturer.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
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
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO groups (id,name,lecturer_id,notes) VALUES (?,?,?,?)')
    .run(id, name.trim(), req.user.id, notes||'');
  res.status(201).json({ id, name });
});

// PATCH /api/lecturer/groups/:id
router.patch('/groups/:id', LEC, (req, res) => {
  const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Not found' });
  const { name, notes, active } = req.body;
  if (name) db.prepare('UPDATE groups SET name=? WHERE id=?').run(name, req.params.id);
  if (notes !== undefined) db.prepare('UPDATE groups SET notes=? WHERE id=?').run(notes, req.params.id);
  if (active !== undefined) db.prepare('UPDATE groups SET active=? WHERE id=?').run(active?1:0, req.params.id);
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
// Скидає все для студента і генерує новий набір листів.
// body.start_date (опц.) — ДД.ММ.РРРР; якщо нема — бере поточну дату групи.
router.post('/sessions/:studentId/reset', LEC, (req, res) => {
  try {
    const studentId = req.params.studentId;

    const member = db.prepare('SELECT group_id FROM group_members WHERE student_id=?').get(studentId);
    if (!member) return res.status(404).json({ error: 'Student not in any group' });

    // Якщо передали дату — оновлюємо дату старту групи (одна на групу)
    if (req.body && req.body.start_date) {
      const sd = String(req.body.start_date).trim();
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(sd)) {
        return res.status(400).json({ error: 'start_date must be DD.MM.YYYY' });
      }
      db.prepare("UPDATE groups SET start_date=?, started_at=datetime('now') WHERE id=?")
        .run(sd, member.group_id);
    } else {
      // дата не передана — гарантуємо що група стартована (started_at не порожній)
      db.prepare("UPDATE groups SET started_at=COALESCE(NULLIF(started_at,''), datetime('now')) WHERE id=?")
        .run(member.group_id);
    }

    // Повна чистка + нова assignment
    wipeStudentSession(studentId);
    const newAssignment = generateAssignment(studentId, member.group_id, req.user.id);

    res.json({ ok: true, new_assignment_id: newAssignment.id, letter_count: newAssignment.letter_ids.length });
  } catch (e) {
    console.error('[reset session] error:', e.message);
    res.status(500).json({ error: 'reset_failed', detail: e.message });
  }
});

// POST /api/lecturer/groups/:groupId/reset — рестарт всієї групи
// body.start_date (опц.) — ДД.ММ.РРРР; якщо нема — поточна реальна дата.
router.post('/groups/:groupId/reset', LEC, (req, res) => {
  try {
    const g = db.prepare('SELECT id FROM groups WHERE id=? AND lecturer_id=?').get(req.params.groupId, req.user.id);
    if (!g) return res.status(404).json({ error: 'Group not found' });

    // Дата старту: передана або поточна реальна (ДД.ММ.РРРР)
    let startDate = req.body && req.body.start_date ? String(req.body.start_date).trim() : '';
    if (startDate) {
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(startDate)) {
        return res.status(400).json({ error: 'start_date must be DD.MM.YYYY' });
      }
    } else {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      startDate = `${dd}.${mm}.${now.getFullYear()}`;
    }

    // Записуємо дату і час старту групи — всі нові сесії підхоплять цю дату
    db.prepare("UPDATE groups SET start_date=?, started_at=datetime('now') WHERE id=?")
      .run(startDate, req.params.groupId);

    const members = db.prepare('SELECT student_id FROM group_members WHERE group_id=?').all(req.params.groupId);
    const results = [];

    for (const m of members) {
      wipeStudentSession(m.student_id);
      const newAssignment = generateAssignment(m.student_id, req.params.groupId, req.user.id);
      results.push({ student_id: m.student_id, letters: newAssignment.letter_ids.length });
    }

    res.json({ ok: true, start_date: startDate, students_reset: results.length, results });
  } catch (e) {
    console.error('[reset group] error:', e.message);
    res.status(500).json({ error: 'reset_failed', detail: e.message });
  }
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
  // Store rates on all active sessions in this group
  const members = db.prepare('SELECT student_id FROM group_members WHERE group_id=?').all(req.params.groupId);
  for (const m of members) {
    db.prepare('UPDATE sessions SET rates=? WHERE student_id=?').run(JSON.stringify(rates), m.student_id);
  }
  res.json({ ok: true });
});

// ── HELPER: generate assignment ───────────────────────────────
// ── 25-fix: повна безпечна чистка всіх даних студента ─────────
// Чистить дочірні таблиці по session_id, резюме/аналіз по student_id.
// Кожен DELETE захищений перевіркою існування таблиці — щоб рестарт
// не падав 500 якщо якоїсь таблиці нема в поточній схемі.
function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function colExists(table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  } catch (e) { return false; }
}
function safeDelete(table, whereCol, value) {
  if (!tableExists(table)) return 0;
  if (!colExists(table, whereCol)) return 0; // тихо пропускаємо якщо колонки нема
  try {
    return db.prepare(`DELETE FROM ${table} WHERE ${whereCol}=?`).run(value).changes;
  } catch (e) {
    console.error(`[reset] DELETE ${table} WHERE ${whereCol}: ${e.message}`);
    return 0;
  }
}
function wipeStudentSession(studentId) {
  const session = db.prepare('SELECT id FROM sessions WHERE student_id=?').get(studentId);
  // Таблиці прив'язані до session_id (видаляємо ДО самої сесії, інакше FK fail)
  if (session) {
    const sid = session.id;
    for (const t of ['order_events','incidents','resume_points','application_followups',
                     'email_threads','carrier_chats','order_progress','confirmations',
                     'order_documents','cargo_board','student_analysis','applications']) {
      safeDelete(t, 'session_id', sid);
    }
    safeDelete('sessions', 'id', sid);
  }
  // Стара assignment — ПІСЛЯ sessions (бо sessions.assignment_id → FK на assignments)
  safeDelete('assignments', 'student_id', studentId);
  // Таблиці прив'язані до student_id (резюме/аналіз — теж скидаємо при рестарті)
  for (const t of ['student_summaries','student_analysis']) {
    safeDelete(t, 'student_id', studentId);
  }
  // На випадок осиротілих записів без сесії — чистимо по student_id
  // (тільки таблиці що РЕАЛЬНО мають колонку student_id; order_events її не має)
  for (const t of ['applications','application_followups','incidents','resume_points']) {
    safeDelete(t, 'student_id', studentId);
  }
}

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

// GET /api/lecturer/students/:studentId/resume — перегляд резюме студента
router.get('/students/:studentId/resume', LEC, (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE student_id=?').get(req.params.studentId);
  if (!session) return res.json({ exists: false });

  const points = db.prepare(`
    SELECT rp.id, rp.type, rp.impact, rp.context_json, rp.letter_id, rp.created_at,
           l.subject, l.scenario_id
    FROM resume_points rp
    LEFT JOIN letters l ON l.id = rp.letter_id
    WHERE rp.session_id=?
    ORDER BY rp.created_at DESC
  `).all(session.id);

  const enriched = points.map(p => ({
    id: p.id,
    type: p.type,
    impact: p.impact,
    context: (() => { try { return JSON.parse(p.context_json || '{}'); } catch (e) { return {}; } })(),
    letter_id: p.letter_id,
    letter_subject: p.subject,
    scenario_id: p.scenario_id,
    created_at: p.created_at,
  }));

  const totalScore = enriched.reduce((s, p) => s + p.impact, 0);

  const profitData = db.prepare(`
    SELECT
      SUM(COALESCE(client_freight,0)) AS revenue,
      SUM(COALESCE(carrier_freight,0)) AS carrier_paid,
      SUM(COALESCE(simple_paid_by_student,0)) AS simples_self
    FROM order_progress WHERE session_id=?
  `).get(session.id);
  const margin = (profitData?.revenue || 0) - (profitData?.carrier_paid || 0) - (profitData?.simples_self || 0);

  res.json({
    exists: true,
    session_id: session.id,
    total_score: totalScore,
    total_points: enriched.length,
    margin,
    points: enriched,
  });
});

module.exports = router;
