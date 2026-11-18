'use strict';
// Admin → Programs: the program builder (super admins only). Every program has a draft that's edited here
// and published versions that people actually do. Publishing asks whether the change is for new people only,
// or pushed to everyone already in the program.
//
// Pages: the list; and for one program, tabs for Basics (length, phases, photos), Categories & scale,
// Forms (sections and questions; each question has its own page), Results (analyses, scores, priorities,
// coach alerts, participant messages), Publish, and Advanced (the whole definition as JSON). Preview shows
// any form exactly as participants see it.
const { html, raw, dateTimeFmt } = require('../lib/html');
const { layout, icon, csrfField, formBody } = require('../lib/views');
const { HttpError } = require('../lib/http');
const audit = require('../lib/audit');
const defs = require('../lib/defs');
const F = require('../lib/forms');
const Rules = require('../lib/rules');
const { str } = require('../lib/site');
const { tabs: adminTabs } = require('./admin');

const O = { coach: true, super: true };
const TYPES = [
  ['single', 'Pick one'], ['multi', 'Pick any'], ['yesno', 'Yes / No'], ['scale', '1–5 rating'],
  ['grid', 'Ratings table (several 1–5 ratings)'], ['time', 'Clock time'], ['text', 'Written answer'],
];
const TYPE = Object.fromEntries(TYPES);
const TOD = [['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening']];
const SECTIONS = [['basics', 'Basics'], ['categories', 'Categories & scale'], ['forms', 'Forms & questions'], ['results', 'Results'], ['publish', 'Publish'], ['json', 'Advanced']];

const sel = (on) => (on ? raw(' selected') : '');
const chk = (on) => (on ? raw(' checked') : '');
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && String(v).trim() !== '' ? Math.max(lo, Math.min(hi, n)) : dflt; };
const lines = (v, max = 60) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, 300));
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
/** A key that isn't in `taken` yet, made from a label. */
function uniqueKey(label, taken, fallback) {
  const base = defs.slug(label, fallback);
  let k = base; let i = 2;
  while (taken.includes(k)) k = `${base}_${i++}`;
  return k;
}
const iconSelect = (name, v) => html`<select name="${name}">${defs.ICONS.map((i) => html`<option${sel(i === v)}>${i}</option>`)}</select>`;

module.exports = (r, { db }) => {
  // ---------------------------------------------------------------- Loading and saving the draft
  function load(id) {
    const p = db.get('SELECT * FROM programs WHERE id=?', Number(id));
    if (!p) throw new HttpError(404, 'That program wasn’t found.');
    const def = JSON.parse(p.draft);
    const latest = defs.latestVersion(db, p.id);
    return { p, def, latest, changed: !latest || latest.def !== p.draft };
  }
  function save(p, def) {
    db.run('UPDATE programs SET draft=?, draft_updated_at=? WHERE id=?', JSON.stringify(def), new Date().toISOString(), p.id);
  }
  /** Change the draft with fn(def) and go back to `back`. fn may return an error message. */
  function change(ctx, back, fn) {
    const { p, def } = load(ctx.params.id);
    const err = fn(def, p);
    if (typeof err === 'string') { ctx.setFlash(err, 'err'); return ctx.redirect(back); }
    save(p, def);
    if (err && err.warn) ctx.setFlash(err.warn, 'err'); else ctx.setFlash('Saved to the draft. Publish when you’re ready.');
    ctx.redirect(back);
  }
  const people = (programId) => db.get('SELECT COUNT(*) n FROM enrollments e JOIN program_versions v ON v.id=e.program_version_id WHERE v.program_id=?', programId).n;
  const onOlder = (programId, latestId) => db.get('SELECT COUNT(*) n FROM enrollments e JOIN program_versions v ON v.id=e.program_version_id WHERE v.program_id=? AND v.id<>?', programId, latestId).n;

  function page(ctx, s, title, body, sub) {
    const { p, def, latest, changed } = s;
    const base = `/admin/programs/${p.id}`;
    return layout(ctx, { title, nav: 'admin', body: html`
<div class="page-head"><div><p class="eyebrow"><a href="/admin/programs">Programs</a></p><h1>${def.name}</h1>
<p class="muted">${def.days} days · ${(def.forms || []).length} form${(def.forms || []).length === 1 ? '' : 's'} · ${latest ? `Published v${latest.version}` : 'Never published'}${changed ? html` · <span class="pill warn">Draft has unpublished changes</span>` : html` · <span class="pill done">Draft matches v${latest.version}</span>`}</p></div>
<div class="head-actions"><a class="btn ghost" href="${base}/preview">${icon('phone')} Preview</a>${changed ? html`<a class="btn primary" href="${base}?s=publish">Publish</a>` : ''}</div></div>
<nav class="tabs">${SECTIONS.map(([k, l]) => html`<a href="${base}?s=${k}" class="${sub === k ? 'on' : ''}">${l}</a>`)}</nav>
<div class="tab-body">${body}</div>` });
  }

  // ---------------------------------------------------------------- The list
  r.get('/admin/programs', (ctx) => {
    const list = db.all('SELECT * FROM programs ORDER BY active DESC, builtin DESC, name');
    ctx.html(layout(ctx, { title: 'Programs', nav: 'admin', body: html`
<div class="page-head"><div><p class="eyebrow">Super admin</p><h1>Programs</h1><p class="muted">Each program has its own length, forms, questions, rating scale and results. Coaches pick one when they invite someone.</p></div></div>
${adminTabs('programs')}
<div class="cols">
<section class="panel"><h3>${icon('target')} Programs</h3><table class="list"><thead><tr><th>Program</th><th>Published</th><th>People</th><th></th></tr></thead><tbody>
${list.map((p) => {
    const latest = defs.latestVersion(db, p.id);
    const def = JSON.parse(p.draft);
    return html`<tr class="${p.active ? '' : 'off'}" data-href="/admin/programs/${p.id}"><td><a href="/admin/programs/${p.id}"><b>${p.name}</b></a><small>${def.days} days${p.builtin ? ' · the original' : ''}${p.active ? '' : ' · archived'}${latest && latest.def !== p.draft ? ' · unpublished changes' : ''}</small></td>
<td>${latest ? html`v${latest.version}<small>${dateTimeFmt(latest.published_at, ctx.user.timezone)}</small>` : html`<span class="pill warn">Draft only</span>`}</td><td>${people(p.id)}</td>
<td class="actions"><a class="link" href="/admin/programs/${p.id}">Edit</a><form method="post" action="/admin/programs/${p.id}/duplicate">${csrfField(ctx)}<button class="link">Duplicate</button></form></td></tr>`;
  })}</tbody></table></section>
<form method="post" action="/admin/programs" class="panel">${csrfField(ctx)}<h3>${icon('plus')} New program</h3>
<label class="fld"><span>Name</span><input name="name" required maxlength="80" placeholder="e.g. 30-Day Reset"></label>
<label class="fld"><span>Start from</span><select name="from"><option value="">A blank program (one daily check-in)</option>${list.map((p) => html`<option value="${p.id}">A copy of ${p.name}</option>`)}</select></label>
<p class="hint">Nothing is live until you publish it. Copying is the quickest way to make a variation of an existing program.</p>
<button class="btn primary">Create</button></form></div>` }));
  }, O);

  function create(ctx, def, note) {
    const t = new Date().toISOString();
    const id = db.insert('programs', { name: def.name, draft: JSON.stringify(def), draft_updated_at: t, builtin: 0, created_by: ctx.user.id, created_at: t });
    audit.log(db, ctx.user, 'program', null, `${note}: ${def.name}`);
    return id;
  }
  r.post('/admin/programs', (ctx) => {
    const name = str(ctx.body.name, 80) || 'New program';
    let def;
    if (ctx.body.from) { def = load(ctx.body.from).def; def = JSON.parse(JSON.stringify(def)); def.name = name; } else def = defs.blank(name);
    const id = create(ctx, def, 'created a program');
    ctx.setFlash(`${name} created. Build it, preview it, then publish.`);
    ctx.redirect(`/admin/programs/${id}`);
  }, O);
  r.post('/admin/programs/:id/duplicate', (ctx) => {
    const def = JSON.parse(JSON.stringify(load(ctx.params.id).def));
    def.name = `Copy of ${def.name}`.slice(0, 80);
    const id = create(ctx, def, 'duplicated a program');
    ctx.setFlash('Copied. Rename it under Basics.');
    ctx.redirect(`/admin/programs/${id}`);
  }, O);

  // ---------------------------------------------------------------- One program
  r.get('/admin/programs/:id', (ctx) => {
    const s = load(ctx.params.id);
    const sub = SECTIONS.some(([k]) => k === ctx.query.s) ? ctx.query.s : 'basics';
    const body = { basics, categories, forms: formsTab, results, publish: publishTab, json: jsonTab }[sub](ctx, s);
    ctx.html(page(ctx, s, s.def.name, body, sub));
  }, O);

  // ---- Basics: name, length, photos, phases
  function basics(ctx, { p, def }) {
    const base = `/admin/programs/${p.id}`;
    const ph = def.photos || {};
    return html`<form method="post" action="${base}/basics" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">About this program</h3>
<label class="fld"><span>Name</span><input name="name" value="${def.name}" required maxlength="80"></label>
<label class="fld"><span>Length in days</span><input type="number" name="days" value="${def.days}" min="1" max="365" required></label>
<label class="fld span2"><span>Description <em>shown to participants on their Me page</em></span><textarea name="description" rows="2" maxlength="1000">${def.description || ''}</textarea></label>
<label class="check span2"><input type="checkbox" name="photos" value="1"${chk(ph.enabled)}> Participants can add photos each day</label>
<label class="fld"><span>Photo section title</span><input name="photo_label" value="${ph.label || 'Photos'}" maxlength="60"></label>
<label class="fld"><span>Photo tip</span><input name="photo_tip" value="${ph.tip || ''}" maxlength="200"></label>
<div class="span2"><button class="btn primary">Save</button></div></form>

<form method="post" action="${base}/phases" class="panel">${csrfField(ctx)}<h3>Phases <small>stretches of days with their own heading and tip on the Today screen</small></h3>
<div class="table-wrap"><table class="list edit"><thead><tr><th>From day</th><th>To day</th><th>Name</th><th>Tip</th><th>“Remember” list <em>one per line</em></th><th>Remove</th></tr></thead><tbody>
${[...(def.phases || []), {}].map((x, i) => html`<tr><td><input type="number" name="from[]" value="${x.from ?? ''}" min="1" max="365" class="num"></td><td><input type="number" name="to[]" value="${x.to ?? ''}" min="1" max="365" class="num"></td>
<td><input name="name[]" value="${x.name || ''}" maxlength="80" placeholder="${x.name ? '' : 'Add a phase…'}"></td><td><textarea name="tip[]" rows="2" maxlength="400">${x.tip || ''}</textarea></td><td><textarea name="remember[]" rows="2" maxlength="1500">${(x.remember || []).join('\n')}</textarea></td>
<td>${x.name ? html`<input type="checkbox" name="remove[]" value="${i}" aria-label="Remove">` : ''}</td></tr>`)}</tbody></table></div>
<p class="hint">Days not inside any phase use the last phase. Fill in the empty row to add one.</p><button class="btn">Save phases</button></form>`;
  }
  r.post('/admin/programs/:id/basics', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=basics`, (def) => {
    const b = ctx.body;
    def.name = str(b.name, 80) || def.name;
    def.days = int(b.days, 1, 365, def.days);
    def.description = str(b.description, 1000);
    def.photos = { enabled: !!b.photos, label: str(b.photo_label, 60) || 'Photos', tip: str(b.photo_tip, 200) };
    // A shorter program: pull phases, schedules and analyses inside the new length
    const n = def.days; const cap = (x) => Math.min(x, n);
    def.phases = (def.phases || []).filter((x) => x.from <= n).map((x) => ({ ...x, to: cap(x.to) }));
    for (const f of def.forms || []) {
      const sc = f.schedule || {};
      if (sc.from && sc.from > n) { delete sc.from; delete sc.to; } else if (sc.to) sc.to = cap(sc.to);
      sc.days = (sc.days || []).filter((d) => d <= n);
      if (!defs.scheduledDays(f, n).length) f.schedule = f.kind === 'review' ? { days: [n] } : { from: 1, to: n, days: [] };
    }
    def.analyses = (def.analyses || []).map((a) => ({ ...a, day: cap(a.day), from: cap(a.from), to: cap(a.to) }));
  }), O);
  r.post('/admin/programs/:id/phases', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=basics`, (def) => {
    const b = ctx.body; const rm = arr(b.remove).map(Number);
    const out = [];
    arr(b.name).forEach((n, i) => {
      const name = str(n, 80);
      if (!name || rm.includes(i)) return;
      const from = int(arr(b.from)[i], 1, 365, 1); const to = int(arr(b.to)[i], 1, 365, def.days);
      out.push({ from: Math.min(from, to), to: Math.max(from, to), name, tip: str(arr(b.tip)[i], 400), ...(lines(arr(b.remember)[i], 12).length ? { remember: lines(arr(b.remember)[i], 12) } : {}) });
    });
    def.phases = out.sort((a, c) => a.from - c.from);
  }), O);

  // ---- Categories and the 1-5 scale
  function categories(ctx, { p, def }) {
    const base = `/admin/programs/${p.id}`;
    const used = (k) => (def.forms || []).some((f) => (f.sections || []).some((s) => s.area === k || (s.fields || []).some((x) => x.area === k)));
    return html`<form method="post" action="${base}/areas" class="panel">${csrfField(ctx)}<h3>Categories <small>what scores, priorities and content are grouped by</small></h3>
<div class="table-wrap"><table class="list edit"><thead><tr><th>Name</th><th>Short name</th><th>Icon</th><th>Key</th><th>Remove</th></tr></thead><tbody>
${[...(def.areas || []), {}].map((a, i) => html`<tr><td><input name="label[]" value="${a.label || ''}" maxlength="60" placeholder="${a.key ? '' : 'Add a category…'}"><input type="hidden" name="key[]" value="${a.key || ''}"></td><td><input name="short[]" value="${a.short || ''}" maxlength="20"></td><td>${iconSelect('icon[]', a.icon || 'target')}</td><td><code>${a.key || 'new'}</code></td>
<td>${a.key ? (used(a.key) ? html`<small class="muted">in use</small>` : html`<input type="checkbox" name="remove[]" value="${i}" aria-label="Remove">`) : ''}</td></tr>`)}</tbody></table></div>
<p class="hint">The key never changes once made, so renaming a category keeps everyone’s answers and content attached to it. Categories used by a section or question can’t be removed.</p>
<button class="btn">Save categories</button></form>
<form method="post" action="${base}/scale" class="panel">${csrfField(ctx)}<h3>The 1–5 scale <small>shown above review forms</small></h3>
<div class="table-wrap"><table class="list edit"><thead><tr><th>Rating</th><th>Name</th><th>Meaning</th></tr></thead><tbody>
${(def.scale && def.scale.levels ? def.scale.levels : F.BUILTIN.scale.levels).map((l) => html`<tr><td><span class="dot d${l.n}">${l.n}</span></td><td><input name="label[]" value="${l.label}" maxlength="30"></td><td><input name="desc[]" value="${l.desc || ''}" maxlength="80"></td></tr>`)}</tbody></table></div>
<p class="hint">1 always means “not a challenge” and 5 the hardest. Questions where 5 is good (like sleep quality) are flipped when scoring.</p><button class="btn">Save scale</button></form>`;
  }
  r.post('/admin/programs/:id/areas', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=categories`, (def) => {
    const b = ctx.body; const rm = arr(b.remove).map(Number);
    const old = def.areas || [];
    const out = [];
    arr(b.label).forEach((l, i) => {
      const label = str(l, 60); const key = arr(b.key)[i];
      const prev = old.find((a) => a.key === key);
      if (!label) { if (prev) out.push(prev); return; }
      if (rm.includes(i)) return;
      const k = prev ? prev.key : uniqueKey(label, [...old.map((a) => a.key), ...out.map((a) => a.key)], 'area');
      out.push({ key: k, label, short: str(arr(b.short)[i], 20) || label.split(/[ &,]/)[0], icon: defs.ICONS.includes(arr(b.icon)[i]) ? arr(b.icon)[i] : 'target' });
    });
    if (!out.length) return 'Keep at least one category.';
    def.areas = out;
  }), O);
  r.post('/admin/programs/:id/scale', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=categories`, (def) => {
    const levels = [1, 2, 3, 4, 5].map((n, i) => ({ n, label: str(arr(ctx.body.label)[i], 30) || String(n), desc: str(arr(ctx.body.desc)[i], 80) }));
    def.scale = { levels };
  }), O);

  // ---- Forms
  const schedText = (f, days) => {
    const d = defs.scheduledDays(f, days);
    if (!d.length) return 'not scheduled';
    if (d.length === days) return 'every day';
    const runs = []; let a = d[0]; let prev = d[0];
    for (const x of [...d.slice(1), null]) { if (x === prev + 1) { prev = x; continue; } runs.push(a === prev ? `${a}` : `${a}–${prev}`); a = x; prev = x; }
    return `day${d.length > 1 ? 's' : ''} ${runs.join(', ')}`;
  };
  function formsTab(ctx, { p, def }) {
    const base = `/admin/programs/${p.id}`;
    return html`<div class="cols"><section class="panel"><h3>Forms</h3>
${(def.forms || []).length ? html`<table class="list"><tbody>${def.forms.map((f, i) => html`<tr data-href="${base}/forms/${f.key}"><td>${icon(f.icon || 'notes')}</td><td><a href="${base}/forms/${f.key}"><b>${f.title}</b></a><small>${f.kind === 'review' ? 'Review' : 'Daily'} · ${schedText(f, def.days)} · ${F.questions({ sections: f.sections || [] }).length} questions</small></td>
<td class="actions"><a class="link" href="${base}/preview?form=${f.key}">Preview</a><form method="post" action="${base}/forms/${f.key}/move">${csrfField(ctx)}${i ? html`<button class="link" name="dir" value="-1" title="Move up">↑</button>` : ''}${i < def.forms.length - 1 ? html`<button class="link" name="dir" value="1" title="Move down">↓</button>` : ''}</form></td></tr>`)}</tbody></table>` : html`<p class="muted">No forms yet.</p>`}
<p class="hint"><b>Daily</b> forms are what people fill in each day; their ratings make the category scores. <b>Review</b> forms are rating lists (often on the last day of a week) that analyses and priorities use.</p></section>
<form method="post" action="${base}/forms" class="panel">${csrfField(ctx)}<h3>${icon('plus')} Add a form</h3>
<label class="fld"><span>Title</span><input name="title" required maxlength="80" placeholder="e.g. Evening check-in"></label>
<label class="fld"><span>Kind</span><select name="kind"><option value="daily">Daily</option><option value="review">Review</option></select></label>
<button class="btn primary">Add form</button></form></div>`;
  }
  r.post('/admin/programs/:id/forms', (ctx) => {
    const { p, def } = load(ctx.params.id);
    const title = str(ctx.body.title, 80) || 'New form';
    const key = uniqueKey(title, (def.forms || []).map((f) => f.key), 'form');
    const kind = ctx.body.kind === 'review' ? 'review' : 'daily';
    const area = (def.areas[0] || {}).key;
    (def.forms = def.forms || []).push({ key, title, short: title.slice(0, 20), blurb: '', icon: kind === 'review' ? 'trophy' : 'notes', kind,
      schedule: kind === 'review' ? { days: [def.days] } : { from: 1, to: def.days, days: [] },
      sections: [{ key: 'main', num: 1, title, icon: 'notes', area, fields: [] }] });
    save(p, def);
    ctx.redirect(`/admin/programs/${p.id}/forms/${key}`);
  }, O);
  r.post('/admin/programs/:id/forms/:fk/move', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=forms`, (def) => {
    const i = def.forms.findIndex((f) => f.key === ctx.params.fk); const j = i + (Number(ctx.body.dir) < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= def.forms.length) return null;
    [def.forms[i], def.forms[j]] = [def.forms[j], def.forms[i]];
  }), O);

  function getForm(def, fk) {
    const f = (def.forms || []).find((x) => x.key === fk);
    if (!f) throw new HttpError(404, 'That form wasn’t found.');
    return f;
  }
  const areaSelect = (def, name, v, { inherit } = {}) => html`<select name="${name}">${inherit ? html`<option value="">${inherit}</option>` : ''}${def.areas.map((a) => html`<option value="${a.key}"${sel(a.key === v)}>${a.label}</option>`)}${inherit ? html`<option value="-"${sel(v === '-')}>No category (not scored)</option>` : ''}</select>`;

  r.get('/admin/programs/:id/forms/:fk', (ctx) => {
    const s = load(ctx.params.id); const { p, def } = s;
    const f = getForm(def, ctx.params.fk);
    const base = `/admin/programs/${p.id}/forms/${f.key}`;
    const sc = f.schedule || {};
    const body = html`<p><a href="/admin/programs/${p.id}?s=forms">← All forms</a></p>
<form method="post" action="${base}" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">${icon(f.icon || 'notes')} ${f.title}</h3>
<label class="fld"><span>Title</span><input name="title" value="${f.title}" required maxlength="80"></label>
<label class="fld"><span>Short name <em>on the day screen</em></span><input name="short" value="${f.short || ''}" maxlength="20"></label>
<label class="fld span2"><span>Description</span><input name="blurb" value="${f.blurb || ''}" maxlength="200"></label>
<label class="fld"><span>Kind</span><select name="kind"><option value="daily"${sel(f.kind !== 'review')}>Daily: ratings make the category scores</option><option value="review"${sel(f.kind === 'review')}>Review: ratings lists for analyses and priorities</option></select></label>
<label class="fld"><span>Icon</span>${iconSelect('icon', f.icon || 'notes')}</label>
<label class="fld"><span>Every day from</span><span class="inline"><input type="number" name="from" value="${sc.from || ''}" min="1" max="${def.days}" class="num"> to <input type="number" name="to" value="${sc.to || ''}" min="1" max="${def.days}" class="num"></span></label>
<label class="fld"><span>Also on days <em>comma-separated</em></span><input name="days" value="${(sc.days || []).join(', ')}" placeholder="e.g. 7, 14"></label>
<p class="hint span2">Shows on ${schedText(f, def.days)}. Leave “every day” empty to use only specific days.</p>
<div class="span2"><button class="btn primary">Save</button> <a class="btn ghost" href="/admin/programs/${p.id}/preview?form=${f.key}">Preview</a></div></form>
${(f.sections || []).map((sec, si) => html`<section class="panel builder-sec"><form method="post" action="${base}/sections/${si}" class="form-grid">${csrfField(ctx)}
<h3 class="span2">Section ${si + 1}: ${sec.title}</h3>
<label class="fld"><span>Title</span><input name="title" value="${sec.title}" maxlength="80"></label>
<label class="fld"><span>Category <em>its ratings count toward</em></span>${areaSelect(def, 'area', sec.area)}</label>
<label class="fld span2"><span>Intro <em>optional</em></span><input name="intro" value="${sec.intro || ''}" maxlength="300"></label>
<div class="span2 inline"><button class="btn small">Save section</button>${si ? html`<button class="btn small ghost" name="move" value="-1">Move up</button>` : ''}${si < f.sections.length - 1 ? html`<button class="btn small ghost" name="move" value="1">Move down</button>` : ''}${f.sections.length > 1 ? html`<button class="btn small ghost danger" name="remove" value="1" data-confirm="Remove the section “${sec.title}” and its ${(sec.fields || []).length} questions?">Remove section</button>` : ''}</div></form>
<table class="list qlist"><tbody>${(sec.fields || []).map((q, qi) => html`<tr data-href="${base}/q/${si}/${qi}"><td><a href="${base}/q/${si}/${qi}"><b>${q.label || q.key}</b></a><small>${TYPE[q.type] || q.type}${q.type === 'grid' ? ` · ${q.rows.length} rows${q.cols.length > 1 ? ` × ${q.cols.length}` : ''}${q.rateAll ? ' · review ratings' : ''}` : ''}${q.optional ? ' · optional' : ''}${q.good ? ' · 5 is good' : ''}${q.challenge ? ' · challenge rating' : ''}${q.showIf ? ` · only if ${q.showIf.key} = ${q.showIf.eq}` : ''}${q.noScore ? ' · not scored' : q.area && q.area !== sec.area ? ` · counts toward ${q.area}` : ''}</small></td>
<td class="actions"><form method="post" action="${base}/q/${si}/${qi}/move">${csrfField(ctx)}${qi ? html`<button class="link" name="dir" value="-1" title="Move up">↑</button>` : ''}${qi < sec.fields.length - 1 ? html`<button class="link" name="dir" value="1" title="Move down">↓</button>` : ''}</form></td></tr>`)}</tbody></table>
<form method="post" action="${base}/q/${si}/new" class="inline add-q">${csrfField(ctx)}<input name="label" required maxlength="200" placeholder="New question…"><select name="type">${TYPES.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select><button class="btn small">${icon('plus')} Add question</button></form></section>`)}
<form method="post" action="${base}/sections" class="panel inline">${csrfField(ctx)}<input name="title" required maxlength="80" placeholder="New section title…"><button class="btn">${icon('plus')} Add section</button></form>
<form method="post" action="${base}/delete" class="panel danger"><h3>Remove this form</h3><p class="muted">Answers already saved by people on published versions are kept.</p>${csrfField(ctx)}<button class="btn danger" data-confirm="Remove “${f.title}” from the draft?">Remove form</button></form>`;
    ctx.html(page(ctx, s, f.title, body, 'forms'));
  }, O);

  const back = (ctx) => `/admin/programs/${ctx.params.id}/forms/${ctx.params.fk}`;
  r.post('/admin/programs/:id/forms/:fk', (ctx) => change(ctx, back(ctx), (def) => {
    const f = getForm(def, ctx.params.fk); const b = ctx.body;
    f.title = str(b.title, 80) || f.title; f.short = str(b.short, 20); f.blurb = str(b.blurb, 200);
    f.kind = b.kind === 'review' ? 'review' : 'daily'; f.icon = defs.ICONS.includes(b.icon) ? b.icon : f.icon;
    const from = int(b.from, 1, def.days, null); const to = int(b.to, 1, def.days, null);
    const days = String(b.days || '').split(/[\s,]+/).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= def.days);
    f.schedule = { ...(from && to ? { from: Math.min(from, to), to: Math.max(from, to) } : {}), days: [...new Set(days)].sort((a, c) => a - c) };
    if (!defs.scheduledDays(f, def.days).length) return 'Choose at least one day for this form.';
  }), O);
  r.post('/admin/programs/:id/forms/:fk/delete', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=forms`, (def) => {
    if (def.forms.length < 2) return 'A program needs at least one form.';
    def.forms = def.forms.filter((f) => f.key !== ctx.params.fk);
  }), O);
  r.post('/admin/programs/:id/forms/:fk/sections', (ctx) => change(ctx, back(ctx), (def) => {
    const f = getForm(def, ctx.params.fk);
    const title = str(ctx.body.title, 80) || 'Section';
    const key = uniqueKey(title, f.sections.map((x) => x.key), 'section');
    f.sections.push({ key, num: f.sections.length + 1, title, icon: 'notes', area: (f.sections.at(-1) || {}).area || def.areas[0].key, fields: [] });
  }), O);
  r.post('/admin/programs/:id/forms/:fk/sections/:si', (ctx) => change(ctx, back(ctx), (def) => {
    const f = getForm(def, ctx.params.fk); const si = Number(ctx.params.si); const sec = f.sections[si];
    if (!sec) return 'That section wasn’t found.';
    const b = ctx.body;
    if (b.remove) { f.sections.splice(si, 1); } else if (b.move) {
      const j = si + (Number(b.move) < 0 ? -1 : 1);
      if (j >= 0 && j < f.sections.length) [f.sections[si], f.sections[j]] = [f.sections[j], f.sections[si]];
    } else {
      sec.title = str(b.title, 80) || sec.title; sec.intro = str(b.intro, 300);
      if (def.areas.some((a) => a.key === b.area)) sec.area = b.area;
      const a = def.areas.find((x) => x.key === sec.area); if (a) sec.icon = a.icon;
    }
    f.sections.forEach((x, i) => { x.num = i + 1; });
  }), O);

  // ---- One question
  r.post('/admin/programs/:id/forms/:fk/q/:si/new', (ctx) => {
    const { p, def } = load(ctx.params.id);
    const f = getForm(def, ctx.params.fk); const si = Number(ctx.params.si); const sec = f.sections[si];
    if (!sec) throw new HttpError(404, 'That section wasn’t found.');
    const label = str(ctx.body.label, 200) || 'New question';
    const type = TYPE[ctx.body.type] ? ctx.body.type : 'scale';
    const q = { key: uniqueKey(label, sec.fields.map((x) => x.key), 'q'), type, label };
    if (type === 'single' || type === 'multi') q.options = ['Option 1', 'Option 2'];
    if (type === 'scale') Object.assign(q, { lo: 'Not a challenge', hi: 'Severe' });
    if (type === 'grid') Object.assign(q, { cols: [['v', '']], rows: [{ key: 'item_1', label: 'Item 1' }], lo: 'Not at all', hi: 'Severe', rateAll: f.kind === 'review' });
    sec.fields.push(q);
    save(p, def);
    ctx.redirect(`/admin/programs/${p.id}/forms/${f.key}/q/${si}/${sec.fields.length - 1}`);
  }, O);
  r.post('/admin/programs/:id/forms/:fk/q/:si/:qi/move', (ctx) => change(ctx, back(ctx), (def) => {
    const sec = getForm(def, ctx.params.fk).sections[Number(ctx.params.si)]; const i = Number(ctx.params.qi);
    const j = i + (Number(ctx.body.dir) < 0 ? -1 : 1);
    if (sec && sec.fields[i] && j >= 0 && j < sec.fields.length) [sec.fields[i], sec.fields[j]] = [sec.fields[j], sec.fields[i]];
  }), O);

  function getQ(def, ctx) {
    const f = getForm(def, ctx.params.fk); const sec = f.sections[Number(ctx.params.si)];
    const q = sec && sec.fields[Number(ctx.params.qi)];
    if (!q) throw new HttpError(404, 'That question wasn’t found.');
    return { f, sec, q };
  }
  r.get('/admin/programs/:id/forms/:fk/q/:si/:qi', (ctx) => {
    const s = load(ctx.params.id); const { p, def } = s;
    const { f, sec, q } = getQ(def, ctx);
    const action = `/admin/programs/${p.id}/forms/${f.key}/q/${ctx.params.si}/${ctx.params.qi}`;
    const opts = (q.options || []).map((o) => (q.optionScores && q.optionScores[o] != null ? `${o} = ${q.optionScores[o]}` : o)).join('\n');
    const triggers = sec.fields.filter((x) => x !== q && (x.type === 'yesno' || x.type === 'single'));
    const colMode = q.type !== 'grid' ? '' : q.cols.length === 1 ? 'one' : q.cols.map(([c]) => c).join() === 'morning,midday,evening' ? 'tod' : 'custom';
    const body = html`<p><a href="/admin/programs/${p.id}/forms/${f.key}">← ${f.title}</a></p>
<form method="post" action="${action}" class="panel form-grid builder-q">${csrfField(ctx)}<h3 class="span2">${TYPE[q.type]} · <code>${sec.key}.${q.key}</code></h3>
<label class="fld span2"><span>Question</span><input name="label" value="${q.label || ''}" maxlength="200" required></label>
<label class="fld"><span>Type</span><select name="type">${TYPES.map(([k, l]) => html`<option value="${k}"${sel(k === q.type)}>${l}</option>`)}</select></label>
<label class="fld"><span>Counts toward</span>${areaSelect(def, 'area', q.noScore ? '-' : q.area || '', { inherit: `The section’s category (${(def.areas.find((a) => a.key === sec.area) || {}).label || '—'})` })}</label>
<label class="check"><input type="checkbox" name="optional" value="1"${chk(q.optional)}> Optional (not needed to finish the form)</label>
${q.type === 'single' || q.type === 'multi' ? html`<label class="fld span2"><span>Answer choices <em>one per line${q.type === 'single' ? '. To score a choice for its category, add “ = 1” to “ = 5” (5 = hardest), e.g. “Very difficult = 5”' : ''}</em></span><textarea name="options" rows="7">${opts}</textarea></label>
<label class="check"><input type="checkbox" name="other" value="1"${chk(q.other)}> Add “Other” with a box to write in</label>
${q.type === 'multi' ? html`<label class="fld"><span>Most they can pick <em>blank = any</em></span><input type="number" name="max" value="${q.max || ''}" min="1" max="20" class="num"></label>` : ''}` : ''}
${q.type === 'scale' ? html`<label class="fld"><span>What 1 means</span><input name="lo" value="${q.lo || ''}" maxlength="60"></label><label class="fld"><span>What 5 means</span><input name="hi" value="${q.hi || ''}" maxlength="60"></label>
<label class="check"><input type="checkbox" name="good" value="1"${chk(q.good)}> 5 is good (flipped when scoring, like sleep quality)</label>
<label class="check"><input type="checkbox" name="challenge" value="1"${chk(q.challenge)}> Highlight as the section’s “how much of a challenge” rating</label>` : ''}
${q.type === 'grid' ? html`<label class="fld span2"><span>Rows <em>one per line: Label | what 1 means | what 5 means | good (optional; add “good” where 5 is good)</em></span><textarea name="rows" rows="7">${q.rows.map((x) => [x.label, x.lo || '', x.hi || '', x.good ? 'good' : ''].join(' | ').replace(/( \| )+$/, '')).join('\n')}</textarea></label>
<label class="fld"><span>Columns</span><select name="colmode"><option value="one"${sel(colMode === 'one')}>One rating per row</option><option value="tod"${sel(colMode === 'tod')}>Morning, midday and evening</option><option value="custom"${sel(colMode === 'custom')}>My own (below)</option></select></label>
<label class="fld"><span>My own columns <em>one per line</em></span><textarea name="cols" rows="3">${colMode === 'custom' ? q.cols.map(([, l]) => l).join('\n') : ''}</textarea></label>
<label class="fld"><span>What 1 means <em>default for rows</em></span><input name="lo" value="${q.lo || ''}" maxlength="60"></label><label class="fld"><span>What 5 means</span><input name="hi" value="${q.hi || ''}" maxlength="60"></label>
<label class="check span2"><input type="checkbox" name="rateAll" value="1"${chk(q.rateAll)}> Review ratings: each row is a challenge that analyses use and that can make its category a priority${f.kind === 'review' ? '' : ' (only used on review forms)'}</label>` : ''}
${triggers.length ? html`<label class="fld"><span>Only show if</span><select name="si_key"><option value="">Always show</option>${triggers.map((x) => html`<option value="${x.key}"${sel(q.showIf && q.showIf.key === x.key)}>${x.label}</option>`)}</select></label>
<label class="fld"><span>…is answered</span><input name="si_eq" value="${q.showIf ? q.showIf.eq : 'Yes'}" maxlength="100"></label>` : ''}
<div class="span2 inline"><button class="btn primary">Save</button><a class="btn ghost" href="/admin/programs/${p.id}/forms/${f.key}">Done</a><button class="btn ghost danger" name="remove" value="1" data-confirm="Remove this question?">Remove question</button></div>
<p class="hint span2">Changing the type of a question people have answered can leave their old answer unreadable on older reports. For a big change, add a new question instead.</p></form>
<section class="panel"><h3>How it looks</h3>${formBody(ctx, { key: 'preview', sections: [{ ...sec, intro: '', fields: [q] }] }, {}, '#', { readonly: true, D: defs.compile(def) })}</section>`;
    ctx.html(page(ctx, s, q.label || 'Question', body, 'forms'));
  }, O);

  r.post('/admin/programs/:id/forms/:fk/q/:si/:qi', (ctx) => {
    const { p, def } = load(ctx.params.id);
    const { f, sec, q } = getQ(def, ctx);
    const b = ctx.body;
    const done = `/admin/programs/${p.id}/forms/${f.key}`;
    const here = `${done}/q/${ctx.params.si}/${ctx.params.qi}`;
    if (b.remove) {
      sec.fields.splice(Number(ctx.params.qi), 1);
      for (const x of sec.fields) if (x.showIf && x.showIf.key === q.key) delete x.showIf;
      save(p, def); ctx.setFlash('Question removed from the draft.'); return ctx.redirect(done);
    }
    const type = TYPE[b.type] ? b.type : q.type;
    const n = { key: q.key, type, label: str(b.label, 200) || q.label };
    if (b.optional) n.optional = true;
    if (b.area === '-') n.noScore = true; else if (def.areas.some((a) => a.key === b.area)) n.area = b.area;
    if (type === 'single' || type === 'multi') {
      const raw = lines(b.options != null ? b.options : (q.options || []).join('\n'), 40);
      n.options = []; const scores = {};
      for (const l of raw) {
        const m = type === 'single' ? /^(.*?)\s*=\s*([1-5])$/.exec(l) : null;
        const o = m ? m[1] : l;
        if (!o || n.options.includes(o)) continue;
        n.options.push(o); if (m) scores[o] = Number(m[2]);
      }
      if (!n.options.length) { ctx.setFlash('Add at least one answer choice.', 'err'); return ctx.redirect(here); }
      if (Object.keys(scores).length) n.optionScores = scores;
      if (b.other) n.other = true;
      if (type === 'multi' && int(b.max, 1, 20, null)) n.max = int(b.max, 1, 20, null);
    }
    if (type === 'scale') {
      n.lo = str(b.lo, 60) || q.lo || 'Not a challenge'; n.hi = str(b.hi, 60) || q.hi || 'Severe';
      if (b.good) n.good = true; if (b.challenge) n.challenge = true;
    }
    if (type === 'grid') {
      const oldRows = q.rows || [];
      const rows = [];
      for (const l of lines(b.rows != null ? b.rows : '', 40)) {
        const [label, lo, hi, good] = l.split('|').map((x) => x.trim());
        if (!label) continue;
        const prev = oldRows.find((x) => x.label === label);
        const row = { key: prev ? prev.key : uniqueKey(label, [...oldRows.map((x) => x.key), ...rows.map((x) => x.key)], 'row'), label };
        if (lo) row.lo = lo; if (hi) row.hi = hi; if (/^good$/i.test(good || '')) row.good = true;
        rows.push(row);
      }
      if (!rows.length) { ctx.setFlash('Add at least one row.', 'err'); return ctx.redirect(here); }
      n.rows = rows;
      const own = lines(b.cols, 6);
      n.cols = b.colmode === 'tod' ? TOD.map((x) => [...x]) : b.colmode === 'custom' && own.length > 1 ? own.map((l, i) => [uniqueKey(l, [], `c${i}`), l]) : [['v', '']];
      n.lo = str(b.lo, 60) || 'Not at all'; n.hi = str(b.hi, 60) || 'Severe';
      if (b.rateAll) n.rateAll = true;
    }
    if (b.si_key && sec.fields.some((x) => x.key === b.si_key && x !== q)) n.showIf = { key: b.si_key, eq: str(b.si_eq, 100) || 'Yes' };
    sec.fields[Number(ctx.params.qi)] = n;
    save(p, def);
    ctx.setFlash('Saved to the draft.');
    ctx.redirect(here);
  }, O);

  // ---- Results: analyses, scores, priorities, alerts and messages
  function results(ctx, { p, def }) {
    const base = `/admin/programs/${p.id}`;
    const D = defs.compile(def);
    const res = { scores: true, alerts: [], messages: [], ...(def.results || {}) };
    const pri = { enabled: false, threshold: 3, max: 3, confirm: true, ...(res.priorities || {}) };
    const choiceQs = D.formList.flatMap((f) => F.questions(f).filter((q) => ['single', 'multi', 'yesno'].includes(q.field.type)).map((q) => ({ name: q.name, label: `${f.title} › ${q.field.label}` })));
    const allQs = D.formList.flatMap((f) => F.questions(f).map((q) => ({ value: `${f.key}|${q.name}`, label: `${f.short || f.title} › ${q.row ? `${q.field.label || q.section.title}: ${q.row.label}${q.col && q.col !== 'v' ? ` (${q.col})` : ''}` : q.field.label}` })));
    const ruleList = (kind, list) => html`${list.length ? html`<table class="list"><tbody>${list.map((x) => html`<tr><td><b>${x.name || '(no name)'}</b><small>When ${Rules.describe(D, x)}${x.email ? ' · emailed' : ''}</small>${x.text ? html`<small>“${x.text}”</small>` : ''}</td>
<td class="actions"><form method="post" action="${base}/rules/${kind}/${x.id}/delete">${csrfField(ctx)}<button class="link danger" data-confirm="Remove this rule?">Remove</button></form></td></tr>`)}</tbody></table>` : html`<p class="muted">None yet.</p>`}`;
    const ruleForm = (kind) => html`<details class="adjust"><summary>${icon('plus')} Add ${kind === 'alert' ? 'a coach alert' : 'a participant message'}</summary><form method="post" action="${base}/rules/${kind}" class="form-grid">${csrfField(ctx)}
<label class="fld span2"><span>Name</span><input name="name" required maxlength="80" placeholder="${kind === 'alert' ? 'e.g. Stress very high' : 'e.g. Sleep tip'}"></label>
<label class="fld"><span>When</span><select name="type"><option value="answer">An answer…</option><option value="score">A category’s daily score…</option></select></label>
<label class="fld"><span>Answer to</span><select name="question">${allQs.map((q) => html`<option value="${q.value}">${q.label}</option>`)}</select></label>
<label class="fld"><span>Category <em>for score rules</em></span>${areaSelect(def, 'area', '')}</label>
<label class="fld"><span>Is</span><span class="inline"><select name="op">${Object.entries(Rules.OPS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select><input name="value" maxlength="100" placeholder="e.g. 4 or Yes" class="short"></span></label>
<label class="fld"><span>For how many days in a row</span><input type="number" name="days" value="1" min="1" max="30" class="num"></label>
<label class="fld span2"><span>${kind === 'alert' ? 'Note for the coach' : 'Message they see on Today'}</span><textarea name="text" rows="2" maxlength="1000"></textarea></label>
<label class="fld"><span>Link <em>optional</em></span><input type="url" name="link" placeholder="https://…"></label>
<label class="check"><input type="checkbox" name="email" value="1"> Also email ${kind === 'alert' ? 'their coach' : 'them'} (at most every 3 days)</label>
<div class="span2"><button class="btn">Add</button></div></form></details>`;
    return html`<form method="post" action="${base}/analyses" class="panel">${csrfField(ctx)}<h3>${icon('chart')} Analyses <small>reports on a set stretch of days</small></h3>
<div class="table-wrap"><table class="list edit"><thead><tr><th>Name</th><th>Heading</th><th>Shows on day</th><th>Covers days</th><th>Compare with</th><th>Remove</th></tr></thead><tbody>
${[...D.analyses, {}].map((a, i) => html`<tr><td><input name="label[]" value="${a.label || ''}" maxlength="60" placeholder="${a.key ? '' : 'Add an analysis…'}"><input type="hidden" name="key[]" value="${a.key || ''}"></td><td><input name="title[]" value="${a.title || ''}" maxlength="80"></td>
<td><input type="number" name="day[]" value="${a.day || ''}" min="1" max="${def.days}" class="num"></td><td><span class="range"><input type="number" name="from[]" value="${a.from || ''}" min="1" max="${def.days}" class="num">–<input type="number" name="to[]" value="${a.to || ''}" min="1" max="${def.days}" class="num"></span></td>
<td><select name="compareTo[]"><option value="">—</option>${D.analyses.filter((x) => x.key !== a.key).map((x) => html`<option value="${x.key}"${sel(a.compareTo === x.key)}>${x.label}</option>`)}</select></td><td>${a.key ? html`<input type="checkbox" name="remove[]" value="${i}">` : ''}</td></tr>`)}</tbody></table></div>
<p class="hint">Each analysis scores every category from the daily ratings over its days, blended with any review form on the day it shows. “Compare with” adds a before-and-after.</p>
<label class="check"><input type="checkbox" name="scores" value="1"${chk(res.scores !== false)}> Show category scores and charts in reports (turn off for a program that only collects answers)</label>
<p><button class="btn">Save analyses</button></p></form>

<form method="post" action="${base}/priorities" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">${icon('target')} Priorities and content</h3>
<label class="check span2"><input type="checkbox" name="enabled" value="1"${chk(pri.enabled)}> Turn review ratings into priorities that pick each person’s content</label>
<label class="fld"><span>From the review on</span><select name="analysis">${D.analyses.map((a) => html`<option value="${a.key}"${sel(pri.analysis === a.key)}>${a.label} (day ${a.day})</option>`)}</select></label>
<label class="fld"><span>Ratings that count <em>this or higher</em></span><select name="threshold">${[1, 2, 3, 4, 5].map((n) => html`<option${sel(pri.threshold === n)}>${n}</option>`)}</select></label>
<label class="fld"><span>How many priorities</span><input type="number" name="max" value="${pri.max}" min="1" max="8" class="num"></label>
<label class="fld"><span>Content unlocks on day <em>blank = the day after the review</em></span><input type="number" name="unlockDay" value="${pri.unlockDay || ''}" min="1" max="${def.days}" class="num" placeholder="auto"></label>
<label class="fld"><span>Name of their content page</span><input name="contentLabel" value="${pri.contentLabel || 'Your plan'}" maxlength="40"></label>
<label class="fld"><span>Tie-breaker question <em>their own top picks</em></span><select name="statedQuestion"><option value="">None</option>${choiceQs.map((q) => html`<option value="${q.name}"${sel(pri.statedQuestion === q.name)}>${q.label}</option>`)}</select></label>
<label class="check span2"><input type="checkbox" name="confirm" value="1"${chk(pri.confirm !== false)}> Participants confirm or swap their priorities (otherwise the recommendation is used as is)</label>
<p class="hint span2">Priorities rank categories by their highest review rating, then how many were rated at the threshold or higher, then the tie-breaker. Content for each category and challenge is added under Content.</p>
<div class="span2"><button class="btn">Save priorities</button></div></form>

<div class="cols"><section class="panel"><h3>${icon('alert')} Coach alerts <small>on the participant’s page and the list</small></h3>${ruleList('alert', res.alerts)}${ruleForm('alert')}</section>
<section class="panel"><h3>${icon('notes')} Messages to the participant <small>on their Today screen</small></h3>${ruleList('message', res.messages)}${ruleForm('message')}</section></div>`;
  }
  const res = (def) => { def.results = { scores: true, alerts: [], messages: [], ...(def.results || {}) }; return def.results; };
  const toR = (ctx) => `/admin/programs/${ctx.params.id}?s=results`;
  r.post('/admin/programs/:id/analyses', (ctx) => change(ctx, toR(ctx), (def) => {
    const b = ctx.body; const rm = arr(b.remove).map(Number);
    const old = def.analyses || []; const out = [];
    arr(b.label).forEach((l, i) => {
      const label = str(l, 60); if (!label || rm.includes(i)) return;
      const prev = old.find((a) => a.key === arr(b.key)[i]);
      const day = int(arr(b.day)[i], 1, def.days, def.days);
      const from = int(arr(b.from)[i], 1, def.days, 1); const to = int(arr(b.to)[i], 1, def.days, day);
      out.push({ key: prev ? prev.key : uniqueKey(label, [...old.map((a) => a.key), ...out.map((a) => a.key)], 'a'), label, title: str(arr(b.title)[i], 80), day, from: Math.min(from, to), to: Math.max(from, to), ...(arr(b.compareTo)[i] ? { compareTo: arr(b.compareTo)[i] } : {}) });
    });
    for (const a of out) if (a.compareTo && !out.some((x) => x.key === a.compareTo)) delete a.compareTo;
    def.analyses = out.sort((a, c) => a.day - c.day);
    res(def).scores = !!b.scores;
  }), O);
  r.post('/admin/programs/:id/priorities', (ctx) => change(ctx, toR(ctx), (def) => {
    const b = ctx.body;
    res(def).priorities = { enabled: !!b.enabled, analysis: str(b.analysis, 40), threshold: int(b.threshold, 1, 5, 3), max: int(b.max, 1, 8, 3), confirm: !!b.confirm,
      statedQuestion: str(b.statedQuestion, 120), unlockDay: int(b.unlockDay, 1, def.days, null), contentLabel: str(b.contentLabel, 40) || 'Your plan' };
    if (b.enabled && !(def.analyses || []).length) return 'Add an analysis first: priorities come from the review on an analysis day.';
  }), O);
  r.post('/admin/programs/:id/rules/:kind', (ctx) => change(ctx, toR(ctx), (def) => {
    const b = ctx.body; const kind = ctx.params.kind === 'alert' ? 'alerts' : 'messages';
    let when;
    if (b.type === 'score') {
      if (!def.areas.some((a) => a.key === b.area)) return 'Pick a category.';
      when = { type: 'score', area: b.area };
    } else {
      const [form, question] = String(b.question || '').split('|');
      when = { type: 'answer', form, question };
    }
    when.op = Rules.OPS[b.op] ? b.op : '>='; when.value = str(b.value, 100); when.days = int(b.days, 1, 30, 1);
    if (when.op !== 'answered' && when.value === '') return 'Enter the value to compare with.';
    const link = str(b.link, 500);
    if (link && !/^https?:\/\/\S+$/.test(link)) return 'Links need to start with https://.';
    res(def)[kind].push({ id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: str(b.name, 80), when, text: str(b.text, 1000), ...(link ? { link } : {}), ...(b.email ? { email: true } : {}) });
  }), O);
  r.post('/admin/programs/:id/rules/:kind/:rid/delete', (ctx) => change(ctx, toR(ctx), (def) => {
    const kind = ctx.params.kind === 'alert' ? 'alerts' : 'messages';
    res(def)[kind] = res(def)[kind].filter((x) => x.id !== ctx.params.rid);
  }), O);

  // ---- Publish
  function publishTab(ctx, { p, def, latest, changed }) {
    const base = `/admin/programs/${p.id}`;
    const errs = defs.validate(def);
    const versions = db.all('SELECT v.*, u.name who, (SELECT COUNT(*) FROM enrollments e WHERE e.program_version_id=v.id) n FROM program_versions v LEFT JOIN users u ON u.id=v.published_by WHERE v.program_id=? ORDER BY v.version DESC', p.id);
    const older = latest ? onOlder(p.id, latest.id) : 0;
    const total = people(p.id);
    return html`<div class="cols"><div>
${errs.length ? html`<section class="panel"><h3>${icon('alert')} Fix these before publishing</h3><ul>${errs.map((e) => html`<li>${e}</li>`)}</ul></section>`
    : !changed ? html`<section class="panel"><h3>${icon('check')} Nothing new to publish</h3><p class="muted">The draft is the same as version ${latest.version}.</p></section>`
      : html`<form method="post" action="${base}/publish" class="panel">${csrfField(ctx)}<h3>Publish version ${latest ? latest.version + 1 : 1}</h3>
<label class="fld"><span>What changed <em>optional, for the version history</em></span><input name="note" maxlength="200"></label>
${latest ? html`<fieldset class="choice"><legend>Who gets this version?</legend>
<label class="check"><input type="radio" name="push" value=""${chk(true)}> <span><b>New people from now on.</b> Everyone already in it (${total}) keeps the version they started with.</span></label>
<label class="check"><input type="radio" name="push" value="1"> <span><b>Push to everyone already in it too</b> (${total} ${total === 1 ? 'person' : 'people'}). Answers they’ve saved are kept; questions you removed stop showing, new questions appear on days still to come.</span></label></fieldset>` : html`<p class="muted">Once published, coaches can choose it when inviting someone.</p>`}
<p><button class="btn primary">Publish</button></p></form>`}
<section class="panel"><h3>Try it yourself</h3><p class="muted">Makes a test participant on the latest published version, so you can go through it on the phone app. Test participants are left out of every count.</p>
<form method="post" action="/participants/test">${csrfField(ctx)}<input type="hidden" name="program_id" value="${p.id}"><button class="btn"${latest ? '' : raw(' disabled')}>${icon('phone')} Make a test participant</button></form></section>
${changed && latest ? html`<form method="post" action="${base}/discard" class="panel">${csrfField(ctx)}<h3>Discard draft changes</h3><p class="muted">Puts the draft back to version ${latest.version}.</p><button class="btn ghost danger" data-confirm="Throw away every change since version ${latest.version}?">Discard changes</button></form>` : ''}
</div><div>
<section class="panel"><h3>Versions</h3>${versions.length ? html`<table class="list"><tbody>${versions.map((v) => html`<tr><td><b>v${v.version}</b>${v.note ? html`<small>${v.note}</small>` : ''}</td><td>${dateTimeFmt(v.published_at, ctx.user.timezone)}${v.who ? html`<small>${v.who}</small>` : ''}</td><td>${v.n} ${v.n === 1 ? 'person' : 'people'}</td></tr>`)}</tbody></table>
${older ? html`<p class="hint">${older} ${older === 1 ? 'person is' : 'people are'} on an older version.</p>` : ''}` : html`<p class="muted">Not published yet.</p>`}</section>
<form method="post" action="${base}/active" class="panel">${csrfField(ctx)}<h3>${p.active ? 'Archive' : 'Bring back'}</h3><p class="muted">${p.active ? 'Archived programs can’t be picked for new invites. People already in it carry on.' : 'Make it available for new invites again.'}</p>
<button class="btn ghost"${p.builtin && p.active ? raw(' disabled title="The original program stays available"') : ''}>${p.active ? 'Archive' : 'Make available'}</button></form>
${!p.builtin && !total ? html`<form method="post" action="${base}/delete" class="panel danger">${csrfField(ctx)}<h3>Delete</h3><p class="muted">No one has done this program, so it can be deleted for good.</p><button class="btn danger" data-confirm="Delete ${def.name} permanently?">Delete program</button></form>` : ''}
</div></div>`;
  }
  r.post('/admin/programs/:id/publish', (ctx) => {
    const { p } = load(ctx.params.id);
    const push = !!ctx.body.push;
    const out = defs.publish(db, p.id, { by: ctx.user.id, note: str(ctx.body.note, 200), push });
    if (out.errors) { ctx.setFlash(out.errors[0], 'err'); return ctx.redirect(`/admin/programs/${p.id}?s=publish`); }
    audit.log(db, ctx.user, 'program', null, `published ${p.name} v${out.version}${push ? `, pushed to ${out.moved}` : ', new people only'}`);
    ctx.setFlash(`Version ${out.version} is live${push ? ` for new people and the ${out.moved} already in it` : ' for new people'}.`);
    ctx.redirect(`/admin/programs/${p.id}?s=publish`);
  }, O);
  r.post('/admin/programs/:id/discard', (ctx) => {
    const { p, latest } = load(ctx.params.id);
    if (latest) db.run('UPDATE programs SET draft=?, draft_updated_at=? WHERE id=?', latest.def, new Date().toISOString(), p.id);
    ctx.setFlash('Draft put back to the published version.');
    ctx.redirect(`/admin/programs/${p.id}?s=publish`);
  }, O);
  r.post('/admin/programs/:id/active', (ctx) => {
    const { p } = load(ctx.params.id);
    if (p.builtin && p.active) throw new HttpError(400, 'The original program stays available.');
    db.run('UPDATE programs SET active=? WHERE id=?', p.active ? 0 : 1, p.id);
    audit.log(db, ctx.user, 'program', null, `${p.active ? 'archived' : 'brought back'} ${p.name}`);
    ctx.redirect(`/admin/programs/${p.id}?s=publish`);
  }, O);
  r.post('/admin/programs/:id/delete', (ctx) => {
    const { p } = load(ctx.params.id);
    if (p.builtin || people(p.id)) throw new HttpError(400, 'Programs people have done can only be archived.');
    db.run('UPDATE products SET program_id=NULL, active=0 WHERE program_id=?', p.id);
    db.run('DELETE FROM videos WHERE program_id=?', p.id);
    db.run('DELETE FROM programs WHERE id=?', p.id);
    audit.log(db, ctx.user, 'program', null, `deleted ${p.name}`);
    ctx.setFlash(`${p.name} deleted.`);
    ctx.redirect('/admin/programs');
  }, O);

  // ---- Advanced: the whole definition as JSON
  function jsonTab(ctx, { p, def }) {
    return html`<form method="post" action="/admin/programs/${p.id}/json" class="panel">${csrfField(ctx)}<h3>The whole program as JSON</h3>
<p class="muted">For copying a program between sites or making many changes at once. The format is described at the top of lib/defs.js. Keys of questions people have answered shouldn’t be changed.</p>
<textarea name="json" rows="28" class="code" spellcheck="false">${JSON.stringify(def, null, 2)}</textarea>
<p><button class="btn primary">Save to the draft</button></p></form>`;
  }
  r.post('/admin/programs/:id/json', (ctx) => change(ctx, `/admin/programs/${ctx.params.id}?s=json`, (def) => {
    let d;
    try { d = JSON.parse(String(ctx.body.json || '')); } catch (e) { return `That isn’t valid JSON: ${e.message}`; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return 'The program must be a JSON object.';
    for (const k of Object.keys(def)) delete def[k];
    Object.assign(def, d);
    const errs = defs.validate(def);
    if (errs.length) return { warn: `Saved, but fix before publishing: ${errs.slice(0, 3).join(' ')}` };
  }), { ...O, maxBody: 2e6 });

  // ---- Preview: any form of the draft, as participants see it
  r.get('/admin/programs/:id/preview', (ctx) => {
    const s = load(ctx.params.id); const { p, def } = s;
    const D = defs.compile(def);
    const f = D.FORMS[ctx.query.form] || D.formList[0];
    const day = int(ctx.query.day, 1, D.PROGRAM_DAYS, f ? f.scheduled[0] || 1 : 1);
    const ph = D.phaseOf(day);
    const body = html`<div class="cols preview-cols"><section class="panel"><h3>Preview <small>the draft, read-only</small></h3>
<form class="inline"><select name="form" data-autosubmit>${D.formList.map((x) => html`<option value="${x.key}"${sel(f && x.key === f.key)}>${x.title}</option>`)}</select></form>
<p class="hint">Day ${day}: ${D.formsForDay(day).map((k) => D.FORMS[k].short || D.FORMS[k].title).join(', ') || 'no forms'}${ph.name ? html` · ${ph.name}` : ''}</p>
<div class="day-nav">${day > 1 ? html`<a class="btn small ghost" href="?form=${f.key}&day=${day - 1}">← Day ${day - 1}</a>` : html`<span></span>`}<b>Day ${day} of ${D.PROGRAM_DAYS}</b>${day < D.PROGRAM_DAYS ? html`<a class="btn small ghost" href="?form=${f.key}&day=${day + 1}">Day ${day + 1} →</a>` : html`<span></span>`}</div>
${ph.tip ? html`<p class="tip">${ph.tip}</p>` : ''}</section>
<div class="phone-frame"><div class="phone-screen">${f ? html`<h2>${f.title}</h2>${f.blurb ? html`<p class="muted">${f.blurb}</p>` : ''}${formBody(ctx, f, {}, '#', { readonly: true, D })}` : html`<p class="muted">No forms yet.</p>`}</div></div></div>`;
    ctx.html(page(ctx, s, `Preview · ${def.name}`, body, ''));
  }, O);
};
