'use strict';
// The analysis pages (shared by the coach site and the phone app), for any program and any analysis in it.
const { html } = require('./html');
const { icon, areaBars, levelClass } = require('./views');
const S = require('./scoring');
const P = require('./program');
const Pr = require('./priorities');
const defs = require('./defs');

const dailyOf = (w) => Object.fromEntries(w.areas.map((a) => [a.key, a.daily]));

/** Everything about one program run: each analysis, its review ranking, comparisons and the priorities. */
function build(db, enrollment) {
  const D = defs.forEnrollment(db, enrollment);
  const answers = P.allAnswers(db, enrollment.id);
  const list = D.analyses.map((a) => S.analyze(D, answers, a));
  const byKey = Object.fromEntries(list.map((w) => [w.key, w]));
  const ranks = Object.fromEntries(list.map((w) => [w.key, Pr.rank(D, answers[w.day] || {}, dailyOf(w))]));
  const priW = D.priAnalysis ? byKey[D.priAnalysis.key] : null;
  const pri = Pr.state(db, D, enrollment, answers, priW ? dailyOf(priW) : {});
  const comparisons = {};
  for (const a of D.analyses) if (a.compareTo && byKey[a.compareTo]) comparisons[a.key] = S.compare(D, byKey[a.compareTo], byKey[a.key]);
  return { D, answers, list, byKey, ranks, pri, comparisons, first: list[0] || null };
}

/** The analysis that's most current on a program day (the latest one whose stretch has started). */
function currentAnalysis(r, day) {
  let cur = r.list[0] || null;
  for (const w of r.list) if (day >= w.from) cur = w;
  return cur;
}

const ratingCell = (v) => (v == null ? html`<td>–</td>` : html`<td><span class="dot d${v}">${v}</span></td>`);
const f1 = (v) => (v == null ? '–' : Number(v).toFixed(1));

/**
 * The ranking table: category, highest rating, questions at or above the threshold, and either the
 * recommendation (for the analysis priorities come from) or eligible / no intervention.
 */
function priorityTable(r, key, { confirmLink } = {}) {
  const D = r.D; const st = r.pri;
  const isPri = D.priAnalysis && D.priAnalysis.key === key;
  const ranking = isPri ? st.ranking : r.ranks[key];
  const w = r.byKey[key];
  const t = ranking.threshold || 3;
  if (!ranking.total) return '';
  if (!ranking.answered) return html`<p class="hint">The review for day ${w.day} isn’t filled in yet.${isPri ? ` Ratings of ${t}–5 there decide the priorities.` : ''}</p>`;
  const prevKey = r.D.analyses.find((a) => a.key === key).compareTo;
  const prev = prevKey && r.ranks[prevKey] ? Object.fromEntries(r.ranks[prevKey].categories.map((c) => [c.key, c])) : null;
  const rows = ranking.categories.map((c) => {
    const s = isPri ? Pr.status(st, c.key) : c.eligible ? { text: 'Eligible', cls: 'elig' } : { text: 'No intervention', cls: 'none' };
    return html`<tr class="${s.cls}"><th>${icon(c.icon)} ${c.label}${c.challenges.length ? html`<small>${c.challenges.map((x) => `${x.label} (${x.rating})`).join(' · ')}</small>` : ''}</th>
${prev ? ratingCell(prev[c.key] && prev[c.key].highest) : ''}${ratingCell(c.highest)}<td>${c.count}</td><td><span class="status ${s.cls}">${s.text}</span></td></tr>`;
  });
  const n = ranking.eligibleKeys.length;
  const prevLabel = prevKey ? (r.byKey[prevKey] || {}).label : '';
  return html`${!ranking.complete ? html`<p class="notice">${icon('alert')} ${ranking.answered} of ${ranking.total} review questions rated so far.</p>` : ''}
<div class="table-wrap"><table class="pritable"><thead><tr><th>Area</th>${prev ? html`<th>${prevLabel || 'Before'}: highest</th>` : ''}<th>${prev ? 'Now: highest' : 'Highest rating'}</th><th>Rated ${t}–5</th><th>${isPri ? 'Recommendation' : 'Status'}</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="hint">A rating of ${t} or higher makes a challenge eligible for support; lower ratings are recorded only. Areas are ranked by their highest rating, then by how many questions were rated ${t}–5.${isPri ? ` ${n === 0 ? `Nothing was rated ${t} or higher, so there are no priorities.` : n < (ranking.max || 3) ? `Only ${n} area${n === 1 ? '' : 's'} qualified, so only ${n === 1 ? 'that one is' : 'those are'} recommended.` : ''}` : ''}</p>
${isPri && confirmLink && ranking.complete && n && st.confirmStep ? html`<p><a class="btn ${st.isConfirmed ? 'ghost' : 'primary'}" href="${confirmLink}">${st.isConfirmed ? 'See your priorities' : 'Confirm your priorities'}</a></p>` : ''}
${isPri && st.isConfirmed ? html`<p class="hint">Confirmed${st.confirmedRole === 'participant' ? '' : st.confirmedRole === 'system' ? ' (automatically)' : ' by the coach'}: <b>${st.confirmed.map((k) => (D.AREA[k] || { label: k }).label).join(', ') || 'none'}</b>.${st.swapped && st.swapped.in.length ? ` Swapped in ${st.swapped.in.map((k) => (D.AREA[k] || {}).short).join(', ')} for ${st.swapped.out.map((k) => (D.AREA[k] || {}).short).join(', ')}.` : ''}</p>` : ''}`;
}

const factRow = (label, value, cls = '') => html`<div class="fact ${cls}"><span>${label}</span><b>${value}</b></div>`;

function gridTable(g) {
  const cell = (v, good) => (v == null ? html`<td>–</td>` : html`<td class="${levelClass(good ? 6 - v : v)}">${v.toFixed(1)}</td>`);
  return html`<table class="mood"><thead><tr><th></th>${g.cols.map(([, l]) => html`<th>${l}</th>`)}</tr></thead><tbody>
${g.rows.map((r) => html`<tr><th>${r.label}</th>${r.vals.map((v) => cell(v, r.good))}</tr>`)}</tbody></table>`;
}

function areaTable(w) {
  return html`<table class="areas"><thead><tr><th>Area</th><th>Daily</th><th>Review</th><th>Score</th><th></th></tr></thead><tbody>
${w.areas.map((a) => html`<tr><th>${icon(a.icon)} ${a.label}</th><td>${f1(a.daily)}</td><td>${f1(a.review)}</td><td class="score ${levelClass(a.score)}">${f1(a.score)}</td><td>${a.level}</td></tr>`)}
</tbody></table>
<p class="hint">Score = the daily ratings and the review averaged together. 1 = not a challenge, 5 = severe.</p>`;
}

/**
 * The report for one analysis. who: 'You' on the phone, the participant's first name on the coach site.
 */
function analysisReport(r, key, { who = 'You', coach = false } = {}) {
  const w = r.byKey[key];
  if (!w) return html`<div class="empty"><p>That analysis isn’t part of this program.</p></div>`;
  if (!w.logged.length && !w.hasReview) return html`<div class="empty">${icon('chart')}<p>Nothing logged for days ${w.from}–${w.to} yet. The analysis builds as days are filled in.</p></div>`;
  const isPri = r.D.priAnalysis && r.D.priAnalysis.key === key;
  const ranking = isPri ? r.pri.ranking : r.ranks[key];
  const lines = S.summary(w, who, ranking.total ? ranking : null, ranking.threshold);
  const cmp = r.comparisons[key];
  const prev = cmp ? r.byKey[r.D.analyses.find((a) => a.key === key).compareTo] : null;
  const showScores = r.D.results.scores !== false;
  return html`
<section class="card report-head"><p class="eyebrow">${w.label}</p><h2>${w.title || w.label}</h2>
${ranking.total && !w.hasReview ? html`<p class="notice">${icon('alert')} The review for day ${w.day} isn’t filled in yet, so this uses the daily answers only.</p>` : ''}
<ul class="summary">${lines.map((l) => html`<li>${l}</li>`)}</ul></section>
${cmp && showScores ? html`<section class="card"><h3>${prev.label} → ${w.label}</h3>${compareBars(cmp)}</section>` : ''}
${showScores ? html`<section class="card"><h3>Challenge by area</h3>${areaBars(w.areas, { compareTo: prev ? prev.areas : null })}
<div class="legend"><span class="l1">Not at all</span><span class="l2">Minor</span><span class="l3">Moderate</span><span class="l4">Significant</span><span class="l5">Severe</span>${prev ? html`<span class="prev">${prev.label}</span>` : ''}</div></section>` : ''}
${ranking.total ? html`<section class="card"><h3>${icon('target')} ${isPri ? 'Priorities' : 'Review'}</h3>${priorityTable(r, key, { confirmLink: coach ? null : '/m/priorities' })}</section>` : ''}
${w.facts.review.length ? html`<section class="card"><h3>${icon('trophy')} From the review</h3>${w.facts.review.map((x) => factRow(x.label, x.value))}</section>` : ''}
${w.facts.grids.map((g) => html`<section class="card"><h3>${g.label}</h3>${gridTable(g)}<p class="hint">Averages, 1–5 as answered. Red means harder.</p></section>`)}
${w.facts.items.length ? html`<section class="card"><h3>These days in numbers</h3><div class="facts">${factRow('Days logged', `${w.facts.daysLogged} of ${w.length}`)}${w.facts.items.map((x) => factRow(x.label, x.value))}</div></section>` : ''}
${coach && showScores ? html`<section class="card"><h3>Score breakdown</h3>${areaTable(w)}</section>` : ''}
${coach && w.facts.notes.length ? html`<section class="card"><h3>Their notes</h3>${w.facts.notes.map((n) => html`<p class="note"><b>Day ${n.day}</b> ${n.text}</p>`)}</section>` : ''}`;
}

function compareBars(cmp) {
  return html`<div class="cmp">${cmp.map((a) => {
    const c = a.change;
    const cls = c == null ? 'none' : c < -0.2 ? 'better' : c > 0.2 ? 'worse' : 'same';
    return html`<div class="cmp-row"><span class="bar-label">${icon(a.icon)}${a.short}</span><span>${f1(a.before)}</span><span class="arrow">→</span><span>${f1(a.after)}</span><span class="chg ${cls}">${c == null ? '' : c < 0 ? `▼ ${Math.abs(c).toFixed(1)}` : c > 0 ? `▲ ${c.toFixed(1)}` : '• 0.0'}</span></div>`;
  })}</div><p class="hint">Lower is better: ▼ means the area became less of a challenge.</p>`;
}

module.exports = { build, currentAnalysis, analysisReport, compareBars, priorityTable };
