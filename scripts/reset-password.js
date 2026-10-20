'use strict';
// Set a new password for any login from the server's shell (e.g. Render → Shell):
//   npm run reset-password -- someone@example.com 'new-password'
const path = require('node:path');
const { open } = require('../lib/db');
const auth = require('../lib/auth');

const [email, pw] = process.argv.slice(2);
if (!email || !pw || pw.length < 8) { console.log('Usage: npm run reset-password -- EMAIL NEW-PASSWORD (8+ characters)'); process.exit(1); }
const db = open(process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'la360.db'));
const u = db.get('SELECT id, name FROM users WHERE email=?', email.toLowerCase());
if (!u) { console.log(`No login with the email ${email}.`); process.exit(1); }
db.run('UPDATE users SET password_hash=?, active=1 WHERE id=?', auth.hashPassword(pw), u.id);
db.run('DELETE FROM sessions WHERE user_id=?', u.id);
console.log(`Password changed for ${u.name}.`);
