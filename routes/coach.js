'use strict';
// Coach site: the participants list, inviting people, and each participant's answers, photos, reports and notes.
const { html, raw, dateFmt, dateTimeFmt, firstName } = require('../lib/html');
const { layout, icon, csrfField, answersView, dayStrip, areaBars } = require('../lib/views');
const { HttpError } = require('../lib/http');
const defs = require('../lib/defs');
const Rules = require('../lib/rules');
const P = require('../lib/program');
const R = require('../lib/report');
const Pr = require('../lib/priorities');
const ST = require('../lib/store');
const { participantFor, sendInvite, currentLink, baseUrl, str, validEmail, ZONES } = require('../lib/site');

const O = { coach: true };

/** Everything the list and the detail page need about one participant. */
function summary(db, p) {
  const e = P.currentEnrollment(db, p.id);
  const pos = P.positionOf(db, e, p.timezone);
  const D = pos ? pos.D : null;
  const map = e ? P.responseMap(db, e.id) : {};
  let lastEntry = null;
  for (const d of Object.values(map)) for (const f of Object.values(d)) if (!lastEntry || f.updated_at > lastEntry) lastEntry = f.updated_at;
  const report = e && pos && pos.started ? R.build(db, e) : null;
  const current = report ? R.currentAnalysis(report, pos.day) : null;
  const alerts = e ? Rules.alertsFor(db, e.id, { unseen: true }) : [];
  const idle = pos && pos.started && !pos.finished && (!lastEntry || Date.now() - new Date(lastEntry) > 2 * 864e5);
  return { p, e, pos, D, map, lastEntry, report, current, alerts, idle, completion: P.completion(map, pos) };
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
  return html`<span class="pill on">Day ${s.pos.day} of ${s.D.PROGRAM_DAYS}</span>`;
}

function todayMarks(s) {
  if (!s.pos || !s.pos.started || s.pos.finished) return '';
  const got = s.map[s.pos.day] || {};
  return html`<span class="marks">${s.D.formsForDay(s.pos.day).map((k) => {
    const r = got[k]; const st = r && r.total && r.answered >= r.total ? 'done' : r && r.answered ? 'partial' : 'todo';
    return html`<span class="mark ${st}" title="${s.D.FORMS[k].title}">${s.D.FORMS[k].short || s.D.FORMS[k].title}</span>`;
  })}</span>`;
}

function coachOptions(db, selected) {
  return db.all("SELECT id, name, role FROM users WHERE role IN ('head','coach') AND active=1 ORDER BY role='head' DESC, name").map((c) => html`<option value="${c.id}"${c.id === selected ? raw(' selected') : ''}>${c.name}${c.role === 'head' ? ' (head coach)' : ''}</option>`);
}

function tzSelect(name, value) {
  return html`<select name="${name}">${[...new Set([value, ...ZONES])].map((z) => html`<option${z === value ? raw(' selected') : ''}>${z}</option>`)}</select>`;
}

module.exports = (r, { db }) => {
  const programs = () => db.all("SELECT * FROM products WHERE kind='program' AND active=1 ORDER BY sort, id");
  /**
   * Program and price in one list: each program (definition) with "No charge" plus the Store prices linked to it.
   * Value: "programId:productId" (productId empty = free).
   */
  function planSelect(selected, compact = false) {
    const progs = defs.activePrograms(db);
    const prices = programs();
    const sel = selected || `${defs.builtinId(db)}:`;
    const opts = progs.map((pg) => html`<optgroup label="${pg.name}"><option value="${pg.id}:"${sel === `${pg.id}:` ? raw(' selected') : ''}>${pg.name} · No charge</option>${prices.filter((x) => x.program_id === pg.id).map((x) => html`<option value="${pg.id}:${x.id}"${sel === `${pg.id}:${x.id}` ? raw(' selected') : ''}>${pg.name} · ${x.name} · ${ST.priceLabel(x)}</option>`)}</optgroup>`);
    if (compact) return html`<select name="plan" title="Program and price">${opts}</select>`;
    return html`<label class="fld"><span>Program and price</span><select name="plan">${opts}</select>${prices.length ? '' : html`<span class="hint">Super admins add programs in Admin → Programs and prices in Admin → Store.</span>`}</label>`;
  }
  /** Which program version and which price (product, or null for free) the form picked. */
  function pickPlan(b) {
    let programId = null; let product = null;
    if (b.plan) {
      const [pid, prod] = String(b.plan).split(':');
      programId = Number(pid);
      if (prod) {
        product = db.get("SELECT * FROM products WHERE id=? AND kind='program' AND active=1", Number(prod));
        if (!product || product.program_id !== programId) throw new HttpError(400, 'That price isn’t available.');
      }
    } else if (b.product_id) {
      product = db.get("SELECT * FROM products WHERE id=? AND kind='program' AND active=1", Number(b.product_id));
      if (!product) throw new HttpError(400, 'That program isn’t available.');
      programId = product.program_id;
    }
    if (!programId) programId = defs.builtinId(db);
    const pg = db.get('SELECT * FROM programs WHERE id=? AND active=1', programId);
    const v = pg && defs.latestVersion(db, pg.id);
    if (!v) throw new HttpError(400, 'That program isn’t available.');
    return { program: pg, versionId: v.id, product };
  }
  function payBadge(s) {
    const pu = s.e && ST.forEnrollment(db, s.e.id);
    if (!pu) return '';
    const today = P.todayIn(s.p.timezone);
    if (['paid', 'active'].includes(pu.status)) return html` <span class="pill done" title="${pu.name}">Paid</span>`;
    if (['free', 'comped'].includes(pu.status)) return html` <span class="pill" title="${pu.name}">Free</span>`;
    if (pu.status === 'trial' && ST.hasAccess(pu, today)) return html` <span class="pill on" title="Free trial until ${pu.trial_ends}">Trial</span>`;
    if (ST.hasAccess(pu, today)) return '';
    return html` <span class="pill warn" title="${pu.name} · ${ST.priceLabel(pu, { trial: false })}">Payment due</span>`;
  }
  function purchasesPanel(ctx, s) {
    const list = db.all('SELECT * FROM purchases WHERE user_id=? ORDER BY id DESC', s.p.id);
    const addons = db.all("SELECT * FROM products WHERE kind='addon' AND active=1 ORDER BY sort, id");
    const today = P.todayIn(s.p.timezone);
    return html`<section class="panel"><h3>${icon('cal')} Program and purchases</h3>
${list.length ? html`<table class="list"><tbody>${list.map((pu) => html`<tr><td><b>${pu.name}</b><small>${pu.enrollment_id ? (s.e && pu.enrollment_id === s.e.id ? 'Current program' : 'Earlier program') : 'Add-on'} · ${pu.fee === 'free' ? 'Free' : ST.priceLabel(pu, { trial: false })}</small></td>
<td><span class="pill ${ST.hasAccess(pu, today) ? (pu.status === 'trial' ? 'on' : 'done') : 'warn'}">${ST.STATUS[pu.status] || pu.status}${pu.status === 'trial' && pu.trial_ends ? ` until ${dateFmt(pu.trial_ends.slice(0, 10))}` : ''}</span>${pu.note ? html`<small>${pu.note}</small>` : ''}</td>
<td class="actions">${!['paid', 'active', 'free', 'comped'].includes(pu.status) ? html`<form method="post" action="/participants/${s.p.id}/purchases/${pu.id}">${csrfField(ctx)}<button class="link" name="do" value="comp">Give free</button> <button class="link" name="do" value="paid" data-confirm="Mark ${pu.name} as paid outside the app (cash, Venmo…)?">Mark paid</button></form>` : ''}
${ST.hasAccess(pu, today) && pu.status !== 'active' ? html`<form method="post" action="/participants/${s.p.id}/purchases/${pu.id}">${csrfField(ctx)}<button class="link danger" name="do" value="end" data-confirm="End access to ${pu.name}?">End access</button></form>` : ''}</td></tr>`)}</tbody></table>`
    : html`<p class="muted">${s.e ? 'No charge for this program.' : 'Nothing yet.'}</p>`}
${addons.length ? html`<form method="post" action="/participants/${s.p.id}/give" class="inline gap-s">${csrfField(ctx)}<select name="product_id">${addons.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select><button class="btn small">Give free</button></form>` : ''}</section>`;
  }

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
    const real = all.filter((s) => !s.p.is_test);
    const active = real.filter((s) => s.pos && s.pos.started && !s.pos.finished);
    const loggedToday = active.filter((s) => s.map[s.pos.day]).length;
    const idle = active.filter((s) => s.idle);
    const reviews = real.filter((s) => {
      if (!s.report) return false;
      const done = s.report.list.filter((w) => w.day <= s.pos.day);
      const w = done[done.length - 1];
      return w && w.hasReview && (s.pos.finished || s.pos.day <= w.day + 1);
    });
    const alerting = real.filter((s) => s.alerts.length);
    const counts = { active: active.length, upcoming: all.filter((s) => !s.pos || !s.pos.started).length, finished: all.filter((s) => s.pos && s.pos.finished).length, all: all.length };
    const qs = (o) => '?' + new URLSearchParams({ ...(head && ctx.query.coach ? { coach: ctx.query.coach } : {}), show, ...(q ? { q } : {}), ...o }).toString();

    ctx.html(layout(ctx, { title: 'Participants', nav: 'people', body: html`
<div class="page-head"><div><p class="eyebrow">${head ? 'All coaches' : 'Your clients'}</p><h1>Participants</h1></div><div class="head-actions"><form method="post" action="/participants/test">${csrfField(ctx)}<button class="btn ghost" title="A pretend participant for trying the program yourself">${icon('phone')} Try it as a participant</button></form><a class="btn primary" href="/participants/new">${icon('plus')} Invite a participant</a></div></div>
<section class="kpis">
<div class="kpi"><b>${active.length}</b><span>In a program now</span></div>
<div class="kpi"><b>${loggedToday}<small>/${active.length}</small></b><span>Logged something today</span></div>
<div class="kpi ${idle.length ? 'warn' : ''}"><b>${idle.length}</b><span>Quiet for 2+ days</span></div>
<div class="kpi"><b>${reviews.length}</b><span>Analysis ready to review</span></div>
${alerting.length ? html`<div class="kpi warn"><b>${alerting.length}</b><span>With new alerts</span></div>` : ''}
</section>
<div class="toolbar"><nav class="seg">${[['active', 'In program'], ['upcoming', 'Starting soon'], ['finished', 'Finished'], ['all', 'All']].map(([k, l]) => html`<a href="${qs({ show: k })}" class="${show === k ? 'on' : ''}">${l} <small>${counts[k]}</small></a>`)}</nav>
<form class="filters">${head ? html`<select name="coach" data-autosubmit><option value="all">All coaches</option>${coachOptions(db, coachFilter)}</select>` : ''}<input type="hidden" name="show" value="${show}"><input type="search" name="q" value="${q}" placeholder="Search name or email"></form></div>
${list.length ? html`<table class="list"><thead><tr><th>Participant</th>${head ? html`<th>Coach</th>` : ''}<th>Program</th><th>Today</th><th>Days complete</th><th>Challenges / priorities</th><th>Last entry</th></tr></thead><tbody>
${list.map((s) => {
    const w = s.current;
    return html`<tr class="${s.idle ? 'idle' : ''}" data-href="/participants/${s.p.id}"><td><a href="/participants/${s.p.id}"><b>${s.p.name}</b></a>${s.p.is_test ? html` <span class="pill test">Test</span>` : html`<small>${s.p.email}</small>${inviteNote(ctx, s.p, ctx.url.pathname + ctx.url.search)}`}${s.alerts.length ? html` <a class="pill warn" href="/participants/${s.p.id}" title="${s.alerts.map((a) => a.title).join(' · ')}">${icon('alert')} ${s.alerts.length} alert${s.alerts.length === 1 ? '' : 's'}</a>` : ''}${s.D && s.D.programId !== defs.builtinId(db) ? html`<small>${s.D.name}</small>` : ''}</td>
${head ? html`<td>${s.p.coach_name || '—'}</td>` : ''}
<td>${stateLabel(s)}${payBadge(s)}</td><td>${todayMarks(s)}</td>
<td>${s.pos && s.pos.started ? html`<span class="meter"><span style="width:${s.completion.pct}%"></span></span> ${s.completion.done}/${s.completion.of}` : '—'}</td>
<td>${s.report && s.report.pri.isConfirmed ? html`<span class="chips-s">${s.report.pri.confirmed.length ? s.report.pri.confirmed.map((k, i) => html`<span class="pill on" title="Priority ${i + 1}">${i + 1}. ${(s.D.AREA[k] || { short: k }).short}</span>`) : html`<span class="muted">No priorities</span>`}</span>`
  : s.report && s.report.pri.enabled && s.report.pri.confirmStep && s.pos.day >= s.report.pri.reviewDay && s.report.pri.ranking.complete ? html`<span class="pill warn">Priorities not confirmed</span>`
  : w && w.top.length ? html`<span class="chips-s">${w.top.map((a) => html`<span class="badge ${require('../lib/views').levelClass(a.score)}" title="${a.label}: ${a.score}">${a.short} ${a.score}</span>`)}</span>` : html`<span class="muted">—</span>`}</td>
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
${planSelect(v.plan)}
${ctx.user.role === 'head' ? html`<label class="fld"><span>Coach</span><select name="coach_id">${coachOptions(db, Number(v.coach_id) || ctx.user.id)}</select></label>` : ''}
<label class="fld"><span>Their time zone</span>${tzSelect('timezone', v.timezone || ctx.user.timezone)}</label>
<p class="hint span2">Day 1 can be today. They’ll get a link to choose a password. On Day 1 the app shows their first daily audit. Each day changes over at midnight in their time zone.</p>
<div class="span2"><button class="btn primary">Create and send invite</button> <a class="btn ghost" href="/participants">Cancel</a></div></form>`,
  });

  r.get('/participants/new', (ctx) => ctx.html(inviteForm(ctx)), O);
  r.post('/participants/new', async (ctx) => {
    const b = ctx.body;
    const v = { name: str(b.name, 100), email: str(b.email).toLowerCase(), phone: str(b.phone, 40), start_date: str(b.start_date, 10), coach_id: b.coach_id, timezone: str(b.timezone, 60), plan: b.plan };
    const plan = pickPlan(b);
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
      const eid = db.insert('enrollments', { user_id: uid, start_date: v.start_date, program_version_id: plan.versionId, created_at: now });
      ST.assignProgram(db, { id: uid }, { id: eid, start_date: v.start_date }, plan.product, ctx.user);
      return uid;
    });
    const u = db.get('SELECT * FROM users WHERE id=?', id);
    const { link, emailed } = await sendInvite(ctx, u);
    ctx.html(layout(ctx, { title: 'Invite sent', nav: 'people', body: html`
<div class="page-head"><div><p class="eyebrow"><a href="/participants">Participants</a></p><h1>${v.name} is set up</h1></div></div>
<section class="panel invite-done"><p>${emailed ? html`We emailed an invite to <b>${v.email}</b>.` : html`Email isn’t set up on this site yet, so <b>send them this link yourself</b> (text or email).`} Day 1 is <b>${dateFmt(v.start_date, 'long')}</b>.</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>
<p class="hint">The link works once, for ${require('../lib/auth').INVITE_DAYS} days. You can send a new one from their page.</p>
<p><a class="btn primary" href="/participants/${id}">Open ${firstName(v.name)}’s page</a> <a class="btn ghost" href="/participants/new">Invite another</a></p></section>`,
    }));
  }, O);

  // ---------------------------------------------------------------- One participant
  r.get('/participants/:id', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const s = summary(db, p);
    const coach = p.coach_id ? db.get('SELECT name FROM users WHERE id=?', p.coach_id) : null;
    const tabs = [['overview', 'Overview'], ['day', 'Daily answers'], ...(s.D ? s.D.analyses.map((a) => [`an-${a.key}`, a.label]) : []), ['notes', 'Notes'], ['settings', 'Settings']];
    const tab = tabs.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'overview';
    const base = `/participants/${p.id}`;
    let body;
    if (!s.e) body = html`<div class="empty"><p>No program yet.</p></div>`;
    else if (tab === 'overview') body = html`${p.is_test ? require('./testing').panel(ctx, s) : ''}${overview(ctx, s)}`;
    else if (tab === 'day') body = dayTab(ctx, s);
    else if (tab.startsWith('an-')) body = s.report ? R.analysisReport(s.report, tab.slice(3), { who: firstName(p.name), coach: true }) : html`<div class="empty"><p>The program hasn’t started yet.</p></div>`;
    else if (tab === 'notes') body = notesTab(ctx, p);
    else body = settingsTab(ctx, s);
    if (tab === 'settings' && !s.e) body = settingsTab(ctx, s);

    ctx.html(layout(ctx, { title: p.name, nav: 'people', body: html`
<div class="page-head person"><div><p class="eyebrow"><a href="/participants">Participants</a></p><h1>${p.name}</h1>
<p class="muted">${s.D ? html`<b>${s.D.name}</b>${s.D.version > 1 ? ` (v${s.D.version})` : ''} · ` : ''}${p.is_test ? html`<span class="pill test">Test participant</span> ` : p.email}${p.phone ? html` · <a href="tel:${p.phone}">${p.phone}</a>` : ''}${coach ? html` · Coach: ${coach.name}` : ''}</p>${p.is_test ? '' : inviteNote(ctx, p, `/participants/${p.id}`)}</div>
<div class="head-state">${stateLabel(s)}${payBadge(s)}${s.e ? html`<small>${dateFmt(s.e.start_date)} – ${dateFmt(s.pos.endDate)}</small>` : ''}
${s.e && !s.pos.started ? html`<form method="post" action="/participants/${p.id}/start-today">${csrfField(ctx)}<button class="btn small primary">Start today</button></form>` : ''}</div></div>
${s.e ? html`<div class="person-strip">${dayStrip(s.map, s.pos, { link: (d) => `${base}?tab=day&day=${d}` })}<div class="person-stats"><span><b>${s.completion.done}</b>/${s.completion.of} days complete</span><span><b>${P.streak(s.map, s.pos)}</b> day streak</span><span>Last entry <b>${s.lastEntry ? dateTimeFmt(s.lastEntry, ctx.user.timezone) : 'none yet'}</b></span></div></div>` : ''}
<nav class="tabs">${tabs.map(([k, l]) => html`<a href="${base}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</nav>
<div class="tab-body">${body}</div>`,
    }));
  }, O);

  function overview(ctx, s) {
    if (!s.report) return html`<section class="panel"><h3>Program starts ${dateFmt(s.e.start_date, 'long')}</h3><p class="muted">Nothing to show until Day 1.</p></section>`;
    const w = s.current;
    const D = s.D;
    const an = D.analyses.find((a) => a.key === (w && w.key));
    const prev = an && an.compareTo ? s.report.byKey[an.compareTo] : null;
    const isPri = D.priAnalysis && w && D.priAnalysis.key === w.key;
    const ranking = w ? (isPri ? s.report.pri.ranking : s.report.ranks[w.key]) : null;
    const notes = db.all('SELECT n.*, u.name author FROM notes n JOIN users u ON u.id=n.author_id WHERE participant_id=? ORDER BY n.created_at DESC LIMIT 3', s.p.id);
    return html`${alertsPanel(ctx, s)}${D.priorities.enabled ? priorityPanel(ctx, s) : ''}<div class="cols">
${w ? html`<section class="panel"><h3>${w.label}: days ${w.from}–${Math.min(w.to, s.pos.day)} so far ${w.hasReview ? html`<span class="pill done">Review done</span>` : ''}</h3>
<ul class="summary">${require('../lib/scoring').summary(w, firstName(s.p.name), ranking && ranking.total ? ranking : null, ranking ? ranking.threshold : 3).map((l) => html`<li>${l}</li>`)}</ul>
${D.results.scores !== false ? html`${areaBars(w.areas, { compareTo: prev ? prev.areas : null })}<p class="hint">Bars blend the daily challenge ratings with the review.${D.priorities.enabled ? ' Priorities come only from the review ratings (table above).' : ''}</p>` : ''}
<p><a href="/participants/${s.p.id}?tab=an-${w.key}">Open the full ${w.label.toLowerCase()}</a></p></section>` : html`<section class="panel"><h3>Progress</h3><p class="muted">This program has no analyses. Answers are under Daily answers.</p></section>`}
<div>
<section class="panel"><h3>${icon('notes')} Latest notes</h3>${notes.length ? notes.map((n) => html`<p class="note"><small>${dateTimeFmt(n.created_at, ctx.user.timezone)} · ${n.author}</small>${n.body}</p>`) : html`<p class="muted">No notes yet.</p>`}<a href="/participants/${s.p.id}?tab=notes">Add a note</a></section>
</div></div>`;
  }

  function priorityPanel(ctx, s) {
    const pri = s.report.pri;
    const rk = pri.ranking;
    const n = pri.required;
    let head;
    if (!rk.answered) head = html`<span class="pill">Waiting for the Day ${pri.reviewDay} review</span>`;
    else if (!rk.complete && !pri.isConfirmed) head = html`<span class="pill">Review ${rk.answered}/${rk.total} rated</span>`;
    else if (!pri.isConfirmed) head = html`<span class="pill warn">Not confirmed yet</span>`;
    else head = html`<span class="pill done">Confirmed ${pri.confirmedRole === 'participant' ? 'by them' : pri.confirmedRole === 'system' ? '(test data)' : 'by a coach'} · ${dateTimeFmt(pri.confirmedAt, ctx.user.timezone)}</span>`;
    const canEdit = rk.complete && rk.eligibleKeys.length > 0;
    const chosen = pri.confirmed || pri.recommended;
    return html`<section class="panel"><h3>${icon('target')} Priorities ${head}</h3>
${R.priorityTable(s.report, s.D.priAnalysis.key)}
${canEdit ? html`<details class="adjust"${ctx.query.adjust ? raw(' open') : ''}><summary>${pri.isConfirmed ? 'Change their priorities' : 'Confirm for them'}</summary>
<form method="post" action="/participants/${s.p.id}/priorities" data-pick="${n}">${csrfField(ctx)}
<p class="hint">Same rules as the participant: pick ${n} of the areas rated ${rk.threshold} or higher. The system’s original recommendation is kept for comparison.</p>
<div class="chips">${rk.categories.filter((c) => c.eligible).map((c) => html`<label class="chip pick-chip"><input type="checkbox" name="areas[]" value="${c.key}"${chosen.includes(c.key) ? raw(' checked') : ''}><span>${c.label} · ${c.highest}</span></label>`)}</div>
<p><button class="btn small" data-pick-submit>Save priorities <span data-pick-count></span></button></p></form></details>` : ''}</section>`;
  }

  function alertsPanel(ctx, s) {
    const list = Rules.alertsFor(db, s.e.id).slice(0, 8);
    if (!list.length) return '';
    const unseen = list.filter((a) => !a.seen_at).length;
    return html`<section class="panel alerts"><h3>${icon('alert')} Alerts ${unseen ? html`<span class="pill warn">${unseen} new</span>` : ''}</h3>
${list.map((a) => html`<p class="alert-row ${a.seen_at ? 'seen' : ''}"><b>${a.title}</b> ${a.text}${a.link ? html` <a href="${a.link}" target="_blank" rel="noopener">Link</a>` : ''}<small>${dateTimeFmt(a.created_at, ctx.user.timezone)}</small></p>`)}
${unseen ? html`<form method="post" action="/participants/${s.p.id}/alerts/seen">${csrfField(ctx)}<button class="btn small">Mark as seen</button></form>` : ''}</section>`;
  }

  function dayTab(ctx, s) {
    if (!s.pos.started) return html`<p class="muted">The program hasn’t started yet.</p>`;
    const D = s.D;
    let day = Number(ctx.query.day) || Math.min(s.pos.open, D.PROGRAM_DAYS);
    day = Math.max(1, Math.min(day, s.pos.open));
    const photos = db.all('SELECT * FROM photos WHERE enrollment_id=? AND day=? ORDER BY created_at', s.e.id, day);
    const forms = D.formsForDay(day);
    const base = `/participants/${s.p.id}?tab=day&day=`;
    return html`<div class="day-nav">${day > 1 ? html`<a class="btn small ghost" href="${base}${day - 1}">← Day ${day - 1}</a>` : html`<span></span>`}<h2>Day ${day} · ${dateFmt(s.pos.dateOf(day), 'long')}</h2>${day < s.pos.open ? html`<a class="btn small ghost" href="${base}${day + 1}">Day ${day + 1} →</a>` : html`<span></span>`}</div>
${D.photos || photos.length ? html`<section class="panel"><h3>${icon('camera')} ${D.photos ? D.photos.label : 'Photos'} <small>${photos.length}</small></h3>${photos.length ? html`<div class="gallery wide">${photos.map((ph) => html`<figure><a href="/photo/${ph.id}" target="_blank"><img src="/photo/${ph.id}" alt="Photo" loading="lazy"></a><figcaption>${dateTimeFmt(ph.created_at, s.p.timezone).split(', ').pop()}</figcaption></figure>`)}</div>` : html`<p class="muted">No photos for this day.</p>`}</section>` : ''}
${forms.map((k) => {
    const r = (s.map[day] || {})[k];
    const ans = P.loadAnswers(db, s.e.id, day, k);
    return html`<section class="panel answers"><h3>${D.FORMS[k].title} ${r ? html`<small>${r.answered}/${r.total} answered · saved ${dateTimeFmt(r.updated_at, ctx.user.timezone)}</small>` : html`<small>Not started</small>`}</h3>${r ? answersView(D.FORMS[k], ans) : ''}</section>`;
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
${purchasesPanel(ctx, s)}
${linkPanel(ctx, p)}
<section class="panel"><h3>Start another program</h3><p class="muted">Starts a fresh program on the date you pick (today works) and sends them a new sign-in link. The earlier program is kept on record.</p>
<form method="post" action="/participants/${p.id}/restart" class="inline">${csrfField(ctx)}<input type="date" name="start_date" value="${P.todayIn(p.timezone)}" required> ${planSelect(s.D ? `${s.D.programId}:` : null, true)} <button class="btn" data-confirm="Start a new program for ${p.name}?">Start new program</button></form>
${pastPrograms(ctx, p)}</section>
<section class="panel danger"><h3>Remove</h3><p class="muted">They can’t sign in any more and disappear from your list. Their answers are kept.</p>
<form method="post" action="/participants/${p.id}/deactivate">${csrfField(ctx)}<button class="btn danger" data-confirm="Remove ${p.name}? They won’t be able to sign in.">Remove participant</button></form></section>
</div></div>`;
  }

  function linkPanel(ctx, p) {
    const link = currentLink(ctx, p);
    const until = p.invite_expires ? dateFmt(p.invite_expires.slice(0, 10)) : '';
    return html`<section class="panel"><h3>Sign-in link</h3>
${link ? html`<p class="muted">${p.password_hash ? 'This link signs them straight in.' : 'They haven’t used it yet. It lets them choose a password and opens their program.'} It works once, until ${until}.</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>`
    : p.password_hash ? html`<p class="muted">They’ve set a password and sign in at <b>${baseUrl(ctx)}/login</b> with ${p.email}.</p>`
      : html`<p class="muted">Their last link has expired.</p>`}
<form method="post" action="/participants/${p.id}/invite">${csrfField(ctx)}<input type="hidden" name="next" value="/participants/${p.id}?tab=settings"><button class="btn">${link ? 'Make and send a new link' : 'Send a new sign-in link'}</button></form>
<p class="hint">A new link replaces the old one.</p></section>`;
  }

  function pastPrograms(ctx, p) {
    const list = db.all('SELECT * FROM enrollments WHERE user_id=? ORDER BY start_date DESC', p.id);
    if (list.length < 2) return '';
    return html`<p class="hint">Programs: ${list.map((e, i) => html`${i ? ', ' : ''}${defs.forEnrollment(db, e).name} from ${dateFmt(e.start_date)}${i === 0 ? ' (current)' : ''}`)}</p>`;
  }

  // ---------------------------------------------------------------- Actions
  r.post('/participants/:id/priorities', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const e = P.currentEnrollment(db, p.id);
    if (!e) throw new HttpError(400, 'No program.');
    const pri = R.build(db, e).pri;
    if (!pri.enabled) throw new HttpError(400, 'This program doesn’t use priorities.');
    if (!pri.ranking.complete) throw new HttpError(400, `The Day ${pri.reviewDay} review needs every question rated first.`);
    const v = Pr.validate(pri.ranking, ctx.body.areas);
    if (v.error) { ctx.setFlash(v.error, 'err'); return ctx.redirect(`/participants/${p.id}?adjust=1`); }
    Pr.confirm(db, e.id, pri.ranking, v.keys, ctx.user);
    ctx.setFlash('Priorities saved.');
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  r.post('/participants/:id/alerts/seen', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    db.run("UPDATE rule_hits SET seen_at=? WHERE kind='alert' AND seen_at IS NULL AND enrollment_id IN (SELECT id FROM enrollments WHERE user_id=?)", new Date().toISOString(), p.id);
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
    if (e && P.isDate(b.start_date) && b.start_date !== e.start_date) { db.run('UPDATE enrollments SET start_date=? WHERE id=?', b.start_date, e.id); require('../lib/store').syncTrial(db, e.id); }
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
    if (e.start_date > today) { db.run('UPDATE enrollments SET start_date=? WHERE id=?', today, e.id); require('../lib/store').syncTrial(db, e.id); }
    ctx.setFlash(`${firstName(p.name)}’s program starts today. Day 1 is open in their app.`);
    ctx.redirect(`/participants/${p.id}`);
  }, O);

  // Coaches: give something free, mark it paid outside the app, or end access
  r.post('/participants/:id/purchases/:pid', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const pu = db.get('SELECT * FROM purchases WHERE id=? AND user_id=?', Number(ctx.params.pid), p.id);
    if (!pu) throw new HttpError(404, 'That purchase wasn’t found.');
    const what = ctx.body.do;
    const t = new Date().toISOString();
    if (what === 'comp') ST.update(db, pu.id, { status: 'comped', note: `Given free by ${ctx.user.name}`, paid_at: t });
    else if (what === 'paid') ST.update(db, pu.id, { status: 'paid', note: `Marked paid by ${ctx.user.name}`, paid_at: t });
    else if (what === 'end') ST.update(db, pu.id, { status: 'expired', trial_ends: null, paid_through: null, note: `Ended by ${ctx.user.name}` });
    else throw new HttpError(400, 'Unknown action.');
    require('../lib/audit').log(db, ctx.user, 'purchase', p, `${pu.name}: ${{ comp: 'given free', paid: 'marked paid', end: 'access ended' }[what]}`);
    ctx.setFlash({ comp: `${pu.name} is now free for ${firstName(p.name)}.`, paid: `${pu.name} marked as paid.`, end: `${firstName(p.name)} no longer has ${pu.name}.` }[what]);
    ctx.redirect(`/participants/${p.id}?tab=settings`);
  }, O);

  r.post('/participants/:id/give', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    const prod = db.get("SELECT * FROM products WHERE id=? AND kind='addon'", Number(ctx.body.product_id));
    if (!prod) throw new HttpError(404, 'That add-on wasn’t found.');
    ST.insert(db, { user_id: p.id, product_id: prod.id, name: prod.name, fee: prod.fee, amount_cents: 0, currency: prod.currency, status: 'comped', note: `Given free by ${ctx.user.name}`, paid_at: new Date().toISOString(), created_by: ctx.user.id });
    require('../lib/audit').log(db, ctx.user, 'purchase', p, `${prod.name}: given free`);
    ctx.setFlash(`${firstName(p.name)} now has ${prod.name}, free.`);
    ctx.redirect(`/participants/${p.id}?tab=settings`);
  }, O);

  r.post('/participants/:id/restart', async (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    if (!P.isDate(ctx.body.start_date)) throw new HttpError(400, 'Choose the date of Day 1.');
    const plan = pickPlan(ctx.body);
    const eid = db.insert('enrollments', { user_id: p.id, start_date: ctx.body.start_date, program_version_id: plan.versionId, created_at: new Date().toISOString() });
    ST.assignProgram(db, p, { id: eid, start_date: ctx.body.start_date }, plan.product, ctx.user);
    const { link, emailed } = await sendInvite(ctx, p, { programStart: ctx.body.start_date });
    ctx.html(layout(ctx, { title: 'New program', nav: 'people', body: html`<div class="page-head"><div><p class="eyebrow"><a href="/participants/${p.id}">${p.name}</a></p><h1>New program set up</h1></div></div>
<section class="panel invite-done"><p><b>${plan.program.name}</b>. Day 1 is <b>${dateFmt(ctx.body.start_date, 'long')}</b>. ${emailed ? html`We emailed ${firstName(p.name)} a new sign-in link. You can also send it yourself:` : html`Send ${firstName(p.name)} this new sign-in link:`}</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>
<p class="hint">It’s also kept under Settings on their page.</p>
<p><a class="btn primary" href="/participants/${p.id}">Back to ${firstName(p.name)}</a></p></section>` }));
  }, O);

  r.post('/participants/:id/deactivate', (ctx) => {
    const p = participantFor(ctx, ctx.params.id);
    db.run('UPDATE users SET active=0, invite_hash=NULL, invite_token=NULL WHERE id=?', p.id);
    db.run('DELETE FROM sessions WHERE user_id=?', p.id);
    ctx.setFlash(`${p.name} was removed.`);
    ctx.redirect('/participants');
  }, O);
};
