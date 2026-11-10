'use strict';
// The Day 7 and Day 14 analysis pages (shared by the coach site and the phone app).
const { html } = require('./html');
const { icon, areaBars, levelClass } = require('./views');
const S = require('./scoring');
const F = require('./forms');
const P = require('./program');
const Pr = require('./priorities');

const dailyOf = (w) => Object.fromEntries(w.areas.map((a) => [a.key, a.daily]));

function build(db, enrollment) {
  const answers = P.allAnswers(db, enrollment.id);
  const w1 = S.analyzeWeek(answers, 1);
  const w2 = S.analyzeWeek(answers, 2);
  const pri = Pr.state(db, enrollment, answers, dailyOf(w1));       // Week 2 priorities from the Day 7 review
  const rank2 = Pr.rank(answers[14] || {}, dailyOf(w2));             // the Day 14 review, ranked the same way
  return { answers, w1, w2, pri, rank2, comparison: S.compare(w1, w2) };
}

const ratingCell = (v) => (v == null ? html`<td>–</td>` : html`<td><span class="dot d${v}">${v}</span></td>`);

/**
 * The ranking table from the spec: category, highest rating, questions rated 3-5, recommendation.
 * week 1 uses the priorities (recommended / confirmed); week 2 shows the Day 14 review next to Week 1.
 */
function priorityTable(r, week, { confirmLink } = {}) {
  const st = r.pri;
  const ranking = week === 1 ? st.ranking : r.rank2;
  if (!ranking.answered) return html`<p class="hint">The End of Week Review isn’t filled in yet. Ratings of 3–5 there decide the Week 2 priorities.</p>`;
  const w1 = Object.fromEntries(st.ranking.categories.map((c) => [c.key, c]));
  const rows = ranking.categories.map((c) => {
    const s = week === 1 ? Pr.status(st, c.key) : c.eligible ? { text: 'Eligible', cls: 'elig' } : { text: 'No intervention', cls: 'none' };
    return html`<tr class="${s.cls}"><th>${icon(c.icon)} ${c.label}${c.challenges.length ? html`<small>${c.challenges.map((x) => `${x.label} (${x.rating})`).join(' · ')}</small>` : ''}</th>
${week === 2 ? ratingCell(w1[c.key] && w1[c.key].highest) : ''}${ratingCell(c.highest)}<td>${c.count}</td><td><span class="status ${s.cls}">${s.text}</span></td></tr>`;
  });
  const n = ranking.eligibleKeys.length;
  return html`${!ranking.complete ? html`<p class="notice">${icon('alert')} ${ranking.answered} of ${ranking.total} review questions rated so far.</p>` : ''}
<div class="table-wrap"><table class="pritable"><thead><tr><th>Area</th>${week === 2 ? html`<th>Week 1 highest</th>` : ''}<th>${week === 2 ? 'Week 2 highest' : 'Highest rating'}</th><th>Rated 3–5</th><th>${week === 1 ? 'Recommendation' : 'Status'}</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="hint">A rating of 3, 4 or 5 makes a challenge eligible for support; 1 and 2 are recorded only. Areas are ranked by their highest rating, then by how many questions were rated 3–5.${week === 1 ? ` ${n === 0 ? 'Nothing was rated 3 or higher, so there are no Week 2 priorities.' : n < Pr.MAX ? `Only ${n} area${n === 1 ? '' : 's'} qualified, so only ${n === 1 ? 'that one is' : 'those are'} recommended.` : ''}` : ''}</p>
${week === 1 && confirmLink && ranking.complete && n ? html`<p><a class="btn ${st.isConfirmed ? 'ghost' : 'primary'}" href="${confirmLink}">${st.isConfirmed ? 'See your priorities' : 'Confirm your priorities'}</a></p>` : ''}
${week === 1 && st.isConfirmed ? html`<p class="hint">Confirmed${st.confirmedRole === 'participant' ? '' : st.confirmedRole === 'system' ? ' (test data)' : ' by the coach'}: <b>${st.confirmed.map((k) => F.AREA[k].label).join(', ') || 'none'}</b>.${st.swapped && st.swapped.in.length ? ` Swapped in ${st.swapped.in.map((k) => F.AREA[k].short).join(', ')} for ${st.swapped.out.map((k) => F.AREA[k].short).join(', ')}.` : ''}</p>` : ''}`;
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
  const lines = S.summary(w, who, week === 1 ? r.pri.ranking : r.rank2);
  return html`
<section class="card report-head"><p class="eyebrow">${week === 1 ? 'Day 7 analysis' : 'Day 14 analysis'}</p><h2>${week === 1 ? 'Where you are today' : 'How the two weeks compare'}</h2>
${!w.hasReview ? html`<p class="notice">${icon('alert')} The End of Week Review for Day ${week * 7} isn’t filled in yet, so this uses the daily answers only.</p>` : ''}
<ul class="summary">${lines.map((l) => html`<li>${l}</li>`)}</ul></section>

${week === 2 ? html`<section class="card"><h3>Week 1 → Week 2</h3>${compareBars(r.comparison)}</section>` : ''}

<section class="card"><h3>Challenge by area</h3>${areaBars(w.areas, { compareTo: week === 2 ? r.w1.areas : null })}
<div class="legend"><span class="l1">Not at all</span><span class="l2">Minor</span><span class="l3">Moderate</span><span class="l4">Significant</span><span class="l5">Severe</span>${week === 2 ? html`<span class="prev">Week 1</span>` : ''}</div></section>

<section class="card"><h3>${icon('target')} ${week === 1 ? 'Week 2 priorities' : 'Day 14 review'}</h3>${priorityTable(r, week, { confirmLink: coach ? null : '/m/priorities' })}</section>

${w.facts.strengths.length || w.facts.priorities.length ? html`<section class="card two"><div><h3>${icon('trophy')} Strengths</h3><p>${w.facts.strengths.join(', ') || '—'}</p></div><div><h3>${icon('target')} Priorities they named</h3><p>${w.facts.priorities.join(', ') || '—'}</p></div></section>` : ''}

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

module.exports = { build, weekReport, compareBars, priorityTable };
