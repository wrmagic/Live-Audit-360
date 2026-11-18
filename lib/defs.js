'use strict';
// Programs. Each program has a draft (edited in Admin → Programs) and published versions. A person's program
// run (enrollment) points at one version; compile() turns that version's definition into everything the app
// needs: forms, schedule, phases, categories, scoring, analyses, priorities and results rules.
//
// Definition format (JSON):
//   name, description, days (length), photos {enabled, label, tip}
//   phases   [{from, to, name, tip, remember: [..]}]
//   areas    [{key, label, short, icon}]              the categories scores, priorities and content belong to
//   scale    {levels: [{n, label, desc}]}             the 1-5 meaning shown on review forms
//   forms    [{key, title, short, blurb, icon, kind: 'daily'|'review', legend, schedule: {from, to, days: []}, sections}]
//            sections: [{key, num, title, icon, area, intro, fields}]  (field types: see lib/forms.js)
//   analyses [{key, label, title, day, from, to, compareTo}]  a report on `day` covering days from-to
//   results  {scores, priorities: {enabled, analysis, threshold, max, confirm, statedQuestion, unlockDay, contentLabel},
//             alerts: [rule], messages: [rule]}  (rules: see lib/rules.js)
const F = require('./forms');

const ICONS = ['brain', 'shoe', 'dumbbell', 'fork', 'drop', 'phone', 'gear', 'bed', 'people', 'notes', 'trophy', 'briefcase', 'mountain', 'home', 'chart', 'target', 'cal', 'camera', 'user', 'video'];
const slug = (s, fallback = 'item') => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || fallback);

/** A brand-new, nearly empty program to start building from. */
function blank(name = 'New program') {
  return {
    name, description: '', days: 7, photos: { enabled: false, label: 'Photos', tip: '' },
    phases: [{ from: 1, to: 7, name: 'Week 1', tip: 'Fill in today’s check-in.' }],
    areas: [{ key: 'general', label: 'General', short: 'General', icon: 'target' }],
    scale: JSON.parse(JSON.stringify(F.BUILTIN.scale)),
    forms: [{ key: 'daily', title: 'Daily check-in', short: 'Check-in', blurb: 'A few questions about your day.', icon: 'notes', kind: 'daily', schedule: { from: 1, to: 7, days: [] },
      sections: [{ key: 'today', num: 1, title: 'Today', icon: 'notes', area: 'general', fields: [
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was today?', lo: 'Not a challenge', hi: 'Severe' }] }] }],
    analyses: [{ key: 'a1', label: 'Day 7 analysis', title: 'Your week', day: 7, from: 1, to: 7 }],
    results: { scores: true, priorities: { enabled: false, analysis: 'a1', threshold: 3, max: 3, confirm: true, statedQuestion: '', unlockDay: null, contentLabel: 'Your plan' }, alerts: [], messages: [] },
  };
}

/** Problems that stop a definition being published. Returns a list of plain-language messages. */
function validate(def) {
  const errs = [];
  const days = Number(def.days);
  if (!def.name || !String(def.name).trim()) errs.push('The program needs a name.');
  if (!Number.isInteger(days) || days < 1 || days > 365) errs.push('Length must be between 1 and 365 days.');
  const areas = Array.isArray(def.areas) ? def.areas : [];
  if (!areas.length) errs.push('Add at least one category.');
  const areaKeys = new Set();
  for (const a of areas) { if (areaKeys.has(a.key)) errs.push(`Two categories share the key “${a.key}”.`); areaKeys.add(a.key); }
  const forms = Array.isArray(def.forms) ? def.forms : [];
  if (!forms.length) errs.push('Add at least one form.');
  const formKeys = new Set();
  for (const f of forms) {
    if (formKeys.has(f.key)) errs.push(`Two forms share the key “${f.key}”.`);
    formKeys.add(f.key);
    if (!scheduledDays(f, days).length) errs.push(`“${f.title}” isn’t scheduled on any day.`);
    const names = new Set();
    for (const s of f.sections || []) {
      if (s.area && !areaKeys.has(s.area)) errs.push(`Section “${s.title}” uses a category that doesn’t exist.`);
      for (const fld of s.fields || []) {
        if (['single', 'multi'].includes(fld.type) && !(fld.options || []).length) errs.push(`“${fld.label}” needs answer choices.`);
        if (fld.type === 'grid' && !(fld.rows || []).length) errs.push(`“${fld.label || s.title}” needs at least one row.`);
        if (fld.area && !areaKeys.has(fld.area)) errs.push(`“${fld.label}” counts toward a category that doesn’t exist.`);
      }
      for (const q of F.questions({ sections: [s] })) { if (names.has(q.name)) errs.push(`Two questions in “${f.title}” share the key ${q.name}.`); names.add(q.name); }
    }
    if (!(f.sections || []).some((s) => (s.fields || []).length)) errs.push(`“${f.title}” has no questions.`);
  }
  for (const p of def.phases || []) if (!(p.from >= 1 && p.to <= days && p.from <= p.to)) errs.push(`Phase “${p.name}” must be within days 1–${days}.`);
  const an = def.analyses || [];
  for (const a of an) if (!(a.from >= 1 && a.to <= days && a.from <= a.to && a.day >= 1 && a.day <= days)) errs.push(`Analysis “${a.label}” must be within days 1–${days}.`);
  const pri = (def.results || {}).priorities || {};
  if (pri.enabled) {
    const a = an.find((x) => x.key === pri.analysis);
    if (!a) errs.push('Priorities need an analysis to come from.');
    else if (!forms.some((f) => f.kind === 'review' && scheduledDays(f, days).includes(a.day))) errs.push(`Priorities come from review ratings, but no review form is scheduled on day ${a.day}.`);
    if (!(pri.threshold >= 1 && pri.threshold <= 5)) errs.push('The priority threshold must be 1–5.');
    if (!(pri.max >= 1 && pri.max <= 8)) errs.push('Priorities: pick between 1 and 8.');
  }
  return errs;
}

function scheduledDays(f, days) {
  const sc = f.schedule || {};
  const out = new Set();
  if (sc.from && sc.to) for (let d = Math.max(1, sc.from); d <= Math.min(days, sc.to); d++) out.add(d);
  for (const d of sc.days || []) if (d >= 1 && d <= days) out.add(Number(d));
  return [...out].sort((a, b) => a - b);
}

/** Turn a definition into the object the app uses (same shape for every program). */
function compile(def, meta = {}) {
  const days = Number(def.days) || 1;
  const AREAS = def.areas || [];
  const AREA = Object.fromEntries(AREAS.map((a) => [a.key, a]));
  const formList = (def.forms || []).map((f) => ({ ...f, weekly: f.kind === 'review', legend: f.kind === 'review' && f.legend !== false, scheduled: scheduledDays(f, days) }));
  const FORMS = Object.fromEntries(formList.map((f) => [f.key, f]));
  const byDay = {};
  for (let d = 1; d <= days; d++) byDay[d] = formList.filter((f) => f.scheduled.includes(d)).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'daily' ? -1 : 1)).map((f) => f.key);
  const phases = (def.phases || []).map((p, i) => ({ ...p, index: i, week: i + 1 }));
  const analyses = (def.analyses || []).map((a, i) => ({ ...a, index: i }));
  const results = { scores: true, alerts: [], messages: [], ...(def.results || {}) };
  const pri = { enabled: false, threshold: 3, max: 3, confirm: true, ...(results.priorities || {}) };
  const priAnalysis = pri.enabled ? analyses.find((a) => a.key === pri.analysis) : null;
  // Content unlocks the day after the review it comes from (or that day, when it's the last day)
  if (!pri.unlockDay && priAnalysis) pri.unlockDay = Math.min(priAnalysis.day + 1, days);

  // What counts toward each category's daily score: ratings (scale, grid) and single choices with option scores
  const scoring = [];
  for (const f of formList.filter((x) => x.kind === 'daily')) {
    for (const s of f.sections || []) {
      for (const fld of s.fields || []) {
        const area = fld.area || s.area;
        if (!area || fld.noScore || !AREA[area]) continue;
        if (fld.type === 'scale') scoring.push({ form: f.key, area, kind: 'scale', name: `${s.key}.${fld.key}`, good: !!fld.good });
        else if (fld.type === 'grid' && !fld.rateAll) scoring.push({ form: f.key, area, kind: 'grid', cells: fld.rows.flatMap((r) => fld.cols.map(([c]) => ({ name: `${s.key}.${fld.key}.${r.key}${c === 'v' ? '' : '.' + c}`, good: !!r.good }))) });
        else if (fld.type === 'single' && fld.optionScores) scoring.push({ form: f.key, area, kind: 'single', name: `${s.key}.${fld.key}`, map: fld.optionScores });
      }
    }
  }
  // Review questions: every row of a "rate each" grid in a review form, by category
  const reviewQs = [];
  for (const f of formList.filter((x) => x.kind === 'review')) {
    for (const s of f.sections || []) for (const fld of s.fields || []) {
      if (fld.type !== 'grid' || !fld.rateAll) continue;
      const area = fld.area || s.area;
      if (!AREA[area]) continue;
      for (const r of fld.rows) reviewQs.push({ key: `${s.key}.${fld.key}.${r.key}`, area, label: r.label, form: f.key });
    }
  }

  const phaseOf = (day) => {
    const p = phases.find((x) => day >= x.from && day <= x.to) || phases[phases.length - 1] || { name: '', tip: '', index: 0, week: 1 };
    return p;
  };
  return {
    ...meta, def, name: def.name, description: def.description || '',
    PROGRAM_DAYS: days, AREAS, AREA, FORMS, formList, phases, analyses, results, priorities: pri, priAnalysis,
    photos: def.photos && def.photos.enabled ? def.photos : null,
    scale: (def.scale && def.scale.levels) || F.BUILTIN.scale.levels,
    scoring, reviewQs, REVIEW_DAYS: [...new Set(formList.filter((f) => f.kind === 'review').flatMap((f) => f.scheduled))],
    formsForDay: (day) => byDay[day] || [],
    phaseOf,
    analysisOn: (day) => analyses.filter((a) => a.day === day),
    questions: F.questions, progress: F.progress, parseAnswers: F.parseAnswers, visible: F.visible, isAnswered: F.isAnswered,
  };
}

// ---------------------------------------------------------------- Storage

function ensureTables(db) {
  db.raw.exec(`
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  draft TEXT NOT NULL,              -- the definition being edited
  draft_updated_at TEXT,
  active INTEGER NOT NULL DEFAULT 1, -- can be chosen for new invites
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS program_versions (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  def TEXT NOT NULL,
  note TEXT,
  published_by INTEGER,
  published_at TEXT NOT NULL,
  UNIQUE (program_id, version)
);`);
  const cols = (t) => db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('enrollments').includes('program_version_id')) db.raw.exec('ALTER TABLE enrollments ADD COLUMN program_version_id INTEGER REFERENCES program_versions(id)');
  if (!cols('products').includes('program_id')) db.raw.exec('ALTER TABLE products ADD COLUMN program_id INTEGER REFERENCES programs(id)');
  if (!cols('videos').includes('program_id')) db.raw.exec('ALTER TABLE videos ADD COLUMN program_id INTEGER REFERENCES programs(id)');
}

/** On start: make sure the built-in 14-day program exists, and attach anything from before programs existed to it. */
function ensureBuiltin(db) {
  ensureTables(db);
  let p = db.get('SELECT * FROM programs WHERE builtin=1');
  if (!p) {
    const t = new Date().toISOString();
    const id = db.insert('programs', { name: F.BUILTIN.name, draft: JSON.stringify(F.BUILTIN), draft_updated_at: t, builtin: 1, created_at: t });
    db.insert('program_versions', { program_id: id, version: 1, def: JSON.stringify(F.BUILTIN), note: 'The original 14-day program', published_at: t });
    p = db.get('SELECT * FROM programs WHERE id=?', id);
  }
  const v1 = db.get('SELECT id FROM program_versions WHERE program_id=? ORDER BY version LIMIT 1', p.id);
  db.run('UPDATE enrollments SET program_version_id=? WHERE program_version_id IS NULL', v1.id);
  db.run("UPDATE products SET program_id=? WHERE program_id IS NULL AND kind='program'", p.id);
  db.run('UPDATE videos SET program_id=? WHERE program_id IS NULL', p.id);
  require('./rules').ensureTable(db);
  return p;
}

const cache = new Map();
function forVersion(db, versionId) {
  if (cache.has(versionId)) return cache.get(versionId);
  const v = db.get('SELECT v.*, p.name pname FROM program_versions v JOIN programs p ON p.id=v.program_id WHERE v.id=?', versionId);
  if (!v) return null;
  const D = compile(JSON.parse(v.def), { versionId: v.id, programId: v.program_id, version: v.version });
  cache.set(versionId, D);
  return D;
}
/** The program a person is doing (their program run's version). */
function forEnrollment(db, e) {
  if (e && e.program_version_id) return forVersion(db, e.program_version_id);
  return forVersion(db, latestVersion(db, builtinId(db)).id);
}
const builtinId = (db) => db.get('SELECT id FROM programs WHERE builtin=1').id;
const latestVersion = (db, programId) => db.get('SELECT * FROM program_versions WHERE program_id=? ORDER BY version DESC LIMIT 1', programId);
const activePrograms = (db) => db.all('SELECT p.*, (SELECT MAX(version) FROM program_versions v WHERE v.program_id=p.id) version FROM programs p WHERE p.active=1 AND EXISTS (SELECT 1 FROM program_versions v WHERE v.program_id=p.id) ORDER BY p.builtin DESC, p.name');

/** Publish the draft as a new version. push: move everyone already in this program to it. */
function publish(db, programId, { by, note, push }) {
  const p = db.get('SELECT * FROM programs WHERE id=?', programId);
  const def = JSON.parse(p.draft);
  const errs = validate(def);
  if (errs.length) return { errors: errs };
  const last = latestVersion(db, programId);
  const version = last ? last.version + 1 : 1;
  const id = db.insert('program_versions', { program_id: programId, version, def: JSON.stringify(def), note: note || null, published_by: by || null, published_at: new Date().toISOString() });
  db.run('UPDATE programs SET name=? WHERE id=?', def.name, programId);
  let moved = 0;
  if (push) moved = db.run('UPDATE enrollments SET program_version_id=? WHERE program_version_id IN (SELECT id FROM program_versions WHERE program_id=?) AND program_version_id<>?', id, programId, id).changes;
  return { versionId: id, version, moved };
}

module.exports = { ICONS, slug, blank, validate, scheduledDays, compile, ensureTables, ensureBuiltin, forVersion, forEnrollment, builtinId, latestVersion, activePrograms, publish };
