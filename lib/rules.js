'use strict';
// Results rules from a program definition: coach alerts and participant messages. Checked every time a
// participant saves a form. A rule:
//   { id, name, when: { type: 'answer', form, question, op, value, days } |
//                      { type: 'score', area, op, value, days },
//     text, link, email }
//   op: '>=', '<=', '=', '!=', 'includes' (multi-choice), 'answered'
//   days: how many days in a row (ending today) it has to be true (default 1)
// Alerts go to the participant's coach (on their page and list; emailed if email is set).
// Messages appear on the participant's Today screen (and are emailed to them if email is set).
const defs = require('./defs');
const P = require('./program');
const S = require('./scoring');
const mail = require('./mail');

function ensureTable(db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS rule_hits (
    id INTEGER PRIMARY KEY,
    enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,           -- alert or message
    rule_id TEXT NOT NULL,
    day INTEGER NOT NULL,
    title TEXT NOT NULL,
    text TEXT,
    link TEXT,
    created_at TEXT NOT NULL,
    seen_at TEXT,
    emailed_at TEXT,
    UNIQUE (enrollment_id, kind, rule_id, day)
  )`);
}

const OPS = { '>=': 'is at least', '<=': 'is at most', '=': 'is', '!=': 'isn’t', includes: 'includes', answered: 'is answered' };

function test(op, actual, want) {
  if (op === 'answered') return actual !== undefined && actual !== null && actual !== '' && !(Array.isArray(actual) && !actual.length);
  if (actual === undefined || actual === null || actual === '') return false;
  if (op === 'includes') return Array.isArray(actual) ? actual.map(String).includes(String(want)) : String(actual) === String(want);
  const n = Number(actual); const m = Number(want);
  const numeric = typeof actual === 'number' || (!isNaN(n) && !isNaN(m) && String(want).trim() !== '');
  const a = numeric ? n : String(actual); const b = numeric ? m : String(want);
  if (op === '>=') return a >= b;
  if (op === '<=') return a <= b;
  if (op === '=') return a === b;
  if (op === '!=') return a !== b;
  return false;
}

/** Is the rule true on this day? answers: {day: {form: answers}} */
function trueOn(D, rule, answers, day) {
  const w = rule.when || {};
  if (w.type === 'score') {
    const v = S.dailyAreas(D, answers[day] || {})[w.area];
    return v != null && test(w.op, Math.round(v * 10) / 10, w.value);
  }
  const a = (answers[day] || {})[w.form] || {};
  return test(w.op, a[w.question], w.value);
}

function matches(D, rule, answers, day) {
  const n = Math.max(1, Number((rule.when || {}).days) || 1);
  for (let d = day; d > day - n; d--) if (d < 1 || !trueOn(D, rule, answers, d)) return false;
  return true;
}

/** A plain description of a rule's condition, for the builder and the coach. */
function describe(D, rule) {
  const w = rule.when || {};
  const days = Number(w.days) > 1 ? ` for ${w.days} days in a row` : '';
  if (w.type === 'score') return `${(D.AREA[w.area] || { label: w.area }).label} score ${OPS[w.op] || w.op} ${w.value}${days}`;
  const f = D.FORMS[w.form];
  const q = f ? D.questions(f).find((x) => x.name === w.question) : null;
  const label = q ? (q.row ? `${q.field.label || q.section.title}: ${q.row.label}${q.col && q.col !== 'v' ? ` (${q.col})` : ''}` : q.field.label) : w.question;
  return `“${label}” ${OPS[w.op] || w.op}${w.op === 'answered' ? '' : ` ${w.value}`}${days}`;
}

/** After a participant saves a form: check every rule for that day and record (and send) what matches. */
async function afterSave(ctx, db, e, day) {
  ensureTable(db);
  const D = defs.forEnrollment(db, e);
  const rules = [...(D.results.alerts || []).map((r) => ({ ...r, kind: 'alert' })), ...(D.results.messages || []).map((r) => ({ ...r, kind: 'message' }))];
  if (!rules.length) return;
  const answers = P.allAnswers(db, e.id);
  const user = db.get('SELECT * FROM users WHERE id=?', e.user_id);
  for (const rule of rules) {
    if (!rule.id || !matches(D, rule, answers, day)) continue;
    const exists = db.get('SELECT id FROM rule_hits WHERE enrollment_id=? AND kind=? AND rule_id=? AND day=?', e.id, rule.kind, rule.id, day);
    if (exists) continue;
    const title = rule.name || (rule.kind === 'alert' ? 'Alert' : 'A note for you');
    const text = rule.kind === 'alert' ? `${describe(D, rule)} (Day ${day}).${rule.text ? ` ${rule.text}` : ''}` : rule.text || '';
    const id = db.insert('rule_hits', { enrollment_id: e.id, kind: rule.kind, rule_id: rule.id, day, title, text, link: rule.link || null, created_at: new Date().toISOString() });
    if (!rule.email || !user) continue;
    // Email at most once every 3 days per rule, so a run of matching days doesn't flood anyone
    const recent = db.get("SELECT 1 FROM rule_hits WHERE enrollment_id=? AND kind=? AND rule_id=? AND emailed_at > datetime('now', '-3 days')", e.id, rule.kind, rule.id);
    if (recent) continue;
    let sent = false;
    if (rule.kind === 'alert' && user.coach_id) {
      const coach = db.get('SELECT * FROM users WHERE id=? AND active=1', user.coach_id);
      if (coach) sent = await mail.send({ to: coach.email, subject: `Life Audit 360 alert: ${user.name} · ${title}`, text: `${user.name} (${D.name}, Day ${day}):\n\n${text}\n\nOpen their page: ${require('./site').baseUrl(ctx)}/participants/${user.id}` });
    } else if (rule.kind === 'message' && !user.is_test) {
      sent = await mail.send({ to: user.email, subject: title, text: `${text}${rule.link ? `\n\n${rule.link}` : ''}` });
    }
    if (sent) db.run('UPDATE rule_hits SET emailed_at=? WHERE id=?', new Date().toISOString(), id);
  }
}

/** Messages the participant hasn't dismissed (newest per rule). */
function messagesFor(db, e) {
  ensureTable(db);
  return db.all("SELECT * FROM rule_hits WHERE enrollment_id=? AND kind='message' AND seen_at IS NULL AND id IN (SELECT MAX(id) FROM rule_hits WHERE enrollment_id=? AND kind='message' AND seen_at IS NULL GROUP BY rule_id) ORDER BY id DESC LIMIT 5", e.id, e.id);
}

/** Alerts for a coach to look at. */
function alertsFor(db, enrollmentId, { unseen = false } = {}) {
  ensureTable(db);
  return db.all(`SELECT * FROM rule_hits WHERE enrollment_id=? AND kind='alert' ${unseen ? 'AND seen_at IS NULL' : ''} ORDER BY id DESC LIMIT 50`, enrollmentId);
}

module.exports = { OPS, test, matches, describe, afterSave, messagesFor, alertsFor, ensureTable };
