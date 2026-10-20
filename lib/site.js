'use strict';
// Shared bits for routes: the site's address, invite emails, who can see whom.
const { HttpError } = require('./http');
const mail = require('./mail');
const auth = require('./auth');

function baseUrl(ctx) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = ctx.req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${ctx.req.headers.host || 'localhost:3000'}`;
}

/** Create a set-password link for a user and email it if email is set up. Returns {link, emailed}. */
async function sendInvite(ctx, user, { reset = false } = {}) {
  const t = auth.issueInvite(ctx.db, user.id);
  const link = `${baseUrl(ctx)}/invite/${t}`;
  const who = ctx.user ? ctx.user.name : 'Your coach';
  const subject = reset ? 'Reset your Life Audit 360 password' : user.role === 'participant' ? `${who} invited you to Life Audit 360` : 'You’re a coach on Life Audit 360';
  const text = reset
    ? `Hi ${user.name},\n\nUse this link to choose a new password for Life Audit 360:\n${link}\n\nThe link works for ${auth.INVITE_DAYS} days. If you didn't ask for this, you can ignore this email.`
    : user.role === 'participant'
      ? `Hi ${user.name},\n\n${who} has set up your 14-day Life Audit 360 program.\n\nTap this link on your phone to choose a password and get started:\n${link}\n\nTip: once you're in, add Life Audit 360 to your home screen so it opens like an app.\n\nThe link works for ${auth.INVITE_DAYS} days.`
      : `Hi ${user.name},\n\nYou've been added as a coach on Life Audit 360. Use this link to choose your password:\n${link}\n\nThe link works for ${auth.INVITE_DAYS} days.`;
  const emailed = await mail.send({ to: user.email, subject, text });
  return { link, emailed };
}

/** The participant, if the signed-in coach may see them (head coach: everyone; coach: their own). */
function participantFor(ctx, id) {
  const p = ctx.db.get("SELECT * FROM users WHERE id=? AND role='participant'", Number(id));
  if (!p) throw new HttpError(404, 'That participant wasn’t found.');
  if (ctx.user.role !== 'head' && p.coach_id !== ctx.user.id) throw new HttpError(403, 'That participant belongs to another coach.');
  return p;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico', 'Europe/London', 'Australia/Sydney'];

module.exports = { baseUrl, sendInvite, participantFor, str, validEmail, ZONES };
