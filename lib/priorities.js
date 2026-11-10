'use strict';
// Week 2 priorities: the Hybrid Priority Recommendation System (developer spec, Oct 28 2026).
//
//  1. Every End-of-Week Review question is rated 1-5. Ratings of 3, 4 or 5 make that challenge ELIGIBLE;
//     1 and 2 are recorded but never trigger support.
//  2. Questions are grouped into the eight categories (life areas).
//  3. Eligible categories are ranked by their highest single rating, then by how many questions were
//     rated 3-5, then by the participant's stated priorities (the review's "top three priorities" question).
//     Any tie left after that goes to the higher daily challenge average, then the fixed category order.
//  4. The system recommends up to three. If only one or two categories qualify, only those: no third
//     problem is manufactured.
//  5. The participant confirms, or swaps a recommendation for another eligible category. The final choice
//     has no duplicates and no more than three. It stays the same for all of Days 8-14.
// The original recommendations are stored separately from the final choice, for later comparison.
const F = require('./forms');

const THRESHOLD = 3;
const MAX = 3;
const REVIEW_DAY = 7;
const LEVEL = { 1: 'Not at all', 2: 'Minor', 3: 'Moderate', 4: 'Significant', 5: 'Severe' };

/** Every rating question on the End of Week Review: [{key, area, label}] */
function reviewQuestions() {
  const out = [];
  for (const form of [F.FORMS.week1, F.FORMS.week2]) {
    for (const s of form.sections) {
      for (const f of s.fields) {
        if (f.type !== 'grid' || !f.rateAll) continue;
        for (const r of f.rows) out.push({ key: `${s.key}.${f.key}.${r.key}`, area: s.area, label: r.label });
      }
    }
  }
  return out;
}
const QUESTIONS = reviewQuestions();
const QUESTION = Object.fromEntries(QUESTIONS.map((q) => [q.key, q]));

/**
 * Rank the eight categories from one End of Week Review.
 * review: {week1: answers, week2: answers}; daily: {areaKey: daily challenge average} (last tie-breaker only)
 */
function rank(review = {}, daily = {}) {
  const ans = { ...(review.week1 || {}), ...(review.week2 || {}) };
  const items = QUESTIONS.map((q) => {
    const rating = typeof ans[q.key] === 'number' ? ans[q.key] : null;
    return { ...q, rating, eligible: rating != null && rating >= THRESHOLD };
  });
  const answered = items.filter((i) => i.rating != null).length;
  const byLabel = Object.fromEntries(F.AREAS.map((a) => [a.label, a.key]));
  const stated = (ans['wrapup.priorities'] || []).map((l) => byLabel[l]).filter(Boolean);

  const cats = F.AREAS.map((a, order) => {
    const mine = items.filter((i) => i.area === a.key);
    const rated = mine.filter((i) => i.rating != null);
    const highest = rated.length ? Math.max(...rated.map((i) => i.rating)) : null;
    const eligibleItems = mine.filter((i) => i.eligible).sort((x, y) => y.rating - x.rating);
    return {
      key: a.key, label: a.label, short: a.short, icon: a.icon, order,
      highest, count: eligibleItems.length, eligible: eligibleItems.length > 0,
      stated: stated.indexOf(a.key), daily: daily[a.key] ?? null,
      challenges: eligibleItems.map((i) => ({ key: i.key, label: i.label, rating: i.rating })),
    };
  });
  const cmp = (x, y) => (y.highest ?? 0) - (x.highest ?? 0)
    || y.count - x.count
    || (x.stated < 0 ? 99 : x.stated) - (y.stated < 0 ? 99 : y.stated)
    || (y.daily ?? 0) - (x.daily ?? 0)
    || x.order - y.order;
  const eligible = cats.filter((c) => c.eligible).sort(cmp);
  const other = cats.filter((c) => !c.eligible).sort(cmp);
  eligible.forEach((c, i) => { c.rank = i + 1; });
  return {
    complete: answered === QUESTIONS.length,
    answered, total: QUESTIONS.length,
    categories: [...eligible, ...other],
    eligibleKeys: eligible.map((c) => c.key),
    recommended: eligible.slice(0, MAX).map((c) => c.key),
    items: items.map(({ key, area, rating, eligible: e }) => ({ key, area, rating, eligible: e })),
  };
}

/** How many categories the participant confirms: three, or fewer when fewer qualify. */
const required = (ranking) => Math.min(MAX, ranking.eligibleKeys.length);

/** Check a selection against the rules. Returns {keys} or {error}. */
function validate(ranking, picked) {
  const list = (Array.isArray(picked) ? picked : picked ? [picked] : []).map(String);
  const keys = [...new Set(list)];
  if (keys.length !== list.length) return { error: 'Each area can only be picked once.' };
  if (keys.some((k) => !ranking.eligibleKeys.includes(k))) return { error: 'Only areas you rated 3 or higher can be picked.' };
  const n = required(ranking);
  if (keys.length > MAX) return { error: `Pick no more than ${MAX}.` };
  if (keys.length !== n) return { error: n === 1 ? 'Pick your 1 area.' : `Pick ${n} areas.` };
  return { keys };
}

/** The saved record for an enrollment (parsed), or null. */
function load(db, enrollmentId) {
  const r = db.get('SELECT * FROM priorities WHERE enrollment_id=?', enrollmentId);
  if (!r) return null;
  const j = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return { ...r, ranking: j(r.ranking), recommended: j(r.recommended) || [], confirmed: j(r.confirmed) };
}

/** Save the confirmed selection, keeping the ranking and recommendations as they were at that moment. */
function confirm(db, enrollmentId, ranking, keys, user) {
  const t = new Date().toISOString();
  const prev = load(db, enrollmentId);
  db.run(`INSERT INTO priorities (enrollment_id, ranking, recommended, recommended_at, confirmed, confirmed_at, confirmed_by, confirmed_role)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (enrollment_id) DO UPDATE SET ranking=excluded.ranking, recommended=excluded.recommended, recommended_at=excluded.recommended_at,
      confirmed=excluded.confirmed, confirmed_at=excluded.confirmed_at, confirmed_by=excluded.confirmed_by, confirmed_role=excluded.confirmed_role`,
  enrollmentId, JSON.stringify(ranking), JSON.stringify(ranking.recommended), (prev && prev.recommended_at) || t,
  JSON.stringify(keys), t, user ? user.id : null, user ? user.role : 'system');
}

/** Undo a confirmation (only allowed before Day 8; the review becomes editable again). */
function reopen(db, enrollmentId) { db.run('DELETE FROM priorities WHERE enrollment_id=?', enrollmentId); }

/**
 * Everything the screens need: the ranking (saved snapshot once confirmed, live before), what was
 * recommended, what was confirmed, and the challenges flagged in each confirmed category.
 */
function state(db, enrollment, answers, daily = {}) {
  const saved = load(db, enrollment.id);
  const live = rank(answers[REVIEW_DAY] || {}, daily);
  const confirmedKeys = saved && Array.isArray(saved.confirmed) ? saved.confirmed : null;
  const ranking = confirmedKeys && saved.ranking ? saved.ranking : live;
  const byKey = Object.fromEntries(ranking.categories.map((c) => [c.key, c]));
  const confirmed = confirmedKeys ? confirmedKeys.filter((k) => byKey[k]) : null;
  return {
    ranking,
    recommended: confirmedKeys ? saved.recommended : live.recommended,
    confirmed,
    isConfirmed: !!confirmedKeys,
    confirmedAt: saved ? saved.confirmed_at : null,
    confirmedRole: saved ? saved.confirmed_role : null,
    required: required(ranking),
    swapped: confirmed ? { out: saved.recommended.filter((k) => !confirmed.includes(k)), in: confirmed.filter((k) => !saved.recommended.includes(k)) } : null,
    // challenges rated 3-5 in each confirmed category: these pick the challenge-level content
    flagged: Object.fromEntries((confirmed || []).map((k) => [k, byKey[k].challenges.map((c) => c.key)])),
    byKey,
  };
}

/** Status line for a category, as in the spec's example table. */
function status(st, key) {
  const c = st.byKey[key];
  if (!c || !c.eligible) return { text: 'No intervention', cls: 'none' };
  if (st.confirmed) {
    const i = st.confirmed.indexOf(key);
    if (i >= 0) return { text: `Priority ${i + 1}${st.recommended.includes(key) ? '' : ' (swapped in)'}`, cls: 'pri' };
    if (st.recommended.includes(key)) return { text: 'Recommended, swapped out', cls: 'out' };
    return { text: 'Eligible, not selected', cls: 'elig' };
  }
  const r = st.recommended.indexOf(key);
  if (r >= 0) return { text: `Recommended · Priority ${r + 1}`, cls: 'pri' };
  return { text: 'Eligible, not selected', cls: 'elig' };
}

module.exports = { THRESHOLD, MAX, REVIEW_DAY, LEVEL, QUESTIONS, QUESTION, rank, required, validate, load, confirm, reopen, state, status };
