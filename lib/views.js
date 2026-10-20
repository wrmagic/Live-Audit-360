'use strict';
// Page frames (coach desktop and participant phone), icons, and drawing the forms.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, raw } = require('./html');
const F = require('./forms');

// Cache-busting for static files (served with a long cache time)
const ver = (f) => { try { return crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', 'public', f))).digest('hex').slice(0, 8); } catch { return '0'; } };
const CSS = `/static/app.css?v=${ver('app.css')}`;
const JS = `/static/app.js?v=${ver('app.js')}`;
const FONTS = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap';

const ICONS = {
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1Z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/><path d="M12 9h-2M12 14h2M7 11h2M15 11h2"/>',
  shoe: '<path d="M3 16v-3l4-6 3 2 2 3 6 1a3 3 0 0 1 3 3v1H3Z"/><path d="M3 18h18"/><path d="M9 12l1-1M11 14l1-1"/>',
  dumbbell: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
  fork: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 3c-2 2-2 6 0 8v10"/>',
  drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11Z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  bed: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19a6 6 0 0 1 12 0M15 14.5a5 5 0 0 1 6 4.5"/>',
  notes: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
  mountain: '<path d="M2 20 9 8l4 6 2-3 7 9H2Z"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Z"/><circle cx="12" cy="13" r="3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
};
const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`);

const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

function head(title, { manifest = false } = {}) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} · ` : ''}Life Audit 360</title>
<link rel="icon" href="/static/favicon.png"><link rel="apple-touch-icon" href="/static/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${CSS}">
${manifest ? html`<link rel="manifest" href="/manifest.webmanifest">` : ''}<meta name="theme-color" content="#15111b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Life Audit 360">
</head>`;
}

const flashBox = (ctx) => (ctx.flash ? html`<p class="flash ${ctx.flash.kind}" role="status">${ctx.flash.msg}</p>` : '');

/** Coach / head coach desktop frame. */
function layout(ctx, { title, body, nav = '' }) {
  const u = ctx.user;
  const items = [
    ['/participants', 'Participants', 'people', 'people'],
    ['/videos', 'Videos', 'video', 'videos'],
    ...(u.role === 'head' ? [['/coaches', 'Coaches', 'user', 'coaches']] : []),
  ];
  return html`${head(title)}<body class="coach">
<header class="topbar"><a class="brand" href="/participants"><span class="brand-word">LIFE AUDIT</span><span class="brand-num">360</span></a>
<nav>${items.map(([href, label, ic, key]) => html`<a href="${href}" class="${nav === key ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`)}</nav>
<div class="who"><span>${u.name}<small>${u.role === 'head' ? 'Head coach' : 'Coach'}</small></span><form method="post" action="/logout">${csrfField(ctx)}<button class="link" title="Sign out">${icon('logout')}</button></form></div></header>
<main class="page">${flashBox(ctx)}${body}</main>
<script src="${JS}" defer></script></body></html>`;
}

/** Participant phone frame: top bar, content, bottom tabs. */
function phone(ctx, { title, back, body, tab = '', hero = false }) {
  const tabs = [['/m', 'Today', 'home', 'today'], ['/m/progress', 'Progress', 'chart', 'progress'], ['/m/videos', 'Videos', 'play', 'videos'], ['/m/me', 'Me', 'user', 'me']];
  return html`${head(title, { manifest: true })}<body class="phone${hero ? ' has-hero' : ''}">
${hero ? '' : html`<header class="pbar">${back ? html`<a class="pback" href="${back}" aria-label="Back">${icon('back')}</a>` : html`<span class="pmark">LA<b>360</b></span>`}<h1>${title}</h1><span class="psave" data-savestate></span></header>`}
<main class="pmain">${flashBox(ctx)}${body}</main>
<nav class="ptabs">${tabs.map(([href, label, ic, key]) => html`<a href="${href}" class="${tab === key ? 'on' : ''}">${icon(ic)}<span>${label}</span></a>`)}</nav>
<script src="${JS}" defer></script></body></html>`;
}

/** Simple centered card page (sign in, set password). */
function bare(title, body) {
  return html`${head(title, { manifest: true })}<body class="bare"><main class="auth">
<div class="auth-hero"><div><p class="eyebrow">Life Audit 360</p><h1>Real habits.<br>Real awareness.<br><span>A stronger tomorrow.</span></h1></div></div>
<div class="auth-card">${body}</div></main><script src="${JS}" defer></script></body></html>`;
}

// ---------------------------------------------------------------- Drawing a form to fill in

const opt = (type, name, value, checked, label, extra = '') => html`<label class="chip"><input type="${type}" name="${name}" value="${value}"${checked ? raw(' checked') : ''}${raw(extra)}><span>${label}</span></label>`;

function scaleInput(name, value, lo, hi, cls = '') {
  return html`<div class="scale ${cls}" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => html`<label><input type="radio" name="${name}" value="${n}"${value === n ? raw(' checked') : ''}><span>${n}</span></label>`)}</div>
${lo || hi ? html`<div class="scale-ends"><span>1 = ${lo}</span><span>5 = ${hi}</span></div>` : ''}`;
}

function fieldInput(section, f, answers) {
  const name = `${section.key}.${f.key}`;
  const v = answers[name];
  const showIf = f.showIf ? raw(` data-showif="${section.key}.${f.showIf.key}" data-eq="${f.showIf.eq}"`) : '';
  const other = f.other ? html`<input class="other" type="text" name="${name}__other" value="${answers[name + '__other'] || ''}" placeholder="Other: write it here" maxlength="200" data-otherfor="${name}">` : '';
  let control;
  if (f.type === 'single') control = html`<div class="chips">${[...f.options, ...(f.other ? ['Other'] : [])].map((o) => opt('radio', name, o, v === o, o))}</div>${other}`;
  else if (f.type === 'multi') {
    const set = new Set(v || []);
    control = html`<div class="chips"${f.max ? raw(` data-max="${f.max}"`) : ''}>${[...f.options, ...(f.other ? ['Other'] : [])].map((o) => opt('checkbox', name + '[]', o, set.has(o), o, /^None/.test(o) ? ' data-none="1"' : ''))}</div>${other}`;
  } else if (f.type === 'yesno') control = html`<div class="chips yn">${['Yes', 'No'].map((o) => opt('radio', name, o, v === o, o))}</div>`;
  else if (f.type === 'scale') control = scaleInput(name, v, f.lo, f.hi, f.challenge ? 'challenge' : '');
  else if (f.type === 'time') control = html`<input type="time" name="${name}" value="${v || ''}" class="time">`;
  else if (f.type === 'text') control = html`<textarea name="${name}" rows="3" maxlength="4000">${v || ''}</textarea>`;
  else if (f.type === 'grid') return gridInput(section, f, answers);
  const hint = f.type === 'multi' ? (f.max ? `Pick up to ${f.max}` : 'Check all that apply') : '';
  return html`<fieldset class="q ${f.challenge ? 'is-challenge' : ''}"${showIf}><legend>${f.label}${hint ? html` <em>${hint}</em>` : ''}</legend>${control}</fieldset>`;
}

function gridInput(section, f, answers) {
  const base = `${section.key}.${f.key}`;
  if (f.cols.length === 1) {
    // End of Week Review: one 1-5 rating per row
    return html`<div class="rate-list">${f.rows.map((r) => {
      const n = `${base}.${r.key}`;
      return html`<div class="rate-row"><span class="rate-label">${r.label}</span>${scaleInput(n, answers[n], '', '', 'mini')}</div>`;
    })}</div>`;
  }
  // Daily check-in: tabs for morning / midday / evening, 1-5 per row
  return html`<div class="tod" data-tod><div class="tod-tabs" role="tablist">${f.cols.map(([c, label]) => {
    const filled = f.rows.filter((r) => answers[`${base}.${r.key}.${c}`]).length;
    return html`<button type="button" role="tab" data-tab="${c}">${label}<small data-count="${c}">${filled}/${f.rows.length}</small></button>`;
  })}</div>
${f.cols.map(([c, label]) => html`<div class="tod-pane" data-pane="${c}"><p class="tod-title">${label}</p>${f.rows.map((r) => {
    const n = `${base}.${r.key}.${c}`;
    return html`<div class="grid-row"><div class="grid-label"><b>${r.label}</b><small>1 = ${r.lo} · 5 = ${r.hi}</small></div>${scaleInput(n, answers[n], '', '', 'mini')}</div>`;
  })}</div>`)}</div>`;
}

function sectionHead(s) {
  return html`<div class="sec-head"><span class="sec-icon">${icon(s.icon)}</span><h2>${s.num ? html`<span>${s.num}.</span> ` : ''}${s.title}</h2></div>`;
}

/** The whole form as a phone page body (posted to `action`). */
function formBody(ctx, form, answers, action, { readonly = false } = {}) {
  return html`<form method="post" action="${action}" class="audit-form" data-autosave="${readonly ? '' : action}">${csrfField(ctx)}
${form.sections.map((s) => html`<section class="sec" id="s-${s.key}">${sectionHead(s)}${s.intro ? html`<p class="sec-intro">${s.intro}</p>` : ''}${s.fields.map((f) => fieldInput(s, f, answers))}</section>`)}
<div class="savebar"><button class="btn primary wide">Save</button></div></form>`;
}

// ---------------------------------------------------------------- Showing answers (coach view)

function answerText(f, answers, name) {
  const v = answers[name];
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
  const o = answers[name + '__other'];
  if (Array.isArray(v)) return v.map((x) => (x === 'Other' && o ? `Other: ${o}` : x)).join(', ');
  if (v === 'Other' && o) return `Other: ${o}`;
  if (f.type === 'time') return require('./html').time12(v);
  return String(v);
}

function scoreDot(v) { return v ? html`<span class="dot d${v}">${v}</span>` : html`<span class="dot none">–</span>`; }

function answersView(form, answers) {
  return html`${form.sections.map((s) => html`<section class="ans-sec"><h3>${icon(s.icon)} ${s.num ? `${s.num}. ` : ''}${s.title}</h3>
${s.fields.map((f) => {
    if (f.type === 'grid') {
      const base = `${s.key}.${f.key}`;
      if (f.cols.length === 1) return html`<table class="ans-grid"><tbody>${f.rows.map((r) => html`<tr><th>${r.label}</th><td>${scoreDot(answers[`${base}.${r.key}`])}</td></tr>`)}</tbody></table>`;
      return html`<table class="ans-grid"><thead><tr><th></th>${f.cols.map(([, l]) => html`<th>${l}</th>`)}</tr></thead><tbody>${f.rows.map((r) => html`<tr><th>${r.label}<small>5 = ${r.hi.toLowerCase()}</small></th>${f.cols.map(([c]) => html`<td>${scoreDot(answers[`${base}.${r.key}.${c}`])}</td>`)}</tr>`)}</tbody></table>`;
    }
    const name = `${s.key}.${f.key}`;
    if (f.showIf && answers[`${s.key}.${f.showIf.key}`] !== f.showIf.eq) return '';
    const t = answerText(f, answers, name);
    return html`<div class="ans ${f.challenge ? 'is-challenge' : ''}"><span class="ans-q">${f.label}</span><span class="ans-a">${f.type === 'scale' ? html`${scoreDot(answers[name])}<small>${f.lo} → ${f.hi}</small>` : t || html`<i>—</i>`}</span></div>`;
  })}</section>`)}`;
}

// ---------------------------------------------------------------- Small pieces

const levelClass = (s) => (s == null ? 'none' : `l${Math.min(5, Math.max(1, Math.round(s)))}`);

/** Horizontal bars, one per area: score of 5. */
function areaBars(areas, { compareTo } = {}) {
  return html`<div class="bars">${areas.map((a) => {
    const prev = compareTo ? compareTo.find((x) => x.key === a.key) : null;
    return html`<div class="bar-row"><span class="bar-label">${icon(a.icon)}${a.short}</span>
<span class="bar-track">${prev && prev.score != null ? html`<span class="bar-prev" style="width:${(prev.score / 5) * 100}%"></span>` : ''}<span class="bar-fill ${levelClass(a.score)}" style="width:${a.score ? (a.score / 5) * 100 : 0}%"></span></span>
<span class="bar-val">${a.score != null ? a.score.toFixed(1) : '–'}</span></div>`;
  })}</div>`;
}

/** 14 little squares showing each day's status. */
function dayStrip(map, pos, { link } = {}) {
  const P = require('./program');
  return html`<ol class="strip">${Array.from({ length: F.PROGRAM_DAYS }, (_, i) => {
    const d = i + 1;
    const st = pos && d <= pos.open ? P.dayStatus(map, d) : 'future';
    const cls = `${st}${pos && d === pos.day ? ' today' : ''}${d === 8 ? ' wk2' : ''}`;
    const inner = html`<span>${d}</span>`;
    return html`<li class="${cls}" title="Day ${d}">${link && st !== 'future' ? html`<a href="${link(d)}">${inner}</a>` : inner}</li>`;
  })}</ol>`;
}

module.exports = { CSS, JS, icon, csrfField, layout, phone, bare, head, formBody, answersView, areaBars, dayStrip, scoreDot, levelClass, sectionHead };
