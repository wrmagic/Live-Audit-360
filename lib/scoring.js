'use strict';
// Turns a stretch of days (one analysis) into a score per category (1 = not a challenge … 5 = severe),
// the top categories, and a plain summary of the answers. Works for any program (D, from lib/defs.js).
//
// Each category's score blends two things equally:
//   daily  – that category's daily ratings (scale and grid questions, flipped where 5 is good, and single
//            choices with option scores), averaged per question then per day, over the days logged
//   review – the average of that category's rows on the review form(s) on the analysis day
// If only one of the two exists, that one is the score.

const LEVELS = [
  [1.5, 'Not at all'], [2.5, 'Minor'], [3.5, 'Moderate'], [4.5, 'Significant'], [Infinity, 'Severe'],
];
const level = (s) => (s == null ? '' : LEVELS.find(([max]) => s < max)[1]);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const mean = (xs) => { const v = xs.filter((x) => typeof x === 'number' && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const flip = (v) => (typeof v === 'number' ? 6 - v : null);

/** One day's challenge per category ({area: number|null}). dayAnswers: {form: answers}. */
function dailyAreas(D, dayAnswers = {}) {
  const per = {};
  for (const sc of D.scoring) {
    const a = dayAnswers[sc.form] || {};
    let v = null;
    if (sc.kind === 'scale') v = sc.good ? flip(a[sc.name]) : a[sc.name] ?? null;
    else if (sc.kind === 'grid') v = mean(sc.cells.map((c) => (c.good ? flip(a[c.name]) : a[c.name])));
    else if (sc.kind === 'single') v = sc.map[a[sc.name]] ?? null;
    (per[sc.area] = per[sc.area] || []).push(v);
  }
  return Object.fromEntries(D.AREAS.map((x) => [x.key, mean(per[x.key] || [])]));
}

/** The review's average per category on a day ({area: number|null}). */
function reviewAreas(D, dayAnswers = {}) {
  const out = {};
  for (const x of D.AREAS) {
    const vals = D.reviewQs.filter((q) => q.area === x.key).map((q) => (dayAnswers[q.form] || {})[q.key]);
    out[x.key] = mean(vals);
  }
  return out;
}

const count = (list) => {
  const m = new Map();
  for (const x of list) if (x) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const multiVals = (ans, name) => {
  const v = ans[name]; if (!Array.isArray(v)) return [];
  return v.map((x) => (x === 'Other' && ans[`${name}__other`] ? ans[`${name}__other`] : x));
};
function avgClock(times) {
  // Average clock times, treating times either side of midnight sensibly (measured from noon).
  const mins = times.filter(Boolean).map((t) => { const [h, m] = t.split(':').map(Number); let x = h * 60 + m - 720; if (x < 0) x += 1440; return x; });
  if (!mins.length) return null;
  let a = Math.round(mean(mins)) + 720; a %= 1440;
  return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function clock12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A readable summary of every daily question over the days logged, plus grids and notes. */
function summarize(D, answers, logged) {
  const items = []; const grids = []; const notes = [];
  for (const f of D.formList.filter((x) => x.kind === 'daily')) {
    for (const s of f.sections || []) {
      for (const fld of s.fields || []) {
        const name = `${s.key}.${fld.key}`;
        const per = logged.map((d) => ({ d, a: (answers[d] || {})[f.key] || {} }));
        if (fld.type === 'grid' && fld.cols.length > 1) {
          grids.push({ label: fld.label || s.title, cols: fld.cols, rows: fld.rows.map((r) => ({ label: r.label, good: !!r.good, vals: fld.cols.map(([c]) => round1(mean(per.map((x) => x.a[`${name}.${r.key}.${c}`])))) })) });
          continue;
        }
        if (fld.summary === false || fld.type === 'grid') continue;
        let value = null;
        if (fld.type === 'single') { const c = count(per.map((x) => (x.a[name] === 'Other' ? x.a[`${name}__other`] : x.a[name]))); if (c.length) value = `${c[0][0]} (${plural(c[0][1], 'day')})`; }
        else if (fld.type === 'multi') { const c = count(per.flatMap((x) => multiVals(x.a, name))).filter(([k]) => !/^None/.test(k)).slice(0, 3); if (c.length) value = c.map(([k, n]) => `${k} (${n})`).join(', '); }
        else if (fld.type === 'yesno') { const ans = per.filter((x) => x.a[name]); if (ans.length) value = `Yes on ${ans.filter((x) => x.a[name] === 'Yes').length} of ${plural(ans.length, 'day')}`; }
        else if (fld.type === 'scale') { const m = round1(mean(per.map((x) => x.a[name]))); if (m != null) value = `${m.toFixed(1)} of 5`; }
        else if (fld.type === 'time') { const c = avgClock(per.map((x) => x.a[name])); if (c) value = `around ${clock12(c)}`; }
        else if (fld.type === 'text') { for (const x of per) if (x.a[name]) notes.push({ day: x.d, label: fld.label, text: x.a[name] }); continue; }
        if (value) items.push({ label: fld.label, value, challenge: !!fld.challenge });
      }
    }
  }
  return { items, grids, notes };
}

/** The other answers on the review forms (choices like strengths and priorities), for the report. */
function reviewChoices(D, dayAnswers) {
  const out = [];
  for (const f of D.formList.filter((x) => x.kind === 'review')) {
    const a = dayAnswers[f.key] || {};
    for (const s of f.sections || []) for (const fld of s.fields || []) {
      if (fld.type === 'grid') continue;
      const name = `${s.key}.${fld.key}`;
      const v = fld.type === 'multi' ? multiVals(a, name).join(', ') : a[name] === 'Other' ? a[`${name}__other`] : a[name];
      if (v) out.push({ key: name, label: fld.label, value: String(v) });
    }
  }
  return out;
}

/** The analysis for one stretch of days. an: an analysis from the program ({from, to, day, …}). */
function analyze(D, answers, an) {
  const days = []; for (let d = an.from; d <= an.to; d++) days.push(d);
  const dailyKeys = D.formList.filter((f) => f.kind === 'daily').map((f) => f.key);
  const logged = days.filter((d) => answers[d] && dailyKeys.some((k) => answers[d][k] && Object.keys(answers[d][k]).length));
  const perDay = logged.map((d) => ({ day: d, areas: dailyAreas(D, answers[d]) }));
  const review = reviewAreas(D, answers[an.day] || {});
  const hasReview = Object.values(review).some((v) => v != null);
  const areas = D.AREAS.map((a) => {
    const daily = mean(perDay.map((p) => p.areas[a.key]));
    const rev = review[a.key];
    const score = mean([daily, rev]);
    return { ...a, daily: round1(daily), review: round1(rev), score: round1(score), level: level(score), trend: perDay.map((p) => ({ day: p.day, v: round1(p.areas[a.key]) })) };
  });
  const ranked = areas.filter((a) => a.score != null).sort((x, y) => y.score - x.score);
  const sum = summarize(D, answers, logged);
  return {
    key: an.key, label: an.label, title: an.title, day: an.day, from: an.from, to: an.to, week: an.index + 1, length: days.length,
    days, logged, perDay, areas, ranked, hasReview, top: ranked.slice(0, 3), strongest: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    facts: { daysLogged: logged.length, ...sum, review: reviewChoices(D, answers[an.day] || {}) },
  };
}

/** Later against earlier, per category. Negative change = less of a challenge = better. */
function compare(D, a, b) {
  return D.AREAS.map((x) => {
    const before = a.areas.find((z) => z.key === x.key).score;
    const after = b.areas.find((z) => z.key === x.key).score;
    return { ...x, before, after, change: before != null && after != null ? round1(after - before) : null };
  });
}

/** A few plain sentences. ranking: the priority ranking from this analysis's review, if any. */
function summary(w, name = 'You', ranking = null, threshold = 3) {
  const lines = [];
  if (!w.logged.length && !(ranking && ranking.answered)) return ['Nothing has been logged for these days yet.'];
  const you = name === 'You';
  if (ranking && ranking.complete) {
    const top = ranking.categories.filter((c) => c.eligible).slice(0, 3);
    lines.push(top.length
      ? `Rated ${threshold} or higher on the review: ${top.map((c) => `${c.label} (highest ${c.highest})`).join(', ')}${ranking.eligibleKeys.length > 3 ? `, and ${ranking.eligibleKeys.length - 3} more` : ''}.`
      : `Nothing on the review was rated ${threshold} or higher.`);
  } else if (w.top.length) {
    lines.push(`${you ? 'Your' : name + '’s'} biggest challenge${w.top.length > 1 ? 's' : ''}: ${w.top.map((a) => `${a.label} (${a.score}, ${a.level.toLowerCase()})`).join(', ')}.`);
  }
  if (w.strongest && w.strongest.score < (w.top[0] || {}).score) lines.push(`Strongest area: ${w.strongest.label} (${w.strongest.score}).`);
  for (const g of w.facts.grids) {
    // The time of day (or column) where the hardest row peaked, e.g. "Stress was highest in the evening"
    const r = g.rows.find((x) => !x.good && x.vals.some((v) => v != null));
    if (r && g.cols.length > 1) {
      let best = -1; let bi = 0; r.vals.forEach((v, i) => { if (v != null && v > best) { best = v; bi = i; } });
      lines.push(`${r.label.replace(/ level$/i, '')} was highest in the ${String(g.cols[bi][1]).toLowerCase()} (average ${best} of 5).`);
    }
  }
  if (w.logged.length < w.length) lines.push(`Based on ${w.logged.length} of ${w.length} days logged.`);
  return lines;
}

module.exports = { analyze, compare, summary, dailyAreas, reviewAreas, level, clock12, mean, round1 };
