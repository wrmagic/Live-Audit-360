'use strict';
// Head coach: the coaching team (add coaches, resend links, remove).
const { html, dateTimeFmt } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const { sendInvite, str, validEmail } = require('../lib/site');

const O = { coach: true, head: true };

function linkPage(ctx, u, link, emailed, title) {
  return layout(ctx, { title, nav: 'coaches', body: html`<div class="page-head"><div><p class="eyebrow"><a href="/coaches">Coaches</a></p><h1>${title}</h1></div></div>
<section class="panel invite-done"><p>${emailed ? html`We emailed a link to <b>${u.email}</b>.` : html`Email isn’t set up on this site, so send <b>${u.name}</b> this link yourself:`}</p>
<div class="copy"><input readonly value="${link}" data-copy><button type="button" class="btn" data-copybtn>Copy link</button></div>
<p><a class="btn" href="/coaches">Back to coaches</a></p></section>` });
}

module.exports = (r, { db }) => {
  r.get('/coaches', (ctx) => {
    const list = db.all(`SELECT u.*, (SELECT COUNT(*) FROM users p WHERE p.coach_id=u.id AND p.role='participant' AND p.active=1) clients
      FROM users u WHERE u.role IN ('head','coach') AND u.active=1 ORDER BY u.role='head' DESC, u.name`);
    ctx.html(layout(ctx, { title: 'Coaches', nav: 'coaches', body: html`
<div class="page-head"><div><p class="eyebrow">Your team</p><h1>Coaches</h1></div></div>
<div class="cols">
<section class="panel"><table class="list"><thead><tr><th>Coach</th><th>Clients</th><th>Last here</th><th></th></tr></thead><tbody>
${list.map((c) => html`<tr><td><b>${c.name}</b>${c.role === 'head' ? html` <span class="pill on">Head coach</span>` : ''}<small>${c.email}</small>${c.password_hash ? '' : html`<small class="warn-text">Hasn’t accepted invite</small>`}</td>
<td><a href="/participants?coach=${c.id}&show=all">${c.clients}</a></td><td>${c.last_seen ? dateTimeFmt(c.last_seen, ctx.user.timezone) : '—'}</td>
<td class="actions">${c.role === 'coach' ? html`<form method="post" action="/coaches/${c.id}/invite">${csrfField(ctx)}<button class="link">New link</button></form>
<form method="post" action="/coaches/${c.id}/remove">${csrfField(ctx)}<button class="link danger" data-confirm="Remove ${c.name}? Their clients move to you.">Remove</button></form>` : ''}</td></tr>`)}
</tbody></table></section>
<form method="post" action="/coaches" class="panel">${csrfField(ctx)}<h3>${icon('plus')} Add a coach</h3>
<label class="fld"><span>Full name</span><input name="name" required maxlength="100"></label>
<label class="fld"><span>Email</span><input type="email" name="email" required></label>
<p class="hint">Coaches see and manage only their own clients. You see everyone.</p>
<button class="btn primary">Add and send invite</button></form></div>
<section class="panel"><h3>Change your password</h3><form method="post" action="/coaches/me/password" class="inline">${csrfField(ctx)}
<input type="password" name="current" placeholder="Current password" required autocomplete="current-password"> <input type="password" name="password" placeholder="New password (8+ characters)" required minlength="8" autocomplete="new-password"> <button class="btn">Change</button></form></section>`,
    }));
  }, O);

  r.post('/coaches', async (ctx) => {
    const name = str(ctx.body.name, 100); const email = str(ctx.body.email).toLowerCase();
    if (!name || !validEmail(email)) throw new HttpError(400, 'Enter a name and a valid email.');
    if (db.get('SELECT id FROM users WHERE email=?', email)) throw new HttpError(400, 'Someone already uses that email.');
    const id = db.insert('users', { role: 'coach', name, email, timezone: ctx.user.timezone, created_at: new Date().toISOString() });
    const u = db.get('SELECT * FROM users WHERE id=?', id);
    const { link, emailed } = await sendInvite(ctx, u);
    ctx.html(linkPage(ctx, u, link, emailed, `${name} added`));
  }, O);

  r.post('/coaches/:id/invite', async (ctx) => {
    const u = db.get("SELECT * FROM users WHERE id=? AND role='coach' AND active=1", Number(ctx.params.id));
    if (!u) throw new HttpError(404, 'That coach wasn’t found.');
    const { link, emailed } = await sendInvite(ctx, u, { reset: !!u.password_hash });
    ctx.html(linkPage(ctx, u, link, emailed, 'New sign-in link'));
  }, O);

  r.post('/coaches/:id/remove', (ctx) => {
    const u = db.get("SELECT * FROM users WHERE id=? AND role='coach' AND active=1", Number(ctx.params.id));
    if (!u) throw new HttpError(404, 'That coach wasn’t found.');
    db.tx(() => {
      db.run("UPDATE users SET coach_id=? WHERE coach_id=? AND role='participant'", ctx.user.id, u.id);
      db.run('UPDATE users SET active=0, invite_hash=NULL WHERE id=?', u.id);
      db.run('DELETE FROM sessions WHERE user_id=?', u.id);
    });
    ctx.setFlash(`${u.name} was removed. Their clients are now yours.`);
    ctx.redirect('/coaches');
  }, O);

  // Any coach can change their own password
  r.post('/coaches/me/password', (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    if (!auth.verifyPassword(ctx.body.current || '', u.password_hash)) ctx.setFlash('Your current password isn’t right.', 'err');
    else if ((ctx.body.password || '').length < 8) ctx.setFlash('Use at least 8 characters.', 'err');
    else {
      db.run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(ctx.body.password), u.id);
      db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.token_hash);
      ctx.setFlash('Password changed.');
    }
    ctx.redirect(ctx.user.role === 'head' ? '/coaches' : '/videos');
  }, { coach: true });
};
