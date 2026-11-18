'use strict';
// The participant phone app (/m): today's forms, past days, photos, progress, analyses, priorities, plan, profile.
// Everything follows the person's program (D): its length, forms, phases, analyses and results.
const { html, raw, dateFmt, firstName } = require('../lib/html');
const { phone, icon, csrfField, formBody, dayStrip, answersView } = require('../lib/views');
const { HttpError } = require('../lib/http');
const P = require('../lib/program');
const R = require('../lib/report');
const Pr = require('../lib/priorities');
const auth = require('../lib/auth');
const { str, ZONES } = require('../lib/site');

const O = { participant: true };

/** The signed-in participant's program, position and status of each day. */
function mine(ctx) {
  const e = P.currentEnrollment(ctx.db, ctx.user.id);
  const pos = P.positionOf(ctx.db, e, ctx.user.timezone);
  const map = e ? P.responseMap(ctx.db, e.id) : {};
  return { e, pos, map, D: pos ? pos.D : null };
}

function dayParam(ctx, pos) {
  const d = Number(ctx.params.day);
  if (!Number.isInteger(d) || d < 1 || d > pos.D.PROGRAM_DAYS) throw new HttpError(404, 'That day isn’t part of the program.');
  if (!pos || d > pos.open) throw new HttpError(403, `Day ${d} hasn’t started yet.`);
  return d;
}

function progressBar(answered, total) {
  const pct = total ? Math.round((answered / total) * 100) : 0;
  return html`<span class="pbar-track"><span style="width:${pct}%"></span></span><small>${answered >= total && total ? html`${icon('check')} Done` : `${answered} of ${total}`}</small>`;
}

function formCard(D, day, key, got) {
  const f = D.FORMS[key];
  const r = got && got[key];
  const answered = r ? r.answered : 0; const total = r ? r.total : D.progress(f, {}).total;
  const done = r && total && answered >= total;
  return html`<a class="task ${done ? 'done' : answered ? 'partial' : ''} ${f.weekly ? 'weekly' : ''}" href="/m/day/${day}/${key}">
<span class="task-icon">${icon(f.icon || (f.weekly ? 'trophy' : (f.sections[0] || {}).icon || 'notes'))}</span>
<span class="task-body"><b>${f.title}</b><small>${f.blurb}</small><span class="task-prog">${progressBar(answered, total)}</span></span></a>`;
}

function photoCard(ctx, D, e, day) {
  if (!D.photos) return '';
  const n = ctx.db.get('SELECT COUNT(*) n FROM photos WHERE enrollment_id=? AND day=?', e.id, day).n;
  return html`<a class="task photo" href="/m/day/${day}/photos"><span class="task-icon">${icon('camera')}</span>
<span class="task-body"><b>${D.photos.label || 'Photos'}</b><small>${D.photos.tip || ''}</small><span class="task-prog"><small>${n ? `${n} photo${n === 1 ? '' : 's'} today` : 'No photos yet'}</small></span></span></a>`;
}

const KIND = { video: ['Video', 'play'], prompt: ['Prompt', 'notes'], tool: ['Tool', 'gear'] };

/**
 * Plan content for the confirmed priorities: items for the whole area, plus items for the specific
 * challenges rated at or above the threshold. Nothing for lower-rated challenges, and nothing twice.
 */
function contentFor(db, D, e, day, pri) {
  // Without priorities, everyone gets every item in the program; with them, only their confirmed categories
  const keys = pri.enabled ? pri.confirmed || [] : D.AREAS.map((x) => x.key);
  if (!keys.length) return { byArea: {}, all: [], next: null };
  const rows = db.all(`SELECT v.*, vv.watched_at FROM videos v LEFT JOIN video_views vv ON vv.video_id=v.id AND vv.enrollment_id=?
    WHERE v.active=1 AND v.program_id=? AND v.area IN (${keys.map(() => '?').join(',')}) ORDER BY (v.day IS NULL) DESC, v.day, v.sort, v.id`, e.id, D.programId, ...keys);
  const seen = new Set(); const byArea = {}; const all = []; let next = null;
  for (const v of rows) {
    if (pri.enabled && v.challenge && !(pri.flagged[v.area] || []).includes(v.challenge)) continue;
    if (v.day && v.day > day) { next = next ? Math.min(next, v.day) : v.day; continue; }
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    (byArea[v.area] = byArea[v.area] || []).push(v);
    all.push(v);
  }
  return { byArea, all, next };
}

function itemCard(ctx, D, v) {
  const [kindLabel, kindIcon] = KIND[v.kind] || KIND.video;
  const ch = v.challenge && D.reviewQs.find((q) => q.key === v.challenge);
  return html`<article class="video ${v.watched_at ? 'watched' : ''}" id="v${v.id}">
<div class="video-meta"><span class="tag">${icon(kindIcon)} ${kindLabel}</span>${ch ? html`<span class="tag">For: ${ch.label}</span>` : ''}${v.day ? html`<span class="tag">Day ${v.day}</span>` : ''}</div>
<h3>${v.title}</h3>${v.description ? html`<p class="prewrap">${v.description}</p>` : ''}
${v.url ? (v.kind === 'video' ? embed(v.url) : html`<p><a class="btn wide" href="${v.url}" target="_blank" rel="noopener">Open the ${kindLabel.toLowerCase()}</a></p>`) : ''}
<form method="post" action="/m/videos/${v.id}/watched">${csrfField(ctx)}${v.watched_at ? html`<input type="hidden" name="undo" value="1"><button class="btn small ghost">${icon('check')} Done</button>` : html`<button class="btn small">${v.kind === 'video' ? 'Mark as watched' : 'Mark as done'}</button>`}</form></article>`;
}

/** One selectable area on the confirm screen. */
function pickCard(c, checked, t = 3) {
  return html`<label class="pick"><input type="checkbox" name="areas[]" value="${c.key}"${checked ? raw(' checked') : ''}>
<span class="pick-body"><span class="pick-head">${icon(c.icon)}<b>${c.label}</b><span class="dot d${c.highest}">${c.highest}</span></span>
<small>${c.count} challenge${c.count === 1 ? '' : 's'} rated ${t}–5: ${c.challenges.map((x) => `${x.label} (${x.rating})`).join(', ')}</small></span></label>`;
}

function priorityCards(pri) {
  return html`<div class="tasks">${pri.confirmed.map((k, i) => {
    const c = pri.byKey[k];
    return html`<div class="task done"><span class="task-icon">${icon(c.icon)}</span><span class="task-body"><b>Priority ${i + 1} · ${c.label}</b><small>${c.challenges.map((x) => `${x.label} (${x.rating})`).join(', ')}</small></span></div>`;
  })}</div>`;
}

/** The current phase's reminders (e.g. Week 1: take photos, don't change anything…). */
const remember = (phase) => (phase.remember && phase.remember.length ? html`<section class="remember"><h3>Remember</h3><ul>${phase.remember.map((t) => html`<li>${icon('check')}<span>${t}</span></li>`)}</ul></section>` : '');

/** "Days 8–14" */
const span = (a, b) => (a === b ? `Day ${a}` : `Days ${a}–${b}`);

const INSTALL = html`<section class="card install" data-install><h3>${icon('phone')} Put Life Audit 360 on your home screen</h3>
<p><b>iPhone:</b> tap the Share button <span class="kbd">⬆</span> in Safari, then <b>Add to Home Screen</b>.</p>
<p><b>Android:</b> tap the <span class="kbd">⋮</span> menu in Chrome, then <b>Add to Home screen</b> or <b>Install app</b>.</p>
<button type="button" class="link" data-install-hide>Hide this</button></section>`;

module.exports = (r, { db }) => {
  const Rules = require('../lib/rules');

  /** The review that priorities come from can't change once the priorities are confirmed. */
  const reviewLocked = (D, e, day, key) => !!D.priAnalysis && day === D.priAnalysis.day && D.FORMS[key].weekly && !!Pr.load(db, e.id);

  /** Priorities without the confirm step are confirmed automatically once the review is complete. */
  function priorities(e, pos, report) {
    const pri = report.pri;
    if (pri.enabled && !pri.confirmStep && !pri.isConfirmed && pri.ranking.complete && pos.day >= pri.reviewDay) {
      Pr.confirm(db, e.id, pri.ranking, pri.ranking.recommended, null);
      return R.build(db, e).pri;
    }
    return pri;
  }

  // ---------------------------------------------------------------- Today
  r.get('/m', (ctx) => {
    const { e, pos, map, D } = mine(ctx);
    const name = firstName(ctx.user.name);
    if (!e) {
      return ctx.html(phone(ctx, { title: 'Today', tab: 'today', body: html`<section class="card"><h2>Hi ${name}</h2><p>Your coach hasn’t started your program yet. You’ll see Day 1 here as soon as they do.</p></section>${INSTALL}` }));
    }
    if (!pos.started) {
      return ctx.html(phone(ctx, { title: 'Today', tab: 'today', hero: true, body: html`
<section class="hero"><div class="hero-text"><p class="eyebrow">${D.name}</p><h1>Starts<br><span>${dateFmt(e.start_date, 'dow')}</span></h1><p>Hi ${name}. Your ${D.PROGRAM_DAYS} days begin soon.</p></div></section>
<section class="card"><h3>How it works</h3>${D.description ? html`<p>${D.description}</p>` : ''}<ol class="how">${D.phases.map((p) => html`<li><b>${span(p.from, p.to)}: ${p.name}.</b> ${p.tip}</li>`)}${D.analyses.map((a) => html`<li><b>Day ${a.day}: ${a.label}.</b> ${a.title || ''}</li>`)}</ol></section>
${INSTALL}`,
      }));
    }
    const day = Math.min(pos.day, D.PROGRAM_DAYS);
    const phase = D.phaseOf(day);
    const got = map[day] || {};
    const report = R.build(db, e);
    const pri = priorities(e, pos, report);
    const planOpen = pri.enabled && day >= pri.unlockDay;
    const content = planOpen ? contentFor(db, D, e, day, pri) : { all: [] };
    const todo = content.all.filter((v) => !v.watched_at);
    const priCard = pri.enabled && pri.confirmStep && !pri.isConfirmed && pri.ranking.complete && pos.day >= pri.reviewDay && !pos.finished
      ? html`<a class="task weekly pri-cta" href="/m/priorities"><span class="task-icon">${icon('target')}</span><span class="task-body"><b>Choose your priorities</b><small>${pri.ranking.eligibleKeys.length ? `We recommend ${pri.recommended.length}: ${pri.recommended.map((k) => (D.AREA[k] || {}).short).join(', ')}. Confirm or swap.` : 'See what your review found.'}</small></span></a>`
      : '';
    const behind = [];
    for (let d = 1; d < pos.open; d++) if (P.dayStatus(map, d, D) !== 'done') behind.push(d);
    const forms = D.formsForDay(day);
    const daily = forms.filter((k) => !D.FORMS[k].weekly); const reviews = forms.filter((k) => D.FORMS[k].weekly);
    const reviewFor = D.analysisOn(day)[0];
    const doneAnalyses = D.analyses.filter((a) => pos.day >= a.day);
    const last = D.analyses[D.analyses.length - 1];
    const msgs = Rules.messagesFor(db, e);

    ctx.html(phone(ctx, { title: 'Today', tab: 'today', hero: true, body: html`
<section class="hero"><div class="hero-text"><p class="eyebrow">${pos.finished ? 'Program complete' : dateFmt(pos.today, 'dow')}</p><h1>${pos.finished ? html`${D.PROGRAM_DAYS} <span>days done</span>` : html`Day ${day}<span>of ${D.PROGRAM_DAYS}</span>`}</h1><p>${phase.name}</p></div></section>
${ctx.query.welcome ? html`<section class="card welcome"><h2>You’re in, ${name}!</h2><p>Each day, open Life Audit 360 and fill in that day’s check-in. It only takes a few minutes.</p></section>${INSTALL}` : ''}
${msgs.map((m) => html`<section class="card message"><h3>${icon('notes')} ${m.title}</h3><p class="prewrap">${m.text}</p>${m.link ? html`<p><a class="btn small" href="${m.link}" target="_blank" rel="noopener">Open</a></p>` : ''}<form method="post" action="/m/messages/${m.id}/seen">${csrfField(ctx)}<button class="link">Got it</button></form></section>`)}
<div class="strip-wrap">${dayStrip(map, pos, { link: (d) => `/m/day/${d}` })}</div>

${pos.finished ? html`<section class="card done-card"><h2>${icon('trophy')} You did it</h2>${last ? html`<p>Your ${last.label} is ready.</p><a class="btn primary wide" href="/m/report/${last.key}">See your results</a>` : html`<p>Thanks for completing ${D.name}.</p>`}</section>` : html`
${phase.tip ? html`<p class="tip">${phase.tip}</p>` : ''}
${day > (pri.reviewDay || 0) ? priCard : ''}
${daily.length || D.photos ? html`<h2 class="list-title">Today</h2><div class="tasks">${daily.map((k) => formCard(D, day, k, got))}${photoCard(ctx, D, e, day)}</div>` : ''}
${reviews.length ? html`<h2 class="list-title">Review</h2>${reviewFor ? html`<p class="tip">Rate each area based on ${span(reviewFor.from, reviewFor.to).toLowerCase()}. This builds your ${reviewFor.label}.</p>` : ''}<div class="tasks">${reviews.map((k) => formCard(D, day, k, got))}</div>${day === pri.reviewDay ? html`<div class="tasks after">${priCard}</div>` : ''}` : ''}
${planOpen && pri.isConfirmed ? html`<h2 class="list-title">${pri.label}</h2>${pri.confirmed.length ? html`<a class="task" href="/m/videos"><span class="task-icon">${icon('target')}</span><span class="task-body"><b>${content.all.length ? (todo.length ? `${todo.length} to do` : 'All caught up') : 'Your plan'}</b><small>${pri.confirmed.map((k) => (D.AREA[k] || {}).short).join(' · ')}</small></span></a>` : html`<p class="tip">Nothing on your review was rated ${pri.ranking.threshold} or higher, so there’s no corrective plan. Keep doing what works.</p>`}` : ''}`}
${doneAnalyses.filter((a) => a.day < pos.day || pos.finished).slice(-1).map((a) => html`<a class="task report" href="/m/report/${a.key}"><span class="task-icon">${icon('chart')}</span><span class="task-body"><b>Your ${a.label}</b><small>${pri.isConfirmed && pri.confirmed.length && D.priAnalysis && D.priAnalysis.key === a.key ? `Priorities: ${pri.confirmed.map((k) => (D.AREA[k] || {}).short).join(', ')}` : `Biggest challenges: ${report.byKey[a.key].top.map((x) => x.short).join(', ') || '—'}`}</small></span></a>`)}
${behind.length && !pos.finished ? html`<h2 class="list-title">Catch up</h2><div class="behind">${behind.slice(-6).map((d) => html`<a href="/m/day/${d}">Day ${d}<small>${P.dayStatus(map, d, D) === 'partial' ? 'Unfinished' : 'Not started'}</small></a>`)}</div>` : ''}
${!pos.finished ? remember(phase) : ''}`,
    }));
  }, O);

  r.post('/m/messages/:id/seen', (ctx) => {
    const { e } = mine(ctx);
    if (e) db.run('UPDATE rule_hits SET seen_at=? WHERE id=? AND enrollment_id=?', new Date().toISOString(), Number(ctx.params.id), e.id);
    ctx.redirect('/m');
  }, O);

  // ---------------------------------------------------------------- One day
  r.get('/m/day/:day', (ctx) => {
    const { e, pos, map, D } = mine(ctx);
    if (!e) return ctx.redirect('/m');
    const day = dayParam(ctx, pos);
    const got = map[day] || {};
    const forms = D.formsForDay(day);
    ctx.html(phone(ctx, { title: `Day ${day}`, back: '/m', tab: 'today', body: html`
<p class="day-date">${dateFmt(pos.dateOf(day), 'long')} · ${D.phaseOf(day).name}</p>
<div class="tasks">${forms.map((k) => formCard(D, day, k, got))}${photoCard(ctx, D, e, day)}</div>`,
    }));
  }, O);

  r.get('/m/day/:day/:form', (ctx) => {
    const { e, pos, D } = mine(ctx);
    if (!e) return ctx.redirect('/m');
    const day = dayParam(ctx, pos);
    const key = ctx.params.form;
    if (key === 'photos') { if (!D.photos) throw new HttpError(404, 'This program has no photos.'); return require('./photos').page(ctx, e, day); }
    if (!D.formsForDay(day).includes(key)) throw new HttpError(404, 'That form isn’t part of this day.');
    const form = D.FORMS[key];
    const answers = P.loadAnswers(db, e.id, day, key);
    if (reviewLocked(D, e, day, key)) {
      return ctx.html(phone(ctx, { title: `Day ${day} · ${form.short}`, back: `/m/day/${day}`, tab: 'today', body: html`
<p class="tip">${icon('check')} Your priorities are confirmed, so this review is locked. ${pos.day < Pr.state(db, D, e, {}).unlockDay ? html`To change an answer, <a href="/m/priorities">reopen your priorities</a> first.` : ''}</p>
<section class="card">${answersView(form, answers)}</section>` }));
    }
    ctx.html(phone(ctx, { title: `Day ${day} · ${form.short}`, back: `/m/day/${day}`, tab: 'today', body: html`
<div class="form-top"><p class="eyebrow">${form.title}</p><p>${form.weekly ? 'Be honest. This helps identify where to focus.' : D.phaseOf(day).tip || ''} Answers save as you go.</p></div>
${formBody(ctx, form, answers, `/m/day/${day}/${key}`, { D })}`,
    }));
  }, O);

  r.post('/m/day/:day/:form', async (ctx) => {
    const { e, pos, D } = mine(ctx);
    if (!e) throw new HttpError(400, 'Your program hasn’t been set up yet.');
    const day = dayParam(ctx, pos);
    const key = ctx.params.form;
    if (!D.formsForDay(day).includes(key)) throw new HttpError(404, 'That form isn’t part of this day.');
    if (reviewLocked(D, e, day, key)) throw new HttpError(403, 'Your priorities are confirmed, so that review is locked.');
    const answers = D.parseAnswers(D.FORMS[key], ctx.body);
    const p = P.saveAnswers(db, e.id, day, key, answers);
    await Rules.afterSave(ctx, db, e, day);
    if (ctx.wantsJson) return ctx.json({ ok: true, ...p });
    const forms = D.formsForDay(day);
    const nextForm = forms[forms.indexOf(key) + 1];
    const done = p.answered >= p.total;
    ctx.setFlash(done ? `${D.FORMS[key].short} saved. Nice work!` : `Saved. ${p.total - p.answered} question${p.total - p.answered === 1 ? '' : 's'} left on ${D.FORMS[key].short}.`);
    ctx.redirect(done && nextForm ? `/m/day/${day}/${nextForm}` : `/m/day/${day}`);
  }, O);

  // ---------------------------------------------------------------- Progress and analyses
  r.get('/m/progress', (ctx) => {
    const { e, pos, map, D } = mine(ctx);
    if (!e || !pos.started) return ctx.html(phone(ctx, { title: 'Progress', tab: 'progress', body: html`<div class="empty">${icon('chart')}<p>Your progress shows here once Day 1 starts.</p></div>` }));
    const c = P.completion(map, pos);
    const report = R.build(db, e);
    const cur = R.currentAnalysis(report, pos.day);
    ctx.html(phone(ctx, { title: 'Progress', tab: 'progress', body: html`
<section class="card stats"><div><b>${c.done}</b><small>days complete</small></div><div><b>${P.streak(map, pos)}</b><small>day streak</small></div><div><b>${c.pct}%</b><small>so far</small></div></section>
<div class="strip-wrap">${dayStrip(map, pos, { link: (d) => `/m/day/${d}` })}</div>
${D.analyses.length ? html`<h2 class="list-title">Your analysis</h2><div class="tasks">
${D.analyses.map((a, i) => (pos.day >= a.day ? html`<a class="task report" href="/m/report/${a.key}"><span class="task-icon">${icon(i ? 'trophy' : 'chart')}</span><span class="task-body"><b>${a.label}</b><small>${a.title || span(a.from, a.to)}</small></span></a>`
    : html`<div class="task locked"><span class="task-icon">${icon(i ? 'trophy' : 'chart')}</span><span class="task-body"><b>${a.label}</b><small>Unlocks on Day ${a.day} · ${dateFmt(pos.dateOf(a.day), 'dow')}</small></span></div>`))}</div>` : ''}
${cur && cur.logged.length && D.results.scores !== false ? html`<h2 class="list-title">So far</h2><section class="card">${require('../lib/views').areaBars(cur.areas)}<p class="hint">How much of a challenge each area has been (1 = not a challenge, 5 = severe), from your answers so far.</p></section>` : ''}`,
    }));
  }, O);

  r.get('/m/report/:key', (ctx) => {
    const { e, pos, D } = mine(ctx);
    if (!e) return ctx.redirect('/m/progress');
    const a = D.analyses.find((x) => x.key === ctx.params.key) || D.analyses[Number(ctx.params.key) - 1];
    if (!a) return ctx.redirect('/m/progress');
    if (!pos || pos.day < a.day) throw new HttpError(403, `Your ${a.label} unlocks on Day ${a.day}.`);
    ctx.html(phone(ctx, { title: a.label, back: '/m/progress', tab: 'progress', body: R.analysisReport(R.build(db, e), a.key) }));
  }, O);

  // ---------------------------------------------------------------- Priorities (confirm or swap)
  r.get('/m/priorities', (ctx) => {
    const { e, pos, D } = mine(ctx);
    const page = (body) => ctx.html(phone(ctx, { title: 'Priorities', back: '/m', tab: 'videos', body }));
    if (!e || !D.priorities.enabled) return page(html`<div class="empty">${icon('target')}<p>This program doesn’t have priorities.</p></div>`);
    const report = R.build(db, e);
    const pri = priorities(e, pos, report);
    const t = pri.ranking.threshold;
    if (pos.day < pri.reviewDay) return page(html`<div class="empty">${icon('target')}<p>On <b>Day ${pri.reviewDay}</b> you’ll rate each challenge. Anything rated ${t} or higher can become one of your priorities.</p></div>`);
    const rk = pri.ranking;
    const wk = span(pri.unlockDay, D.PROGRAM_DAYS);
    if (pri.isConfirmed) {
      return page(html`<section class="card report-head"><p class="eyebrow">Confirmed</p><h2>Your priorities</h2>
<p>${pri.confirmed.length ? `You’ll work on these for ${wk.toLowerCase()}, with videos, prompts and tools for the challenges you rated ${t} or higher.` : `Nothing on your review was rated ${t} or higher, so there’s no corrective plan.`}</p></section>
${pri.confirmed.length ? priorityCards(pri) : ''}
${pos.day < pri.unlockDay && pri.confirmStep ? html`<form method="post" action="/m/priorities/reopen" class="center gap">${csrfField(ctx)}<button class="btn ghost">Change my priorities</button><p class="hint">You can change them until Day ${pri.unlockDay} starts.</p></form>`
    : html`<p class="hint center gap">Your priorities stay the same for ${wk.toLowerCase()}.</p><p><a class="btn primary wide" href="/m/videos">Open your plan</a></p>`}`);
    }
    if (!rk.complete) {
      const rf = D.formList.filter((f) => f.weekly && f.scheduled.includes(pri.reviewDay));
      return page(html`<section class="card"><h2>Finish your review first</h2><p>Rate every question on the review. You’ve rated ${rk.answered} of ${rk.total}.</p>
<div class="tasks">${rf.map((f) => html`<a class="task" href="/m/day/${pri.reviewDay}/${f.key}"><span class="task-icon">${icon('trophy')}</span><span class="task-body"><b>${f.short || f.title}</b></span></a>`)}</div></section>`);
    }
    const n = pri.required;
    const eligible = rk.categories.filter((c) => c.eligible);
    const rec = eligible.filter((c) => pri.recommended.includes(c.key));
    const alt = eligible.filter((c) => !pri.recommended.includes(c.key));
    const none = rk.categories.filter((c) => !c.eligible);
    const err = ctx.query.err ? String(ctx.query.err).slice(0, 120) : '';
    page(html`<section class="card report-head"><p class="eyebrow">Day ${pri.reviewDay}</p><h2>Choose your priorities</h2>
<p>${n ? html`Based on your review, we recommend <b>${n === 1 ? 'one area' : `${n} areas`}</b>. Keep ${n === 1 ? 'it' : 'them'}, or swap ${n === 1 ? 'it' : 'one'} for another area you rated ${t} or higher. You’ll work on the same priorities for ${wk.toLowerCase()}.` : `Nothing on your review was rated ${t} or higher. That’s great news: there’s nothing to correct, so there are no priorities.`}</p></section>
${err ? html`<p class="flash err">${err}</p>` : ''}
<form method="post" action="/m/priorities" data-pick="${n}">${csrfField(ctx)}
${n ? html`<h2 class="list-title">Recommended</h2><div class="picks">${rec.map((c) => pickCard(c, true, t))}</div>
${alt.length ? html`<h2 class="list-title">Other areas you can swap in</h2><p class="hint">Uncheck a recommended area, then check one of these.</p><div class="picks">${alt.map((c) => pickCard(c, false, t))}</div>` : ''}` : ''}
${none.length ? html`<h2 class="list-title">No support needed</h2><p class="hint">Nothing in these areas was rated ${t} or higher.</p><div class="nopick">${none.map((c) => html`<span>${icon(c.icon)} ${c.short}${c.highest ? html` <small>highest ${c.highest}</small>` : ''}</span>`)}</div>` : ''}
<div class="savebar"><button class="btn primary wide" data-pick-submit>${n ? html`Confirm my priorities <span data-pick-count></span>` : 'Continue'}</button></div></form>`);
  }, O);

  r.post('/m/priorities', (ctx) => {
    const { e, pos, D } = mine(ctx);
    if (!e || !D.priorities.enabled) throw new HttpError(404, 'This program doesn’t have priorities.');
    const pri = R.build(db, e).pri;
    if (pos.day < pri.reviewDay) throw new HttpError(403, `Priorities are chosen after the Day ${pri.reviewDay} review.`);
    if (pri.isConfirmed) throw new HttpError(403, 'Your priorities are already confirmed.');
    if (!pri.ranking.complete) return ctx.redirect('/m/priorities');
    const v = Pr.validate(pri.ranking, ctx.body.areas);
    if (v.error) return ctx.redirect(`/m/priorities?err=${encodeURIComponent(v.error)}`);
    Pr.confirm(db, e.id, pri.ranking, v.keys, ctx.user);
    ctx.setFlash(v.keys.length ? 'Priorities confirmed.' : 'Got it.');
    ctx.redirect('/m/priorities');
  }, O);

  r.post('/m/priorities/reopen', (ctx) => {
    const { e, pos, D } = mine(ctx);
    const pri = e && D.priorities.enabled ? Pr.state(db, D, e, {}) : null;
    if (!pri || pos.day >= pri.unlockDay) throw new HttpError(403, 'Your priorities are set and can’t be changed now.');
    Pr.reopen(db, e.id);
    ctx.redirect('/m/priorities');
  }, O);

  // ---------------------------------------------------------------- Plan (videos, prompts, tools)
  r.get('/m/videos', (ctx) => {
    const { e, pos, D } = mine(ctx);
    const page = (body) => ctx.html(phone(ctx, { title: 'My plan', tab: 'videos', body }));
    if (!e || !D.priorities.enabled) return page(html`<div class="empty">${icon('target')}<p>Your program doesn’t have a plan section. Keep up your daily check-ins.</p></div>`);
    const report = R.build(db, e);
    const pri = priorities(e, pos, report);
    if (pos.day < pri.unlockDay) {
      return page(html`<div class="empty">${icon('target')}<p>Your plan starts on <b>Day ${pri.unlockDay}</b>, ${dateFmt(pos.dateOf(pri.unlockDay), 'dow')}. After your Day ${pri.reviewDay} review you’ll have up to ${pri.ranking.max} priorities, and your videos, prompts and tools come from those.</p>${pos.day >= pri.reviewDay && pri.confirmStep ? html`<p><a class="btn primary" href="/m/priorities">Your priorities</a></p>` : ''}</div>`);
    }
    if (!pri.isConfirmed) return page(html`<div class="empty">${icon('target')}<p>${pri.confirmStep ? 'Confirm your priorities to see your plan.' : 'Finish your review to see your plan.'}</p>${pri.confirmStep ? html`<p><a class="btn primary" href="/m/priorities">Choose your priorities</a></p>` : ''}</div>`);
    if (!pri.confirmed.length) return page(html`<div class="empty">${icon('trophy')}<p>Nothing on your review was rated ${pri.ranking.threshold} or higher, so there’s no corrective plan. Keep doing what works and keep logging your days.</p></div>`);
    const day = Math.min(pos.day, D.PROGRAM_DAYS);
    const c = contentFor(db, D, e, day, pri);
    page(html`<p class="tip">Your priorities for ${span(pri.unlockDay, D.PROGRAM_DAYS).toLowerCase()}. Each one shows the challenges you rated ${pri.ranking.threshold} or higher and what to work on.</p>
${pri.confirmed.map((k, i) => {
    const cat = pri.byKey[k];
    const items = c.byArea[k] || [];
    return html`<section class="plan"><div class="sec-head plan-head"><span class="sec-icon">${icon(cat.icon)}</span><h2><span>${i + 1}.</span> ${cat.label}</h2></div>
<div class="flagged">${cat.challenges.map((x) => html`<span><span class="dot d${x.rating}">${x.rating}</span>${x.label}</span>`)}</div>
${items.length ? html`<div class="videos">${items.map((v) => itemCard(ctx, D, v))}</div>` : html`<p class="hint">Your coach is adding content for this area.</p>`}</section>`;
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
${e ? html`<p class="muted">${pos.D.name}: ${dateFmt(e.start_date)} – ${dateFmt(pos.endDate)}</p>` : ''}</section>
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
