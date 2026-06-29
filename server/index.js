// server/index.js — Main server
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── SECURITY ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc: ["'self'", "fonts.googleapis.com", "fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL, 'https://sim.docaa.net']
    : '*',
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Global rate limiter (prod: RATE_LIMIT_MAX=5000 у .env)
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 300,
  message: { error: 'Too many requests' }
}));

app.use(express.json({ limit: '2mb' }));

// ── STATIC FILES ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api/lecturer', require('./routes/lecturer'));
app.use('/api/student',  require('./routes/student'));

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── SPA FALLBACK — serve login.html for unknown routes ───────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Docaa Simulator running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB: ${process.env.DB_PATH || './data/simulator.db'}`);
  console.log(`   API Key: ${process.env.ANTHROPIC_API_KEY ? '✓ configured' : '✗ MISSING'}\n`);
});

// ── BACKGROUND: процесор тригерів-нагадувань "де заявка" ─────
// Запускається раз на 60 секунд. Перевіряє application_followups
// і додає повідомлення в carrier_chats якщо настав час.
try {
  const db = require('./db');
  const followupScheduler = require('./utils/followup-scheduler');

  const FOLLOWUP_INTERVAL_MS = 60 * 1000; // 60 секунд

  setInterval(() => {
    try {
      const simTime = require('./utils/sim-time');
      simTime.syncActiveSessions();
    } catch (e) { /* ignore */ }
    try {
      followupScheduler.processPendingFollowups({ db });
    } catch (e) {
      console.error('[followup-cron] error:', e.message);
    }
  }, FOLLOWUP_INTERVAL_MS);

  console.log(`   Followup-cron: ✓ запущено (інтервал ${FOLLOWUP_INTERVAL_MS / 1000}s)\n`);
} catch (e) {
  console.error('[followup-cron] init error:', e.message);
}
// ── BACKGROUND: incident-scheduler (інциденти рейсу) ──────────
try {
  const incidentScheduler = require('./utils/incident-scheduler');
  incidentScheduler.startCron(60 * 1000);
  console.log(`   Incident-cron: ✓ запущено (інтервал 60s)\n`);
} catch (e) {
  console.error('[incident-cron] init error:', e.message);
}
module.exports = app;
