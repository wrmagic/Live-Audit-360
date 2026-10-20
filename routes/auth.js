'use strict';
// Sign in and out, invite links (choose a password), forgotten passwords, and the phone app files.
const { html } = require('../lib/html');
const { bare, csrfField } = require('../lib/views');
const auth = require('../lib/auth');
const mail = require('../lib/mail');
const { str, validEmail, sendInvite } = require('../lib/site');

const home = (u) => (u.role === 'participant' ? '/m' : '/');

function loginPage(ctx, { error, email = '' } = {}) {
  const next = typeof ctx.query.next === 'string' ? ctx.query.next : '';
  return bare('Sign in', html`<h2>Sign in</h2>
${error ? html`<p class="flash err" role="alert">${error}</p>` : ''}
<form method="post" action="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">${csrfField(ctx)}
<label class="fld"><span>Email</span><input type="email" name="email" value="${email}" required autocomplete="email" autofocus></label>
<label class="fld"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn primary wide">Sign in</button></form>
<p class="auth-links"><a href="/forgot">Forgot your password?</a></p>`);
}

function passwordPage(ctx, u, error) {
  // Someone who already has a password: the link signs them straight in (they can also pick a new password).
  if (u.password_hash) {
    return bare('Welcome back', html`<h2>Welcome back, ${u.name.split(' ')[0]}</h2>
<p class="muted">This link signs you in as <b>${u.email}</b>.</p>
${error ? html`<p class="flash err" role="alert">${error}</p>` : ''}
<form method="post">${csrfField(ctx)}<input type="hidden" name="continue" value="1"><button class="btn primary wide">Continue</button></form>
<details class="newpw"><summary>Forgot your password? Choose a new one</summary>
<form method="post">${csrfField(ctx)}
<label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
<label class="fld"><span>Type it again</span><input type="password" name="password2" required minlength="8" autocomplete="new-password"></label>
<button class="btn wide">Save and continue</button></form></details>`);
  }
  return bare('Choose a password', html`<h2>Welcome, ${u.name.split(' ')[0]}</h2>
<p class="muted">Choose a password to sign in with <b>${u.email}</b>.</p>
${error ? html`<p class="flash err" role="alert">${error}</p>` : ''}
<form method="post">${csrfField(ctx)}
<label class="fld"><span>Password</span><input type="password" name="password" required minlength="8" autocomplete="new-password" autofocus></label>
<label class="fld"><span>Type it again</span><input type="password" name="password2" required minlength="8" autocomplete="new-password"></label>
<p class="hint">At least 8 characters.</p>
<button class="btn primary wide">Save and continue</button></form>`);
}

// Simple brake on password guessing: per email, 10 tries per 15 minutes.
const tries = new Map();
function limited(key) {
  const now = Date.now(); const t = (tries.get(key) || []).filter((x) => now - x < 15 * 60e3);
  t.push(now); tries.set(key, t);
  return t.length > 10;
}

module.exports = (r, { db }) => {
  r.get('/', (ctx) => ctx.redirect(ctx.user ? (ctx.user.role === 'participant' ? '/m' : '/participants') : '/login'), { public: true });

  r.get('/login', (ctx) => (ctx.user ? ctx.redirect(home(ctx.user)) : ctx.html(loginPage(ctx))), { public: true });
  r.post('/login', (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    if (limited(email)) return ctx.html(loginPage(ctx, { error: 'Too many tries. Wait 15 minutes and try again.', email }), 429);
    const u = db.get('SELECT * FROM users WHERE email=? AND active=1', email);
    if (!u || !auth.verifyPassword(ctx.body.password || '', u.password_hash)) {
      return ctx.html(loginPage(ctx, { error: u && !u.password_hash ? 'You haven’t chosen a password yet. Use the link in your invite, or ask your coach to send a new one.' : 'That email and password don’t match.', email }), 401);
    }
    tries.delete(email);
    ctx.setCookie('sid', auth.createSession(db, u), { maxAge: 60 * 864e2 });
    const next = ctx.back(null);
    ctx.redirect(next && next !== '/login' ? next : home(u));
  }, { public: true });

  r.post('/logout', (ctx) => {
    auth.destroySession(db, ctx.sessionToken);
    ctx.setCookie('sid', '', { maxAge: 0 });
    ctx.redirect('/login');
  }, { public: true });

  // ---- invite / reset links
  r.get('/invite/:token', (ctx) => {
    const u = auth.findInvite(db, ctx.params.token);
    if (!u) return ctx.html(bare('Link expired', html`<h2>This link has expired</h2><p class="muted">Invite and reset links work once, for ${auth.INVITE_DAYS} days. Ask your coach to send a new one, or <a href="/forgot">reset your password</a>.</p><p><a class="btn wide" href="/login">Go to sign in</a></p>`), 410);
    ctx.html(passwordPage(ctx, u));
  }, { public: true });
  r.post('/invite/:token', (ctx) => {
    const u = auth.findInvite(db, ctx.params.token);
    if (!u) return ctx.redirect(`/invite/${encodeURIComponent(ctx.params.token)}`);
    const signIn = () => {
      db.run('DELETE FROM sessions WHERE user_id=?', u.id);
      ctx.setCookie('sid', auth.createSession(db, u), { maxAge: 60 * 864e2 });
      ctx.redirect(u.role === 'participant' ? '/m?welcome=1' : '/participants');
    };
    if (ctx.body.continue && u.password_hash) {
      db.run('UPDATE users SET invite_hash=NULL, invite_token=NULL, invite_expires=NULL WHERE id=?', u.id);
      return signIn();
    }
    const pw = ctx.body.password || '';
    if (pw.length < 8) return ctx.html(passwordPage(ctx, u, 'Use at least 8 characters.'), 400);
    if (pw !== ctx.body.password2) return ctx.html(passwordPage(ctx, u, 'The two passwords don’t match.'), 400);
    db.run('UPDATE users SET password_hash=?, invite_hash=NULL, invite_token=NULL, invite_expires=NULL WHERE id=?', auth.hashPassword(pw), u.id);
    signIn();
  }, { public: true });

  // ---- forgotten password
  r.get('/forgot', (ctx) => ctx.html(bare('Forgot password', html`<h2>Forgot your password?</h2>
${mail.configured() ? html`<p class="muted">Enter your email and we’ll send you a link to choose a new one.</p>
<form method="post">${csrfField(ctx)}<label class="fld"><span>Email</span><input type="email" name="email" required autocomplete="email" autofocus></label><button class="btn primary wide">Send the link</button></form>`
    : html`<p class="muted">Ask your coach to send you a new sign-in link. They can do it from your page in Life Audit 360.</p>`}
<p class="auth-links"><a href="/login">Back to sign in</a></p>`)), { public: true });
  r.post('/forgot', async (ctx) => {
    const email = str(ctx.body.email).toLowerCase();
    if (validEmail(email) && !limited('forgot:' + email)) {
      const u = db.get('SELECT * FROM users WHERE email=? AND active=1', email);
      if (u) await sendInvite(ctx, u, { reset: true });
    }
    ctx.html(bare('Check your email', html`<h2>Check your email</h2><p class="muted">If ${email} has an account, a link to choose a new password is on its way.</p><p class="auth-links"><a href="/login">Back to sign in</a></p>`));
  }, { public: true });

  // ---- installable phone app
  r.get('/manifest.webmanifest', (ctx) => ctx.send(200, JSON.stringify({
    name: 'Life Audit 360', short_name: 'Life Audit', start_url: '/m', scope: '/', display: 'standalone',
    background_color: '#15111b', theme_color: '#15111b',
    icons: [
      { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/static/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }), 'application/manifest+json'), { public: true });

  r.get('/sw.js', (ctx) => ctx.send(200, `// Life Audit 360 service worker: lets the app install, and shows a friendly page when offline.
const OFFLINE = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#15111b;color:#fff;display:grid;place-items:center;height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:22px">You’re offline</h1><p style="opacity:.8">Life Audit 360 needs a connection to save your answers. Try again when you’re back online.</p></div>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});`, 'text/javascript; charset=utf-8', { 'Cache-Control': 'no-cache' }), { public: true });
};
