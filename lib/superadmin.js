'use strict';
// Super admins run the Admin area (logins, log in as, backups…). They are head coaches with an extra flag.
// The emails in SUPER_ADMIN_EMAILS (comma-separated; default james@wrmagic.com) are made super admins every
// time the app starts, so that access can't be lost by accident. If the login doesn't exist yet, it is
// created, and a link to choose a password is written to the server log (or use "Forgot your password?").
const auth = require('./auth');

const emails = () => String(process.env.SUPER_ADMIN_EMAILS ?? 'james@wrmagic.com').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isProtected = (email) => emails().includes(String(email || '').toLowerCase());

function ensure(db) {
  for (const email of emails()) {
    const u = db.get('SELECT * FROM users WHERE email=?', email);
    if (u) {
      if (u.role === 'participant') { console.warn(`SUPER_ADMIN_EMAILS: ${email} is a participant login, so it wasn't made a super admin.`); continue; }
      if (u.role !== 'head' || !u.is_super || !u.active) db.run("UPDATE users SET role='head', is_super=1, active=1 WHERE id=?", u.id);
    } else {
      const id = db.insert('users', { role: 'head', is_super: 1, name: email.split('@')[0].replace(/^./, (c) => c.toUpperCase()), email, created_at: new Date().toISOString() });
      const t = auth.issueInvite(db, id);
      const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
      if (process.env.NODE_ENV !== 'test') console.log(`\nSuper admin login created for ${email}. Choose a password here (works for ${auth.INVITE_DAYS} days):\n${base}/invite/${t}\n`);
    }
  }
}

module.exports = { ensure, emails, isProtected };
