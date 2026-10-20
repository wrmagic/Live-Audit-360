'use strict';
// The Life Audit 360 forms, written out as data. The app draws the screens, saves the answers and
// scores them from this file, so wording changes and new questions only need an edit here.
//
// Field types
//   single  pick one          multi   pick any (max: limit)     yesno   Yes / No
//   scale   1-5 buttons       grid    1-5 per row and per column (morning / midday / evening)
//   time    clock time        text    free text
// Options
//   other: true      adds "Other" with a box to write in
//   showIf: {key, eq} only shown when another answer matches (e.g. "If yes, how?")
//   challenge: true  the section's "How much of a challenge…" rating (1 = not a challenge, 5 = severe)
//   good: true       a 1-5 rating where 5 is GOOD (sleep quality, hydration…); scoring flips it to a challenge

// The eight life areas, as on the End of Week Review. Every score, report and video belongs to one.
const AREAS = [
  { key: 'mental', label: 'Mental health & emotions', short: 'Mental', icon: 'brain' },
  { key: 'physical', label: 'Physical health & fitness', short: 'Fitness', icon: 'dumbbell' },
  { key: 'nutrition', label: 'Nutrition & hydration', short: 'Nutrition', icon: 'fork' },
  { key: 'sleep', label: 'Sleep & recovery', short: 'Sleep', icon: 'bed' },
  { key: 'phone', label: 'Phone & social media', short: 'Phone', icon: 'phone' },
  { key: 'work', label: 'Work, time & productivity', short: 'Productivity', icon: 'briefcase' },
  { key: 'relationships', label: 'Relationships & environment', short: 'Relationships', icon: 'people' },
  { key: 'discipline', label: 'Discipline & habits', short: 'Discipline', icon: 'mountain' },
];
const AREA = Object.fromEntries(AREAS.map((a) => [a.key, a]));

const CHALLENGE = { lo: 'Not a challenge', hi: 'Severe' };

// ---------------------------------------------------------------- Day forms (Days 1-7)

const DAY_PART1 = {
  key: 'day1',
  title: 'Daily Audit · Part 1',
  short: 'Part 1',
  blurb: 'Check-in, movement, nutrition and hydration.',
  sections: [
    {
      key: 'checkin', num: 1, title: 'Daily Check-In', icon: 'brain', area: 'mental',
      intro: 'How are you feeling today? Fill in each time of day as you go.',
      fields: [
        {
          key: 'feel', type: 'grid', label: 'How are you feeling?',
          cols: [['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening']],
          rows: [
            { key: 'stress', label: 'Stress level', lo: 'Completely calm', hi: 'Extremely stressed' },
            { key: 'anxiety', label: 'Anxiety level', lo: 'Not anxious at all', hi: 'Extremely anxious' },
            { key: 'mood', label: 'Mood', lo: 'Very negative', hi: 'Very positive', good: true },
            { key: 'motivation', label: 'Motivation', lo: 'No motivation', hi: 'Extremely motivated', good: true },
            { key: 'energy', label: 'Energy level', lo: 'No energy', hi: 'Extremely high energy', good: true },
          ],
        },
        { key: 'overall', type: 'single', label: 'Overall, how would you describe your day so far?', options: ['Very difficult', 'Difficult', 'Neutral', 'Good', 'Very good'] },
      ],
    },
    {
      key: 'movement', num: 2, title: 'Activity & Movement', icon: 'shoe', area: 'physical',
      fields: [
        { key: 'steps', type: 'single', label: 'Total steps today', options: ['0 – 2,500', '2,501 – 5,000', '5,001 – 7,500', '7,501 – 10,000', '10,001 – 15,000', '15,000+'] },
        { key: 'exercised', type: 'yesno', label: 'Did you exercise today?' },
        { key: 'exercise_types', type: 'multi', label: 'What did you do?', showIf: { key: 'exercised', eq: 'Yes' }, other: true, options: ['Walking', 'Running', 'Strength training', 'Home workout', 'Sports', 'Yoga / Stretching', 'Active job (manual work)'] },
        { key: 'exercise_minutes', type: 'single', label: 'How long did you exercise?', options: ['0 min (rest day)', '1 – 15 min', '16 – 30 min', '31 – 45 min', '46 – 60 min', '60+ min'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was it to get movement in today?', ...CHALLENGE },
      ],
    },
    {
      key: 'nutrition', num: 3, title: 'Nutrition & Eating', icon: 'fork', area: 'nutrition',
      fields: [
        { key: 'ate', type: 'multi', label: 'What did you eat and drink today?', options: ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Fruits', 'Vegetables', 'Whole grains', 'Lean protein', 'Processed foods', 'Fast food / takeout', 'Sweets / dessert', 'Late-night eating', 'Emotional eating', 'Mindful eating (not rushed)', 'None of the above'] },
        { key: 'meals', type: 'single', label: 'How many meals did you have today?', options: ['1', '2', '3', '4', '5+'] },
        { key: 'portions', type: 'single', label: 'Did you stay within your normal portion sizes?', options: ['Yes', 'No', 'N/A'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was your nutrition today?', ...CHALLENGE },
      ],
    },
    {
      key: 'hydration', num: 4, title: 'Hydration & Drinks', icon: 'drop', area: 'nutrition',
      fields: [
        { key: 'water', type: 'single', label: 'How many 8 oz glasses of water today?', options: ['0', '1 – 2', '3 – 4', '5 – 6', '7 – 8', '9+'] },
        { key: 'drinks', type: 'multi', label: 'Other drinks today', other: true, options: ['Coffee', 'Tea', 'Energy drinks', 'Soda', 'Juice', 'Alcohol', 'Protein shake', 'Electrolyte drink', 'None of the above'] },
        { key: 'rating', type: 'scale', good: true, label: 'How would you rate your hydration today?', lo: 'Very low', hi: 'Excellent' },
      ],
    },
  ],
};

const DAY_PART2 = {
  key: 'day2',
  title: 'Daily Audit · Part 2',
  short: 'Part 2',
  blurb: 'Phone, habits, sleep, environment and your daily reflection.',
  sections: [
    {
      key: 'phone', num: 5, title: 'Phone & Social Media', icon: 'phone', area: 'phone',
      fields: [
        { key: 'screen_time', type: 'single', label: 'Total phone screen time today', options: ['< 1 hr', '1 – 2 hrs', '2 – 4 hrs', '4 – 6 hrs', '6 – 8 hrs', '8+ hrs'] },
        { key: 'social_time', type: 'single', label: 'Time on social media today', options: ['< 1 hr', '1 – 2 hrs', '2 – 4 hrs', '4 – 6 hrs', '6 – 8 hrs', '8+ hrs'] },
        { key: 'platforms', type: 'multi', label: 'Which platforms did you use?', other: true, options: ['Instagram', 'YouTube', 'TikTok', 'Facebook', 'X (Twitter)', 'Snapchat', 'Reddit'] },
        { key: 'reason', type: 'single', label: 'Main reason for your phone use today', other: true, options: ['Work / business', 'Social media', 'News / information', 'Entertainment', 'Communication (calls / texts)', 'Shopping', 'Boredom'] },
        { key: 'negative', type: 'yesno', label: 'Did phone or social media negatively impact your day?' },
        { key: 'negative_how', type: 'multi', label: 'If yes, how?', showIf: { key: 'negative', eq: 'Yes' }, other: true, options: ['Wasted time', 'Increased anxiety', 'Lower mood', 'Procrastination', 'Distracted from goals', 'Affected sleep'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was phone / social media today?', ...CHALLENGE },
      ],
    },
    {
      key: 'habits', num: 6, title: 'Habits & Behaviors', icon: 'gear', area: 'discipline',
      fields: [
        { key: 'consumed', type: 'multi', label: 'Did you consume any of the following today?', options: ['Alcohol', 'Caffeine', 'Nicotine', 'Cannabis', 'Sugary foods', 'Energy drinks', 'Late-night eating', 'Supplements', 'None of the above'] },
        { key: 'behaviors', type: 'multi', label: 'Any other habits or behaviors?', other: true, options: ['Overeating', 'Skipping meals', 'Unhealthy snacking', 'Emotional eating', 'Impulsive spending', 'Excessive screen time', 'Not sticking to plan', 'Stress eating', 'Smoking / vaping'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge were your habits and behaviors today?', ...CHALLENGE },
      ],
    },
    {
      key: 'sleep', num: 7, title: 'Sleep & Energy', icon: 'bed', area: 'sleep',
      fields: [
        { key: 'bedtime', type: 'time', label: 'What time did you go to bed?' },
        { key: 'waketime', type: 'time', label: 'What time did you wake up?' },
        { key: 'hours', type: 'single', label: 'Total hours of sleep', options: ['< 4 hrs', '4 – 5 hrs', '6 – 7 hrs', '8 – 9 hrs', '9+ hrs'] },
        { key: 'quality', type: 'scale', good: true, label: 'How would you rate your sleep quality?', lo: 'Very poor', hi: 'Excellent' },
        { key: 'rested', type: 'scale', good: true, label: 'How rested did you feel when you woke up?', lo: 'Not at all rested', hi: 'Fully rested' },
        { key: 'crash', type: 'yesno', label: 'Did you have an afternoon crash?' },
        { key: 'affected', type: 'multi', label: 'What affected your sleep?', other: true, options: ['Stress / anxiety', 'Screen time', 'Late eating', 'Caffeine', 'Environment (noise, light)', 'Nothing in particular', 'Travel'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was your sleep today?', ...CHALLENGE },
      ],
    },
    {
      key: 'environment', num: 8, title: 'Environment & Social', icon: 'people', area: 'relationships',
      fields: [
        { key: 'with', type: 'multi', label: 'Who did you spend the most time with today?', other: true, options: ['Family', 'Friends', 'Partner', 'Colleagues', 'Alone'] },
        { key: 'interactions', type: 'scale', good: true, label: 'How were your social interactions overall?', lo: 'Very negative', hi: 'Very positive' },
        { key: 'supportive', type: 'yesno', label: 'Did your environment support your goals today?' },
        { key: 'negative', type: 'yesno', label: 'Did you have any negative influences today?' },
        { key: 'negative_what', type: 'multi', label: 'If yes, what?', showIf: { key: 'negative', eq: 'Yes' }, other: true, options: ['People', 'Social media', 'Work situation', 'Stressful events', 'Environment'] },
        { key: 'challenge', type: 'scale', challenge: true, label: 'How much of a challenge was your environment or social situations today?', ...CHALLENGE },
      ],
    },
    {
      key: 'reflection', num: 9, title: 'Daily Reflection', icon: 'notes', area: null,
      fields: [
        { key: 'went_well', type: 'multi', label: 'What went well today?', other: true, options: ['Stayed consistent', 'Ate well', 'Got movement in', 'Managed stress', 'Was productive', 'Stayed hydrated', 'Spent time with loved ones', 'Learned something new'] },
        { key: 'biggest', type: 'single', label: 'What was the biggest challenge today?', other: true, options: ['Time management', 'Motivation', 'Stress / anxiety', 'Food choices', 'Phone / distractions', 'Lack of sleep', 'Negative mood', 'Procrastination', 'Didn’t exercise'] },
        { key: 'satisfied', type: 'scale', good: true, label: 'How satisfied were you with the way you spent your day?', lo: 'Not at all satisfied', hi: 'Extremely satisfied' },
        { key: 'notes', type: 'text', label: 'Notes / final thoughts (optional)', optional: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------- End of Week Review (Day 7 and Day 14)

const rows = (list) => list.map(([key, label]) => ({ key, label }));
const WEEK_SECTION = (num, area, items) => ({
  key: area, num, title: AREA[area].label, icon: AREA[area].icon, area,
  intro: 'How much of a challenge was this for you in the last 7 days?',
  fields: [{ key: 'ratings', type: 'grid', rateAll: true, cols: [['v', '']], rows: rows(items), lo: 'Not at all', hi: 'Severe' }],
});

const WEEK_PART1 = {
  key: 'week1',
  title: 'End of Week Review · Part 1',
  short: 'Review Part 1',
  blurb: 'Rate each area based on your last 7 days.',
  weekly: true,
  sections: [
    WEEK_SECTION(1, 'mental', [['stress', 'Stress levels'], ['anxiety', 'Anxiety'], ['mood', 'Mood / emotional stability'], ['overthinking', 'Overthinking'], ['self_doubt', 'Self-doubt / negative mindset'], ['motivation', 'Motivation'], ['overwhelmed', 'Feeling overwhelmed']]),
    WEEK_SECTION(2, 'physical', [['energy', 'Energy levels'], ['exercise', 'Lack of exercise / movement'], ['weight', 'Weight / body composition'], ['health', 'Overall physical health'], ['routine', 'Consistency with routine']]),
    WEEK_SECTION(3, 'nutrition', [['unhealthy', 'Unhealthy food choices'], ['overeating', 'Overeating / portion control'], ['emotional', 'Emotional eating'], ['consistency', 'Consistency with healthy eating'], ['water', 'Water / hydration'], ['alcohol', 'Alcohol consumption'], ['caffeine', 'Caffeine / energy drinks']]),
    WEEK_SECTION(4, 'sleep', [['hours', 'Getting enough sleep (hours)'], ['quality', 'Sleep quality'], ['inconsistent', 'Inconsistent bed/wake times'], ['rested', 'Feeling rested upon waking'], ['crashes', 'Afternoon energy crashes']]),
  ],
};

const WEEK_PART2 = {
  key: 'week2',
  title: 'End of Week Review · Part 2',
  short: 'Review Part 2',
  blurb: 'The rest of the areas, your strengths and your top three priorities.',
  weekly: true,
  sections: [
    WEEK_SECTION(5, 'phone', [['phone_time', 'Time spent on phone'], ['social_time', 'Time spent on social media'], ['scrolling', 'Mindless scrolling'], ['distractions', 'Distractions / losing focus'], ['comparing', 'Comparing myself to others'], ['mood', 'It negatively affected my mood'], ['productivity', 'It impacted my productivity']]),
    WEEK_SECTION(6, 'work', [['time', 'Managing my time'], ['procrastination', 'Procrastination'], ['focus', 'Staying focused'], ['tasks', 'Completing important tasks'], ['demands', 'Work / business demands'], ['productive', 'Feeling productive'], ['balance', 'Finding balance (work + personal)']]),
    WEEK_SECTION(7, 'relationships', [['family', 'Quality time with family'], ['relationships', 'Relationships (partner/friends)'], ['communication', 'Communication'], ['supported', 'Feeling supported'], ['negativity', 'Negativity / toxic influences'], ['social', 'Social life balance'], ['home', 'Home / living environment']]),
    WEEK_SECTION(8, 'discipline', [['habits', 'Consistency with daily habits'], ['goals', 'Following through on goals'], ['disciplined', 'Staying disciplined'], ['environment', 'Managing my environment'], ['mindset', 'Keeping a positive mindset'], ['self', 'Overall self-discipline']]),
    {
      key: 'wrapup', num: null, title: 'Your Strengths & Priorities', icon: 'trophy', area: null,
      fields: [
        { key: 'strengths', type: 'multi', label: 'Your strengths: which areas did you do well in this past week?', other: true, options: ['Managed stress well', 'Stayed consistent with exercise', 'Made good food choices', 'Stayed hydrated', 'Got quality sleep', 'Maintained a positive mindset', 'Was productive', 'Maintained healthy relationships', 'Handled challenges well', 'Stayed disciplined', 'Kept a consistent routine'] },
        { key: 'priorities', type: 'multi', max: 3, label: 'Your top three priorities: which areas do you want to focus on for the next 7 days?', other: true, options: AREAS.map((a) => a.label) },
      ],
    },
  ],
};

const FORMS = { day1: DAY_PART1, day2: DAY_PART2, week1: WEEK_PART1, week2: WEEK_PART2 };

// ---------------------------------------------------------------- The 14-day program

const PROGRAM_DAYS = 14;
const REVIEW_DAYS = [7, 14];

// Which forms are filled in on each program day.
// Days 8-14 use the same daily forms for now; when the Days 8-14 forms are ready, add them above
// (e.g. DAY8_PART1 with key 'day8a') and list them here.
function formsForDay(day) {
  const list = day <= 7 ? ['day1', 'day2'] : ['day1', 'day2'];
  if (REVIEW_DAYS.includes(day)) list.push('week1', 'week2');
  return list;
}

function phaseOf(day) {
  if (day <= 7) return { week: 1, name: 'Week 1 · Document, don’t change', tip: 'This isn’t a challenge and it isn’t about being perfect. Just observe and record your real day as honestly as possible.' };
  return { week: 2, name: 'Week 2 · Make the change', tip: 'Watch today’s videos and put one small change into practice in your focus areas. Keep logging your day the same way.' };
}

// ---------------------------------------------------------------- Helpers for every form

/** Every answerable question on a form, flattened: [{section, field, row?, col?, name}] */
function questions(form) {
  const out = [];
  for (const s of form.sections) {
    for (const f of s.fields) {
      if (f.type === 'grid') {
        for (const r of f.rows) for (const [c] of f.cols) out.push({ section: s, field: f, row: r, col: c, name: `${s.key}.${f.key}.${r.key}${c === 'v' ? '' : '.' + c}` });
      } else out.push({ section: s, field: f, name: `${s.key}.${f.key}` });
    }
  }
  return out;
}

const get = (answers, name) => (answers ? answers[name] : undefined);
const isAnswered = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

/** Is a question showing, given the answers so far (showIf)? */
function visible(q, answers) {
  const si = q.field.showIf;
  if (!si) return true;
  return get(answers, `${q.section.key}.${si.key}`) === si.eq;
}

/** Answered / total, counting only questions that are showing and not optional. */
function progress(form, answers) {
  let total = 0; let answered = 0;
  for (const q of questions(form)) {
    if (q.field.optional || !visible(q, answers)) continue;
    total++;
    if (isAnswered(get(answers, q.name))) answered++;
  }
  return { answered, total };
}

/** Turn a posted form into clean answers, keeping only known questions and allowed values. */
function parseAnswers(form, body) {
  const out = {};
  for (const q of questions(form)) {
    const f = q.field; const n = q.name;
    let v = body[n];
    if (f.type === 'multi') {
      const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
      const allowed = new Set([...f.options, ...(f.other ? ['Other'] : [])]);
      let clean = [...new Set(list.filter((x) => allowed.has(x)))];
      if (f.max) clean = clean.slice(0, f.max);
      if (clean.length) out[n] = clean;
    } else if (f.type === 'single') {
      if (Array.isArray(v)) v = v[0];
      if (v && (f.options.includes(v) || (f.other && v === 'Other'))) out[n] = v;
    } else if (f.type === 'yesno') {
      if (v === 'Yes' || v === 'No') out[n] = v;
    } else if (f.type === 'scale' || f.type === 'grid') {
      const x = Number(v);
      if (Number.isInteger(x) && x >= 1 && x <= 5) out[n] = x;
    } else if (f.type === 'time') {
      if (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) out[n] = v;
    } else if (f.type === 'text') {
      if (typeof v === 'string' && v.trim()) out[n] = v.trim().slice(0, 4000);
    }
    if (f.other) {
      const o = body[`${n}__other`];
      const picked = f.type === 'multi' ? (out[n] || []).includes('Other') : out[n] === 'Other';
      if (picked && typeof o === 'string' && o.trim()) out[`${n}__other`] = o.trim().slice(0, 200);
    }
  }
  // Drop answers to questions that are hidden by showIf
  for (const q of questions(form)) if (!visible(q, out)) { delete out[q.name]; delete out[`${q.name}__other`]; }
  return out;
}

module.exports = { AREAS, AREA, FORMS, PROGRAM_DAYS, REVIEW_DAYS, formsForDay, phaseOf, questions, progress, parseAnswers, visible, isAnswered };
