'use strict';
// First-time setup: creates the head coach login. With --demo, also adds sample coaches, participants
// at different points in the program (with made-up answers) and sample videos, to try things out.
//   ADMIN_EMAIL     the head coach's email (sign-in name)          default: coach@example.com
//   ADMIN_NAME      the head coach's name                          default: Head Coach
//   ADMIN_PASSWORD  the head coach's password (first start only)   default: a random one, printed below
const path = require('node:path');
const crypto = require('node:crypto');
const { open, now } = require('../lib/db');
const auth = require('../lib/auth');

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'la360.db');
const db = open(dbFile);
const demo = process.argv.includes('--demo');

if (db.get('SELECT COUNT(*) n FROM users').n) {
  console.log('This database already has logins. Nothing to do.');
  process.exit(0);
}

const pw = () => crypto.randomBytes(9).toString('base64url');
const email = (process.env.ADMIN_EMAIL || 'coach@example.com').toLowerCase();
const headPw = process.env.ADMIN_PASSWORD || (demo ? 'demo1234' : pw());
const headId = db.insert('users', { role: 'head', name: process.env.ADMIN_NAME || 'Head Coach', email, password_hash: auth.hashPassword(headPw), created_at: now() });
console.log('\nLife Audit 360 is set up.');
console.log(`  Head coach sign-in:  ${email}`);
console.log(`  Password:            ${process.env.ADMIN_PASSWORD ? '(the ADMIN_PASSWORD you set)' : headPw}`);

if (demo) {
  const seed = require('./demo');
  const logins = seed(db, headId);
  console.log('\nSample data added. Other sign-ins (password for all: demo1234):');
  for (const l of logins) console.log(`  ${l.role.padEnd(12)} ${l.email.padEnd(28)} ${l.note || ''}`);
}
console.log('');
db.close();
