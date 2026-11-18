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
  const firstLink = /value="(https?:\/\/[^"]+\/invite\/[^"]+)"/.exec(inv.text)[1];
  // They haven't responded: the list shows a Resend button, and resending replaces the link
  const pid0 = db.get("SELECT id FROM users WHERE email='pat@x.test'").id;
  assert.match((await coach.get('/participants')).text, new RegExp(`/participants/${pid0}/invite`));
  const again = await coach.post(`/participants/${pid0}/invite`, { next: '/participants' });
  assert.equal(again.status, 200, 'without email set up, the new link is shown to copy');
  const link = /value="(https?:\/\/[^"]+\/invite\/[^"]+)"/.exec(again.text)[1];
  assert.notEqual(link, firstLink);
  assert.equal((await client(base).get(new URL(firstLink).pathname)).status, 410, 'the old link stops working');
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

  // A program set to start later can be moved to today with one click
  await coach.post('/participants/new', { name: 'Later Person', email: 'later@x.test', start_date: P.addDays(today, 3), timezone: 'America/Los_Angeles' });
  const lid = db.get("SELECT id FROM users WHERE email='later@x.test'").id;
  assert.match((await coach.get(`/participants/${lid}`)).text, /Start today/);
  await coach.post(`/participants/${lid}/start-today`);
  assert.equal(P.currentEnrollment(db, lid).start_date, today);
  assert.match((await coach.get('/participants/new')).text, new RegExp(`value="${today}"`), 'new invites default to today');
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

test('sign-in links in Settings, new programs, and the testing tools', async (t) => {
  const { server, db, base } = await setup();
  t.after(() => server.close());
  const coach = client(base);
  await coach.login('head@x.test');
  const today = P.todayIn('America/Los_Angeles');

  // Settings shows the link they haven't used yet
  await coach.post('/participants/new', { name: 'Kim Real', email: 'kim@x.test', start_date: today, timezone: 'America/Los_Angeles' });
  const kim = db.get("SELECT * FROM users WHERE email='kim@x.test'");
  const settings = await coach.get(`/participants/${kim.id}?tab=settings`);
  assert.match(settings.text, new RegExp(`/invite/${kim.invite_token}`));

  // Once they've set a password, a new program sends a new link that signs them straight in
  const k = client(base);
  await k.post(`/invite/${kim.invite_token}`, { password: 'kimpassword', password2: 'kimpassword' });
  assert.match((await coach.get(`/participants/${kim.id}?tab=settings`)).text, /They’ve set a password/);
  const re = await coach.post(`/participants/${kim.id}/restart`, { start_date: today });
  const newLink = /value="(https?:\/\/[^"]+\/invite\/[^"]+)"/.exec(re.text)[1];
  assert.equal(db.all('SELECT * FROM enrollments WHERE user_id=?', kim.id).length, 2);
  const k2 = client(base);
  assert.match((await k2.get(new URL(newLink).pathname)).text, /Welcome back/);
  assert.equal((await k2.post(new URL(newLink).pathname, { continue: '1' })).location, '/m?welcome=1');
  assert.match((await k2.get('/m')).text, /Day 1/);

  // Testing tools refuse real clients
  assert.equal((await coach.post(`/participants/${kim.id}/jump`, { day: '9', fill: '1' })).status, 403);
  assert.equal((await coach.post(`/participants/${kim.id}/preview`)).status, 403);

  // Make a test participant, jump to Day 9 with sample answers
  const mk = await coach.post('/participants/test');
  const tid = Number(/\/participants\/(\d+)/.exec(mk.location)[1]);
  assert.equal(db.get('SELECT is_test FROM users WHERE id=?', tid).is_test, 1);
  assert.match((await coach.get('/participants')).text, /<b>1<\/b><span>In a program now/, 'only Kim counts; tests are left out of the numbers');
  await coach.post(`/participants/${tid}/jump`, { day: '9', fill: '1' });
  const te = P.currentEnrollment(db, tid);
  assert.equal(P.position(te, 'America/Los_Angeles').day, 9);
  const filled = db.get('SELECT COUNT(DISTINCT day) n FROM responses WHERE enrollment_id=?', te.id).n;
  assert.equal(filled, 8, 'Days 1-8 filled, today left for you');
  assert.ok(db.get("SELECT COUNT(*) n FROM responses WHERE enrollment_id=? AND day=7 AND form='week2'", te.id).n, 'the Day 7 review is filled too');
  assert.match((await coach.get(`/participants/${tid}?tab=week1`)).text, /Week 2 priorities/);

  // Preview as them, then come back
  const pv = await coach.post(`/participants/${tid}/preview`);
  assert.equal(pv.location, '/m');
  const phoneHome = await coach.get('/m');
  assert.match(phoneHome.text, /Day 9/);
  assert.match(phoneHome.text, /Back to coach view/);
  assert.equal((await coach.get('/m/report/1')).status, 200);
  const back = await coach.post('/preview/exit');
  assert.equal(back.location, `/participants/${tid}`);
  assert.equal((await coach.get('/participants')).status, 200, 'signed back in as the coach');

  // Clear and restart
  await coach.post(`/participants/${tid}/clear`);
  assert.equal(db.get('SELECT COUNT(*) n FROM responses WHERE enrollment_id=?', te.id).n, 0);
  assert.equal(P.currentEnrollment(db, tid).start_date, today);
});


// ---------------------------------------------------------------- Hybrid priority spec (Oct 28 2026)
const Pr = require('../lib/priorities');

/** A full End of Week Review: every question rated `base`, with some overrides. */
function review(base, overrides = {}, stated = []) {
  const week1 = {}; const week2 = {};
  for (const q of Pr.QUESTIONS) {
    const v = overrides[q.key] ?? base;
    (F.FORMS.week1.sections.some((sec) => sec.area === q.area) ? week1 : week2)[q.key] = v;
  }
  if (stated.length) week2['wrapup.priorities'] = stated;
  return { week1, week2 };
}

test('spec: eligibility, ranking order and the worked example', () => {
  // Page 2 example: Sleep 5, Mental 5, Phone 4, Nutrition 3, Physical 2 (everything else 1-2)
  const rk = Pr.rank(review(1, {
    'sleep.ratings.quality': 5, 'sleep.ratings.hours': 4,             // sleep: highest 5, two rated 3-5
    'mental.ratings.stress': 5,                                       // mental: highest 5, one rated 3-5
    'phone.ratings.scrolling': 4, 'nutrition.ratings.water': 3,
    'physical.ratings.energy': 2,
  }));
  assert.ok(rk.complete);
  assert.deepEqual(rk.eligibleKeys, ['sleep', 'mental', 'phone', 'nutrition'], 'highest rating first, then count of 3-5');
  assert.deepEqual(rk.recommended, ['sleep', 'mental', 'phone']);
  const cat = Object.fromEntries(rk.categories.map((c) => [c.key, c]));
  assert.equal(cat.physical.eligible, false, 'a 2 is recorded but never triggers support');
  assert.equal(cat.physical.highest, 2);
  assert.deepEqual(cat.sleep.challenges.map((c) => c.key), ['sleep.ratings.quality', 'sleep.ratings.hours']);
  assert.equal(rk.items.find((i) => i.key === 'physical.ratings.energy').eligible, false);

  // Ties on highest and count are broken by the participant's stated priorities
  const tie = Pr.rank(review(1, { 'work.ratings.time': 4, 'discipline.ratings.goals': 4 }, ['Discipline & habits']));
  assert.deepEqual(tie.recommended, ['discipline', 'work']);
  const tie2 = Pr.rank(review(1, { 'work.ratings.time': 4, 'discipline.ratings.goals': 4 }, ['Work, time & productivity']));
  assert.deepEqual(tie2.recommended, ['work', 'discipline']);
});

test('spec: never manufacture a third priority', () => {
  const two = Pr.rank(review(2, { 'sleep.ratings.quality': 3, 'phone.ratings.mood': 4 }));
  assert.deepEqual(two.recommended, ['phone', 'sleep']);
  assert.equal(Pr.required(two), 2);
  const none = Pr.rank(review(2));
  assert.deepEqual(none.recommended, []);
  assert.equal(Pr.required(none), 0);
  assert.deepEqual(Pr.validate(none, []), { keys: [] });
  const partial = Pr.rank({ week1: { 'sleep.ratings.quality': 5 } });
  assert.equal(partial.complete, false, 'every question must be rated first');
});

test('spec: confirm or swap rules', () => {
  const rk = Pr.rank(review(1, { 'sleep.ratings.quality': 5, 'mental.ratings.stress': 5, 'phone.ratings.scrolling': 4, 'nutrition.ratings.water': 3 }));
  assert.deepEqual(Pr.validate(rk, ['sleep', 'mental', 'nutrition']), { keys: ['sleep', 'mental', 'nutrition'] }, 'swap in another eligible area');
  assert.match(Pr.validate(rk, ['sleep', 'mental', 'physical']).error, /rated 3 or higher/);
  assert.match(Pr.validate(rk, ['sleep', 'sleep', 'mental']).error, /once/);
  assert.match(Pr.validate(rk, ['sleep', 'mental', 'phone', 'nutrition']).error, /no more than 3/);
  assert.match(Pr.validate(rk, ['sleep']).error, /Pick 3/);
});

test('spec: the participant flow, storage, lock and challenge-level content', async (t) => {
  const { server, db, base } = await setup();
  t.after(() => server.close());
  const coach = client(base);
  await coach.login('head@x.test');
  const today = P.todayIn('America/Los_Angeles');
  await coach.post('/participants/new', { name: 'Robin Spec', email: 'robin@x.test', start_date: P.addDays(today, -6), timezone: 'America/Los_Angeles' });
  const u = db.get("SELECT * FROM users WHERE email='robin@x.test'");
  const e = P.currentEnrollment(db, u.id);
  const me = client(base);
  await me.post(`/invite/${u.invite_token}`, { password: 'robinpassword', password2: 'robinpassword' });

  // Content: a whole-area video, a challenge item for a challenge they flag, and one for a challenge rated 2
  const now = new Date().toISOString();
  const vArea = db.insert('videos', { kind: 'video', area: 'sleep', title: 'Sleep basics', url: 'https://youtu.be/abcdefgh', created_at: now });
  const vHit = db.insert('videos', { kind: 'prompt', area: 'sleep', challenge: 'sleep.ratings.quality', title: 'Quality prompt', url: '', description: 'Do this', created_at: now });
  const vMiss = db.insert('videos', { kind: 'tool', area: 'sleep', challenge: 'sleep.ratings.hours', title: 'Hours tool', url: '', description: 'x', created_at: now });
  const vOther = db.insert('videos', { kind: 'video', area: 'work', title: 'Not a priority', url: 'https://youtu.be/zzzzzzzz', created_at: now });

  // Day 7: the review is unfinished, so no recommendations yet
  assert.match((await me.get('/m/priorities')).text, /Finish your review first/);
  const r = review(1, { 'sleep.ratings.quality': 5, 'sleep.ratings.hours': 2, 'mental.ratings.stress': 5, 'phone.ratings.scrolling': 4, 'nutrition.ratings.water': 3 });
  P.saveAnswers(db, e.id, 7, 'week1', r.week1);
  P.saveAnswers(db, e.id, 7, 'week2', r.week2);
  const pg = await me.get('/m/priorities');
  assert.match(pg.text, /Choose your Week 2 priorities/);
  assert.match(pg.text, /Other areas you can swap in/);
  assert.match(pg.text, /No support needed/);

  // Bad picks are refused; swapping phone for nutrition is allowed
  assert.match((await me.post('/m/priorities', { 'areas[]': ['sleep', 'physical', 'mental'] })).location, /err=/);
  await me.post('/m/priorities', { 'areas[]': ['sleep', 'mental', 'nutrition'] });
  const saved = Pr.load(db, e.id);
  assert.deepEqual(saved.recommended, ['mental', 'sleep', 'phone'], 'original recommendation kept (mental and sleep tie on 5 with one challenge each; category order decides)');
  assert.deepEqual(saved.confirmed, ['sleep', 'mental', 'nutrition'], 'final choice stored separately');
  assert.equal(saved.confirmed_role, 'participant');
  assert.equal(saved.ranking.items.length, Pr.QUESTIONS.length, 'every question’s rating, category and eligibility is stored');
  assert.ok(saved.ranking.items.every((i) => i.area && typeof i.eligible === 'boolean'));

  // The review is now locked; can reopen on Day 7 only
  assert.equal((await me.post('/m/day/7/week1', r.week1, { 'x-autosave': '1' })).status, 403);
  assert.match((await me.get('/m/day/7/week1')).text, /review is locked/);
  await me.post('/m/priorities/reopen');
  assert.equal(Pr.load(db, e.id), null);
  await me.post('/m/priorities', { 'areas[]': ['sleep', 'mental', 'nutrition'] });

  // Day 9: can't change any more; the plan shows only confirmed areas and flagged challenges
  db.run('UPDATE enrollments SET start_date=? WHERE id=?', P.addDays(today, -8), e.id);
  assert.equal((await me.post('/m/priorities/reopen')).status, 403);
  const plan = (await me.get('/m/videos')).text;
  assert.match(plan, /Sleep basics/);
  assert.match(plan, /Quality prompt/);
  assert.doesNotMatch(plan, /Hours tool/, 'challenge rated 2 gets no content');
  assert.doesNotMatch(plan, /Not a priority/, 'only confirmed categories drive Week 2');
  assert.equal((plan.match(/Sleep basics/g) || []).length, 1, 'no duplicates');
  void vArea; void vHit; void vMiss; void vOther;

  // The coach sees the spec table and can adjust under the same rules
  const ov = (await coach.get(`/participants/${u.id}`)).text;
  assert.match(ov, /Recommended, swapped out/);
  assert.match(ov, /Priority 3 \(swapped in\)/);
  assert.match(ov, /No intervention/);
  await coach.post(`/participants/${u.id}/priorities`, { 'areas[]': ['sleep', 'mental', 'phone'] });
  const after = Pr.load(db, e.id);
  assert.deepEqual(after.confirmed, ['sleep', 'mental', 'phone']);
  assert.deepEqual(after.recommended, ['mental', 'sleep', 'phone'], 'the system’s recommendation is still kept');
  assert.equal(after.confirmed_role, 'head');
});

// ---------------------------------------------------------------- Super admin
test('admin: who can get in, logging in as, and every action logged', async (t) => {
  const { server, db, base, coach: coachId } = await setup();
  t.after(() => server.close());
  const admin = client(base);
  await admin.login('head@x.test');
  const today = P.todayIn('America/Los_Angeles');
  await admin.post('/participants/new', { name: 'Pia Help', email: 'pia@x.test', start_date: today, timezone: 'America/Los_Angeles', coach_id: String(coachId) });
  const pia = db.get("SELECT * FROM users WHERE email='pia@x.test'");
  const pc = client(base);
  await pc.post(`/invite/${pia.invite_token}`, { password: 'piapassword', password2: 'piapassword' });

  // Only admins
  const other = client(base);
  await other.login('other@x.test');
  for (const p of ['/admin', '/admin/users', `/admin/users/${pia.id}`, '/admin/log']) assert.equal((await other.get(p)).status, 403, p);
  assert.equal((await other.post(`/admin/users/${pia.id}/login-as`)).status, 403);
  assert.equal((await pc.get('/admin')).location, '/m');
  for (const p of ['/admin', '/admin/users', `/admin/users/${pia.id}`, `/admin/users/${coachId}`, '/admin/log']) assert.equal((await admin.get(p)).status, 200, p);
  assert.match((await admin.get('/admin/users')).text, /Pia Help/);

  // Log in as a real participant, see their app, then come back
  const seenBefore = db.get('SELECT last_seen FROM users WHERE id=?', pia.id).last_seen;
  assert.equal((await admin.post(`/admin/users/${pia.id}/login-as`)).location, '/m');
  const asPia = await admin.get('/m');
  assert.match(asPia.text, /Signed in as <b>Pia Help/);
  assert.match(asPia.text, /Back to admin/);
  assert.equal(db.get('SELECT last_seen FROM users WHERE id=?', pia.id).last_seen, seenBefore, 'doesn’t change their last seen');
  assert.equal((await admin.get('/admin')).location, '/m', 'no admin powers while signed in as them');
  assert.equal((await admin.post('/preview/exit')).location, `/admin/users/${pia.id}`);
  assert.equal((await admin.get('/admin')).status, 200, 'back to the admin');

  // Log in as a coach: the coach site shows the bar
  await admin.post(`/admin/users/${coachId}/login-as`);
  const asCoach = await admin.get('/participants');
  assert.match(asCoach.text, /Signed in as <b>Other Coach/);
  assert.doesNotMatch(asCoach.text, /href="\/admin"/);
  await admin.post('/preview/exit');
  // Never as another admin, or yourself
  const head2 = db.insert('users', { role: 'head', name: 'Second Admin', email: 'h2@x.test', password_hash: auth.hashPassword('password1'), created_at: new Date().toISOString() });
  assert.equal((await admin.post(`/admin/users/${head2}/login-as`)).status, 403);

  // Set a password: works, signs them out
  await admin.post(`/admin/users/${pia.id}/password`, { password: 'brandnewpw' });
  assert.equal((await pc.get('/m')).location.startsWith('/login'), true, 'signed out everywhere');
  assert.equal((await client(base).login('pia@x.test', 'brandnewpw')).status, 303);

  // Roles: make the coach an admin and back; the last admin can't be removed
  await admin.post(`/admin/users/${coachId}/edit`, { name: 'Other Coach', email: 'other@x.test', role: 'head' });
  assert.equal(db.get('SELECT role FROM users WHERE id=?', coachId).role, 'head');
  await admin.post(`/admin/users/${coachId}/edit`, { name: 'Other Coach', email: 'other@x.test', role: 'coach' });
  db.run('UPDATE users SET active=0 WHERE id=?', head2);
  const me = db.get("SELECT id FROM users WHERE email='head@x.test'").id;
  assert.equal((await admin.post(`/admin/users/${me}/deactivate`)).status, 400, 'can’t turn yourself off');

  // Turning off a coach moves their clients
  await admin.post(`/admin/users/${coachId}/deactivate`, { to: String(me) });
  assert.equal(db.get('SELECT coach_id FROM users WHERE id=?', pia.id).coach_id, me);
  assert.equal(db.get('SELECT active FROM users WHERE id=?', coachId).active, 0);
  await admin.post(`/admin/users/${coachId}/reactivate`);

  // Backup and export
  const bk = await fetch(`${base}/admin/backup`, { method: 'POST', body: new URLSearchParams({ _csrf: admin.jar.csrf }), headers: { cookie: `sid=${admin.jar.sid}; csrf=${admin.jar.csrf}`, 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(bk.status, 200);
  assert.equal(Buffer.from(await bk.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3', 'a real database file');
  const csv = await admin.post('/admin/export');
  assert.match(csv.text, /Pia Help,pia@x\.test/);

  // Delete needs DELETE typed
  await admin.post(`/admin/users/${pia.id}/delete`, { confirm: 'nope' });
  assert.ok(db.get('SELECT id FROM users WHERE id=?', pia.id));
  await admin.post(`/admin/users/${pia.id}/delete`, { confirm: 'DELETE' });
  assert.equal(db.get('SELECT id FROM users WHERE id=?', pia.id), undefined);

  // Everything is in the log
  const actions = db.all('SELECT action FROM admin_log').map((r) => r.action);
  for (const a of ['login_as', 'set_password', 'edit', 'deactivate', 'reactivate', 'backup', 'export', 'delete']) assert.ok(actions.includes(a), a);
  assert.match((await admin.get('/admin/log')).text, /Signed in as/);
});
