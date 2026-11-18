'use strict';
// App settings that super admins change in Admin → Settings (stored in the database, so no Render changes
// are needed). Secrets such as API keys are encrypted (AES-256-GCM). The encryption key is APP_SECRET if set,
// otherwise a key file created next to the database. It is never stored in the database, so a downloaded
// database backup doesn't reveal the secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let keyCache = null;
function key(db) {
  if (keyCache) return keyCache;
  if (process.env.APP_SECRET) return (keyCache = crypto.createHash('sha256').update(process.env.APP_SECRET).digest());
  if (db.file === ':memory:') return (keyCache = crypto.randomBytes(32));
  const file = path.join(path.dirname(path.resolve(db.file)), 'secret.key');
  try { return (keyCache = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')); } catch { /* make one */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(file, k.toString('hex'), { mode: 0o600 });
  return (keyCache = k);
}

function ensureTable(db) {
  db.raw.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, secret INTEGER NOT NULL DEFAULT 0, updated_at TEXT, updated_by INTEGER)');
}

function get(db, k) {
  ensureTable(db);
  const r = db.get('SELECT value, secret FROM settings WHERE key=?', k);
  if (!r || r.value == null) return null;
  if (!r.secret) return r.value;
  try {
    const [iv, tag, data] = r.value.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(db), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; } // the key changed: the secret has to be entered again
}

function set(db, k, value, { secret = false, by = null } = {}) {
  ensureTable(db);
  if (value == null || value === '') { db.run('DELETE FROM settings WHERE key=?', k); return; }
  let v = String(value);
  if (secret) {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(db), iv);
    const data = Buffer.concat([c.update(v, 'utf8'), c.final()]);
    v = [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }
  db.run(`INSERT INTO settings (key, value, secret, updated_at, updated_by) VALUES (?,?,?,?,?)
    ON CONFLICT (key) DO UPDATE SET value=excluded.value, secret=excluded.secret, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
  k, v, secret ? 1 : 0, new Date().toISOString(), by);
}

const has = (db, k) => { ensureTable(db); return !!db.get('SELECT 1 FROM settings WHERE key=?', k); };
const hint = (s) => (s ? `••••${s.slice(-4)}` : '');

/** Email settings: the values saved in Admin → Settings, falling back to Render's environment variables. */
function mail(db) {
  const resendKey = get(db, 'mail.resend_key');
  const fromEmail = get(db, 'mail.from_email');
  const fromName = get(db, 'mail.from_name');
  const inApp = !!(resendKey && fromEmail);
  if (inApp) {
    return { source: 'app', provider: 'resend', resendKey, from: fromName ? `${fromName.replace(/[<>"]/g, '')} <${fromEmail}>` : fromEmail, replyTo: get(db, 'mail.reply_to') || null };
  }
  return {
    source: process.env.RESEND_API_KEY || process.env.POSTMARK_TOKEN ? 'render' : 'none',
    provider: process.env.RESEND_API_KEY ? 'resend' : process.env.POSTMARK_TOKEN ? 'postmark' : null,
    resendKey: process.env.RESEND_API_KEY || null, postmarkToken: process.env.POSTMARK_TOKEN || null,
    from: process.env.MAIL_FROM || null, replyTo: null,
  };
}

module.exports = { get, set, has, hint, mail };
