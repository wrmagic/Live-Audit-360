'use strict';
// The participant phone app (/m): today's forms, past days, food photos, progress, reports, videos, profile.
const { html, raw, dateFmt, firstName } = require('../lib/html');
const { phone, icon, csrfField, formBody, dayStrip, answersView } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const P = require('../lib/program');
const R = require('../lib/report');
const Pr = require('../lib/priorities');
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

const KIND = { video: ['Video', 'play'], prompt: ['Prompt', 'notes'], tool: ['Tool', 'gear'] };

/**
 * Week 2 content for the confirmed priorities: items for the whole area, plus items for the specific
 * challenges rated 3-5. Items for challenges rated 1-2 are never shown, and nothing is listed twice.
 */
function contentFor(db, e, day, pri) {
  const keys = pri.confirmed || [];
  if (!keys.length) return { byArea: {}, all: [], next: null };
  const rows = db.all(`SELECT v.*, vv.watched_at FROM videos v LEFT JOIN video_views vv ON vv.video_id=v.id AND vv.enrollment_id=?
    WHERE v.active=1 AND v.area IN (${keys.map(() => '?').join(',')}) ORDER BY (v.day IS NULL) DESC, v.day, v.sort, v.id`, e.id, ...keys);
  const seen = new Set(); const byArea = {}; const all = []; let next = null;
  for (const v of rows) {
    if (v.challenge && !(pri.flagged[v.area] || []).includes(v.challenge)) continue;
    if (v.day && v.day > day) { next = next ? Math.min(next, v.day) : v.day; continue; }
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    (byArea[v.area] = byArea[v.area] || []).push(v);
    all.push(v);
  }
  return { byArea, all, next };
}

function itemCard(ctx, v) {
  const [kindLabel, kindIcon] = KIND[v.kind] || KIND.video;
  const ch = v.challenge && Pr.QUESTION[v.challenge];
  return html`<article class="video ${v.watched_at ? 'watched' : ''}" id="v${v.id}">
<div class="video-meta"><span class="tag">${icon(kindIcon)} ${kindLabel}</span>${ch ? html`<span class="tag">For: ${ch.label}</span>` : ''}${v.day ? html`<span class="tag">Day ${v.day}</span>` : ''}</div>
<h3>${v.title}</h3>${v.description ? html`<p class="prewrap">${v.description}</p>` : ''}
${v.url ? (v.kind === 'video' ? embed(v.url) : html`<p><a class="btn wide" href="${v.url}" target="_blank" rel="noopener">Open the ${kindLabel.toLowerCase()}</a></p>`) : ''}
<form method="post" action="/m/videos/${v.id}/watched">${csrfField(ctx)}${v.watched_at ? html`<input type="hidden" name="undo" value="1"><button class="btn small ghost">${icon('check')} Done</button>` : html`<button class="btn small">${v.kind === 'video' ? 'Mark as watched' : 'Mark as done'}</button>`}</form></article>`;
}

/** One selectable area on the confirm screen. */
function pickCard(c, checked) {
  return html`<label class="pick"><input type="checkbox" name="areas[]" value="${c.key}"${checked ? raw(' checked') : ''}>
<span class="pick-body"><span class="pick-head">${icon(c.icon)}<b>${c.label}</b><span class="dot d${c.highest}">${c.highest}</span></span>
<small>${c.count} challenge${c.count === 1 ? '' : 's'} rated 3–5: ${c.challenges.map((x) => `${x.label} (${x.rating})`).join(', ')}</small></span></label>`;
}

function priorityCards(pri) {
  return html`<div class="tasks">${pri.confirmed.map((k, i) => {
    const c = pri.byKey[k];
    return html`<div class="task done"><span class="task-icon">${icon(c.icon)}</span><span class="task-body"><b>Priority ${i + 1} · ${c.label}</b><small>${c.challenges.map((x) => `${x.label} (${x.rating})`).join(', ')}</small></span></div>`;
  })}</div>`;
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
  /** The Day 7 review can't change once the priorities it produced are confirmed. */
  const reviewLocked = (e, day, key) => day === Pr.REVIEW_DAY && F.FORMS[key].weekly && !!Pr.load(db, e.id);

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
    const pri = report.pri;
    const content = day >= 8 ? contentFor(db, e, day, pri) : { all: [] };
    const todo = content.all.filter((v) => !v.watched_at);
    const reviewDone = pri.ranking.complete;
    const priCard = !pri.isConfirmed && reviewDone && pos.day >= 7 && !pos.finished
      ? html`<a class="task weekly pri-cta" href="/m/priorities"><span class="task-icon">${icon('target')}</span><span class="task-body"><b>Choose your Week 2 priorities</b><small>${pri.ranking.eligibleKeys.length ? `We recommend ${pri.recommended.length}: ${pri.recommended.map((k) => F.AREA[k].short).join(', ')}. Confirm or swap.` : 'See what your review found.'}</small></span></a>`
      : '';
    const behind = [];
    for (let d = 1; d < pos.open; d++) if (P.dayStatus(map, d) !== 'done') behind.push(d);
    const forms = F.formsForDay(day);

    ctx.html(phone(ctx, { title: 'Today', tab: 'today', hero: true, body: html`
<section class="hero"><div class="hero-text"><p class="eyebrow">${pos.finished ? 'Program complete' : dateFmt(pos.today, 'dow')}</p><h1>${pos.finished ? html`14 <span>days done</span>` : html`Day ${day}<span>of 14</span>`}</h1><p>${phase.name}</p></div></section>
${ctx.query.welcome ? html`<section class="card welcome"><h2>You’re in, ${name}!</h2><p>Each day, open Life Audit 360 and fill in the day’s two parts. It takes about 5 minutes.</p></section>${INSTALL}` : ''}
<div class="strip-wrap">${dayStrip(map, pos, { link: (d) => `/m/day/${d}` })}</div>

${pos.finished ? html`<section class="card done-card"><h2>${icon('trophy')} You did it</h2><p>Your Day 14 analysis compares Week 1 and Week 2.</p><a class="btn primary wide" href="/m/report/2">See your results</a></section>` : html`
<p class="tip">${phase.tip}</p>
${day >= 8 ? priCard : ''}
<h2 class="list-title">Today’s audit</h2>
<div class="tasks">${forms.filter((k) => !F.FORMS[k].weekly).map((k) => formCard(day, k, got))}${photoCard(ctx, e, day)}</div>
${forms.some((k) => F.FORMS[k].weekly) ? html`<h2 class="list-title">End of Week Review</h2><p class="tip">Rate each area based on your last 7 days. This builds your ${day === 7 ? 'Day 7' : 'Day 14'} analysis.</p><div class="tasks">${forms.filter((k) => F.FORMS[k].weekly).map((k) => formCard(day, k, got))}</div>${day === 7 ? html`<div class="tasks after">${priCard}</div>` : ''}` : ''}
${day >= 8 && pri.isConfirmed ? html`<h2 class="list-title">Your Week 2 plan</h2>${pri.confirmed.length ? html`<a class="task" href="/m/videos"><span class="task-icon">${icon('target')}</span><span class="task-body"><b>${content.all.length ? (todo.length ? `${todo.length} to do` : 'All caught up') : 'Your plan'}</b><small>${pri.confirmed.map((k) => F.AREA[k].short).join(' · ')}</small></span></a>` : html`<p class="tip">Nothing on your review was rated 3 or higher, so there’s no corrective plan. Keep doing what works and keep logging.</p>`}` : ''}`}
${pos.day > 7 || pos.finished ? html`<a class="task report" href="/m/report/1"><span class="task-icon">${icon('chart')}</span><span class="task-body"><b>Your Day 7 analysis</b><small>${pri.isConfirmed && pri.confirmed.length ? `Priorities: ${pri.confirmed.map((k) => F.AREA[k].short).join(', ')}` : `Biggest challenges: ${report.w1.top.map((a) => a.short).join(', ') || '—'}`}</small></span></a>` : ''}
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
    if (reviewLocked(e, day, key)) {
      return ctx.html(phone(ctx, { title: `Day ${day} · ${form.short}`, back: `/m/day/${day}`, tab: 'today', body: html`
<p class="tip">${icon('check')} Your Week 2 priorities are confirmed, so this review is locked. ${pos.day <= Pr.REVIEW_DAY ? html`To change an answer, <a href="/m/priorities">reopen your priorities</a> first.` : ''}</p>
<section class="card">${answersView(form, answers)}</section>` }));
    }
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
    if (reviewLocked(e, day, key)) throw new HttpError(403, 'Your Week 2 priorities are confirmed, so the Day 7 review is locked.');
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

  // ---------------------------------------------------------------- Week 2 priorities (confirm or swap)
  r.get('/m/priorities', (ctx) => {
    const { e, pos } = mine(ctx);
    const page = (body) => ctx.html(phone(ctx, { title: 'Week 2 priorities', back: '/m', tab: 'videos', body }));
    if (!e || !pos || pos.day < Pr.REVIEW_DAY) return page(html`<div class="empty">${icon('target')}<p>On <b>Day 7</b> you’ll rate each challenge from your first week. Anything rated 3 or higher can become one of your Week 2 priorities.</p></div>`);
    const pri = R.build(db, e).pri;
    const rk = pri.ranking;
    if (pri.isConfirmed) {
      return page(html`<section class="card report-head"><p class="eyebrow">Confirmed</p><h2>Your Week 2 priorities</h2>
<p>${pri.confirmed.length ? 'You’ll work on these for all of Days 8–14, with videos, prompts and tools for the challenges you rated 3 or higher.' : 'Nothing on your review was rated 3 or higher, so there’s no corrective plan for Week 2.'}</p></section>
${pri.confirmed.length ? priorityCards(pri) : ''}
${pos.day <= Pr.REVIEW_DAY ? html`<form method="post" action="/m/priorities/reopen" class="center gap">${csrfField(ctx)}<button class="btn ghost">Change my priorities</button><p class="hint">You can change them until Day 8 starts.</p></form>`
    : html`<p class="hint center gap">Your priorities stay the same for all of Days 8–14.</p><p><a class="btn primary wide" href="/m/videos">Open your plan</a></p>`}`);
    }
    if (!rk.complete) {
      return page(html`<section class="card"><h2>Finish your review first</h2><p>Rate every question on the End of Week Review. You’ve rated ${rk.answered} of ${rk.total}.</p>
<div class="tasks"><a class="task" href="/m/day/7/week1"><span class="task-icon">${icon('trophy')}</span><span class="task-body"><b>Review Part 1</b></span></a><a class="task" href="/m/day/7/week2"><span class="task-icon">${icon('trophy')}</span><span class="task-body"><b>Review Part 2</b></span></a></div></section>`);
    }
    const n = pri.required;
    const eligible = rk.categories.filter((c) => c.eligible);
    const rec = eligible.filter((c) => pri.recommended.includes(c.key));
    const alt = eligible.filter((c) => !pri.recommended.includes(c.key));
    const none = rk.categories.filter((c) => !c.eligible);
    const err = ctx.query.err ? String(ctx.query.err).slice(0, 120) : '';
    page(html`<section class="card report-head"><p class="eyebrow">Day 7</p><h2>Choose your Week 2 priorities</h2>
<p>${n ? html`Based on your review, we recommend <b>${n === 1 ? 'one area' : `${n} areas`}</b>. Keep ${n === 1 ? 'it' : 'them'}, or swap ${n === 1 ? 'it' : 'one'} for another area you rated 3 or higher. You’ll work on the same priorities for all of Days 8–14.` : 'Nothing on your review was rated 3 or higher. That’s great news: there’s nothing to correct, so Week 2 has no priorities.'}</p></section>
${err ? html`<p class="flash err">${err}</p>` : ''}
<form method="post" action="/m/priorities" data-pick="${n}">${csrfField(ctx)}
${n ? html`<h2 class="list-title">Recommended</h2><div class="picks">${rec.map((c) => pickCard(c, true))}</div>
${alt.length ? html`<h2 class="list-title">Other areas you can swap in</h2><p class="hint">Uncheck a recommended area, then check one of these.</p><div class="picks">${alt.map((c) => pickCard(c, false))}</div>` : ''}` : ''}
${none.length ? html`<h2 class="list-title">No support needed</h2><p class="hint">Nothing in these areas was rated 3 or higher.</p><div class="nopick">${none.map((c) => html`<span>${icon(c.icon)} ${c.short}${c.highest ? html` <small>highest ${c.highest}</small>` : ''}</span>`)}</div>` : ''}
<div class="savebar"><button class="btn primary wide" data-pick-submit>${n ? html`Confirm my priorities <span data-pick-count></span>` : 'Continue'}</button></div></form>`);
  }, O);

  r.post('/m/priorities', (ctx) => {
    const { e, pos } = mine(ctx);
    if (!e || !pos || pos.day < Pr.REVIEW_DAY) throw new HttpError(403, 'Priorities are chosen after the Day 7 review.');
    const pri = R.build(db, e).pri;
    if (pri.isConfirmed) throw new HttpError(403, 'Your priorities are already confirmed.');
    if (!pri.ranking.complete) return ctx.redirect('/m/priorities');
    const v = Pr.validate(pri.ranking, ctx.body.areas);
    if (v.error) return ctx.redirect(`/m/priorities?err=${encodeURIComponent(v.error)}`);
    Pr.confirm(db, e.id, pri.ranking, v.keys, ctx.user);
    ctx.setFlash(v.keys.length ? 'Priorities confirmed.' : 'Got it.');
    ctx.redirect('/m/priorities');
  }, O);

  r.post('/m/priorities/reopen', (ctx) => {
    const { e, pos } = mine(ctx);
    if (!e || !pos || pos.day > Pr.REVIEW_DAY) throw new HttpError(403, 'Your priorities are set for Days 8–14 and can’t be changed now.');
    Pr.reopen(db, e.id);
    ctx.redirect('/m/priorities');
  }, O);

  // ---------------------------------------------------------------- Week 2 plan (videos, prompts, tools)
  r.get('/m/videos', (ctx) => {
    const { e, pos } = mine(ctx);
    const page = (body) => ctx.html(phone(ctx, { title: 'My plan', tab: 'videos', body }));
    if (!e || !pos || pos.day < 8) {
      return page(html`<div class="empty">${icon('target')}<p>Your Week 2 plan starts on <b>Day 8</b>${e ? html`, ${dateFmt(P.addDays(e.start_date, 7), 'dow')}` : ''}. After your Day 7 review you’ll confirm up to three priorities, and your videos, prompts and tools come from those.</p>${pos && pos.day === 7 ? html`<p><a class="btn primary" href="/m/priorities">Your priorities</a></p>` : ''}</div>`);
    }
    const pri = R.build(db, e).pri;
    if (!pri.isConfirmed) return page(html`<div class="empty">${icon('target')}<p>Confirm your Week 2 priorities to see your plan.</p><p><a class="btn primary" href="/m/priorities">Choose your priorities</a></p></div>`);
    if (!pri.confirmed.length) return page(html`<div class="empty">${icon('trophy')}<p>Nothing on your review was rated 3 or higher, so there’s no corrective plan for Week 2. Keep doing what works and keep logging your days.</p></div>`);
    const day = Math.min(pos.day, F.PROGRAM_DAYS);
    const c = contentFor(db, e, day, pri);
    page(html`<p class="tip">Your priorities for Days 8–14. Each one shows the challenges you rated 3 or higher and what to work on.</p>
${pri.confirmed.map((k, i) => {
    const cat = pri.byKey[k];
    const items = c.byArea[k] || [];
    return html`<section class="plan"><div class="sec-head plan-head"><span class="sec-icon">${icon(cat.icon)}</span><h2><span>${i + 1}.</span> ${cat.label}</h2></div>
<div class="flagged">${cat.challenges.map((x) => html`<span><span class="dot d${x.rating}">${x.rating}</span>${x.label}</span>`)}</div>
${items.length ? html`<div class="videos">${items.map((v) => itemCard(ctx, v))}</div>` : html`<p class="hint">Your coach is adding content for this area.</p>`}</section>`;
  })}
${c.next ? html`<p class="hint">More unlocks on Day ${c.next}.</p>` : ''}`);
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
    ctx.html(phone(ctx, { title: 'My settings', tab: 'me', body: html`
<section class="card me"><h2>${u.name}</h2>
${coach ? html`<p>Your coach: <b>${coach.name}</b> · <a href="mailto:${coach.email}">${coach.email}</a></p>` : ''}
${e ? html`<p class="muted">Program: ${dateFmt(e.start_date)} – ${dateFmt(pos.endDate)}</p>` : ''}</section>
${require('./settings').settingsBody(ctx, u)}
${INSTALL}
<form method="post" action="/logout" class="center">${csrfField(ctx)}<button class="btn ghost wide">${icon('logout')} Sign out</button></form>`,
    }));
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
