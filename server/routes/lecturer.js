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

  res.json({ ok: true, students_reset: results.length, results });
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
  // Take least-used letters from each type
  selected.push(...sortByUsage(complete).slice(0, Math.min(3, complete.length)));
  selected.push(...sortByUsage(missing).slice(0, Math.min(3, missing.length)));
  selected.push(...sortByUsage(form).slice(0, Math.min(2, form.length)));

  // Final shuffle of selected set
  selected = shuffle(selected);

  // Target 6-8 letters
  if (selected.length > 8) selected = selected.slice(0, 8);

  // Fallback if DB is empty
  if (selected.length === 0) selected = allLetters;

  const id = uuidv4();
  db.prepare('INSERT INTO assignments (id,student_id,group_id,letter_ids,created_by) VALUES (?,?,?,?,?)')
    .run(id, studentId, groupId, JSON.stringify(selected.map(l => l.id)), createdBy);

  return { id, letter_ids: selected.map(l => l.id) };
}

module.exports = router;
