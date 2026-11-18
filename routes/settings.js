'use strict';
// My settings, for everyone: name, email, phone, time zone, password, and light/dark colors.
// Coaches and admins reach it from their initials (top right) at /settings; participants at /m/me.
const { html, raw } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const T = require('../lib/themes');
const { str, validEmail, ZONES } = require('../lib/site');

const home = (u) => (u.role === 'participant' ? '/m/me' : '/settings');

function swatch(key) {
  const p = T.PALETTES[key].preview;
  return html`<span class="swatch" style="background:${p.bg}"><span class="sw-bar" style="background:${p.bar}"></span><span class="sw-card" style="background:${p.surface}"><i style="background:${p.ink}"></i><i style="background:${p.q}"></i><b style="background:${p.accent}"></b></span></span>`;
}

/** The settings forms (used inside the coach frame or the phone frame). */
function settingsBody(ctx, u) {
  const tp = T.prefs(u);
  const opt = (name, value, checked, inner) => html`<label class="theme-opt"><input type="radio" name="${name}" value="${value}"${checked ? raw(' checked') : ''}><span>${inner}</span></label>`;
  return html`
<form method="post" action="/settings/appearance" class="card settings-card" data-theme-form>${csrfField(ctx)}<h3>${icon('target')} Appearance</h3>
<p class="hint">Changes show right away. Save to keep them on every device you use.</p>
<div class="modes">${Object.entries(T.MODES).map(([k, l]) => opt('mode', k, tp.mode === k, html`<b>${l}</b><small>${k === 'auto' ? 'Follows your phone or computer' : k === 'dark' ? 'Easy on the eyes at night' : 'Bright and clear'}</small>`))}</div>
<h4>Light colors</h4><div class="palettes">${T.lights().map((k) => opt('light', k, tp.light === k, html`${swatch(k)}<b>${T.PALETTES[k].label}</b><small>${T.PALETTES[k].note}</small>`))}</div>
<h4>Dark colors</h4><div class="palettes">${T.darks().map((k) => opt('dark', k, tp.dark === k, html`${swatch(k)}<b>${T.PALETTES[k].label}</b><small>${T.PALETTES[k].note}</small>`))}</div>
<button class="btn primary">Save appearance</button></form>

<form method="post" action="/settings/profile" class="card settings-card">${csrfField(ctx)}<h3>${icon('user')} About you</h3>
<label class="fld"><span>Name</span><input name="name" value="${u.name}" required maxlength="100" autocomplete="name"></label>
${u.is_test ? '' : html`<label class="fld"><span>Email <em>you sign in with this</em></span><input type="email" name="email" value="${u.email}" required autocomplete="email"></label>`}
<label class="fld"><span>Mobile phone <em>optional</em></span><input type="tel" name="phone" value="${u.phone || ''}" maxlength="40" autocomplete="tel"></label>
<label class="fld"><span>Time zone</span><select name="timezone">${[...new Set([u.timezone, ...ZONES])].map((z) => html`<option${z === u.timezone ? raw(' selected') : ''}>${z}</option>`)}</select></label>
${u.role === 'participant' ? html`<p class="hint">Your program days change over at midnight in this time zone.</p>` : ''}
${u.is_test ? '' : html`<label class="fld"><span>Current password <em>only needed to change your email</em></span><input type="password" name="current" autocomplete="current-password"></label>`}
<button class="btn">Save</button></form>

<form method="post" action="/settings/password" class="card settings-card">${csrfField(ctx)}<h3>${icon('alert')} Change password</h3>
<label class="fld"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label>
<label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
<button class="btn">Change password</button></form>`;
}

module.exports = (r, { db }) => {
  r.get('/settings', (ctx) => {
    if (ctx.user.role === 'participant') return ctx.redirect('/m/me');
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    ctx.html(layout(ctx, { title: 'My settings', nav: 'settings', body: html`<div class="page-head"><div><p class="eyebrow">${u.email}</p><h1>My settings</h1></div></div>
<div class="settings-grid">${settingsBody(ctx, u)}</div>
<form method="post" action="/logout" class="gap">${csrfField(ctx)}<button class="btn ghost">${icon('logout')} Sign out</button></form>` }));
  });

  r.post('/settings/appearance', (ctx) => {
    const tp = T.prefs({ theme_mode: ctx.body.mode, theme_light: ctx.body.light, theme_dark: ctx.body.dark });
    db.run('UPDATE users SET theme_mode=?, theme_light=?, theme_dark=? WHERE id=?', tp.mode, tp.light, tp.dark, ctx.user.id);
    if (ctx.wantsJson) return ctx.json({ ok: true, ...tp });
    ctx.setFlash('Appearance saved.');
    ctx.redirect(home(ctx.user));
  });

  r.post('/settings/profile', (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    const back = home(u);
    const name = str(ctx.body.name, 100);
    let tz = str(ctx.body.timezone, 60);
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = u.timezone; }
    if (!name) { ctx.setFlash('Enter your name.', 'err'); return ctx.redirect(back); }
    const upd = { name, phone: str(ctx.body.phone, 40) || null, timezone: tz };
    const email = str(ctx.body.email).toLowerCase();
    if (!u.is_test && email && email !== u.email) {
      if (!validEmail(email)) { ctx.setFlash('That email address doesn’t look right.', 'err'); return ctx.redirect(back); }
      if (!auth.verifyPassword(ctx.body.current || '', u.password_hash)) { ctx.setFlash('Enter your current password to change your email.', 'err'); return ctx.redirect(back); }
      if (db.get('SELECT id FROM users WHERE email=? AND id<>?', email, u.id)) { ctx.setFlash('Another login already uses that email.', 'err'); return ctx.redirect(back); }
      upd.email = email;
    }
    db.update('users', u.id, upd);
    ctx.setFlash(upd.email ? `Saved. Sign in with ${email} from now on.` : 'Saved.');
    ctx.redirect(back);
  });

  r.post('/settings/password', (ctx) => {
    const u = db.get('SELECT * FROM users WHERE id=?', ctx.user.id);
    const back = home(u);
    if (!auth.verifyPassword(ctx.body.current || '', u.password_hash)) { ctx.setFlash('Your current password isn’t right.', 'err'); return ctx.redirect(back); }
    if ((ctx.body.password || '').length < 8) { ctx.setFlash('Use at least 8 characters.', 'err'); return ctx.redirect(back); }
    db.run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(ctx.body.password), u.id);
    db.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', u.id, ctx.user.token_hash);
    ctx.setFlash('Password changed. You’ve been signed out on your other devices.');
    ctx.redirect(back);
  });
};

module.exports.settingsBody = settingsBody;
