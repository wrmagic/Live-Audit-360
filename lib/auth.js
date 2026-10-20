'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 60; // participants stay signed in on their phone
const INVITE_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const hash = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(h, 'hex'));
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

function createSession(db, user) {
  const t = token(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha(t), user.id, exp);
  db.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  return t;
}
function loadSession(db, t) {
  if (!t) return null;
  const row = db.get(`SELECT s.token_hash, s.flash, s.expires_at, u.id, u.role, u.name, u.email, u.coach_id, u.timezone, u.active, u.last_seen
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(t));
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  // Remember when people were last here (at most once every 10 minutes)
  const n = new Date();
  if (!row.last_seen || n - new Date(row.last_seen) > 600e3) db.run('UPDATE users SET last_seen=? WHERE id=?', n.toISOString(), row.id);
  return row;
}
function destroySession(db, t) { if (t) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(t)); }
function setFlash(db, user, msg, kind = 'ok') {
  if (user) db.run('UPDATE sessions SET flash = ? WHERE token_hash = ?', JSON.stringify({ msg, kind }), user.token_hash);
}
function takeFlash(db, user) {
  if (!user || !user.flash) return null;
  db.run('UPDATE sessions SET flash = NULL WHERE token_hash = ?', user.token_hash);
  try { return JSON.parse(user.flash); } catch { return null; }
}

/** A one-time link for setting a password (new invites and password resets). Returns the raw token. */
function issueInvite(db, userId) {
  const t = token(24);
  db.run('UPDATE users SET invite_hash=?, invite_expires=? WHERE id=?', sha(t), new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(), userId);
  return t;
}
function findInvite(db, t) {
  if (!t) return null;
  const u = db.get('SELECT * FROM users WHERE invite_hash=? AND active=1', sha(t));
  if (!u || u.invite_expires < new Date().toISOString()) return null;
  return u;
}

module.exports = { hashPassword, verifyPassword, createSession, loadSession, destroySession, setFlash, takeFlash, token, sha, issueInvite, findInvite, INVITE_DAYS };
