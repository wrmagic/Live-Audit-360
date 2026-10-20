'use strict';
// End-to-end checks: invite → choose password → fill in the day → coach sees it; scoring; who can see what.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const auth = require('../lib/auth');
const F = require('../lib/forms');
const P = require('../lib/program');
const S = require('../lib/scoring');
const mail = require('../lib/mail');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'la360-'));
  const server = createApp({ dbFile: path.join(dir, 'test.db') });
  const db = server.db;
  const t = new Date().toISOString();
  const head = db.insert('users', { role: 'head', name: 'Head Coach', email: 'head@x.test', password_hash: auth.hashPassword('password1'), created_at: t });
  const coach = db.insert('users', { role: 'coach', name: 'Other Coach', email: 'other@x.test', password_hash: auth.hashPassword('password1'), created_at: t });
  return new Promise((res) => server.listen(0, () => res({ server, db, head, coach, base: `http://127.0.0.1:${server.address().port}` })));
}

function client(base) {
  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const take = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const c = {
    jar,
    async get(p) { const r = await fetch(base + p, { redirect: 'manual', headers: { cookie: cookie() } }); take(r); return { status: r.status, text: await r.text(), location: r.headers.get('location') }; },
    async post(p, data = {}, headers = {}) {
      if (!jar.csrf) await c.get('/login');
      const body = new URLSearchParams();
      body.append('_csrf', jar.csrf);
      for (const [k, v] of Object.entries(data)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, x));
      const r = await fetch(base + p, { method: 'POST', redirect: 'manual', body, headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded', ...headers } });
      take(r);
      return { status: r.status, text: await r.text(), location: r.headers.get('location') };
    },
    async raw(p, buf, headers = {}) {
      const r = await fetch(base + p, { method: 'POST', body: buf, headers: { cookie: cookie(), 'x-csrf': jar.csrf, ...headers } });
      take(r);
      return { status: r.status, json: await r.json() };
    },
    async login(email, password = 'password1') { await c.get('/login'); return c.post('/login', { email, password }); },
  };
  return c;
}

test('the whole program flow', async (t) => {
  const { server, db, base } = await setup();
  t.after(() => server.close());
  const coach = client(base);
  const r0 = await coach.login('head@x.test');
  assert.equal(r0.status, 303);

  // Invite someone whose Day 1 was three days ago (so Days 1-3 are open)
  const today = P.todayIn('America/Los_Angeles');
  const inv = await coach.post('/participants/new', { name: 'Pat Test', email: 'pat@x.test', start_date: P.addDays(today, -2), timezone: 'America/Los_Angeles' });
  assert.equal(inv.status, 200);
  const link = /value="(https?:\/\/[^"]+\/invite\/[^"]+)"/.exec(inv.text)[1];
  assert.ok(mail.sentLog.some((m) => m.to === 'pat@x.test'), 'an invite email was attempted');

  // Participant opens the link, chooses a password, lands on the phone app
  const me = client(base);
  const tokenPath = new URL(link).pathname;
  assert.equal((await me.get(tokenPath)).status, 200);
  assert.equal((await me.post(tokenPath, { password: 'short', password2: 'short' })).status, 400);
  const set = await me.post(tokenPath, { password: 'patpassword', password2: 'patpassword' });
  assert.equal(set.location, '/m?welcome=1');
  const home = await me.get('/m');
  assert.match(home.text, /Day 3/);
  assert.equal((await me.get(tokenPath)).status, 410, 'invite links work once');

  // Fill in Day 1 Part 1 (autosave JSON) and check the progress count
  const answers = { 'checkin.feel.stress.morning': '4', 'checkin.overall': 'Difficult', 'movement.challenge': '5', 'movement.exercised': 'Yes', 'movement.exercise_types[]': ['Walking', 'Other'], 'movement.exercise_types__other': 'Hiking', 'nutrition.challenge': '2', 'hydration.rating': '1', bogus: 'x', 'movement.steps': 'not an option' };
  const auto = await me.post('/m/day/1/day1', answers, { 'x-autosave': '1' });
  assert.equal(auto.status, 200);
  const j = JSON.parse(auto.text);
  assert.ok(j.ok && j.answered === 7 && j.total > 20, JSON.stringify(j));
  const e = P.currentEnrollment(db, db.get("SELECT id FROM users WHERE email='pat@x.test'").id);
  const saved = P.loadAnswers(db, e.id, 1, 'day1');
  assert.deepEqual(saved['movement.exercise_types'], ['Walking', 'Other']);
  assert.equal(saved['movement.exercise_types__other'], 'Hiking');
  assert.equal(saved.bogus, undefined);
  assert.equal(saved['movement.steps'], undefined, 'values not on the form are dropped');

  // "If yes" answers disappear when the yes/no becomes No
  await me.post('/m/day/1/day1', { ...answers, 'movement.exercised': 'No' }, { 'x-autosave': '1' });
  assert.equal(P.loadAnswers(db, e.id, 1, 'day1')['movement.exercise_types'], undefined);

  // Days that haven't started can't be filled in; reviews only on Day 7 and 14
  assert.equal((await me.post('/m/day/4/day1', answers, { 'x-autosave': '1' })).status, 403);
  assert.equal((await me.get('/m/day/3/week1')).status, 404);
  assert.equal((await me.get('/m/report/1')).status, 403);

  // Food photo upload (a tiny JPEG header is enough for the type check)
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);
  const up = await me.raw('/m/photos/1', jpg, { 'content-type': 'image/jpeg' });
  assert.equal(up.status, 200);
  assert.equal((await me.raw('/m/photos/1', Buffer.from('not an image'))).status, 415);
  const bad = await fetch(`${base}/m/photos/1`, { method: 'POST', body: jpg, headers: { cookie: `sid=${me.jar.sid}; csrf=${me.jar.csrf}` } });
  assert.equal(bad.status, 403, 'uploads need the CSRF header');

  // The coach sees the answers and the photo
  const pid = db.get("SELECT id FROM users WHERE email='pat@x.test'").id;
  const view = await coach.get(`/participants/${pid}?tab=day&day=1`);
  assert.match(view.text, /Other: Hiking|Difficult/);
  assert.match(view.text, new RegExp(`/photo/${up.json.id}`));
  assert.equal((await coach.get(`/photo/${up.json.id}`)).status, 200);

  // Participants can't open coach pages, and vice versa
  assert.equal((await me.get('/participants')).location, '/m');
  assert.equal((await coach.get('/m')).location, '/');

  // Another coach can't see this participant or the photo
  const other = client(base);
  await other.login('other@x.test');
  assert.equal((await other.get(`/participants/${pid}`)).status, 403);
  assert.equal((await other.get(`/photo/${up.json.id}`)).status, 403);
  assert.doesNotMatch((await other.get('/participants?show=all')).text, /Pat Test/);
  assert.equal((await other.get('/coaches')).status, 403, 'only the head coach manages coaches');
});

test('scoring: week analysis, focus areas and comparison', () => {
  const answers = {};
  for (let d = 1; d <= 7; d++) {
    answers[d] = {
      day1: { 'movement.challenge': 5, 'nutrition.challenge': 2, 'hydration.rating': 4, 'checkin.feel.stress.morning': 4, 'checkin.feel.mood.morning': 2 },
      day2: { 'sleep.challenge': 4, 'sleep.quality': 2, 'sleep.rested': 2, 'phone.challenge': 3, 'sleep.hours': '6 – 7 hrs', 'sleep.bedtime': d % 2 ? '23:30' : '00:30' },
    };
  }
  answers[7].week1 = { 'physical.ratings.energy': 5, 'physical.ratings.exercise': 5, 'sleep.ratings.quality': 4 };
  answers[7].week2 = { 'wrapup.priorities': ['Phone & social media'] };
  const w1 = S.analyzeWeek(answers, 1);
  const by = Object.fromEntries(w1.areas.map((a) => [a.key, a]));
  assert.equal(by.physical.daily, 5);
  assert.equal(by.physical.review, 5);
  assert.equal(by.nutrition.daily, 2); // challenge 2 and flipped hydration 4 → 2
  assert.equal(by.sleep.daily, 4);
  assert.equal(by.sleep.score, 4);
  assert.equal(w1.top[0].key, 'physical');
  assert.equal(w1.facts.sleepHours, '6 – 7 hrs');
  assert.equal(w1.facts.bedtime, '23:56', 'bedtimes either side of midnight average sensibly');

  // Focus: the participant's priority first, then the top scores
  const focus = S.focusAreas({}, w1);
  assert.deepEqual(focus.keys.slice(0, 2), ['phone', 'physical']);
  assert.equal(S.focusAreas({ focus_areas: '["work"]' }, w1).source, 'coach');

  // Week 2 easier → negative change
  for (let d = 8; d <= 14; d++) answers[d] = { day1: { 'movement.challenge': 2 } };
  const w2 = S.analyzeWeek(answers, 2);
  const cmp = S.compare(w1, w2);
  assert.equal(cmp.find((a) => a.key === 'physical').change, -3);
});

test('forms: every question has a unique name and the day plan is right', () => {
  for (const f of Object.values(F.FORMS)) {
    const names = F.questions(f).map((q) => q.name);
    assert.equal(new Set(names).size, names.length, `${f.key} has duplicate question names`);
  }
  assert.deepEqual(F.formsForDay(1), ['day1', 'day2']);
  assert.deepEqual(F.formsForDay(7), ['day1', 'day2', 'week1', 'week2']);
  assert.deepEqual(F.formsForDay(14), ['day1', 'day2', 'week1', 'week2']);
  const priorities = F.parseAnswers(F.FORMS.week2, { 'wrapup.priorities': F.AREAS.slice(0, 5).map((a) => a.label) });
  assert.equal(priorities['wrapup.priorities'].length, 3, 'top three priorities means at most three');
});

test('demo data loads and every page renders', async (t) => {
  const { server, db, head, base } = await setup();
  t.after(() => server.close());
  require('../scripts/demo')(db, head);
  const coach = client(base);
  await coach.login('head@x.test');
  for (const p of ['/participants', '/participants?show=all', '/participants/new', '/videos', '/coaches']) assert.equal((await coach.get(p)).status, 200, p);
  for (const u of db.all("SELECT id FROM users WHERE role='participant'")) {
    for (const tab of ['overview', 'day', 'week1', 'week2', 'notes', 'settings']) assert.equal((await coach.get(`/participants/${u.id}?tab=${tab}`)).status, 200, `${u.id} ${tab}`);
  }
  const derek = client(base);
  await derek.login('derek@example.com', 'demo1234');
  for (const p of ['/m', '/m/progress', '/m/videos', '/m/me', '/m/day/10', '/m/day/10/day1', '/m/day/7/week2', '/m/day/3/photos', '/m/report/1']) assert.equal((await derek.get(p)).status, 200, p);
  assert.match((await derek.get('/m/videos')).text, /Mark as watched/);
});
