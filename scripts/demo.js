'use strict';
// Sample data for trying Life Audit 360: a second coach, participants at different points in the
// program with made-up answers, and sample videos. Used by `npm run demo` and the tests.
const F = require('../lib/forms');
const P = require('../lib/program');
const auth = require('../lib/auth');
const { now } = require('../lib/db');

// A seeded random number generator so the sample data is the same every time
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Made-up answers for one form. bias: {area: 1..5}, how much of a challenge each area is for this person;
 * better: how much easier Week 2 is (0 = same).
 */
function fakeAnswers(form, rand, bias, better = 0) {
  const out = {};
  const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
  const around = (c) => clamp(c - better + (rand() - 0.5) * 2.2);
  for (const q of F.questions(form)) {
    const f = q.field; const area = q.section.area || 'work';
    const c = bias[area] || 3;
    if (f.optional && rand() < 0.75) continue;
    if (f.showIf) continue; // filled after the yes/no below
    if (f.type === 'grid') {
      const good = q.row && (q.row.good || false);
      const v = around(area === 'mental' ? c : c);
      out[q.name] = good ? 6 - v : v;
    } else if (f.type === 'scale') out[q.name] = f.good ? 6 - around(c) : around(c);
    else if (f.type === 'yesno') {
      const yes = /exercised|supportive/.test(f.key) ? rand() > (c - better) / 6 : rand() < (c - better) / 6;
      out[q.name] = yes ? 'Yes' : 'No';
    } else if (f.type === 'single') {
      const n = f.options.length; const lean = /screen_time|social_time/.test(f.key) ? (c - better) / 5 : /hours|water|steps|exercise_minutes/.test(f.key) ? 1 - (c - better) / 5 : rand();
      out[q.name] = f.options[Math.max(0, Math.min(n - 1, Math.round(lean * (n - 1) + (rand() - 0.5) * 2)))];
    } else if (f.type === 'multi') {
      const pool = f.options.filter((o) => !/^None/.test(o));
      const k = f.max || 1 + Math.floor(rand() * 3);
      out[q.name] = [...pool].sort(() => rand() - 0.5).slice(0, k);
    } else if (f.type === 'time') {
      const late = c - better;
      if (f.key === 'bedtime') { const h = 21 + Math.round(late * 0.6 + rand()); out[q.name] = `${String(h % 24).padStart(2, '0')}:${rand() < 0.5 ? '00' : '30'}`; } else out[q.name] = `0${5 + Math.round(rand() * 2)}:${rand() < 0.5 ? '15' : '45'}`;
    } else if (f.type === 'text') out[q.name] = ['Long day at work, but I stayed on track.', 'Felt tired all afternoon.', 'Great workout this morning!', 'Too much scrolling before bed.'][Math.floor(rand() * 4)];
  }
  for (const q of F.questions(form)) {
    if (!q.field.showIf || !F.visible(q, out)) continue;
    const pool = q.field.options; out[q.name] = [...pool].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 2));
  }
  if (form.key === 'week2') {
    const top = Object.entries(bias).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => F.AREA[k].label);
    out['wrapup.priorities'] = top;
  }
  return out;
}

function seed(db, headId) {
  const pwHash = auth.hashPassword('demo1234');
  const coachId = db.insert('users', { role: 'coach', name: 'Jordan Reyes', email: 'jordan@example.com', password_hash: pwHash, created_at: now() });
  const tz = 'America/Los_Angeles';
  const today = P.todayIn(tz);
  const people = [
    { name: 'Maria Lopez', email: 'maria@example.com', day: 4, coach: headId, bias: { mental: 4, physical: 3, nutrition: 3, sleep: 4, phone: 4, work: 3, relationships: 2, discipline: 3 }, skip: [2] },
    { name: 'Derek Thompson', email: 'derek@example.com', day: 10, coach: headId, bias: { mental: 3, physical: 4, nutrition: 4, sleep: 5, phone: 5, work: 3, relationships: 2, discipline: 4 } },
    { name: 'Aisha Khan', email: 'aisha@example.com', day: 15, coach: coachId, bias: { mental: 4, physical: 2, nutrition: 3, sleep: 3, phone: 4, work: 5, relationships: 3, discipline: 3 } },
    { name: 'Sam Carter', email: 'sam@example.com', day: 7, coach: coachId, bias: { mental: 2, physical: 4, nutrition: 4, sleep: 3, phone: 3, work: 2, relationships: 2, discipline: 4 }, stopAfter: 5 },
    { name: 'Lena Park', email: 'lena@example.com', day: 0, coach: headId, bias: {} },
  ];
  const logins = [{ role: 'coach', email: 'jordan@example.com' }];
  people.forEach((p, i) => {
    const rand = rng(1000 + i * 77);
    const start = P.addDays(today, -(p.day - 1));
    const uid = db.insert('users', { role: 'participant', name: p.name, email: p.email, password_hash: pwHash, coach_id: p.coach, timezone: tz, created_at: now() });
    const eid = db.insert('enrollments', { user_id: uid, start_date: p.day ? start : P.addDays(today, 2), created_at: now() });
    const lastDay = Math.min(p.day, F.PROGRAM_DAYS, p.stopAfter || 99);
    for (let d = 1; d <= lastDay; d++) {
      if ((p.skip || []).includes(d)) continue;
      const better = d >= 8 ? 1.1 : 0;
      for (const key of F.formsForDay(d)) {
        if (d === p.day && d !== 7 && d !== 14 && key === 'day2') continue; // today: only Part 1 done so far
        P.saveAnswers(db, eid, d, key, fakeAnswers(F.FORMS[key], rand, p.bias, better));
      }
    }
    // Pretend the entries were saved on their own days
    db.run("UPDATE responses SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || (day - 1) || ' days', '+20 hours') WHERE enrollment_id=? AND day < ?", start, eid, p.day);
    logins.push({ role: 'participant', email: p.email, note: p.day === 0 ? 'starts in 2 days' : p.day > 14 ? 'finished' : `on Day ${p.day}` });
  });
  const vids = [
    ['sleep', 'Building a wind-down routine', 'Three simple steps for the hour before bed.', null],
    ['sleep', 'Caffeine, screens and your sleep', 'How afternoon habits show up at night.', 10],
    ['phone', 'Taking back your screen time', 'Set up your phone so it works for you.', null],
    ['phone', 'The 30-minute morning rule', 'Start the day before you start scrolling.', 11],
    ['nutrition', 'Easy wins for your plate', 'Small swaps that add up over a week.', null],
    ['mental', 'Resetting a stressful day', 'A 5-minute practice for midday stress.', null],
    ['physical', 'Movement you can fit anywhere', 'Short sessions for busy days.', null],
    ['work', 'Plan tomorrow tonight', 'Ten minutes that make the next day easier.', null],
    ['discipline', 'Habits that stick', 'Make it obvious, easy and satisfying.', null],
    ['relationships', 'Protecting your time with people who matter', 'Simple boundaries that help.', 12],
  ];
  vids.forEach(([area, title, description, day], i) => db.insert('videos', { area, title, description, day, url: 'https://example.com/sample-video', sort: i, created_at: now() }));
  return logins;
}

module.exports = seed;
module.exports.fakeAnswers = fakeAnswers;
