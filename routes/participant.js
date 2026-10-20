'use strict';
// The participant phone app (/m): today's forms, past days, food photos, progress, reports, videos, profile.
const { html, raw, dateFmt, firstName } = require('../lib/html');
const { phone, icon, csrfField, formBody, dayStrip } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const P = require('../lib/program');
const R = require('../lib/report');
const auth = require('../lib/auth');
const { str, ZONES } = require('../lib/site');

const O = { participant: true };

/** The signed-in participant's program, position and status of each day. */
function mine(ctx) {
  const e = P.currentEnrollment(ctx.db, ctx.user.id);
  const pos = P.position(e, ctx.user.timezone);
  const map = e ? P.responseMap(ctx.db, e.id) : {};
  return { e, pos, map };
}

function dayParam(ctx, pos) {
  const d = Number(ctx.params.day);
  if (!Number.isInteger(d) || d < 1 || d > F.PROGRAM_DAYS) throw new HttpError(404, 'That day isn’t part of the program.');
  if (!pos || d > pos.open) throw new HttpError(403, `Day ${d} hasn’t started yet.`);
  return d;
}

function progressBar(answered, total) {
  const pct = total ? Math.round((answered / total) * 100) : 0;
  return html`<span class="pbar-track"><span style="width:${pct}%"></span></span><small>${answered >= total && total ? html`${icon('check')} Done` : `${answered} of ${total}`}</small>`;
}

function formCard(day, key, got) {
  const f = F.FORMS[key];
  const r = got && got[key];
  const answered = r ? r.answered : 0; const total = r ? r.total : F.progress(f, {}).total;
  const done = r && total && answered >= total;
  return html`<a class="task ${done ? 'done' : answered ? 'partial' : ''} ${f.weekly ? 'weekly' : ''}" href="/m/day/${day}/${key}">
<span class="task-icon">${icon(f.weekly ? 'trophy' : key === 'day1' ? 'brain' : 'bed')}</span>
<span class="task-body"><b>${f.title}</b><small>${f.blurb}</small><span class="task-prog">${progressBar(answered, total)}</span></span></a>`;
}

function photoCard(ctx, e, day) {
  const n = ctx.db.get('SELECT COUNT(*) n FROM photos WHERE enrollment_id=? AND day=?', e.id, day).n;
  return html`<a class="task photo" href="/m/day/${day}/photos"><span class="task-icon">${icon('camera')}</span>
<span class="task-body"><b>Food &amp; drink photos</b><small>Snap everything you eat and drink: meals, snacks, drinks.</small><span class="task-prog"><small>${n ? `${n} photo${n === 1 ? '' : 's'} today` : 'No photos yet'}</small></span></span></a>`;
}

function videosFor(db, e, day, focusKeys) {
  if (!focusKeys.length) return [];
  return db.all(`SELECT v.*, vv.watched_at FROM videos v LEFT JOIN video_views vv ON vv.video_id=v.id AND vv.enrollment_id=?
    WHERE v.active=1 AND v.area IN (${focusKeys.map(() => '?').join(',')}) AND (v.day IS NULL OR v.day <= ?)
    ORDER BY (v.day IS NULL), v.day, v.sort, v.id`, e.id, ...focusKeys, day);
}

const REMEMBER = html`<section class="remember"><h3>Remember</h3><ul>
<li>${icon('camera')}<span><b>Take photos</b> of everything you eat &amp; drink.</span></li>
<li>${icon('alert')}<span><b>Don’t change anything.</b> Keep your normal routine and just document it.</span></li>
<li>${icon('notes')}<span><b>Be honest.</b> No judgment. Real data creates real change.</span></li>
<li>${icon('chart')}<span><b>A clearer you.</b> After 7 days you’ll see your results and biggest challenges.</span></li></ul></section>`;

const INSTALL = html`<section class="card install" data-install><h3>${icon('phone')} Put Life Audit 360 on your home screen</h3>
<p><b>iPhone:</b> tap the Share button <span class="kbd">⬆</span> in Safari, then <b>Add to Home Screen</b>.</p>
<p><b>Android:</b> tap the <span class="kbd">⋮</span> menu in Chrome, then <b>Add to Home screen</b> or <b>Install app</b>.</p>
<button type="button" class="link" data-install-hide>Hide this</button></section>`;

module.exports = (r, { db }) => {
  // ---------------------------------------------------------------- Today
  r.get('/m', (ctx) => {
    const { e, pos, map } = mine(ctx);
    const name = firstName(ctx.user.name);
    if (!e) {
      return ctx.html(phone(ctx, { title: 'Today', tab: 'today', body: html`<section class="card"><h2>Hi ${name}</h2><p>Your coach hasn’t started your 14-day program yet. You’ll see Day 1 here as soon as they do.</p></section>${INSTALL}` }));
    }
    if (!pos.started) {
      return ctx.html(phone(ctx, { title: 'Today', tab: 'today', hero: true, body: html`
<section class="hero"><div class="hero-text"><p class="eyebrow">Life Audit 360</p><h1>Starts<br><span>${dateFmt(e.start_date, 'dow')}</span></h1><p>Hi ${name}. Your 14 days begin soon.</p></div></section>
<section class="card"><h3>How it works</h3><ol class="how"><li><b>Days 1–7: document, don’t change.</b> Each day, fill in Part 1 and Part 2 and photograph what you eat and drink.</li><li><b>Day 7: your analysis.</b> See where you’re strong and your biggest challenges.</li><li><b>Days 8–14: make the change.</b> Watch the videos for your focus areas and keep logging.</li><li><b>Day 14: see your progress.</b> Week 1 and Week 2 side by side.</li></ol></section>
${INSTALL}`,
      }));
    }
    const day = Math.min(pos.day, F.PROGRAM_DAYS);
    const phase = F.phaseOf(day);
    const got = map[day] || {};
    const report = R.build(db, e);
    const vids = day >= 8 ? videosFor(db, e, day, report.focus.keys) : [];
    const unwatched = vids.filter((v) => !v.watched_at);
    const behind = [];
    for (let d = 1; d < pos.open; d++) if (P.dayStatus(map, d) !== 'done') behind.push(d);
    const forms = F.formsForDay(day);

    ctx.html(phone(ctx, { title: 'Today', tab: 'today', hero: true, body: html`
<section class="hero"><div class="hero-text"><p class="eyebrow">${pos.finished ? 'Program complete' : dateFmt(pos.today, 'dow')}</p><h1>${pos.finished ? html`14 <span>days done</span>` : html`Day ${day}<span>of 14</span>`}</h1><p>${phase.name}</p></div></section>
${ctx.query.welcome ? html`<section class="card welcome"><h2>You’re in, ${name}!</h2><p>Each day, open Life Audit 360 and fill in the day’s two parts. It takes about 5 minutes.</p></section>${INSTALL}` : ''}
<div class="strip-wrap">${dayStrip(map, pos, { link: (d) => `/m/day/${d}` })}</div>

${pos.finished ? html`<section class="card done-card"><h2>${icon('trophy')} You did it</h2><p>Your Day 14 analysis compares Week 1 and Week 2.</p><a class="btn primary wide" href="/m/report/2">See your results</a></section>` : html`
<p class="tip">${phase.tip}</p>
<h2 class="list-title">Today’s audit</h2>
<div class="tasks">${forms.filter((k) => !F.FORMS[k].weekly).map((k) => formCard(day, k, got))}${photoCard(ctx, e, day)}</div>
${forms.some((k) => F.FORMS[k].weekly) ? html`<h2 class="list-title">End of Week Review</h2><p class="tip">Rate each area based on your last 7 days. This builds your ${day === 7 ? 'Day 7' : 'Day 14'} analysis.</p><div class="tasks">${forms.filter((k) => F.FORMS[k].weekly).map((k) => formCard(day, k, got))}</div>` : ''}
${day >= 8 ? html`<h2 class="list-title">Your videos</h2>${vids.length ? html`<a class="task" href="/m/videos"><span class="task-icon">${icon('play')}</span><span class="task-body"><b>${unwatched.length ? `${unwatched.length} to watch` : 'All caught up'}</b><small>For ${report.focus.keys.map((k) => F.AREA[k].short).join(', ')}</small></span></a>` : html`<p class="tip">Your coach is adding videos for your focus areas.</p>`}` : ''}`}
${pos.day > 7 || pos.finished ? html`<a class="task report" href="/m/report/1"><span class="task-icon">${icon('chart')}</span><span class="task-body"><b>Your Day 7 analysis</b><small>Biggest challenges: ${report.w1.top.map((a) => a.short).join(', ') || '—'}</small></span></a>` : ''}
${behind.length && !pos.finished ? html`<h2 class="list-title">Catch up</h2><div class="behind">${behind.slice(-6).map((d) => html`<a href="/m/day/${d}">Day ${d}<small>${P.dayStatus(map, d) === 'partial' ? 'Unfinished' : 'Not started'}</small></a>`)}</div>` : ''}
${day <= 7 && !pos.finished ? REMEMBER : ''}`,
    }));
  }, O);

  // ---------------------------------------------------------------- One day
  r.get('/m/day/:day', (ctx) => {
    const { e, pos, map } = mine(ctx);
    if (!e) return ctx.redirect('/m');
    const day = dayParam(ctx, pos);
    const got = map[day] || {};
    const forms = F.formsForDay(day);
    ctx.html(phone(ctx, { title: `Day ${day}`, back: '/m', tab: 'today', body: html`
<p class="day-date">${dateFmt(pos.dateOf(day), 'long')} · ${F.phaseOf(day).name}</p>
<div class="tasks">${forms.map((k) => formCard(day, k, got))}${photoCard(ctx, e, day)}</div>`,
    }));
  }, O);

  r.get('/m/day/:day/:form', (ctx) => {
    const { e, pos } = mine(ctx);
    if (!e) return ctx.redirect('/m');
    const day = dayParam(ctx, pos);
    const key = ctx.params.form;
    if (key === 'photos') return require('./photos').page(ctx, e, day);
    if (!F.formsForDay(day).includes(key)) throw new HttpError(404, 'That form isn’t part of this day.');
    const form = F.FORMS[key];
    const answers = P.loadAnswers(db, e.id, day, key);
    ctx.html(phone(ctx, { title: `Day ${day} · ${form.short}`, back: `/m/day/${day}`, tab: 'today', body: html`
<div class="form-top"><p class="eyebrow">${form.title}</p><p>${form.weekly ? 'Be honest. This helps identify where to focus.' : day <= 7 ? 'Document, don’t change. Record your real day.' : 'Keep logging your day the same way.'} Answers save as you go.</p></div>
${formBody(ctx, form, answers, `/m/day/${day}/${key}`)}`,
    }));
  }, O);

  r.post('/m/day/:day/:form', (ctx) => {
    const { e, pos } = mine(ctx);
    if (!e) throw new HttpError(400, 'Your program hasn’t been set up yet.');
    const day = dayParam(ctx, pos);
    const key = ctx.params.form;
    if (!F.formsForDay(day).includes(key)) throw new HttpError(404, 'That form isn’t part of this day.');
    const answers = F.parseAnswers(F.FORMS[key], ctx.body);
    const p = P.saveAnswers(db, e.id, day, key, answers);
    if (ctx.wantsJson) return ctx.json({ ok: true, ...p });
    const forms = F.formsForDay(day);
    const nextForm = forms[forms.indexOf(key) + 1];
    const done = p.answered >= p.total;
    ctx.setFlash(done ? `${F.FORMS[key].short} saved. Nice work!` : `Saved. ${p.total - p.answered} question${p.total - p.answered === 1 ? '' : 's'} left on ${F.FORMS[key].short}.`);
    ctx.redirect(done && nextForm ? `/m/day/${day}/${nextForm}` : `/m/day/${day}`);
  }, O);

  // ---------------------------------------------------------------- Progress and reports
  r.get('/m/progress', (ctx) => {
    const { e, pos, map } = mine(ctx);
    if (!e || !pos.started) return ctx.html(phone(ctx, { title: 'Progress', tab: 'progress', body: html`<div class="empty">${icon('chart')}<p>Your progress shows here once Day 1 starts.</p></div>` }));
    const c = P.completion(map, pos);
    const report = R.build(db, e);
    ctx.html(phone(ctx, { title: 'Progress', tab: 'progress', body: html`
<section class="card stats"><div><b>${c.done}</b><small>days complete</small></div><div><b>${P.streak(map, pos)}</b><small>day streak</small></div><div><b>${c.pct}%</b><small>so far</small></div></section>
<div class="strip-wrap">${dayStrip(map, pos, { link: (d) => `/m/day/${d}` })}</div>
<h2 class="list-title">Your analysis</h2>
<div class="tasks">
${pos.day >= 7 ? html`<a class="task report" href="/m/report/1"><span class="task-icon">${icon('chart')}</span><span class="task-body"><b>Day 7 analysis</b><small>Week 1: your starting point</small></span></a>` : html`<div class="task locked"><span class="task-icon">${icon('chart')}</span><span class="task-body"><b>Day 7 analysis</b><small>Unlocks on Day 7 · ${dateFmt(pos.dateOf(7), 'dow')}</small></span></div>`}
${pos.day >= 14 ? html`<a class="task report" href="/m/report/2"><span class="task-icon">${icon('trophy')}</span><span class="task-body"><b>Day 14 analysis</b><small>Week 1 and Week 2 compared</small></span></a>` : html`<div class="task locked"><span class="task-icon">${icon('trophy')}</span><span class="task-body"><b>Day 14 analysis</b><small>Unlocks on Day 14 · ${dateFmt(pos.dateOf(14), 'dow')}</small></span></div>`}
</div>
${report.w1.logged.length ? html`<h2 class="list-title">So far this week</h2><section class="card">${require('../lib/views').areaBars(pos.day >= 8 ? report.w2.areas : report.w1.areas)}<p class="hint">How much of a challenge each area has been (1 = not a challenge, 5 = severe), from your daily answers.</p></section>` : ''}`,
    }));
  }, O);

  r.get('/m/report/:week', (ctx) => {
    const { e, pos } = mine(ctx);
    const week = Number(ctx.params.week);
    if (!e || ![1, 2].includes(week)) return ctx.redirect('/m/progress');
    if (!pos || pos.day < week * 7) throw new HttpError(403, `Your Day ${week * 7} analysis unlocks on Day ${week * 7}.`);
    const report = R.build(db, e);
    ctx.html(phone(ctx, { title: `Day ${week * 7} analysis`, back: '/m/progress', tab: 'progress', body: R.weekReport(report, week) }));
  }, O);

  // ---------------------------------------------------------------- Videos
  r.get('/m/videos', (ctx) => {
    const { e, pos } = mine(ctx);
    if (!e || !pos || pos.day < 8) {
      return ctx.html(phone(ctx, { title: 'Videos', tab: 'videos', body: html`<div class="empty">${icon('play')}<p>Your coaching videos unlock on <b>Day 8</b>${e ? html`, ${dateFmt(P.addDays(e.start_date, 7), 'dow')}` : ''}, after your Day 7 analysis picks your focus areas.</p></div>` }));
    }
    const report = R.build(db, e);
    const day = Math.min(pos.day, F.PROGRAM_DAYS);
    const vids = videosFor(db, e, day, report.focus.keys);
    const upcoming = report.focus.keys.length ? db.get(`SELECT MIN(day) d FROM videos WHERE active=1 AND day > ? AND area IN (${report.focus.keys.map(() => '?').join(',')})`, day, ...report.focus.keys).d : null;
    ctx.html(phone(ctx, { title: 'Videos', tab: 'videos', body: html`
<p class="tip">Your focus areas: <b>${report.focus.keys.map((k) => F.AREA[k].label).join(' · ')}</b></p>
${vids.length ? html`<div class="videos">${vids.map((v) => html`<article class="video ${v.watched_at ? 'watched' : ''}">
<div class="video-meta"><span class="tag">${icon(F.AREA[v.area].icon)} ${F.AREA[v.area].short}</span>${v.day ? html`<span class="tag">Day ${v.day}</span>` : ''}</div>
<h3>${v.title}</h3>${v.description ? html`<p>${v.description}</p>` : ''}
${embed(v.url)}
<form method="post" action="/m/videos/${v.id}/watched">${csrfField(ctx)}${v.watched_at ? html`<input type="hidden" name="undo" value="1"><button class="btn small ghost">${icon('check')} Watched</button>` : html`<button class="btn small">Mark as watched</button>`}</form></article>`)}</div>`
    : html`<div class="empty">${icon('video')}<p>No videos for your focus areas yet. Your coach will add them.</p></div>`}
${upcoming ? html`<p class="hint">More videos unlock on Day ${upcoming}.</p>` : ''}`,
    }));
  }, O);

  r.post('/m/videos/:id/watched', (ctx) => {
    const { e } = mine(ctx);
    const v = db.get('SELECT id FROM videos WHERE id=?', Number(ctx.params.id));
    if (!e || !v) throw new HttpError(404, 'That video wasn’t found.');
    if (ctx.body.undo) db.run('DELETE FROM video_views WHERE enrollment_id=? AND video_id=?', e.id, v.id);
    else db.run('INSERT OR IGNORE INTO video_views (enrollment_id, video_id, watched_at) VALUES (?,?,?)', e.id, v.id, new Date().toISOString());
    ctx.redirect(`/m/videos#v${v.id}`);
  }, O);

  // ---------------------------------------------------------------- Me
  r.get('/m/me', (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    const coach = u.coach_id ? db.get('SELECT name, email FROM users WHERE id=?', u.coach_id) : null;
    const { e, pos } = mine(ctx);
    ctx.html(phone(ctx, { title: 'Me', tab: 'me', body: html`
<section class="card me"><h2>${u.name}</h2><p class="muted">${u.email}</p>
${coach ? html`<p>Your coach: <b>${coach.name}</b> · <a href="mailto:${coach.email}">${coach.email}</a></p>` : ''}
${e ? html`<p>Program: ${dateFmt(e.start_date)} – ${dateFmt(pos.endDate)}</p>` : ''}</section>
<form method="post" action="/m/me" class="card">${csrfField(ctx)}<h3>Settings</h3>
<label class="fld"><span>Time zone</span><select name="timezone">${[...new Set([u.timezone, ...ZONES])].map((z) => html`<option${z === u.timezone ? raw(' selected') : ''}>${z}</option>`)}</select></label>
<p class="hint">Your program days change over at midnight in this time zone.</p>
<button class="btn">Save</button></form>
<form method="post" action="/m/me/password" class="card">${csrfField(ctx)}<h3>Change password</h3>
<label class="fld"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
<label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
<button class="btn">Change password</button></form>
${INSTALL}
<form method="post" action="/logout" class="center">${csrfField(ctx)}<button class="btn ghost wide">${icon('logout')} Sign out</button></form>`,
    }));
  }, O);

  r.post('/m/me', (ctx) => {
    const tz = str(ctx.body.timezone, 60);
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new HttpError(400, 'That time zone isn’t recognized.'); }
    db.run('UPDATE users SET timezone=? WHERE id=?', tz, ctx.user.id);
    ctx.setFlash('Saved.');
    ctx.redirect('/m/me');
  }, O);

  r.post('/m/me/password', (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!auth.verifyPassword(ctx.body.current || '', u.password_hash)) { ctx.setFlash('Your current password isn’t right.', 'err'); return ctx.redirect('/m/me'); }
    if ((ctx.body.password || '').length < 8) { ctx.setFlash('Use at least 8 characters.', 'err'); return ctx.redirect('/m/me'); }
    db.run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(ctx.body.password), u.id);
    db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.token_hash);
    ctx.setFlash('Password changed.');
    ctx.redirect('/m/me');
  }, O);
};

/** YouTube and Vimeo links play inside the app; anything else opens as a link. */
function embed(url) {
  let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (m) return html`<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="Video" allow="encrypted-media; picture-in-picture; fullscreen" loading="lazy" allowfullscreen></iframe></div>`;
  m = /vimeo\.com\/(?:video\/)?(\d+)(?:\/(\w+))?/.exec(url);
  if (m) return html`<div class="embed"><iframe src="https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}" title="Video" allow="fullscreen; picture-in-picture" loading="lazy" allowfullscreen></iframe></div>`;
  return /^https?:\/\//.test(url) ? html`<p><a class="btn wide" href="${url}" target="_blank" rel="noopener">${icon('play')} Watch the video</a></p>` : '';
}
module.exports.embed = embed;
