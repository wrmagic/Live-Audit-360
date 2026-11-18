'use strict';
// Super admin (head coaches): every login, signing in as someone to help them, and running the app.
// Every action here is written to the activity log.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, raw, dateFmt, dateTimeFmt, firstName } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const mail = require('../lib/mail');
const audit = require('../lib/audit');
const F = require('../lib/forms');
const P = require('../lib/program');
const Pr = require('../lib/priorities');
const { sendInvite, currentLink, baseUrl, str, validEmail } = require('../lib/site');
const authRoutes = require('./auth');

const O = { coach: true, super: true };
const SA = require('../lib/superadmin');
const ROLE = { super: 'Super admin', head: 'Head coach', coach: 'Coach', participant: 'Participant' };
const level = (u) => (u.role === 'head' && u.is_super ? 'super' : u.role);
const STARTED = Date.now();

const ACTIONS = {
  login_as: 'Signed in as', preview: 'Previewed', set_password: 'Set password for', send_link: 'Sent a sign-in link to',
  signout: 'Signed out everywhere', unlock: 'Unlocked sign-in for', edit: 'Edited', deactivate: 'Turned off', reactivate: 'Turned back on',
  delete: 'Permanently deleted', backup: 'Downloaded a database backup', export: 'Exported participants', test_email: 'Sent a test email',
  signout_all: 'Signed out everyone else', delete_tests: 'Deleted test participants',
};

function sizeOf(dir) {
  let bytes = 0; let files = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const s = sizeOf(p); bytes += s.bytes; files += s.files; } else { bytes += fs.statSync(p).size; files++; }
    }
  } catch { /* no folder yet */ }
  return { bytes, files };
}
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

function getUser(db, id) {
  const u = db.get('SELECT * FROM users WHERE id=?', Number(id));
  if (!u) throw new HttpError(404, 'That login wasn’t found.');
  return u;
}
const liveSessions = (db, id) => db.get('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND impersonated_by IS NULL AND expires_at > ?', id, new Date().toISOString()).n;
const activeSupers = (db) => db.get("SELECT COUNT(*) n FROM users WHERE role='head' AND is_super=1 AND active=1").n;

function logRows(ctx, rows) {
  if (!rows.length) return html`<p class="muted">Nothing yet.</p>`;
  return html`<table class="list log"><tbody>${rows.map((l) => html`<tr><td class="when">${dateTimeFmt(l.created_at, ctx.user.timezone)}</td>
<td><b>${l.actor_name}</b> ${ACTIONS[l.action] || l.action}${l.target_name ? html` ${l.target_id ? html`<a href="/admin/users/${l.target_id}">${l.target_name}</a>` : l.target_name}` : ''}${l.detail ? html`<small>${l.detail}</small>` : ''}</td></tr>`)}</tbody></table>`;
}

const tabs = (on) => html`<nav class="tabs">${[['/admin', 'App', 'app'], ['/admin/users', 'Logins', 'users'], ['/admin/log', 'Activity log', 'log']].map(([h, l, k]) => html`<a href="${h}" class="${on === k ? 'on' : ''}">${l}</a>`)}</nav>`;
const pageHead = (title, sub) => html`<div class="page-head"><div><p class="eyebrow">Super admin</p><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div></div>`;

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating text as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

module.exports = (r, { db, photoDir }) => {
  // ---------------------------------------------------------------- App: status and tools
  r.get('/admin', (ctx) => {
    const n = (sql, ...a) => db.get(sql, ...a).n;
    const people = {
      participants: n("SELECT COUNT(*) n FROM users WHERE role='participant' AND active=1 AND is_test=0"),
      tests: n("SELECT COUNT(*) n FROM users WHERE role='participant' AND is_test=1"),
      coaches: n("SELECT COUNT(*) n FROM users WHERE role IN ('coach','head') AND active=1"),
      pending: n("SELECT COUNT(*) n FROM users WHERE active=1 AND password_hash IS NULL AND is_test=0"),
      off: n('SELECT COUNT(*) n FROM users WHERE active=0'),
    };
    let inProgram = 0;
    for (const u of db.all("SELECT id, timezone FROM users WHERE role='participant' AND active=1 AND is_test=0")) {
      const pos = P.position(P.currentEnrollment(db, u.id), u.timezone);
      if (pos && pos.started && !pos.finished) inProgram++;
    }
    const dbBytes = ['', '-wal'].reduce((t, x) => { try { return t + fs.statSync(db.file + x).size; } catch { return t; } }, 0);
    const photos = sizeOf(photoDir);
    let disk = null;
    try { const s = fs.statfsSync(path.dirname(path.resolve(db.file))); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { /* not available */ }
    const lastMail = [...mail.sentLog].reverse().find((m) => m.via !== 'log');
    const lastErr = [...mail.sentLog].reverse().find((m) => m.error);
    const commit = process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : null;
    const up = Math.round((Date.now() - STARTED) / 60e3);
    const recent = db.all('SELECT * FROM admin_log ORDER BY id DESC LIMIT 12');
    ctx.html(layout(ctx, { title: 'Admin', nav: 'admin', body: html`${pageHead('Admin', 'Logins, signing in to help people, and running the app.')}${tabs('app')}
<section class="kpis">
<div class="kpi"><b>${people.participants}</b><span>Participants (${inProgram} in a program now)</span></div>
<div class="kpi"><b>${people.coaches}</b><span>Coaches and admins</span></div>
<div class="kpi ${people.pending ? 'warn' : ''}"><b>${people.pending}</b><span>Invites not accepted yet</span></div>
<div class="kpi"><b>${people.tests}</b><span>Test participants</span></div>
</section>
<div class="cols">
<div>
<section class="panel"><h3>${icon('gear')} System</h3><div class="facts">
<div class="fact"><span>Web address</span><b>${process.env.BASE_URL ? process.env.BASE_URL : html`<span class="warn-text">BASE_URL not set (using ${baseUrl(ctx)})</span>`}</b></div>
<div class="fact"><span>Email</span><b>${mail.configured() ? html`On (${process.env.RESEND_API_KEY ? 'Resend' : 'Postmark'})` : html`<span class="warn-text">Off: invite links are shown to copy</span>`}</b></div>
<div class="fact"><span>Last email sent</span><b>${lastMail ? `${dateTimeFmt(lastMail.at, ctx.user.timezone)}${lastMail.error ? ' (failed)' : ''}` : 'None since the last restart'}</b></div>
${lastErr ? html`<div class="fact"><span>Last email error</span><b class="warn-text">${lastErr.error.slice(0, 160)}</b></div>` : ''}
<div class="fact"><span>Database</span><b>${mb(dbBytes)}</b></div>
<div class="fact"><span>Food photos</span><b>${photos.files} · ${mb(photos.bytes)}</b></div>
${disk ? html`<div class="fact"><span>Disk free</span><b class="${disk.free / disk.total < 0.1 ? 'warn-text' : ''}">${mb(disk.free)} of ${mb(disk.total)}</b></div>` : ''}
<div class="fact"><span>Version</span><b>${commit ? `Commit ${commit}` : 'Local'} · Node ${process.versions.node}</b></div>
<div class="fact"><span>Running since</span><b>${up < 120 ? `${up} min` : up < 2880 ? `${Math.round(up / 60)} hours` : `${Math.round(up / 1440)} days`}</b></div>
<div class="fact"><span>Signed-in sessions</span><b>${db.get('SELECT COUNT(*) n FROM sessions WHERE expires_at > ?', new Date().toISOString()).n}</b></div>
</div></section>
<section class="panel"><h3>${icon('notes')} Recent activity</h3>${logRows(ctx, recent)}<p><a href="/admin/log">Full activity log</a></p></section>
</div>
<div>
<section class="panel"><h3>Backups and exports</h3>
<p class="muted">The database holds every login, answer, priority, note and setting. Food photos are separate files and aren’t in the backup.</p>
<form method="post" action="/admin/backup">${csrfField(ctx)}<button class="btn">${icon('cal')} Download database backup</button></form>
<form method="post" action="/admin/export" class="gap-s">${csrfField(ctx)}<button class="btn ghost">Export participants (CSV)</button></form></section>
<form method="post" action="/admin/test-email" class="panel">${csrfField(ctx)}<h3>Test email</h3>
<label class="fld"><span>Send a test to</span><input type="email" name="to" value="${ctx.user.email}" required></label>
<button class="btn">Send test email</button>${!mail.configured() ? html`<p class="hint">Email isn’t set up, so this will only be written to the server log. Add RESEND_API_KEY and MAIL_FROM on Render.</p>` : ''}</form>
<section class="panel danger"><h3>Clean up</h3>
<form method="post" action="/admin/signout-all">${csrfField(ctx)}<p class="muted">Sign out every login except you, on every device. Use it if you think an account was used by someone else.</p><button class="btn danger" data-confirm="Sign out everyone except you?">Sign out everyone else</button></form>
${people.tests ? html`<form method="post" action="/admin/delete-tests" class="gap">${csrfField(ctx)}<p class="muted">Delete all ${people.tests} test participant${people.tests === 1 ? '' : 's'}, with their answers and photos.</p><button class="btn danger" data-confirm="Delete all test participants and their data?">Delete test participants</button></form>` : ''}
</section>
</div></div>` }));
  }, O);

  r.post('/admin/backup', (ctx) => {
    const tmp = path.join(os.tmpdir(), `la360-backup-${crypto.randomBytes(6).toString('hex')}.db`);
    db.raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    audit.log(db, ctx.user, 'backup', null, mb(buf.length));
    ctx.res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="life-audit-360-backup-${P.todayIn(ctx.user.timezone)}.db"`, 'Cache-Control': 'no-store' });
    ctx.res.end(buf);
  }, O);

  r.post('/admin/export', (ctx) => {
    const rows = db.all(`SELECT u.*, c.name coach_name FROM users u LEFT JOIN users c ON c.id=u.coach_id WHERE u.role='participant' ORDER BY u.name`);
    const out = [['Name', 'Email', 'Phone', 'Coach', 'Status', 'Test', 'Invite accepted', 'Program start', 'Program day', 'Days complete', 'Week 2 priorities', 'Last entry', 'Last seen', 'Created']];
    for (const u of rows) {
      const e = P.currentEnrollment(db, u.id);
      const pos = P.position(e, u.timezone);
      const map = e ? P.responseMap(db, e.id) : {};
      let last = '';
      for (const d of Object.values(map)) for (const f of Object.values(d)) if (f.updated_at > last) last = f.updated_at;
      const pri = e ? Pr.load(db, e.id) : null;
      out.push([u.name, u.is_test ? '' : u.email, u.phone, u.coach_name, u.active ? 'Active' : 'Off', u.is_test ? 'Yes' : '', u.password_hash ? 'Yes' : 'No',
        e ? e.start_date : '', !pos ? '' : pos.finished ? 'Finished' : pos.started ? pos.day : 'Not started', pos ? P.completion(map, pos).done : '',
        pri && pri.confirmed ? pri.confirmed.map((k) => F.AREA[k].label).join('; ') : '', last.slice(0, 16).replace('T', ' '), (u.last_seen || '').slice(0, 16).replace('T', ' '), u.created_at.slice(0, 10)]);
    }
    audit.log(db, ctx.user, 'export', null, `${rows.length} participants`);
    ctx.send(200, '﻿' + out.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="life-audit-360-participants-${P.todayIn(ctx.user.timezone)}.csv"`, 'Cache-Control': 'no-store' });
  }, O);

  r.post('/admin/test-email', async (ctx) => {
    const to = str(ctx.body.to).toLowerCase();
    if (!validEmail(to)) throw new HttpError(400, 'That email address doesn’t look right.');
    const ok = await mail.send({ to, subject: 'Life Audit 360 test email', text: `This is a test from Life Audit 360 (${baseUrl(ctx)}), sent by ${ctx.user.name}.\n\nIf you're reading this, email is working.` });
    const entry = mail.sentLog[mail.sentLog.length - 1];
    audit.log(db, ctx.user, 'test_email', null, `${to}: ${ok ? 'sent' : entry && entry.error ? `failed (${entry.error.slice(0, 120)})` : 'not sent (email is off)'}`);
    ctx.setFlash(ok ? `Test email sent to ${to}. Check the inbox (and spam).` : entry && entry.error ? `The email failed: ${entry.error.slice(0, 200)}` : 'Email isn’t set up, so the test was only written to the server log.', ok ? 'ok' : 'err');
    ctx.redirect('/admin');
  }, O);

  r.post('/admin/signout-all', (ctx) => {
    const n = db.run('DELETE FROM sessions WHERE token_hash<>?', ctx.user.token_hash).changes;
    audit.log(db, ctx.user, 'signout_all', null, `${n} session${n === 1 ? '' : 's'} ended`);
    ctx.setFlash(`Signed out ${n} session${n === 1 ? '' : 's'}. Everyone else will need to sign in again.`);
    ctx.redirect('/admin');
  }, O);

  r.post('/admin/delete-tests', (ctx) => {
    const tests = db.all("SELECT * FROM users WHERE role='participant' AND is_test=1");
    for (const u of tests) deleteParticipant(u);
    audit.log(db, ctx.user, 'delete_tests', null, `${tests.length} deleted`);
    ctx.setFlash(`Deleted ${tests.length} test participant${tests.length === 1 ? '' : 's'}.`);
    ctx.redirect('/admin');
  }, O);

  function deleteParticipant(u) {
    for (const ph of db.all('SELECT p.file FROM photos p JOIN enrollments e ON e.id=p.enrollment_id WHERE e.user_id=?', u.id)) {
      try { fs.unlinkSync(path.join(photoDir, ph.file)); } catch { /* already gone */ }
    }
    db.tx(() => db.run('DELETE FROM users WHERE id=?', u.id));
  }

  // ---------------------------------------------------------------- Logins
  r.get('/admin/users', (ctx) => {
    const role = ['staff', 'participant', 'all'].includes(ctx.query.role) ? ctx.query.role : 'all';
    const status = ['active', 'pending', 'off', 'all'].includes(ctx.query.status) ? ctx.query.status : 'active';
    const showTests = ctx.query.tests === '1';
    const q = str(ctx.query.q).toLowerCase();
    const where = ['1=1']; const args = [];
    if (role === 'staff') where.push("u.role IN ('head','coach')");
    if (role === 'participant') where.push("u.role='participant'");
    if (status === 'active') where.push('u.active=1');
    if (status === 'pending') where.push('u.active=1 AND u.password_hash IS NULL');
    if (status === 'off') where.push('u.active=0');
    if (!showTests) where.push('u.is_test=0');
    if (q) { where.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const list = db.all(`SELECT u.*, c.name coach_name,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.impersonated_by IS NULL AND s.expires_at > ?) sessions
      FROM users u LEFT JOIN users c ON c.id=u.coach_id WHERE ${where.join(' AND ')}
      ORDER BY u.active DESC, CASE u.role WHEN 'head' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END, u.name LIMIT 500`, new Date().toISOString(), ...args);
    const qs = (o) => '?' + new URLSearchParams({ role, status, ...(q ? { q } : {}), ...(showTests ? { tests: '1' } : {}), ...o }).toString();
    ctx.html(layout(ctx, { title: 'Logins', nav: 'admin', body: html`${pageHead('Logins', 'Everyone who can sign in: coaches, admins and participants.')}${tabs('users')}
<div class="toolbar"><nav class="seg">${[['all', 'Everyone'], ['staff', 'Coaches & admins'], ['participant', 'Participants']].map(([k, l]) => html`<a href="${qs({ role: k })}" class="${role === k ? 'on' : ''}">${l}</a>`)}</nav>
<form class="filters"><input type="hidden" name="role" value="${role}"><select name="status" data-autosubmit>${[['active', 'Active'], ['pending', 'Invite not accepted'], ['off', 'Turned off'], ['all', 'Any status']].map(([k, l]) => html`<option value="${k}"${status === k ? raw(' selected') : ''}>${l}</option>`)}</select>
<label class="check"><input type="checkbox" name="tests" value="1"${showTests ? raw(' checked') : ''} data-autosubmit> Tests</label><input type="search" name="q" value="${q}" placeholder="Search name or email"></form></div>
${list.length ? html`<table class="list"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last seen</th><th>Signed in on</th><th></th></tr></thead><tbody>
${list.map((u) => html`<tr data-href="/admin/users/${u.id}" class="${u.active ? '' : 'off'}"><td><a href="/admin/users/${u.id}"><b>${u.name}</b></a><small>${u.is_test ? 'Test participant' : u.email}${u.coach_name ? ` · Coach: ${u.coach_name}` : ''}</small></td>
<td>${level(u) === 'super' ? html`<span class="pill on">Super admin</span>` : u.role === 'head' ? html`<span class="pill">Head coach</span>` : u.role === 'coach' ? html`<span class="pill">Coach</span>` : 'Participant'}</td>
<td>${!u.active ? html`<span class="pill">Off</span>` : u.password_hash ? html`<span class="pill done">Active</span>` : html`<span class="pill warn">Invite pending</span>`}${authRoutes.isLocked(u.email) ? html` <span class="pill warn">Locked</span>` : ''}</td>
<td>${u.last_seen ? dateTimeFmt(u.last_seen, ctx.user.timezone) : html`<span class="muted">Never</span>`}</td>
<td>${u.sessions ? `${u.sessions} device${u.sessions === 1 ? '' : 's'}` : html`<span class="muted">—</span>`}</td>
<td class="actions">${canLoginAs(ctx, u) ? html`<form method="post" action="/admin/users/${u.id}/login-as">${csrfField(ctx)}<button class="btn small">Log in as</button></form>` : ''}</td></tr>`)}
</tbody></table>${list.length === 500 ? html`<p class="hint">Showing the first 500. Search to narrow it down.</p>` : ''}` : html`<div class="empty">${icon('people')}<p>No one matches.</p></div>`}` }));
  }, O);

  const canLoginAs = (ctx, u) => u.active && u.id !== ctx.user.id && !u.is_super;

  r.get('/admin/users/:id', (ctx) => {
    const u = getUser(db, ctx.params.id);
    const coach = u.coach_id ? db.get('SELECT id, name FROM users WHERE id=?', u.coach_id) : null;
    const link = currentLink(ctx, u);
    const sessions = liveSessions(db, u.id);
    const locked = authRoutes.isLocked(u.email);
    const self = u.id === ctx.user.id;
    const clients = u.role !== 'participant' ? db.get("SELECT COUNT(*) n FROM users WHERE coach_id=? AND role='participant' AND active=1", u.id).n : 0;
    const e = u.role === 'participant' ? P.currentEnrollment(db, u.id) : null;
    const pos = e ? P.position(e, u.timezone) : null;
    const history = db.all('SELECT * FROM admin_log WHERE target_id=? ORDER BY id DESC LIMIT 15', u.id);
    const staff = db.all("SELECT id, name FROM users WHERE role IN ('head','coach') AND active=1 AND id<>? ORDER BY name", u.id);
    ctx.html(layout(ctx, { title: u.name, nav: 'admin', body: html`<div class="page-head person"><div><p class="eyebrow"><a href="/admin/users">Logins</a></p><h1>${u.name}</h1>
<p class="muted">${u.is_test ? html`<span class="pill test">Test participant</span>` : u.email} · ${ROLE[level(u)]}${SA.isProtected(u.email) ? ' (set by the app’s settings)' : ''}${coach ? html` · Coach: ${coach.name}` : ''}${self ? ' · This is you' : ''}</p></div>
<div class="head-state">${!u.active ? html`<span class="pill">Turned off</span>` : u.password_hash ? html`<span class="pill done">Active</span>` : html`<span class="pill warn">Invite pending</span>`}${locked ? html` <span class="pill warn">Sign-in locked</span>` : ''}
<small>Joined ${dateFmt(u.created_at.slice(0, 10))} · Last seen ${u.last_seen ? dateTimeFmt(u.last_seen, ctx.user.timezone) : 'never'}</small></div></div>
<div class="cols">
<div>
${canLoginAs(ctx, u) ? html`<section class="panel"><h3>${icon('user')} Log in as ${firstName(u.name)}</h3>
<p class="muted">See exactly what ${firstName(u.name)} sees, to help them. A blue bar at the top brings you back. ${u.role === 'participant' ? 'Anything you fill in is saved as their answers. ' : ''}It’s recorded in the activity log and doesn’t change their “last seen”.</p>
<form method="post" action="/admin/users/${u.id}/login-as">${csrfField(ctx)}<button class="btn primary">Log in as ${firstName(u.name)}</button></form></section>` : ''}
${u.role === 'participant' ? html`<section class="panel"><h3>${icon('cal')} Program</h3><p>${!e ? 'No program.' : !pos.started ? `Starts ${dateFmt(e.start_date, 'long')}.` : pos.finished ? 'Finished.' : `Day ${pos.day} of 14.`} <a href="/participants/${u.id}">Open their coach page</a></p></section>` : ''}
<section class="panel"><h3>${icon('target')} Sign-in</h3>
${link ? html`<p class="muted">Current sign-in link (works once, until ${dateFmt(u.invite_expires.slice(0, 10))}):</p><div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>` : ''}
<form method="post" action="/admin/users/${u.id}/link" class="inline">${csrfField(ctx)}<button class="btn" ${u.active ? '' : raw('disabled')}>${link ? 'Make and send a new link' : 'Send a sign-in link'}</button></form>
<form method="post" action="/admin/users/${u.id}/password" class="gap">${csrfField(ctx)}<label class="fld"><span>Or set a new password for them</span><input type="password" name="password" minlength="8" required autocomplete="new-password" placeholder="At least 8 characters"></label>
<button class="btn ghost">Set password</button><p class="hint">This signs them out everywhere. Tell them the new password yourself.</p></form>
<div class="inline gap">${sessions && !self ? html`<form method="post" action="/admin/users/${u.id}/signout">${csrfField(ctx)}<button class="btn small ghost">Sign out of ${sessions} device${sessions === 1 ? '' : 's'}</button></form>` : html`<span class="muted">${self ? '' : 'Not signed in anywhere.'}</span>`}
${locked ? html`<form method="post" action="/admin/users/${u.id}/unlock">${csrfField(ctx)}<button class="btn small">Unlock sign-in</button></form>` : ''}</div></section>
<section class="panel"><h3>${icon('notes')} History</h3>${logRows(ctx, history)}</section>
</div>
<div>
${!u.is_test ? html`<form method="post" action="/admin/users/${u.id}/edit" class="panel">${csrfField(ctx)}<h3>Details</h3>
<label class="fld"><span>Name</span><input name="name" value="${u.name}" required maxlength="100"></label>
<label class="fld"><span>Email (their sign-in)</span><input type="email" name="email" value="${u.email}" required></label>
${u.role !== 'participant' ? html`<label class="fld"><span>Role</span><select name="role"${self || SA.isProtected(u.email) ? raw(' disabled') : ''}>${[['coach', 'Coach: sees their own clients'], ['head', 'Head coach: sees every client, manages coaches and content'], ['super', 'Super admin: head coach plus this Admin area']].map(([k, l]) => html`<option value="${k}"${level(u) === k ? raw(' selected') : ''}>${l}</option>`)}</select>${self ? html`<span class="hint">You can’t change your own role.</span>` : SA.isProtected(u.email) ? html`<span class="hint">This super admin is set in the app’s settings (SUPER_ADMIN_EMAILS) and can’t be changed here.</span>` : ''}</label>` : ''}
<button class="btn">Save</button></form>` : ''}
<section class="panel danger"><h3>Access</h3>
${u.active ? (self ? html`<p class="muted">You can’t turn off your own login.</p>` : html`<form method="post" action="/admin/users/${u.id}/deactivate">${csrfField(ctx)}
<p class="muted">They can’t sign in any more. Everything they entered is kept, and you can turn them back on.</p>
${clients ? html`<label class="fld"><span>Move their ${clients} client${clients === 1 ? '' : 's'} to</span><select name="to">${staff.map((c) => html`<option value="${c.id}"${c.id === ctx.user.id ? raw(' selected') : ''}>${c.name}</option>`)}</select></label>` : ''}
<button class="btn danger" data-confirm="Turn off ${u.name}’s login?">Turn off login</button></form>`)
    : html`<form method="post" action="/admin/users/${u.id}/reactivate">${csrfField(ctx)}<p class="muted">This login is turned off.</p><button class="btn">Turn back on</button></form>`}
${u.role === 'participant' ? html`<form method="post" action="/admin/users/${u.id}/delete" class="gap">${csrfField(ctx)}<p class="muted">Permanently delete ${firstName(u.name)} with every answer, photo and note. This can’t be undone.</p>
<label class="fld"><span>Type DELETE to confirm</span><input name="confirm" autocomplete="off" required pattern="DELETE"></label><button class="btn danger">Delete permanently</button></form>` : ''}
</section>
</div></div>` }));
  }, O);

  r.post('/admin/users/:id/login-as', (ctx) => {
    const u = getUser(db, ctx.params.id);
    if (!canLoginAs(ctx, u)) throw new HttpError(403, u.is_super ? 'You can’t sign in as another super admin.' : u.id === ctx.user.id ? 'That’s you.' : 'That login is turned off.');
    if (ctx.user.impersonated_by) throw new HttpError(403, 'Go back to your own login first.');
    ctx.setCookie('coach_sid', ctx.sessionToken, { maxAge: 12 * 3600 });
    ctx.setCookie('return_to', `/admin/users/${u.id}`, { maxAge: 12 * 3600 });
    ctx.setCookie('sid', auth.createSession(db, u, { impersonatedBy: ctx.user.id }), { maxAge: 12 * 3600 });
    audit.log(db, ctx.user, 'login_as', u);
    ctx.redirect(u.role === 'participant' ? '/m' : '/participants');
  }, O);

  r.post('/admin/users/:id/link', async (ctx) => {
    const u = getUser(db, ctx.params.id);
    if (!u.active) throw new HttpError(400, 'Turn the login back on first.');
    const { emailed } = await sendInvite(ctx, u, { reset: !!u.password_hash });
    audit.log(db, ctx.user, 'send_link', u, emailed ? 'emailed' : 'shown to copy');
    ctx.setFlash(emailed ? `Emailed a new sign-in link to ${u.email}. It’s also shown below.` : 'New link made. Email is off, so copy it below and send it yourself.');
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/password', (ctx) => {
    const u = getUser(db, ctx.params.id);
    const pw = ctx.body.password || '';
    if (pw.length < 8) { ctx.setFlash('Use at least 8 characters.', 'err'); return ctx.redirect(`/admin/users/${u.id}`); }
    db.run('UPDATE users SET password_hash=?, invite_hash=NULL, invite_token=NULL, invite_expires=NULL WHERE id=?', auth.hashPassword(pw), u.id);
    db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.token_hash);
    authRoutes.unlock(u.email);
    audit.log(db, ctx.user, 'set_password', u);
    ctx.setFlash(`New password set for ${u.name}. They’ve been signed out everywhere${u.id === ctx.user.id ? ' else' : ''}.`);
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/signout', (ctx) => {
    const u = getUser(db, ctx.params.id);
    const n = db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.token_hash).changes;
    audit.log(db, ctx.user, 'signout', u, `${n} session${n === 1 ? '' : 's'}`);
    ctx.setFlash(`${u.name} was signed out of ${n} device${n === 1 ? '' : 's'}.`);
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/unlock', (ctx) => {
    const u = getUser(db, ctx.params.id);
    authRoutes.unlock(u.email);
    audit.log(db, ctx.user, 'unlock', u);
    ctx.setFlash(`${u.name} can try signing in again now.`);
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/edit', (ctx) => {
    const u = getUser(db, ctx.params.id);
    if (u.is_test) throw new HttpError(400, 'Test participants are edited from their coach page.');
    const name = str(ctx.body.name, 100); const email = str(ctx.body.email).toLowerCase();
    if (!name || !validEmail(email)) { ctx.setFlash('Enter a name and a valid email.', 'err'); return ctx.redirect(`/admin/users/${u.id}`); }
    if (db.get('SELECT id FROM users WHERE email=? AND id<>?', email, u.id)) { ctx.setFlash('Another login already uses that email.', 'err'); return ctx.redirect(`/admin/users/${u.id}`); }
    const upd = { name, email };
    const changes = [];
    if (name !== u.name) changes.push(`name: ${u.name} → ${name}`);
    if (email !== u.email) changes.push(`email: ${u.email} → ${email}`);
    const want = ctx.body.role;
    if (u.role !== 'participant' && u.id !== ctx.user.id && !SA.isProtected(u.email) && ['coach', 'head', 'super'].includes(want) && want !== level(u)) {
      if (level(u) === 'super' && u.active && activeSupers(db) <= 1) { ctx.setFlash('There must always be at least one super admin.', 'err'); return ctx.redirect(`/admin/users/${u.id}`); }
      upd.role = want === 'coach' ? 'coach' : 'head';
      upd.is_super = want === 'super' ? 1 : 0;
      changes.push(`role: ${ROLE[level(u)]} → ${ROLE[want]}`);
    }
    db.update('users', u.id, upd);
    if (changes.length) audit.log(db, ctx.user, 'edit', { id: u.id, name }, changes.join('; '));
    ctx.setFlash(changes.length ? 'Saved.' : 'Nothing changed.');
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/deactivate', (ctx) => {
    const u = getUser(db, ctx.params.id);
    if (u.id === ctx.user.id) throw new HttpError(400, 'You can’t turn off your own login.');
    if (SA.isProtected(u.email)) throw new HttpError(400, 'This super admin is set in the app’s settings and can’t be turned off here.');
    if (u.is_super && activeSupers(db) <= 1) throw new HttpError(400, 'There must always be at least one super admin.');
    let moved = 0;
    db.tx(() => {
      if (u.role !== 'participant') {
        const to = db.get("SELECT id FROM users WHERE id=? AND role IN ('head','coach') AND active=1 AND id<>?", Number(ctx.body.to) || ctx.user.id, u.id) || { id: ctx.user.id };
        moved = db.run("UPDATE users SET coach_id=? WHERE coach_id=? AND role='participant'", to.id, u.id).changes;
      }
      db.run('UPDATE users SET active=0, invite_hash=NULL, invite_token=NULL WHERE id=?', u.id);
      db.run('DELETE FROM sessions WHERE user_id=?', u.id);
    });
    audit.log(db, ctx.user, 'deactivate', u, moved ? `${moved} client${moved === 1 ? '' : 's'} moved` : null);
    ctx.setFlash(`${u.name}’s login is turned off.${moved ? ` ${moved} client${moved === 1 ? '' : 's'} moved.` : ''}`);
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/reactivate', (ctx) => {
    const u = getUser(db, ctx.params.id);
    db.run('UPDATE users SET active=1 WHERE id=?', u.id);
    audit.log(db, ctx.user, 'reactivate', u);
    ctx.setFlash(`${u.name}’s login is back on.${u.password_hash ? '' : ' Send them a sign-in link so they can set a password.'}`);
    ctx.redirect(`/admin/users/${u.id}`);
  }, O);

  r.post('/admin/users/:id/delete', (ctx) => {
    const u = getUser(db, ctx.params.id);
    if (u.role !== 'participant') throw new HttpError(400, 'Coaches and admins can be turned off, not deleted, so their notes stay on record.');
    if (ctx.body.confirm !== 'DELETE') { ctx.setFlash('Type DELETE to confirm.', 'err'); return ctx.redirect(`/admin/users/${u.id}`); }
    deleteParticipant(u);
    audit.log(db, ctx.user, 'delete', { id: null, name: u.name }, u.is_test ? 'test participant' : u.email);
    ctx.setFlash(`${u.name} was permanently deleted.`);
    ctx.redirect('/admin/users');
  }, O);

  // ---------------------------------------------------------------- Activity log
  r.get('/admin/log', (ctx) => {
    const page = Math.max(1, Number(ctx.query.page) || 1);
    const rows = db.all('SELECT * FROM admin_log ORDER BY id DESC LIMIT 101 OFFSET ?', (page - 1) * 100);
    ctx.html(layout(ctx, { title: 'Activity log', nav: 'admin', body: html`${pageHead('Activity log', 'Every admin action, including each time someone signed in as another person.')}${tabs('log')}
<section class="panel">${logRows(ctx, rows.slice(0, 100))}
<p class="inline">${page > 1 ? html`<a class="btn small ghost" href="/admin/log?page=${page - 1}">← Newer</a>` : ''}${rows.length > 100 ? html`<a class="btn small ghost" href="/admin/log?page=${page + 1}">Older →</a>` : ''}</p></section>` }));
  }, O);
};
