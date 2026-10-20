'use strict';
// Turns a week of answers into a score per life area (1 = not a challenge … 5 = severe),
// the top areas to work on, and plain-language facts about the week.
//
// Each area's score blends two things equally:
//   daily  – the average of that area's daily "How much of a challenge" ratings (plus related 1-5 ratings,
//            flipped where 5 is good, e.g. sleep quality), over the days logged that week
//   review – the average of that area's rows on the End of Week Review
// If only one of the two exists, that one is the score.
const F = require('./forms');

const LEVELS = [
  [1.5, 'Not at all'], [2.5, 'Minor'], [3.5, 'Moderate'], [4.5, 'Significant'], [Infinity, 'Severe'],
];
const level = (s) => (s == null ? '' : LEVELS.find(([max]) => s < max)[1]);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const mean = (xs) => { const v = xs.filter((x) => typeof x === 'number' && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const flip = (v) => (typeof v === 'number' ? 6 - v : null);
const OVERALL = { 'Very difficult': 5, Difficult: 4, Neutral: 3, Good: 2, 'Very good': 1 };

/** One day's challenge per area from the two daily forms ({area: number|null}). */
function dailyAreas(p1 = {}, p2 = {}) {
  const grid = [];
  for (const c of ['morning', 'midday', 'evening']) {
    grid.push(p1[`checkin.feel.stress.${c}`], p1[`checkin.feel.anxiety.${c}`]);
    grid.push(flip(p1[`checkin.feel.mood.${c}`]), flip(p1[`checkin.feel.motivation.${c}`]), flip(p1[`checkin.feel.energy.${c}`]));
  }
  return {
    mental: mean([mean(grid), OVERALL[p1['checkin.overall']]]),
    physical: mean([p1['movement.challenge']]),
    nutrition: mean([p1['nutrition.challenge'], flip(p1['hydration.rating'])]),
    sleep: mean([p2['sleep.challenge'], flip(p2['sleep.quality']), flip(p2['sleep.rested'])]),
    phone: mean([p2['phone.challenge']]),
    work: mean([flip(p2['reflection.satisfied'])]),
    relationships: mean([p2['environment.challenge'], flip(p2['environment.interactions'])]),
    discipline: mean([p2['habits.challenge']]),
  };
}

/** The review's average per area ({area: number|null}). */
function reviewAreas(w1 = {}, w2 = {}) {
  const all = { ...w1, ...w2 };
  const out = {};
  for (const a of F.AREAS) {
    const vals = Object.entries(all).filter(([k, v]) => k.startsWith(`${a.key}.ratings.`) && typeof v === 'number').map(([, v]) => v);
    out[a.key] = mean(vals);
  }
  return out;
}

const weekDays = (week) => Array.from({ length: 7 }, (_, i) => (week - 1) * 7 + i + 1);
const reviewDay = (week) => week * 7;

const count = (list) => {
  const m = new Map();
  for (const x of list) if (x) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const mode = (list) => (count(list)[0] || [null])[0];
const multiVals = (ans, name) => {
  const v = ans[name]; if (!Array.isArray(v)) return [];
  return v.map((x) => (x === 'Other' && ans[`${name}__other`] ? ans[`${name}__other`] : x));
};
function avgClock(times) {
  // Average bed/wake times, treating times either side of midnight sensibly (measured from noon).
  const mins = times.filter(Boolean).map((t) => { const [h, m] = t.split(':').map(Number); let x = h * 60 + m - 720; if (x < 0) x += 1440; return x; });
  if (!mins.length) return null;
  let a = Math.round(mean(mins)) + 720; a %= 1440;
  return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * The analysis of one week. answers: {day: {form: answers}} for the whole enrollment.
 */
function analyzeWeek(answers, week) {
  const days = weekDays(week);
  const logged = days.filter((d) => answers[d] && (answers[d].day1 || answers[d].day2) && Object.keys({ ...(answers[d].day1 || {}), ...(answers[d].day2 || {}) }).length);
  const perDay = logged.map((d) => ({ day: d, areas: dailyAreas(answers[d].day1, answers[d].day2) }));
  const rd = answers[reviewDay(week)] || {};
  const review = reviewAreas(rd.week1, rd.week2);
  const hasReview = Object.values(review).some((v) => v != null);

  const areas = F.AREAS.map((a) => {
    const daily = mean(perDay.map((p) => p.areas[a.key]));
    const rev = review[a.key];
    const score = mean([daily, rev]);
    const trend = perDay.map((p) => ({ day: p.day, v: round1(p.areas[a.key]) }));
    return { ...a, daily: round1(daily), review: round1(rev), score: round1(score), level: level(score), trend };
  });
  const ranked = areas.filter((a) => a.score != null).sort((x, y) => y.score - x.score);

  // ---- facts about the week
  const p1s = logged.map((d) => answers[d].day1 || {});
  const p2s = logged.map((d) => answers[d].day2 || {});
  const facts = {};
  facts.daysLogged = logged.length;
  facts.byTime = ['morning', 'midday', 'evening'].map((c) => ({
    when: c,
    stress: round1(mean(p1s.map((a) => a[`checkin.feel.stress.${c}`]))),
    anxiety: round1(mean(p1s.map((a) => a[`checkin.feel.anxiety.${c}`]))),
    mood: round1(mean(p1s.map((a) => a[`checkin.feel.mood.${c}`]))),
    motivation: round1(mean(p1s.map((a) => a[`checkin.feel.motivation.${c}`]))),
    energy: round1(mean(p1s.map((a) => a[`checkin.feel.energy.${c}`]))),
  }));
  facts.exerciseDays = p1s.filter((a) => a['movement.exercised'] === 'Yes').length;
  facts.exerciseAnswered = p1s.filter((a) => a['movement.exercised']).length;
  facts.steps = mode(p1s.map((a) => a['movement.steps']));
  facts.exerciseTypes = count(p1s.flatMap((a) => multiVals(a, 'movement.exercise_types'))).slice(0, 3);
  facts.water = mode(p1s.map((a) => a['hydration.water']));
  facts.meals = mode(p1s.map((a) => a['nutrition.meals']));
  facts.eating = count(p1s.flatMap((a) => multiVals(a, 'nutrition.ate'))).filter(([k]) => ['Processed foods', 'Fast food / takeout', 'Sweets / dessert', 'Late-night eating', 'Emotional eating'].includes(k));
  facts.screenTime = mode(p2s.map((a) => a['phone.screen_time']));
  facts.socialTime = mode(p2s.map((a) => a['phone.social_time']));
  facts.platforms = count(p2s.flatMap((a) => multiVals(a, 'phone.platforms'))).slice(0, 3);
  facts.phoneNegativeDays = p2s.filter((a) => a['phone.negative'] === 'Yes').length;
  facts.sleepHours = mode(p2s.map((a) => a['sleep.hours']));
  facts.bedtime = avgClock(p2s.map((a) => a['sleep.bedtime']));
  facts.waketime = avgClock(p2s.map((a) => a['sleep.waketime']));
  facts.sleepQuality = round1(mean(p2s.map((a) => a['sleep.quality'])));
  facts.crashDays = p2s.filter((a) => a['sleep.crash'] === 'Yes').length;
  facts.sleepAffected = count(p2s.flatMap((a) => multiVals(a, 'sleep.affected'))).filter(([k]) => k !== 'Nothing in particular').slice(0, 3);
  facts.consumed = count(p2s.flatMap((a) => multiVals(a, 'habits.consumed'))).filter(([k]) => k !== 'None of the above').slice(0, 4);
  facts.behaviors = count(p2s.flatMap((a) => multiVals(a, 'habits.behaviors'))).slice(0, 4);
  facts.biggest = count(p2s.map((a) => (a['reflection.biggest'] === 'Other' ? a['reflection.biggest__other'] : a['reflection.biggest']))).slice(0, 3);
  facts.wentWell = count(p2s.flatMap((a) => multiVals(a, 'reflection.went_well'))).slice(0, 3);
  facts.satisfied = round1(mean(p2s.map((a) => a['reflection.satisfied'])));
  facts.notes = logged.map((d) => ({ day: d, text: (answers[d].day2 || {})['reflection.notes'] })).filter((n) => n.text);
  const w2 = rd.week2 || {};
  facts.strengths = multiVals(w2, 'wrapup.strengths');
  facts.priorities = (w2['wrapup.priorities'] || []).map((p) => (p === 'Other' ? (w2['wrapup.priorities__other'] || 'Other') : p));

  return { week, days, logged, perDay, areas, ranked, hasReview, facts, top: ranked.slice(0, 3), strongest: ranked.length > 1 ? ranked[ranked.length - 1] : null };
}

/** Focus areas for Days 8-14: the coach's choice, else the participant's priorities, filled up with the top-scored areas. */
function focusAreas(enrollment, week1) {
  let coach = null;
  try { coach = enrollment && enrollment.focus_areas ? JSON.parse(enrollment.focus_areas) : null; } catch { coach = null; }
  if (Array.isArray(coach) && coach.length) return { keys: coach.filter((k) => F.AREA[k]), source: 'coach' };
  const byLabel = Object.fromEntries(F.AREAS.map((a) => [a.label, a.key]));
  const keys = [];
  for (const p of week1.facts.priorities) if (byLabel[p] && !keys.includes(byLabel[p])) keys.push(byLabel[p]);
  const fromParticipant = keys.length;
  for (const a of week1.ranked) { if (keys.length >= 3) break; if (!keys.includes(a.key)) keys.push(a.key); }
  return { keys: keys.slice(0, 3), source: fromParticipant ? (fromParticipant >= 3 ? 'participant' : 'mixed') : 'scores' };
}

/** Week 2 against Week 1, per area. Negative change = less of a challenge = better. */
function compare(w1, w2) {
  return F.AREAS.map((a) => {
    const x = w1.areas.find((z) => z.key === a.key).score;
    const y = w2.areas.find((z) => z.key === a.key).score;
    return { ...a, before: x, after: y, change: x != null && y != null ? round1(y - x) : null };
  });
}

/** A few plain sentences summing up a week. */
function summary(w, name = 'You') {
  const lines = [];
  if (!w.logged.length) return ['No days have been logged for this week yet.'];
  const you = name === 'You';
  if (w.top.length) {
    lines.push(`${you ? 'Your' : name + '’s'} biggest challenge${w.top.length > 1 ? 's' : ''} this week: ${w.top.map((a) => `${a.label} (${a.score}, ${a.level.toLowerCase()})`).join(', ')}.`);
  }
  if (w.strongest && w.strongest.score < (w.top[0] || {}).score) lines.push(`Strongest area: ${w.strongest.label} (${w.strongest.score}).`);
  const f = w.facts;
  const bits = [];
  if (f.sleepHours) bits.push(`usually ${f.sleepHours} of sleep${f.bedtime ? `, in bed around ${clock12(f.bedtime)}` : ''}`);
  if (f.screenTime) bits.push(`${f.screenTime} of screen time on a typical day`);
  if (f.exerciseAnswered) bits.push(`exercise on ${f.exerciseDays} of ${f.exerciseAnswered} days`);
  if (f.water) bits.push(`${f.water} glasses of water`);
  if (bits.length) lines.push(`Typical day: ${bits.join('; ')}.`);
  const st = f.byTime.filter((t) => t.stress != null);
  if (st.length > 1) {
    const hi = st.reduce((a, b) => (b.stress > a.stress ? b : a));
    lines.push(`Stress was highest in the ${hi.when} (average ${hi.stress} of 5).`);
  }
  if (f.biggest.length) lines.push(`Most common daily challenge: ${f.biggest[0][0]} (${f.biggest[0][1]} day${f.biggest[0][1] > 1 ? 's' : ''}).`);
  if (w.logged.length < 7) lines.push(`Based on ${w.logged.length} of 7 days logged.`);
  return lines;
}

function clock12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

module.exports = { analyzeWeek, focusAreas, compare, summary, dailyAreas, reviewAreas, level, weekDays, reviewDay, clock12 };
