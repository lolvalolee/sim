// scripts/init-db.js — Creates all database tables
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || './data/simulator.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK(role IN ('superadmin','lecturer','student')),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT,
  last_login  TEXT
);

-- ── GROUPS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  lecturer_id TEXT NOT NULL REFERENCES users(id),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  notes       TEXT
);

-- ── GROUP MEMBERS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  group_id    TEXT NOT NULL REFERENCES groups(id),
  student_id  TEXT NOT NULL REFERENCES users(id),
  joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, student_id)
);

-- ── LETTER POOL (all available letters) ──────────────────────
CREATE TABLE IF NOT EXISTS letters (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,           -- e.g. 'DE_UA_tent_complete'
  type        TEXT NOT NULL CHECK(type IN ('complete','missing','form')),
  country     TEXT NOT NULL,
  from_name   TEXT NOT NULL,
  company     TEXT NOT NULL,
  email_addr  TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,           -- template with {loadDate} {delivDate}
  missing     TEXT NOT NULL DEFAULT '[]', -- JSON array
  vehicle     TEXT NOT NULL,
  dirs        TEXT NOT NULL,           -- JSON array ['DE','UA']
  freight_fixed    INTEGER DEFAULT 0,
  freight_amount   REAL,
  freight_min      REAL,
  freight_max      REAL,
  carrier_range_min REAL,
  carrier_range_max REAL,
  distance    INTEGER,
  load_day_offset  INTEGER DEFAULT 4,
  deliv_day_offset INTEGER DEFAULT 8,
  created_by  TEXT,
  active      INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ── ASSIGNMENTS (student gets a set of letters) ───────────────
CREATE TABLE IF NOT EXISTS assignments (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES users(id),
  group_id    TEXT NOT NULL REFERENCES groups(id),
  letter_ids  TEXT NOT NULL,           -- JSON array of letter IDs
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT NOT NULL REFERENCES users(id)
);

-- ── SESSIONS (student simulation state) ──────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES users(id) UNIQUE,
  assignment_id   TEXT REFERENCES assignments(id),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused','completed','stopped')),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  paused_at       TEXT,
  stopped_by      TEXT REFERENCES users(id),
  completed_at    TEXT,
  timer_ms        INTEGER NOT NULL DEFAULT 0,
  timer_day       INTEGER NOT NULL DEFAULT 1,
  start_date      TEXT NOT NULL,       -- simulation start date DD.MM.YYYY
  profit          REAL NOT NULL DEFAULT 0,
  rates           TEXT NOT NULL DEFAULT '[41.5,41.65,41.8,41.7,41.9]',
  state_json      TEXT NOT NULL DEFAULT '{}'  -- full sim state
);

-- ── ORDER PROGRESS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_progress (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id),
  letter_id       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new',
  client_freight  REAL,
  carrier_id      TEXT,
  carrier_freight REAL,
  carrier_plate   TEXT,
  carrier_driver  TEXT,
  confirmed_at    TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ── EMAIL THREADS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_threads (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  letter_id   TEXT NOT NULL,
  messages    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- ── CARRIER CHATS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier_chats (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  carrier_id  TEXT NOT NULL,
  messages    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  deal_status TEXT NOT NULL DEFAULT 'none',
  updated_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(session_id, carrier_id)
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_student ON group_members(student_id);
CREATE INDEX IF NOT EXISTS idx_order_progress_session ON order_progress(session_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_session ON email_threads(session_id);
CREATE INDEX IF NOT EXISTS idx_carrier_chats_session ON carrier_chats(session_id);
CREATE INDEX IF NOT EXISTS idx_groups_lecturer ON groups(lecturer_id);

`);

console.log('✅ Database initialized:', dbPath);
db.close();
