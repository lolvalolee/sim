// server/utils/sim-time.js — єдине джерело сим-часу сесії (авторitative)
const db = require('../db');

const DAY_MS_REAL = 120 * 60 * 1000;       // 120 хв реал = 1 сим-день
const SIM_HOUR_MS_REAL = 10 * 60 * 1000;   // 10 хв реал = 1 сим-год
const SIM_DAYS_MAX = 8;
const AUTO_PAUSE_MS = 15 * 60 * 1000;      // B3: 15 хв без heartbeat → auto-pause
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 21;
const AFTERNOON_SIM_HOUR = 15;             // друга половина сим-дня (9+6)

function parseIsoMs(iso) {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(t) ? t : null;
}

function timerMsToParts(timerMs) {
  const totalMin = (timerMs || 0) / 60000;
  const timerDay = Math.max(1, Math.floor(totalMin / (DAY_MS_REAL / 60000)) + 1);
  const minInDay = totalMin % (DAY_MS_REAL / 60000);
  const dayFrac = minInDay / (DAY_MS_REAL / 60000);
  const span = DAY_END_HOUR - DAY_START_HOUR;
  const simHourFloat = DAY_START_HOUR + dayFrac * span;
  const simHour = Math.min(DAY_END_HOUR, Math.floor(simHourFloat));
  const simMin = Math.floor((simHourFloat - Math.floor(simHourFloat)) * 60);
  return { timer_day: timerDay, sim_hour: simHour, sim_min: simMin };
}

/** Абсолютна сим-година від старту сесії (0 = 9:00 дня 1) — для інцидентів */
function timerMsToSimHourAbs(timerMs) {
  const msInDay = (timerMs || 0) % DAY_MS_REAL;
  const hourInDay = Math.min(12, Math.floor(msInDay / SIM_HOUR_MS_REAL));
  const timerDay = Math.max(1, Math.floor((timerMs || 0) / DAY_MS_REAL) + 1);
  return (timerDay - 1) * 12 + hourInDay;
}

function syncActiveSessions() {
  const rows = db.prepare(`SELECT id FROM sessions WHERE status='active' AND COALESCE(paused,0)=0`).all();
  for (const { id } of rows) {
    try { syncSessionTime(id, { heartbeat: false }); } catch (e) { /* ignore */ }
  }
}

function addDaysDmy(startDmy, days) {
  const p = String(startDmy || '').split('.');
  if (p.length !== 3) return startDmy;
  const d = new Date(+p[2], +p[1] - 1, +p[0]);
  d.setDate(d.getDate() + days);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function simCalendarDate(startDateDmy, timerDay) {
  return addDaysDmy(startDateDmy, (timerDay || 1) - 1);
}

function parseDmyToDate(dmy) {
  const p = String(dmy || '').split('.');
  if (p.length !== 3) return null;
  return new Date(+p[2], +p[1] - 1, +p[0]);
}

function isRealDateBeforeToday(dmy) {
  const d = parseDmyToDate(dmy);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d > today; // start in future
}

/** Лист видимий за хвилями 4 + 2 ранок д2 + 2 обід д2 */
function isLetterVisible(letter, timerDay, simHour) {
  const day = letter.appear_day || 1;
  const half = letter.appear_half || 1;
  if (timerDay > day) return true;
  if (timerDay < day) return false;
  if (half === 1) return true;
  if (half === 2) return (simHour || DAY_START_HOUR) >= AFTERNOON_SIM_HOUR;
  return true;
}

/**
 * Синхронізує timer_ms на сервері. heartbeat=true — вкладка активна.
 * Повертає оновлений стан або null.
 */
function syncSessionTime(sessionId, { heartbeat = false } = {}) {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!session || session.status === 'stopped') return null;

  const now = Date.now();
  let timerMs = session.timer_ms || 0;
  let paused = session.paused || 0;
  let autoPaused = session.auto_paused || 0;
  let clockAt = parseIsoMs(session.sim_clock_at) || now;
  let lastHb = parseIsoMs(session.last_heartbeat_at) || clockAt;

  if (heartbeat) {
    lastHb = now;
  }

  if (!paused) {
    const sinceHb = now - lastHb;

    if (!heartbeat && sinceHb >= AUTO_PAUSE_MS) {
      // B3: давно не було heartbeat — auto-pause, час не біжить далі lastHb
      const advanceMs = Math.max(0, lastHb - clockAt);
      timerMs += advanceMs;
      paused = 1;
      autoPaused = 1;
      clockAt = now;
    } else {
      // Активна сесія — час іде до now
      timerMs += Math.max(0, now - clockAt);
      clockAt = now;
    }
  } else {
    clockAt = now;
  }

  const parts = timerMsToParts(timerMs);
  const ended = parts.timer_day > SIM_DAYS_MAX;

  db.prepare(`
    UPDATE sessions SET
      timer_ms=?, timer_day=?, paused=?, auto_paused=?,
      sim_clock_at=?, last_heartbeat_at=?
    WHERE id=?
  `).run(
    Math.round(timerMs),
    parts.timer_day,
    paused,
    autoPaused,
    new Date(clockAt).toISOString(),
    new Date(lastHb).toISOString(),
    sessionId
  );

  return {
    timer_ms: Math.round(timerMs),
    timer_day: parts.timer_day,
    sim_hour: parts.sim_hour,
    sim_min: parts.sim_min,
    sim_date: simCalendarDate(session.start_date, parts.timer_day),
    paused: !!paused,
    auto_paused: !!autoPaused,
    ended,
    start_date: session.start_date,
  };
}

function getSessionClock(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!session) return null;
  const parts = timerMsToParts(session.timer_ms || 0);
  return {
    timer_ms: session.timer_ms || 0,
    timer_day: parts.timer_day,
    sim_hour: parts.sim_hour,
    sim_min: parts.sim_min,
    sim_date: simCalendarDate(session.start_date, parts.timer_day),
    paused: !!session.paused,
    auto_paused: !!session.auto_paused,
    start_date: session.start_date,
  };
}

function pauseSession(sessionId, { auto = false } = {}) {
  syncSessionTime(sessionId, { heartbeat: false });
  db.prepare('UPDATE sessions SET paused=1, paused_at=datetime(\'now\'), auto_paused=? WHERE id=?')
    .run(auto ? 1 : 0, sessionId);
}

function resumeSession(sessionId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sessions SET paused=0, paused_at=NULL, auto_paused=0,
      sim_clock_at=?, last_heartbeat_at=?
    WHERE id=?
  `).run(now, now, sessionId);
}

module.exports = {
  DAY_MS_REAL,
  SIM_HOUR_MS_REAL,
  SIM_DAYS_MAX,
  AUTO_PAUSE_MS,
  AFTERNOON_SIM_HOUR,
  DAY_START_HOUR,
  timerMsToParts,
  timerMsToSimHourAbs,
  simCalendarDate,
  isRealDateBeforeToday,
  isLetterVisible,
  syncSessionTime,
  syncActiveSessions,
  getSessionClock,
  pauseSession,
  resumeSession,
};
