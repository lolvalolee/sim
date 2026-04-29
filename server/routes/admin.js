// server/routes/admin.js — Superadmin: manage lecturers
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const SA = requireAuth(['superadmin']);

// GET /api/admin/lecturers
router.get('/lecturers', SA, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.name, u.active, u.created_at, u.last_login,
           COUNT(g.id) as groups_count
    FROM users u
    LEFT JOIN groups g ON g.lecturer_id = u.id
    WHERE u.role = 'lecturer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(rows);
});

// POST /api/admin/lecturers
router.post('/lecturers', SA, async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'email, name, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password min 8 chars' });

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id,email,name,password,role,created_by) VALUES (?,?,?,?,?,?)')
    .run(id, email.trim().toLowerCase(), name.trim(), hash, 'lecturer', req.user.id);

  res.status(201).json({ id, email, name, role: 'lecturer' });
});

// PATCH /api/admin/lecturers/:id — activate/deactivate
router.patch('/lecturers/:id', SA, (req, res) => {
  const { active, name, password } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id=? AND role="lecturer"').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Lecturer not found' });

  if (active !== undefined) {
    db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  }
  if (name) {
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(), req.params.id);
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password min 8 chars' });
    const hash = require('bcryptjs').hashSync(password, 12);
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.params.id);
  }
  res.json({ ok: true });
});

// GET /api/admin/stats
router.get('/stats', SA, (req, res) => {
  const stats = {
    lecturers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='lecturer' AND active=1").get().c,
    students:  db.prepare("SELECT COUNT(*) as c FROM users WHERE role='student' AND active=1").get().c,
    groups:    db.prepare("SELECT COUNT(*) as c FROM groups WHERE active=1").get().c,
    sessions:  db.prepare("SELECT COUNT(*) as c FROM sessions WHERE status='active'").get().c,
  };
  res.json(stats);
});

// GET /api/admin/api-usage — check Anthropic key is set
router.get('/api-key-status', SA, (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY || '';
  res.json({ configured: key.startsWith('sk-ant-'), prefix: key.slice(0, 12) + '...' });
});

module.exports = router;
