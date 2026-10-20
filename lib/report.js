'use strict';
// The Day 7 and Day 14 analysis pages (shared by the coach site and the phone app).
const { html } = require('./html');
const { icon, areaBars, levelClass } = require('./views');
const S = require('./scoring');
const F = require('./forms');
const P = require('./program');

function build(db, enrollment) {
  const answers = P.allAnswers(db, enrollment.id);
  const w1 = S.analyzeWeek(answers, 1);
  const w2 = S.analyzeWeek(answers, 2);
  const focus = S.focusAreas(enrollment, w1);
  return { answers, w1, w2, focus, comparison: S.compare(w1, w2) };
}

const f1 = (v) => (v == null ? '–' : Number(v).toFixed(1));
const factRow = (label, value) => (value === null || value === undefined || value === '' ? '' : html`<div class="fact"><span>${label}</span><b>${value}</b></div>`);
const list = (pairs) => (pairs && pairs.length ? pairs.map(([k, n]) => `${k} (${n})`).join(', ') : '');

function facts(w) {
  const f = w.facts;
  return html`<div class="facts">
${factRow('Days logged', `${f.daysLogged} of 7`)}
${factRow('Typical sleep', f.sleepHours)}
${factRow('Average bedtime', f.bedtime ? S.clock12(f.bedtime) : '')}
${factRow('Average wake-up', f.waketime ? S.clock12(f.waketime) : '')}
${factRow('Sleep quality', f.sleepQuality != null ? `${f.sleepQuality} of 5` : '')}
${factRow('Afternoon crashes', f.daysLogged ? `${f.crashDays} day${f.crashDays === 1 ? '' : 's'}` : '')}
${factRow('Typical screen time', f.screenTime)}
${factRow('Typical social media', f.socialTime)}
${factRow('Phone hurt the day', f.daysLogged ? `${f.phoneNegativeDays} day${f.phoneNegativeDays === 1 ? '' : 's'}` : '')}
${factRow('Top platforms', list(f.platforms))}
${factRow('Exercise', f.exerciseAnswered ? `${f.exerciseDays} of ${f.exerciseAnswered} days` : '')}
${factRow('Typical steps', f.steps)}
${factRow('Water (8 oz glasses)', f.water)}
${factRow('Meals a day', f.meals)}
${factRow('Eating to watch', list(f.eating))}
${factRow('Consumed', list(f.consumed))}
${factRow('Habits noted', list(f.behaviors))}
${factRow('What affected sleep', list(f.sleepAffected))}
${factRow('Biggest daily challenge', list(f.biggest))}
${factRow('What went well', list(f.wentWell))}
${factRow('Satisfaction with the day', f.satisfied != null ? `${f.satisfied} of 5` : '')}
</div>`;
}

function moodTable(w) {
  const t = w.facts.byTime;
  if (!t.some((x) => x.stress != null || x.mood != null)) return '';
  const cell = (v, good) => (v == null ? html`<td>–</td>` : html`<td class="${levelClass(good ? 6 - v : v)}">${v.toFixed(1)}</td>`);
  return html`<table class="mood"><thead><tr><th></th><th>Morning</th><th>Midday</th><th>Evening</th></tr></thead><tbody>
<tr><th>Stress</th>${t.map((x) => cell(x.stress))}</tr>
<tr><th>Anxiety</th>${t.map((x) => cell(x.anxiety))}</tr>
<tr><th>Mood</th>${t.map((x) => cell(x.mood, true))}</tr>
<tr><th>Motivation</th>${t.map((x) => cell(x.motivation, true))}</tr>
<tr><th>Energy</th>${t.map((x) => cell(x.energy, true))}</tr></tbody></table>
<p class="hint">Averages for the week, 1–5 as answered. Red means harder (high stress, low mood).</p>`;
}

function areaTable(w) {
  return html`<table class="areas"><thead><tr><th>Area</th><th>Daily</th><th>Review</th><th>Score</th><th></th></tr></thead><tbody>
${w.areas.map((a) => html`<tr><th>${icon(a.icon)} ${a.label}</th><td>${f1(a.daily)}</td><td>${f1(a.review)}</td><td class="score ${levelClass(a.score)}">${f1(a.score)}</td><td>${a.level}</td></tr>`)}
</tbody></table>
<p class="hint">Score = the daily challenge ratings and the End of Week Review averaged together. 1 = not a challenge, 5 = severe. Work &amp; productivity’s daily part comes from “How satisfied were you with your day”.</p>`;
}

/**
 * The report for week 1 (Day 7) or week 2 (Day 14).
 * who: 'You' on the phone, the participant's first name on the coach site.
 */
function weekReport(r, week, { who = 'You', coach = false } = {}) {
  const w = week === 1 ? r.w1 : r.w2;
  if (!w.logged.length && !w.hasReview) return html`<div class="empty">${icon('chart')}<p>Nothing logged for Week ${week} yet. The analysis builds as days are filled in.</p></div>`;
  const lines = S.summary(w, who);
  return html`
<section class="card report-head"><p class="eyebrow">${week === 1 ? 'Day 7 analysis' : 'Day 14 analysis'}</p><h2>${week === 1 ? 'Where you are today' : 'How the two weeks compare'}</h2>
${!w.hasReview ? html`<p class="notice">${icon('alert')} The End of Week Review for Day ${week * 7} isn’t filled in yet, so this uses the daily answers only.</p>` : ''}
<ul class="summary">${lines.map((l) => html`<li>${l}</li>`)}</ul></section>

${week === 2 ? html`<section class="card"><h3>Week 1 → Week 2</h3>${compareBars(r.comparison)}</section>` : ''}

<section class="card"><h3>Challenge by area</h3>${areaBars(w.areas, { compareTo: week === 2 ? r.w1.areas : null })}
<div class="legend"><span class="l1">Not at all</span><span class="l2">Minor</span><span class="l3">Moderate</span><span class="l4">Significant</span><span class="l5">Severe</span>${week === 2 ? html`<span class="prev">Week 1</span>` : ''}</div></section>

${w.top.length ? html`<section class="card"><h3>${icon('target')} Top areas to work on</h3><ol class="top3">${w.top.map((a) => html`<li><span class="badge ${levelClass(a.score)}">${f1(a.score)}</span><b>${a.label}</b><small>${a.level}</small></li>`)}</ol>
${week === 1 ? html`<p class="hint">Focus areas for Days 8–14: <b>${r.focus.keys.map((k) => F.AREA[k].label).join(', ') || '—'}</b> ${r.focus.source === 'coach' ? '(chosen by your coach)' : r.focus.source === 'scores' ? '(from the scores)' : '(from the priorities picked on the review)'}.</p>` : ''}</section>` : ''}

${w.facts.strengths.length || w.facts.priorities.length ? html`<section class="card two"><div><h3>${icon('trophy')} Strengths</h3><p>${w.facts.strengths.join(', ') || '—'}</p></div><div><h3>${icon('target')} Priorities picked</h3><p>${w.facts.priorities.join(', ') || '—'}</p></div></section>` : ''}

<section class="card"><h3>Feelings through the day</h3>${moodTable(w) || html`<p class="hint">No check-ins yet.</p>`}</section>
<section class="card"><h3>The week in numbers</h3>${facts(w)}</section>
${coach ? html`<section class="card"><h3>Score breakdown</h3>${areaTable(w)}</section>` : ''}
${coach && w.facts.notes.length ? html`<section class="card"><h3>Their notes</h3>${w.facts.notes.map((n) => html`<p class="note"><b>Day ${n.day}</b> ${n.text}</p>`)}</section>` : ''}`;
}

function compareBars(cmp) {
  return html`<div class="cmp">${cmp.map((a) => {
    const c = a.change;
    const cls = c == null ? 'none' : c < -0.2 ? 'better' : c > 0.2 ? 'worse' : 'same';
    return html`<div class="cmp-row"><span class="bar-label">${icon(a.icon)}${a.short}</span><span>${f1(a.before)}</span><span class="arrow">→</span><span>${f1(a.after)}</span><span class="chg ${cls}">${c == null ? '' : c < 0 ? `▼ ${Math.abs(c).toFixed(1)}` : c > 0 ? `▲ ${c.toFixed(1)}` : '• 0.0'}</span></div>`;
  })}</div><p class="hint">Lower is better: ▼ means the area became less of a challenge.</p>`;
}

module.exports = { build, weekReport, compareBars };
