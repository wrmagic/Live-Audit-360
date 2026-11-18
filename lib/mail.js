'use strict';
// Sending email (invites and password resets).
//   RESEND_API_KEY   use Resend (resend.com), or
//   POSTMARK_TOKEN   use Postmark (postmarkapp.com)
//   MAIL_FROM        the sender, e.g. "Life Audit 360 <hello@yourdomain.com>" (must be a verified domain)
// With neither set, emails are written to the server log instead (fine for trying things out).

const sentLog = []; // last few messages, for tests and the owner screen
// Where the settings come from: Admin → Settings (set by the app at start-up), else Render's environment.
let source = () => ({ resendKey: process.env.RESEND_API_KEY || null, postmarkToken: process.env.POSTMARK_TOKEN || null, from: process.env.MAIL_FROM || null, replyTo: null });
const setSource = (fn) => { source = fn; };
const config = () => source();
const configured = () => { const c = config(); return !!((c.resendKey || c.postmarkToken) && c.from); };

async function send({ to, subject, text, html, replyTo }) {
  const cfg = config();
  const from = cfg.from;
  replyTo = replyTo || cfg.replyTo;
  const entry = { to, subject, text, html, at: new Date().toISOString(), via: 'log' };
  sentLog.push(entry); if (sentLog.length > 50) sentLog.shift();
  try {
    if (cfg.resendKey && from) {
      entry.via = 'resend';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
      return true;
    }
    if (cfg.postmarkToken && from) {
      entry.via = 'postmark';
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST', headers: { 'X-Postmark-Server-Token': cfg.postmarkToken, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, ...(html ? { HtmlBody: html } : {}), ...(replyTo ? { ReplyTo: replyTo } : {}), MessageStream: 'outbound' }),
      });
      if (!r.ok) throw new Error(`Postmark ${r.status}: ${await r.text()}`);
      return true;
    }
  } catch (e) {
    entry.error = e.message;
    console.error('Email failed:', e.message);
    return false;
  }
  if (process.env.NODE_ENV !== 'test') console.log(`\n--- Email (not sent: no email service set up) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
  return false;
}

module.exports = { send, configured, config, setSource, sentLog };
