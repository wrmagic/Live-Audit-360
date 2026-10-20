'use strict';
// Database layer: one SQLite file (Node's built-in node:sqlite, nothing to install).
// All SQL goes through the small helper API below (all/get/run/insert/update/tx).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Everyone who signs in. role: head (head coach, sees everything), coach, participant.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('head','coach','participant')),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  phone TEXT,
  password_hash TEXT,
  coach_id INTEGER REFERENCES users(id),         -- participants: their coach
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  active INTEGER NOT NULL DEFAULT 1,
  invite_hash TEXT,                              -- one-time link to set a password
  invite_expires TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  flash TEXT
);

-- One 14-day program run. A participant can do the program again later (a new enrollment).
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,                      -- Day 1 (YYYY-MM-DD, participant's own calendar)
  focus_areas TEXT,                              -- JSON array of area keys for Days 8-14 (set by coach, else automatic)
  created_at TEXT NOT NULL
);

-- Answers to one form on one program day, stored as JSON so forms can change without database changes.
CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  form TEXT NOT NULL,
  answers TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,           -- questions answered
  total INTEGER NOT NULL DEFAULT 0,              -- questions on the form
  updated_at TEXT NOT NULL,
  UNIQUE (enrollment_id, day, form)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL
);

-- Coaching videos for Days 8-14, grouped by life area. day = unlock on that program day (null = from Day 8).
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  area TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  day INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_views (
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  watched_at TEXT NOT NULL,
  PRIMARY KEY (enrollment_id, video_id)
);

-- Private coach notes about a participant.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_coach ON users(coach_id);
CREATE INDEX IF NOT EXISTS idx_enroll_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_enroll ON photos(enrollment_id, day);
CREATE INDEX IF NOT EXISTS idx_notes_participant ON notes(participant_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  let depth = 0;
  const db = {
    raw,
    file,
    all: (sql, ...p) => prep(sql).all(...norm(p)),
    get: (sql, ...p) => prep(sql).get(...norm(p)),
    run: (sql, ...p) => { const r = prep(sql).run(...norm(p)); return { id: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    insert(table, obj) {
      const keys = Object.keys(obj);
      return db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k])).id;
    },
    update(table, id, obj) {
      const keys = Object.keys(obj);
      if (!keys.length) return 0;
      return db.run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id).changes;
    },
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try { const r = fn(); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
      finally { depth--; }
    },
    close: () => raw.close(),
  };
  return db;
}

const now = () => new Date().toISOString();

module.exports = { open, now };
