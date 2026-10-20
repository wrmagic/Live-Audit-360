# Life Audit 360

A 14-day life audit program. Participants log their days on their phone; coaches see everyone's answers, photos and analysis on a desktop dashboard.

- **Days 1–7, Document, don't change.** Each day the participant fills in **Daily Audit Part 1** (check-in, movement, nutrition, hydration) and **Part 2** (phone, habits, sleep, environment, daily reflection), and photographs what they eat and drink. On Day 7 they also fill in the **End of Week Review** (Parts 1 and 2).
- **Day 7 analysis.** A score for each of the eight life areas, the top three challenges, a typical-day summary and their strengths and priorities.
- **Days 8–14, Make the change.** The app picks three **focus areas** (the participant's priorities from the review, filled in from the top scores, or the coach's choice) and shows the coaching videos for those areas. They keep logging the same way.
- **Day 14 analysis.** The same report again, with Week 1 and Week 2 side by side.

It's built the same way as Event Master Plus: one Node.js program with **nothing to install**, its database in a single file, server-rendered pages, a phone app that installs to the home screen, and one-click deploy to Render from this GitHub repository.

## Who sees what

| | Phone app (`/m`) | Coach site |
|---|---|---|
| **Participant** | Today's forms, past days to catch up, food photos, progress and streak, Day 7 / Day 14 analysis, videos (from Day 8), settings | — |
| **Coach** | — | Their own clients: list with today's progress and who's gone quiet, invite people, every answer by day, photos, both analyses, focus areas, private notes |
| **Head coach** | — | Everyone, plus the **Coaches** page (add, resend links, remove) and editing the **Video library** |

## The scoring

Every area is scored 1–5, where 1 = not a challenge and 5 = severe, just like the forms. Each area's score is the average of two parts:

- **Daily:** that area's "How much of a challenge…" rating from each day, plus related 1–5 ratings flipped where 5 is good. For example, Sleep also uses sleep quality and how rested they felt, and Nutrition also uses the hydration rating. The Mental health part comes from the morning, midday and evening check-in plus "how would you describe your day". Work & productivity has no daily section of its own, so it uses "How satisfied were you with the way you spent your day".
- **Review:** the average of that area's rows on the End of Week Review.

The coach view shows the breakdown table. All of this is in `lib/scoring.js`.

## Changing the questions

Every form is written out as data in **`lib/forms.js`**. Change wording, add options or add questions there, and the phone screens, saving, coach views and scoring all follow. Answers are stored as JSON, so the database doesn't need changes.

**Days 8–14 forms:** Days 8–14 currently use the same daily forms as Days 1–7. When the Week 2 forms are ready:

1. Add them to `lib/forms.js` like `DAY_PART1`.
2. List them in `formsForDay()`.

## Try it on your own computer

You need [Node.js](https://nodejs.org) 22.13 or newer.

```bash
npm run demo     # creates the database with sample coaches, participants and videos
npm start
```

Open http://localhost:3000. Every demo login uses the password `demo1234`:

- **Head coach:** `coach@example.com`
- **Coach:** `jordan@example.com`
- **Participants:**
  - `derek@example.com` (Day 10)
  - `maria@example.com` (Day 4)
  - `sam@example.com` (Day 7, gone quiet)
  - `aisha@example.com` (finished)
  - `lena@example.com` (starts soon)

Sign in as a participant on your phone, or in a narrow browser window.

To start clean, delete the `data` folder and run `npm run setup` instead.

Run the tests with `npm test`.

## Put it on the web (Render)

1. On [render.com](https://render.com), choose **New → Blueprint** and pick this repository. It reads `render.yaml`, which sets up a web service with a 5 GB disk for the database and photos. The disk needs a paid plan.
2. Fill in the settings it asks for:
   - `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD`: the head coach login, used on the first start only.
   - `BASE_URL`: your site's address, for example `https://app.lifeaudit360.com`. Invite links use it.
   - `RESEND_API_KEY` and `MAIL_FROM` (optional): to email invites. Without them, the app shows each invite link on screen for you to copy and text or email yourself.
3. Deploy, then sign in with the head coach email and password.
4. Optional: under **Settings → Custom Domains**, add your own domain.

Every push to the repository redeploys automatically. Forgot the head coach password? Open Render's **Shell** tab and run `npm run reset-password -- you@example.com 'new-password'`.

## Using it

1. **Coaches page:** add your coaches. Each one gets a link to choose a password.
2. **Videos:** add your coaching videos. Each video gets a life area and, optionally, the day it unlocks (8–14). Unlisted YouTube or Vimeo links play inside the app.
3. **Invite a participant:** enter their name, email and the date of Day 1. They get a link, choose a password, and the app walks them through each day. Tell them to add it to their home screen. The app shows how on iPhone and Android.
4. **Watch progress:** the Participants list shows who logged today, who's been quiet for 2+ days, and whose analysis is ready. From someone's page you can read every day's answers, look at their photos, change their focus areas, keep notes, send a new sign-in link or start another 14 days.

## Phone app and app stores

Right now the participant app is a web app that installs to the home screen and opens full screen. The same pages can later be wrapped with [Capacitor](https://capacitorjs.com) for the App Store and Google Play. That would add native push reminders, the one thing a home-screen web app can't reliably do on every iPhone.

## Files

```
server.js            web server: sign-in, page access, form handling
lib/forms.js         the four forms, the eight life areas, which forms go on which day
lib/scoring.js       area scores, focus areas, Week 1 vs Week 2
lib/report.js        the Day 7 / Day 14 analysis page
lib/program.js       program days, progress, saving answers
lib/views.js         page frames, icons, drawing the forms and answers
routes/participant.js   phone app      routes/coach.js   coach site
routes/photos.js     food photos       routes/videos.js  video library
routes/coaches.js    coaching team     routes/auth.js    sign-in, invite links
public/              styles, scripts, icons, header images
scripts/setup.js     first-start setup (and --demo sample data)
```
