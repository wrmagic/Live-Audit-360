'use strict';
// Coach site: the participants list, inviting people, and each participant's answers, photos, reports and notes.
const { html, raw, dateFmt, dateTimeFmt, firstName } = require('../lib/html');
const { layout, icon, csrfField, answersView, dayStrip, areaBars } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const P = require('../lib/program');
const R = require('../lib/report');
const { participantFor, sendInvite, str, validEmail, ZONES } = require('../lib/site');

const O = { coach: true };

/** Everything the list and the detail page need about one participant. */
function summary(db, p) {
  const e = P.currentEnrollment(db, p.id);
  const pos = P.position(e, p.timezone);
  const map = e ? P.responseMap(db, e.id) : {};
  let lastEntry = null;
  for (const d of Object.values(map)) for (const f of Object.values(d)) if (!lastEntry || f.updated_at > lastEntry) lastEntry = f.updated_at;
  const report = e && pos && pos.started ? R.build(db, e) : null;
  const week = pos && pos.day >= 8 ? 2 : 1;
  const idle = pos && pos.started && !pos.finished && (!lastEntry || Date.now() - new Date(lastEntry) > 2 * 864e5);
  return { p, e, pos, map, lastEntry, report, week, idle, completion: P.completion(map, pos) };
}

/** For someone who hasn't chosen a password yet: when the last invite went out, and whether it has expired. */
function inviteNote(ctx, p, next) {
  if (p.password_hash) return '';
  const sent = p.invite_expires ? new Date(new Date(p.invite_expires) - require('../lib/auth').INVITE_DAYS * 864e5).toISOString() : null;
  const expired = !p.invite_expires || p.invite_expires < new Date().toISOString();
  return html`<span class="invite-note"><span class="warn-text">${expired ? 'Invite expired' : 'Invite not accepted yet'}${sent ? ` · sent ${dateTimeFmt(sent, ctx.user.timezone)}` : ''}</span>
<form method="post" action="/participants/${p.id}/invite">${csrfField(ctx)}<input type="hidden" name="next" value="${next}"><button class="btn small">Resend invite</button></form></span>`;
}

function stateLabel(s) {
  if (!s.e) return html`<span class="pill">No program</span>`;
  if (!s.pos.started) return html`<span class="pill">Starts ${dateFmt(s.e.start_date, 'dow')}</span>`;
  if (s.pos.finished) return html`<span class="pill done">Finished</span>`;
  return html`<span class="pill on">Day ${s.pos.day} of 14</span>`;
}

function todayMarks(s) {
  if (!s.pos || !s.pos.started || s.pos.finished) return '';
  const got = s.map[s.pos.day] || {};
  return html`<span class="marks">${F.formsForDay(s.pos.day).map((k) => {
    const r = got[k]; const st = r && r.total && r.answered >= r.total ? 'done' : r && r.answered ? 'partial' : 'todo';
    return html`<span class="mark ${st}" title="${F.FORMS[k].title}">${{ day1: 'Part 1', day2: 'Part 2', week1: 'Review 1', week2: 'Review 2' }[k] || F.FORMS[k].short}</span>`;
  })}</span>`;
}

function coachOptions(db, selected) {
  return db.all("SELECT id, name, role FROM users WHERE role IN ('head','coach') AND active=1 ORDER BY role='head' DESC, name").map((c) => html`<option value="${c.id}"${c.id === selected ? raw(' selected') : ''}>${c.name}${c.role === 'head' ? ' (head coach)' : ''}</option>`);
}

function tzSelect(name, value) {
  return html`<select name="${name}">${[...new Set([value, ...ZONES])].map((z) => html`<option${z === value ? raw(' selected') : ''}>${z}</option>`)}</select>`;
}

module.exports = (r, { db }) => {
  // ---------------------------------------------------------------- Participants list
  r.get('/participants', (ctx) => {
    const head = ctx.user.role === 'head';
    const coachFilter = head ? (ctx.query.coach === 'all' || ctx.query.coach === undefined ? null : Number(ctx.query.coach)) : ctx.user.id;
    const show = ['active', 'upcoming', 'finished', 'all'].includes(ctx.query.show) ? ctx.query.show : 'active';
    const q = str(ctx.query.q).toLowerCase();
    const rows = db.all(`SELECT u.*, c.name coach_name FROM users u LEFT JOIN users c ON c.id=u.coach_id
      WHERE u.role='participant' AND u.active=1 ${coachFilter ? 'AND u.coach_id=?' : ''} ORDER BY u.name`, ...(coachFilter ? [coachFilter] : []));
    const all = rows.map((p) => summary(db, p));
    const inShow = (s) => show === 'all' || (show === 'active' ? s.pos && s.pos.started && !s.pos.finished : show === 'upcoming' ? !s.pos || !s.pos.started : s.pos && s.pos.finished);
    const list = all.filter(inShow).filter((s) => !q || s.p.name.toLowerCase().includes(q) || s.p.email.toLowerCase().includes(q));
    const active = all.filter((s) => s.pos && s.pos.started && !s.pos.finished);
    const loggedToday = active.filter((s) => s.map[s.pos.day]).length;
    const idle = active.filter((s) => s.idle);
    const reviews = all.filter((s) => s.pos && (s.pos.day === 7 || s.pos.day === 8 || s.pos.day >= 14) && s.report && s.report[s.pos.day >= 14 ? 'w2' : 'w1'].hasReview);
    const counts = { active: active.length, upcoming: all.filter((s) => !s.pos || !s.pos.started).length, finished: all.filter((s) => s.pos && s.pos.finished).length, all: all.length };
    const qs = (o) => '?' + new URLSearchParams({ ...(head && ctx.query.coach ? { coach: ctx.query.coach } : {}), show, ...(q ? { q } : {}), ...o }).toString();

    ctx.html(layout(ctx, { title: 'Participants', nav: 'people', body: html`
<div class="page-head"><div><p class="eyebrow">${head ? 'All coaches' : 'Your clients'}</p><h1>Participants</h1></div><a class="btn primary" href="/participants/new">${icon('plus')} Invite a participant</a></div>
<section class="kpis">
<div class="kpi"><b>${active.length}</b><span>In a program now</span></div>
<div class="kpi"><b>${loggedToday}<small>/${active.length}</small></b><span>Logged something today</span></div>
<div class="kpi ${idle.length ? 'warn' : ''}"><b>${idle.length}</b><span>Quiet for 2+ days</span></div>
<div class="kpi"><b>${reviews.length}</b><span>Analysis ready to review</span></div>
</section>
<div class="toolbar"><nav class="seg">${[['active', 'In program'], ['upcoming', 'Starting soon'], ['finished', 'Finished'], ['all', 'All']].map(([k, l]) => html`<a href="${qs({ show: k })}" class="${show === k ? 'on' : ''}">${l} <small>${counts[k]}</small></a>`)}</nav>
<form class="filters">${head ? html`<select name="coach" data-autosubmit><option value="all">All coaches</option>${coachOptions(db, coachFilter)}</select>` : ''}<input type="hidden" name="show" value="${show}"><input type="search" name="q" value="${q}" placeholder="Search name or email"></form></div>
${list.length ? html`<table class="list"><thead><tr><th>Participant</th>${head ? html`<th>Coach</th>` : ''}<th>Program</th><th>Today</th><th>Days complete</th><th>Top challenges</th><th>Last entry</th></tr></thead><tbody>
${list.map((s) => {
    const w = s.report ? s.report[s.week === 2 ? 'w2' : 'w1'] : null;
    return html`<tr class="${s.idle ? 'idle' : ''}" data-href="/participants/${s.p.id}"><td><a href="/participants/${s.p.id}"><b>${s.p.name}</b></a><small>${s.p.email}</small>${inviteNote(ctx, s.p, ctx.url.pathname + ctx.url.search)}</td>
${head ? html`<td>${s.p.coach_name || '—'}</td>` : ''}
<td>${stateLabel(s)}</td><td>${todayMarks(s)}</td>
<td>${s.pos && s.pos.started ? html`<span class="meter"><span style="width:${s.completion.pct}%"></span></span> ${s.completion.done}/${s.completion.of}` : '—'}</td>
<td>${w && w.top.length ? html`<span class="chips-s">${w.top.map((a) => html`<span class="badge ${require('../lib/views').levelClass(a.score)}" title="${a.label}: ${a.score}">${a.short} ${a.score}</span>`)}</span>` : html`<span class="muted">—</span>`}</td>
<td>${s.lastEntry ? dateTimeFmt(s.lastEntry, ctx.user.timezone) : html`<span class="muted">Nothing yet</span>`}${s.idle ? html` <span class="pill warn">Nudge</span>` : ''}</td></tr>`;
  })}</tbody></table>` : html`<div class="empty">${icon('people')}<p>${all.length ? 'No one matches.' : 'No participants yet.'}</p>${all.length ? '' : html`<a class="btn primary" href="/participants/new">Invite your first participant</a>`}</div>`}`,
    }));
  }, O);

  // ---------------------------------------------------------------- Invite
  const inviteForm = (ctx, v = {}, error) => layout(ctx, { title: 'Invite a participant', nav: 'people', body: html`
<div class="page-head"><div><p class="eyebrow"><a href="/participants">Participants</a></p><h1>Invite a participant</h1></div></div>
${error ? html`<p class="flash err">${error}</p>` : ''}
<form method="post" action="/participants/new" class="panel form-grid">${csrfField(ctx)}
<label class="fld"><span>Full name</span><input name="name" value="${v.name || ''}" required maxlength="100" autofocus></label>
<label class="fld"><span>Email</span><input type="email" name="email" value="${v.email || ''}" required maxlength="200"></label>
<label class="fld"><span>Mobile phone <em>optional</em></span><input type="tel" name="phone" value="${v.phone || ''}" maxlength="40"></label>
<label class="fld"><span>Day 1 is</span><input type="date" name="start_date" value="${v.start_date || P.todayIn(ctx.user.timezone)}" required></label>
${ctx.user.role === 'head' ? html`<label class="fld"><span>Coach</span><select name="coach_id">${coachOptions(db, Number(v.coach_id) || ctx.user.id)}</select></label>` : ''}
<label class="fld"><span>Their time zone</span>${tzSelect('timezone', v.timezone || ctx.user.timezone)}</label>
<p class="hint span2">Day 1 can be today. They’ll get a link to choose a password. On Day 1 the app shows their first daily audit. Each day changes over at midnight in their time zone.</p>
<div class="span2"><button class="btn primary">Create and send invite</button> <a class="btn ghost" href="/participants">Cancel</a></div></form>`,
  });

  r.get('/participants/new', (ctx) => ctx.html(inviteForm(ctx)), O);
  r.post('/participants/new', async (ctx) => {
    const b = ctx.body;
    const v = { name: str(b.name, 100), email: str(b.email).toLowerCase(), phone: str(b.phone, 40), start_date: str(b.start_date, 10), coach_id: b.coach_id, timezone: str(b.timezone, 60) };
    if (!v.name) return ctx.html(inviteForm(ctx, v, 'Enter their name.'), 400);
    if (!validEmail(v.email)) return ctx.html(inviteForm(ctx, v, 'That email address doesn’t look right.'), 400);
    if (!P.isDate(v.start_date)) return ctx.html(inviteForm(ctx, v, 'Choose the date of Day 1.'), 400);
    try { new Intl.DateTimeFormat('en-US', { timeZone: v.timezone }); } catch { v.timezone = ctx.user.timezone; }
    let coachId = ctx.user.id;
    if (ctx.user.role === 'head' && b.coach_id) {
      const c = db.get("SELECT id FROM users WHERE id=? AND role IN ('head','coach') AND active=1", Number(b.coach_id));
      if (c) coachId = c.id;
    }
    const existing = db.get('SELECT * FROM users WHERE email=?', v.email);
    if (existing) return ctx.html(inviteForm(ctx, v, existing.role === 'participant' ? `${existing.name} is already set up with that email. To change their Day 1, open their page and use “Start today” or Settings.` : 'That email belongs to a coach.'), 400);
    const now = new Date().toISOString();
    const id = db.tx(() => {
      const uid = db.insert('users', { role: 'participant', name: v.name, email: v.email, phone: v.phone || null, coach_id: coachId, timezone: v.timezone, created_at: now });
      db.insert('enrollments', { user_id: uid, start_date: v.start_date, created_at: now });
      return uid;
    });
    const u = db.get('SELECT * FROM users WHERE id=?', id);
    const { link, emailed } = await sendInvite(ctx, u);
    ctx.html(layout(ctx, { title: 'Invite sent', nav: 'people', body: html`
<div class="page-head"><div><p class="eyebrow"><a href="/participants">Participants</a></p><h1>${v.name} is set up</h1></div></div>
<section class="panel invite-done"><p>${emailed ? html`We emailed an invite to <b>${v.email}</b>.` : html`Email isn’t set up on this site yet, so <b>send them this link yourself</b> (text or email).`} Day 1 is <b>${dateFmt(v.start_date, 'long')}</b>.</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>
<p class="hint">The link works once, for 14 days. You can send a new one from their page.</p>
<p><a class="btn primary" href="/participants/${id}">Open ${firstName(v.name)}’s page</a> <a class="btn ghost" href="/participants/new">Invite another</a></p></section>`,
    }));
  }, O);

  // ---------------------------------------------------------------- One participant
  r.get('/participants/:id', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const s = summary(db, p);
    const coach = p.coach_id ? db.get('SELECT name FROM users WHERE id=?', p.coach_id) : null;
    const tabs = [['overview', 'Overview'], ['day', 'Daily answers'], ['week1', 'Day 7 analysis'], ['week2', 'Day 14 analysis'], ['notes', 'Notes'], ['settings', 'Settings']];
    const tab = tabs.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'overview';
    const base = `/participants/${p.id}`;
    let body;
    if (!s.e) body = html`<div class="empty"><p>No program yet.</p></div>`;
    else if (tab === 'overview') body = overview(ctx, s);
    else if (tab === 'day') body = dayTab(ctx, s);
    else if (tab === 'week1' || tab === 'week2') body = s.report ? R.weekReport(s.report, tab === 'week1' ? 1 : 2, { who: firstName(p.name), coach: true }) : html`<div class="empty"><p>The program hasn’t started yet.</p></div>`;
    else if (tab === 'notes') body = notesTab(ctx, p);
    else body = settingsTab(ctx, s);
    if (tab === 'settings' && !s.e) body = settingsTab(ctx, s);

    ctx.html(layout(ctx, { title: p.name, nav: 'people', body: html`
<div class="page-head person"><div><p class="eyebrow"><a href="/participants">Participants</a></p><h1>${p.name}</h1>
<p class="muted">${p.email}${p.phone ? html` · <a href="tel:${p.phone}">${p.phone}</a>` : ''}${coach ? html` · Coach: ${coach.name}` : ''}</p>${inviteNote(ctx, p, `/participants/${p.id}`)}</div>
<div class="head-state">${stateLabel(s)}${s.e ? html`<small>${dateFmt(s.e.start_date)} – ${dateFmt(s.pos.endDate)}</small>` : ''}
${s.e && !s.pos.started ? html`<form method="post" action="/participants/${p.id}/start-today">${csrfField(ctx)}<button class="btn small primary">Start today</button></form>` : ''}</div></div>
${s.e ? html`<div class="person-strip">${dayStrip(s.map, s.pos, { link: (d) => `${base}?tab=day&day=${d}` })}<div class="person-stats"><span><b>${s.completion.done}</b>/${s.completion.of} days complete</span><span><b>${P.streak(s.map, s.pos)}</b> day streak</span><span>Last entry <b>${s.lastEntry ? dateTimeFmt(s.lastEntry, ctx.user.timezone) : 'none yet'}</b></span></div></div>` : ''}
<nav class="tabs">${tabs.map(([k, l]) => html`<a href="${base}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</nav>
<div class="tab-body">${body}</div>`,
    }));
  }, O);

  function overview(ctx, s) {
    if (!s.report) return html`<section class="panel"><h3>Program starts ${dateFmt(s.e.start_date, 'long')}</h3><p class="muted">Nothing to show until Day 1.</p></section>`;
    const w = s.week === 2 ? s.report.w2 : s.report.w1;
    const notes = db.all('SELECT n.*, u.name author FROM notes n JOIN users u ON u.id=n.author_id WHERE participant_id=? ORDER BY n.created_at DESC LIMIT 3', s.p.id);
    const focus = s.report.focus;
    return html`<div class="cols">
<section class="panel"><h3>Week ${s.week} so far ${w.hasReview ? html`<span class="pill done">Review done</span>` : ''}</h3>
<ul class="summary">${require('../lib/scoring').summary(w, firstName(s.p.name)).map((l) => html`<li>${l}</li>`)}</ul>
${areaBars(w.areas, { compareTo: s.week === 2 ? s.report.w1.areas : null })}</section>
<div>
<section class="panel"><h3>${icon('target')} Focus areas for Days 8–14</h3>
<form method="post" action="/participants/${s.p.id}/focus">${csrfField(ctx)}
<div class="chips">${F.AREAS.map((a) => html`<label class="chip"><input type="checkbox" name="areas[]" value="${a.key}"${focus.keys.includes(a.key) ? raw(' checked') : ''}><span>${a.label}</span></label>`)}</div>
<p class="hint">${focus.source === 'coach' ? 'You chose these.' : focus.source === 'scores' ? 'Picked automatically from the top scores.' : 'From the priorities they picked on the Day 7 review, filled in from the top scores.'} The videos they see on Days 8–14 come from these areas.</p>
<button class="btn small">Save focus areas</button>${focus.source === 'coach' ? html` <button class="btn small ghost" name="reset" value="1">Go back to automatic</button>` : ''}</form></section>
<section class="panel"><h3>${icon('notes')} Latest notes</h3>${notes.length ? notes.map((n) => html`<p class="note"><small>${dateTimeFmt(n.created_at, ctx.user.timezone)} · ${n.author}</small>${n.body}</p>`) : html`<p class="muted">No notes yet.</p>`}<a href="/participants/${s.p.id}?tab=notes">Add a note</a></section>
</div></div>`;
  }

  function dayTab(ctx, s) {
    if (!s.pos.started) return html`<p class="muted">The program hasn’t started yet.</p>`;
    let day = Number(ctx.query.day) || Math.min(s.pos.open, F.PROGRAM_DAYS);
    day = Math.max(1, Math.min(day, s.pos.open));
    const photos = db.all('SELECT * FROM photos WHERE enrollment_id=? AND day=? ORDER BY created_at', s.e.id, day);
    const forms = F.formsForDay(day);
    const base = `/participants/${s.p.id}?tab=day&day=`;
    return html`<div class="day-nav">${day > 1 ? html`<a class="btn small ghost" href="${base}${day - 1}">← Day ${day - 1}</a>` : html`<span></span>`}<h2>Day ${day} · ${dateFmt(s.pos.dateOf(day), 'long')}</h2>${day < s.pos.open ? html`<a class="btn small ghost" href="${base}${day + 1}">Day ${day + 1} →</a>` : html`<span></span>`}</div>
<section class="panel"><h3>${icon('camera')} Food &amp; drink photos <small>${photos.length}</small></h3>${photos.length ? html`<div class="gallery wide">${photos.map((ph) => html`<figure><a href="/photo/${ph.id}" target="_blank"><img src="/photo/${ph.id}" alt="Photo" loading="lazy"></a><figcaption>${dateTimeFmt(ph.created_at, s.p.timezone).split(', ').pop()}</figcaption></figure>`)}</div>` : html`<p class="muted">No photos for this day.</p>`}</section>
${forms.map((k) => {
    const r = (s.map[day] || {})[k];
    const ans = P.loadAnswers(db, s.e.id, day, k);
    return html`<section class="panel answers"><h3>${F.FORMS[k].title} ${r ? html`<small>${r.answered}/${r.total} answered · saved ${dateTimeFmt(r.updated_at, ctx.user.timezone)}</small>` : html`<small>Not started</small>`}</h3>${r ? answersView(F.FORMS[k], ans) : ''}</section>`;
  })}`;
  }

  function notesTab(ctx, p) {
    const notes = db.all('SELECT n.*, u.name author FROM notes n JOIN users u ON u.id=n.author_id WHERE participant_id=? ORDER BY n.created_at DESC', p.id);
    return html`<form method="post" action="/participants/${p.id}/notes" class="panel">${csrfField(ctx)}<label class="fld"><span>New note <em>only coaches see notes</em></span><textarea name="body" rows="3" required maxlength="4000"></textarea></label><button class="btn">Add note</button></form>
${notes.map((n) => html`<section class="panel note"><small>${dateTimeFmt(n.created_at, ctx.user.timezone)} · ${n.author}</small><p>${n.body}</p>${n.author_id === ctx.user.id || ctx.user.role === 'head' ? html`<form method="post" action="/participants/${p.id}/notes/${n.id}/delete">${csrfField(ctx)}<button class="link" data-confirm="Delete this note?">Delete</button></form>` : ''}</section>`)}`;
  }

  function settingsTab(ctx, s) {
    const p = s.p;
    return html`<div class="cols">
<form method="post" action="/participants/${p.id}/update" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">Details</h3>
<label class="fld"><span>Full name</span><input name="name" value="${p.name}" required maxlength="100"></label>
<label class="fld"><span>Email</span><input type="email" name="email" value="${p.email}" required></label>
<label class="fld"><span>Mobile phone</span><input type="tel" name="phone" value="${p.phone || ''}"></label>
<label class="fld"><span>Time zone</span>${tzSelect('timezone', p.timezone)}</label>
${ctx.user.role === 'head' ? html`<label class="fld"><span>Coach</span><select name="coach_id">${coachOptions(db, p.coach_id)}</select></label>` : ''}
${s.e ? html`<label class="fld"><span>Day 1 of this program</span><input type="date" name="start_date" value="${s.e.start_date}"></label>` : ''}
<div class="span2"><button class="btn primary">Save</button></div></form>
<div>
<section class="panel"><h3>Sign-in link</h3><p class="muted">Send a new link if they lost the invite or forgot their password. Any older link stops working.</p>
<form method="post" action="/participants/${p.id}/invite">${csrfField(ctx)}<button class="btn">Send a new sign-in link</button></form></section>
<section class="panel"><h3>Start another 14 days</h3><p class="muted">Starts a fresh program. The earlier one is kept on record.</p>
<form method="post" action="/participants/${p.id}/restart" class="inline">${csrfField(ctx)}<input type="date" name="start_date" value="${P.todayIn(p.timezone)}" required> <button class="btn" data-confirm="Start a new 14-day program for ${p.name}?">Start new program</button></form>
${pastPrograms(ctx, p)}</section>
<section class="panel danger"><h3>Remove</h3><p class="muted">They can’t sign in any more and disappear from your list. Their answers are kept.</p>
<form method="post" action="/participants/${p.id}/deactivate">${csrfField(ctx)}<button class="btn danger" data-confirm="Remove ${p.name}? They won’t be able to sign in.">Remove participant</button></form></section>
</div></div>`;
  }

  function pastPrograms(ctx, p) {
    const list = db.all('SELECT * FROM enrollments WHERE user_id=? ORDER BY start_date DESC', p.id);
    if (list.length < 2) return '';
    return html`<p class="hint">Programs: ${list.map((e, i) => html`${i ? ', ' : ''}${dateFmt(e.start_date)}${i === 0 ? ' (current)' : ''}`)}</p>`;
  }

  // ---------------------------------------------------------------- Actions
  r.post('/participants/:id/focus', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const e = P.currentEnrollment(db, p.id);
    if (!e) throw new HttpError(400, 'No program.');
    const areas = (Array.isArray(ctx.body.areas) ? ctx.body.areas : []).filter((k) => F.AREA[k]);
    db.run('UPDATE enrollments SET focus_areas=? WHERE id=?', ctx.body.reset || !areas.length ? null : JSON.stringify(areas), e.id);
    ctx.setFlash(ctx.body.reset || !areas.length ? 'Focus areas are automatic again.' : 'Focus areas saved.');
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  r.post('/participants/:id/notes', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const body = str(ctx.body.body, 4000);
    if (body) db.insert('notes', { participant_id: p.id, author_id: ctx.user.id, body, created_at: new Date().toISOString() });
    ctx.redirect(`/participants/${p.id}?tab=notes`);
  }, O);

  r.post('/participants/:id/notes/:nid/delete', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const n = db.get('SELECT * FROM notes WHERE id=? AND participant_id=?', Number(ctx.params.nid), p.id);
    if (n && (n.author_id === ctx.user.id || ctx.user.role === 'head')) db.run('DELETE FROM notes WHERE id=?', n.id);
    ctx.redirect(`/participants/${p.id}?tab=notes`);
  }, O);

  r.post('/participants/:id/update', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const b = ctx.body;
    const email = str(b.email).toLowerCase();
    if (!str(b.name, 100) || !validEmail(email)) { ctx.setFlash('Enter a name and a valid email.', 'err'); return ctx.redirect(`/participants/${p.id}?tab=settings`); }
    const clash = db.get('SELECT id FROM users WHERE email=? AND id<>?', email, p.id);
    if (clash) { ctx.setFlash('Another account already uses that email.', 'err'); return ctx.redirect(`/participants/${p.id}?tab=settings`); }
    let tz = str(b.timezone, 60); try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = p.timezone; }
    const upd = { name: str(b.name, 100), email, phone: str(b.phone, 40) || null, timezone: tz };
    if (ctx.user.role === 'head' && b.coach_id) {
      const c = db.get("SELECT id FROM users WHERE id=? AND role IN ('head','coach') AND active=1", Number(b.coach_id));
      if (c) upd.coach_id = c.id;
    }
    db.update('users', p.id, upd);
    const e = P.currentEnrollment(db, p.id);
    if (e && P.isDate(b.start_date) && b.start_date !== e.start_date) db.run('UPDATE enrollments SET start_date=? WHERE id=?', b.start_date, e.id);
    ctx.setFlash('Saved.');
    ctx.redirect(upd.coach_id && upd.coach_id !== p.coach_id && ctx.user.role !== 'head' ? '/participants' : `/participants/${p.id}?tab=settings`);
  }, O);

  r.post('/participants/:id/invite', async (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const { link, emailed } = await sendInvite(ctx, p, { reset: !!p.password_hash });
    const next = ctx.back(null);
    if (emailed && next) { ctx.setFlash(`${p.password_hash ? 'New sign-in link' : 'Invite'} sent again to ${p.email}.`); return ctx.redirect(next); }
    ctx.html(layout(ctx, { title: 'Sign-in link', nav: 'people', body: html`<div class="page-head"><div><p class="eyebrow"><a href="/participants/${p.id}">${p.name}</a></p><h1>New sign-in link</h1></div></div>
<section class="panel invite-done"><p>${emailed ? html`We emailed it to <b>${p.email}</b>. You can also send it yourself:` : html`Email isn’t set up on this site, so send them this link yourself:`}</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>
<p><a class="btn" href="/participants/${p.id}">Back to ${firstName(p.name)}</a></p></section>` }));
  }, O);

  // Program hasn't started yet: make today Day 1
  r.post('/participants/:id/start-today', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const e = P.currentEnrollment(db, p.id);
    const today = P.todayIn(p.timezone);
    if (!e) throw new HttpError(400, 'No program.');
    if (e.start_date > today) db.run('UPDATE enrollments SET start_date=? WHERE id=?', today, e.id);
    ctx.setFlash(`${firstName(p.name)}’s program starts today. Day 1 is open in their app.`);
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  r.post('/participants/:id/restart', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    if (!P.isDate(ctx.body.start_date)) throw new HttpError(400, 'Choose the date of Day 1.');
    db.insert('enrollments', { user_id: p.id, start_date: ctx.body.start_date, created_at: new Date().toISOString() });
    ctx.setFlash(`New program starts ${dateFmt(ctx.body.start_date, 'long')}.`);
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  r.post('/participants/:id/deactivate', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    db.run('UPDATE users SET active=0, invite_hash=NULL WHERE id=?', p.id);
    db.run('DELETE FROM sessions WHERE user_id=?', p.id);
    ctx.setFlash(`${p.name} was removed.`);
    ctx.redirect('/participants');
  }, O);
};
