'use strict';
// Trying out the participant experience: test participants, previewing their phone app as them,
// jumping to any program day (with earlier days filled in with sample answers), and clearing answers.
// These tools only work on participants created as test participants, never on real clients.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, raw, firstName } = require('../lib/html');
const { icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const P = require('../lib/program');
const auth = require('../lib/auth');
const { participantFor, str } = require('../lib/site');
const { fakeAnswers } = require('../scripts/demo');

const O = { coach: true };

function testParticipant(ctx, id) {
  const p = participantFor(ctx, id);
  if (!p.is_test) throw new HttpError(403, 'Testing tools only work on test participants, so real clients’ answers are never changed.');
  return p;
}

/** The testing panel shown on a test participant's page. */
function panel(ctx, s) {
  const p = s.p;
  const day = s.pos ? s.pos.day : 0;
  return html`<section class="panel testing"><h3>${icon('alert')} Test participant</h3>
<p class="muted">Use this account to try the program yourself. It isn’t counted in your numbers, and these tools only work on test participants.</p>
<div class="test-grid">
<form method="post" action="/participants/${p.id}/preview">${csrfField(ctx)}<h4>1. See their phone app</h4><p class="hint">Opens the app as ${p.name}. Everything works: fill in forms, add photos, watch videos. A bar at the top brings you back here.</p><button class="btn primary">${icon('phone')} Preview their app</button></form>
<form method="post" action="/participants/${p.id}/jump">${csrfField(ctx)}<h4>2. Jump to a day</h4><p class="hint">Moves their Day 1 so today becomes the day you pick.</p>
<div class="inline"><select name="day">${Array.from({ length: F.PROGRAM_DAYS }, (_, i) => i + 1).map((d) => html`<option value="${d}"${d === day ? raw(' selected') : ''}>Day ${d}${d === 7 ? ' · Week 1 review' : d === 8 ? ' · videos start' : d === 14 ? ' · final review' : ''}</option>`)}<option value="15"${day > F.PROGRAM_DAYS ? raw(' selected') : ''}>Finished</option></select><button class="btn">Jump</button></div>
<label class="check"><input type="checkbox" name="fill" value="1" checked> Fill the days before it with sample answers</label></form>
<form method="post" action="/participants/${p.id}/clear">${csrfField(ctx)}<h4>3. Start over</h4><p class="hint">Deletes every answer, photo and watched video in this program and sets Day 1 to today.</p><button class="btn ghost" data-confirm="Delete all of ${p.name}’s answers and start again from Day 1?">Clear and restart</button></form>
</div></section>`;
}

/** A banner across the phone app while a coach is previewing as a test participant. */
function previewBar(ctx) {
  if (!ctx.cookies.coach_sid || !ctx.user || ctx.user.role !== 'participant') return '';
  return html`<form method="post" action="/preview/exit" class="preview-bar">${csrfField(ctx)}<span>${icon('alert')} Preview: <b>${ctx.user.name}</b></span><button class="btn small">Back to coach view</button></form>`;
}

module.exports = (r, { db, photoDir }) => {
  r.post('/participants/test', (ctx) => {
    const n = db.get("SELECT COUNT(*) n FROM users WHERE is_test=1 AND coach_id=?", ctx.user.id).n + 1;
    const name = str(ctx.body.name, 100) || `Test Participant ${n}`;
    const t = new Date().toISOString();
    const id = db.tx(() => {
      const uid = db.insert('users', { role: 'participant', name, email: `test-${crypto.randomBytes(5).toString('hex')}@test.invalid`, coach_id: ctx.user.id, timezone: ctx.user.timezone, is_test: 1, created_at: t });
      db.insert('enrollments', { user_id: uid, start_date: P.todayIn(ctx.user.timezone), created_at: t });
      return uid;
    });
    auth.issueInvite(db, id); // a sign-in link, under Settings, for trying it on your own phone
    ctx.setFlash(`${name} is ready, starting at Day 1 today.`);
    ctx.redirect(`/participants/${id}`);
  }, O);

  r.post('/participants/:id/jump', (ctx) => {
    const p = testParticipant(ctx, ctx.params.id);
    const e = P.currentEnrollment(db, p.id);
    const day = Math.max(1, Math.min(F.PROGRAM_DAYS + 1, Number(ctx.body.day) || 1));
    const today = P.todayIn(p.timezone);
    let filled = 0;
    db.tx(() => {
      db.run('UPDATE enrollments SET start_date=? WHERE id=?', P.addDays(today, -(day - 1)), e.id);
      if (ctx.body.fill) {
        // Each test participant gets their own pattern of challenges, a bit easier in Week 2
        const bias = Object.fromEntries(F.AREAS.map((a) => [a.key, 1.5 + Math.random() * 3.3]));
        const map = P.responseMap(db, e.id);
        for (let d = 1; d <= Math.min(day - 1, F.PROGRAM_DAYS); d++) {
          for (const key of F.formsForDay(d)) {
            if (map[d] && map[d][key] && map[d][key].answered) continue; // keep anything already filled in
            P.saveAnswers(db, e.id, d, key, fakeAnswers(F.FORMS[key], Math.random, bias, d >= 8 ? 1 : 0));
            filled++;
          }
        }
      }
    });
    ctx.setFlash(`${p.name} is now on ${day > F.PROGRAM_DAYS ? 'the finished program' : `Day ${day}`}.${filled ? ` Filled in ${filled} form${filled === 1 ? '' : 's'} with sample answers.` : ''}`);
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  r.post('/participants/:id/clear', (ctx) => {
    const p = testParticipant(ctx, ctx.params.id);
    const e = P.currentEnrollment(db, p.id);
    for (const ph of db.all('SELECT file FROM photos WHERE enrollment_id=?', e.id)) { try { fs.unlinkSync(path.join(photoDir, ph.file)); } catch { /* gone */ } }
    db.tx(() => {
      for (const t of ['responses', 'photos', 'video_views']) db.run(`DELETE FROM ${t} WHERE enrollment_id=?`, e.id);
      db.run('UPDATE enrollments SET start_date=?, focus_areas=NULL WHERE id=?', P.todayIn(p.timezone), e.id);
    });
    ctx.setFlash(`Cleared. ${p.name} starts again at Day 1 today.`);
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  // Preview: sign in as the test participant in this browser, keeping the coach's sign-in to come back to
  r.post('/participants/:id/preview', (ctx) => {
    const p = testParticipant(ctx, ctx.params.id);
    ctx.setCookie('coach_sid', ctx.sessionToken, { maxAge: 12 * 3600 });
    ctx.setCookie('sid', auth.createSession(db, p), { maxAge: 12 * 3600 });
    ctx.redirect('/m');
  }, O);

  r.post('/preview/exit', (ctx) => {
    const coach = auth.loadSession(db, ctx.cookies.coach_sid);
    const back = ctx.user && ctx.user.role === 'participant' ? ctx.user.id : null;
    if (ctx.user && ctx.user.role === 'participant') auth.destroySession(db, ctx.sessionToken);
    ctx.setCookie('coach_sid', '', { maxAge: 0 });
    if (!coach || coach.role === 'participant') { ctx.setCookie('sid', '', { maxAge: 0 }); return ctx.redirect('/login'); }
    ctx.setCookie('sid', ctx.cookies.coach_sid, { maxAge: 60 * 864e2 });
    ctx.redirect(back ? `/participants/${back}` : '/participants');
  }, { public: true });
};

module.exports.panel = panel;
module.exports.previewBar = previewBar;
