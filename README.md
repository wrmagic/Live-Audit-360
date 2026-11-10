# Life Audit 360

A 14-day life audit program. Participants log their days on their phone; coaches see everyone's answers, photos and analysis on a desktop dashboard.

- **Days 1–7, Document, don't change.** Each day the participant fills in **Daily Audit Part 1** (check-in, movement, nutrition, hydration) and **Part 2** (phone, habits, sleep, environment, daily reflection), and photographs what they eat and drink. On Day 7 they also fill in the **End of Week Review** (Parts 1 and 2).
- **Day 7 analysis and priorities.** Anything rated 3 or higher on the review is eligible for support. The app recommends up to three areas, and the participant confirms them or swaps in another eligible area. See *Week 2 priorities* below.
- **Days 8–14, Make the change.** Videos, prompts and tools for the confirmed priorities, down to the specific challenges they flagged. They keep logging the same way.
- **Day 14 analysis.** The same report again, with Week 1 and Week 2 side by side.

It's built the same way as Event Master Plus: one Node.js program with **nothing to install**, its database in a single file, server-rendered pages, a phone app that installs to the home screen, and one-click deploy to Render from this GitHub repository.

## Who sees what

| | Phone app (`/m`) | Coach site |
|---|---|---|
| **Participant** | Today's forms, past days to catch up, food photos, progress and streak, Day 7 / Day 14 analysis, videos (from Day 8), settings | — |
| **Coach** | — | Their own clients: list with today's progress and who's gone quiet, invite people, every answer by day, photos, both analyses, focus areas, private notes |
| **Head coach** | — | Everyone, plus the **Coaches** page (add, resend links, remove) and editing the **Video library** |

## Week 2 priorities (Hybrid Priority Recommendation System)

This follows the developer spec dated Oct 28, 2026. The code is in `lib/priorities.js`.

1. **Rating:** every End of Week Review question gets a rating from 1 to 5. A rating of **3, 4 or 5 makes that challenge eligible** for support. Ratings of 1 and 2 are recorded but never trigger anything.
2. **Ranking:** questions are grouped into the eight areas. Eligible areas are ranked by:
   - their **highest single rating** first
   - then **how many questions were rated 3–5**
   - then the participant's **stated priorities** (the "top three priorities" question on the review)
   - and, if still tied, the area's daily challenge average, then a fixed area order
3. **Recommendation:** the app recommends **up to three** areas. If only one or two qualify, only those are recommended. If none qualify, there's no corrective plan.
4. **Confirm or swap:** on Day 7, once every review question is rated, the participant confirms the recommendation or swaps an area for another eligible one. The rules: no duplicates, no more than three, and only areas rated 3 or higher. The same priorities stay in place for all of Days 8–14. They can change them until Day 8 starts, and the Day 7 review locks once they confirm. A coach can adjust them under the same rules.
5. **What's stored:**
   - every question's rating, area and eligibility
   - the area ranking
   - the **original recommendations**
   - the **final confirmed choice**, with who confirmed it and when

   The recommendations are kept separately from the final choice, so the two can be compared later.
6. **Week 2 content:** the coach's **Week 2 content** library holds videos, prompts and tools. Each item is either for a whole area or for **one specific challenge**. A participant sees the items for their confirmed areas: whole-area items, plus items for the challenges *they* rated 3 or higher. Nothing is listed twice. The library shows which challenges still have no content of their own, so the challenge-to-resource map can be filled in over time.

The area bars in the reports still blend the daily ratings with the review, as an overall picture. Only the review ratings decide the priorities.

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
2. **Week 2 content:** add videos, prompts and tools. Each item is for a whole area or one specific challenge, and can unlock on a set day (8–14). Unlisted YouTube or Vimeo links play inside the app.
3. **Invite a participant:** enter their name, email and the date of Day 1. They get a link, choose a password, and the app walks them through each day. Tell them to add it to their home screen. The app shows how on iPhone and Android.
4. **Watch progress:** the Participants list shows who logged today, who's been quiet for 2+ days, and whose analysis is ready. From someone's page you can read every day's answers, look at their photos, change their focus areas, keep notes, send a new sign-in link or start another 14 days.

## Phone app and app stores

Right now the participant app is a web app that installs to the home screen and opens full screen. The same pages can later be wrapped with [Capacitor](https://capacitorjs.com) for the App Store and Google Play. That would add native push reminders, the one thing a home-screen web app can't reliably do on every iPhone.

## Files

```
server.js            web server: sign-in, page access, form handling
lib/forms.js         the four forms, the eight life areas, which forms go on which day
lib/priorities.js    Week 2 priorities: eligibility, ranking, recommend, confirm
lib/scoring.js       area scores, Week 1 vs Week 2
lib/report.js        the Day 7 / Day 14 analysis page
lib/program.js       program days, progress, saving answers
lib/views.js         page frames, icons, drawing the forms and answers
routes/participant.js   phone app      routes/coach.js   coach site
routes/photos.js     food photos       routes/videos.js  Week 2 content library
routes/coaches.js    coaching team     routes/auth.js    sign-in, invite links
public/              styles, scripts, icons, header images
scripts/setup.js     first-start setup (and --demo sample data)
```
