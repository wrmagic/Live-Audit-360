'use strict';
// Where a participant is in their 14 days, and how much they've filled in.
const F = require('./forms');

/** Today's date (YYYY-MM-DD) in a time zone. */
function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));

/** The latest program run for a participant. */
function currentEnrollment(db, userId) {
  return db.get('SELECT * FROM enrollments WHERE user_id=? ORDER BY start_date DESC, id DESC LIMIT 1', userId);
}

/**
 * Program position. day: 1-14 while running; 0 before it starts; 15 when finished.
 * open: the latest day that can be filled in (today, capped at 14).
 */
function position(enrollment, tz) {
  if (!enrollment) return null;
  const today = todayIn(tz);
  const n = daysBetween(enrollment.start_date, today) + 1;
  const day = n < 1 ? 0 : n > F.PROGRAM_DAYS ? F.PROGRAM_DAYS + 1 : n;
  return {
    today, day,
    open: Math.min(Math.max(n, 0), F.PROGRAM_DAYS),
    started: n >= 1,
    finished: n > F.PROGRAM_DAYS,
    endDate: addDays(enrollment.start_date, F.PROGRAM_DAYS - 1),
    dateOf: (d) => addDays(enrollment.start_date, d - 1),
  };
}

/** {day: {form: {answered,total,updated_at}}} for one enrollment. */
function responseMap(db, enrollmentId) {
  const map = {};
  for (const r of db.all('SELECT day, form, answered, total, updated_at FROM responses WHERE enrollment_id=?', enrollmentId)) {
    (map[r.day] = map[r.day] || {})[r.form] = r;
  }
  return map;
}

/** Status of one program day: 'done' (every form complete), 'partial', 'empty'. */
function dayStatus(map, day) {
  const forms = F.formsForDay(day);
  const got = map[day] || {};
  const done = forms.filter((f) => got[f] && got[f].total && got[f].answered >= got[f].total).length;
  const started = forms.filter((f) => got[f] && got[f].answered > 0).length;
  if (done === forms.length) return 'done';
  return started ? 'partial' : 'empty';
}

/** Days 1..open that are complete, as a share of days so far. */
function completion(map, pos) {
  if (!pos || !pos.open) return { done: 0, of: 0, pct: 0 };
  let done = 0;
  for (let d = 1; d <= pos.open; d++) if (dayStatus(map, d) === 'done') done++;
  return { done, of: pos.open, pct: Math.round((done / pos.open) * 100) };
}

/** How many days in a row (ending today or yesterday) have at least something logged. */
function streak(map, pos) {
  if (!pos || !pos.open) return 0;
  let d = pos.open;
  if (dayStatus(map, d) === 'empty') d--;
  let n = 0;
  while (d >= 1 && dayStatus(map, d) !== 'empty') { n++; d--; }
  return n;
}

function loadAnswers(db, enrollmentId, day, form) {
  const r = db.get('SELECT answers FROM responses WHERE enrollment_id=? AND day=? AND form=?', enrollmentId, day, form);
  try { return r ? JSON.parse(r.answers) : {}; } catch { return {}; }
}

function saveAnswers(db, enrollmentId, day, formKey, answers) {
  const form = F.FORMS[formKey];
  const p = F.progress(form, answers);
  db.run(`INSERT INTO responses (enrollment_id, day, form, answers, answered, total, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT (enrollment_id, day, form) DO UPDATE SET answers=excluded.answers, answered=excluded.answered, total=excluded.total, updated_at=excluded.updated_at`,
  enrollmentId, day, formKey, JSON.stringify(answers), p.answered, p.total, new Date().toISOString());
  return p;
}

/** Every saved answer for an enrollment: {day: {form: answers}} */
function allAnswers(db, enrollmentId) {
  const out = {};
  for (const r of db.all('SELECT day, form, answers FROM responses WHERE enrollment_id=?', enrollmentId)) {
    try { (out[r.day] = out[r.day] || {})[r.form] = JSON.parse(r.answers); } catch { /* skip */ }
  }
  return out;
}

module.exports = { todayIn, addDays, daysBetween, isDate, currentEnrollment, position, responseMap, dayStatus, completion, streak, loadAnswers, saveAnswers, allAnswers };
