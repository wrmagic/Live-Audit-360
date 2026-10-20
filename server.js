'use strict';
const http = require('node:http');
const path = require('node:path');
const { Router, HttpError, parseForm, readBody, serveStatic, makeCtx, safeEqual } = require('./lib/http');
const { open } = require('./lib/db');
const auth = require('./lib/auth');
const { html } = require('./lib/html');
const { head } = require('./lib/views');

const ROUTES = ['auth', 'participant', 'photos', 'testing', 'coach', 'coaches', 'videos'];

function createApp({ dbFile = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'la360.db') } = {}) {
  const db = open(dbFile);
  const photoDir = process.env.PHOTO_DIR || path.join(path.dirname(path.resolve(dbFile === ':memory:' ? path.join(__dirname, 'data', 'x') : dbFile)), 'photos');
  const router = new Router();
  for (const r of ROUTES) require(`./routes/${r}`)(router, { db, photoDir });
  const secureCookies = process.env.SECURE_COOKIES === '1' || (process.env.BASE_URL || '').startsWith('https://');
  const staticRoot = path.join(__dirname, 'public');

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/static/') && (req.method === 'GET' || req.method === 'HEAD')) {
      if (serveStatic(staticRoot, url.pathname, res)) return;
    }
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    const ctx = makeCtx(req, res, url, secureCookies);
    ctx.db = db;
    try {
      const m = router.match(req.method, url.pathname);
      if (!m) throw new HttpError(404, 'Page not found');
      if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      const { route, params } = m;
      ctx.params = params;

      ctx.sessionToken = ctx.cookies.sid;
      ctx.user = auth.loadSession(db, ctx.sessionToken);
      if (ctx.user) ctx.flash = route.opts.json || route.opts.binary || req.headers['x-autosave'] === '1' ? null : auth.takeFlash(db, ctx.user);
      ctx.setFlash = (msg, kind = 'ok') => auth.setFlash(db, ctx.user, msg, kind);

      if (!route.opts.public && !ctx.user) {
        if (req.method === 'GET') return ctx.redirect('/login?next=' + encodeURIComponent(url.pathname + url.search));
        throw new HttpError(401, 'Please sign in again.');
      }
      // Who may open which pages
      const role = ctx.user && ctx.user.role;
      if (route.opts.participant && role !== 'participant') {
        if (req.method === 'GET') return ctx.redirect('/');
        throw new HttpError(403, 'That page is for participants.');
      }
      if (route.opts.coach && role !== 'coach' && role !== 'head') {
        if (req.method === 'GET') return ctx.redirect('/m');
        throw new HttpError(403, 'That page is for coaches.');
      }
      if (route.opts.head && role !== 'head') throw new HttpError(403, 'Only the head coach can do that.');

      if (req.method === 'POST') {
        const buf = await readBody(req, route.opts.maxBody);
        if (route.opts.binary) {
          ctx.rawBuffer = buf;
          if (!safeEqual(req.headers['x-csrf'], ctx.csrf)) throw new HttpError(403, 'Your page expired. Refresh and try again.');
        } else {
          ctx.body = parseForm(buf.toString('utf8'));
          if (!safeEqual(ctx.body._csrf, ctx.csrf)) throw new HttpError(403, 'Your form expired. Go back, refresh the page and try again.');
        }
      }
      ctx.back = (def) => { const n = (ctx.body && ctx.body.next) || ctx.query.next; return typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.includes('\\') ? n : def; };
      ctx.wantsJson = req.headers['x-autosave'] === '1' || route.opts.json;
      await route.handler(ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return;
      const msg = status === 500 ? 'Something went wrong on our side. The error has been logged.' : err.message;
      if (ctx.wantsJson || req.headers['x-csrf']) return ctx.json({ error: msg }, status);
      const home = ctx.user ? (ctx.user.role === 'participant' ? '/m' : '/') : '/login';
      ctx.html(html`${head('Error')}<body class="bare"><main class="error-page"><h1>${status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong'}</h1><p>${msg}</p><p><a href="javascript:history.back()">Go back</a> or <a href="${home}">start over</a>.</p></main></body></html>`, status);
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.db = db;
  server.photoDir = photoDir;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dbFile = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'la360.db');
  // First start on a new server: create the head coach login.
  {
    const probe = open(dbFile);
    const empty = !probe.get('SELECT COUNT(*) n FROM users').n;
    probe.close();
    if (empty) {
      console.log('New database: running first-time setup…');
      require('node:child_process').spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'scripts', 'setup.js'), ...(process.env.SEED_DEMO === '1' ? ['--demo'] : [])], { stdio: 'inherit', env: process.env });
    }
  }
  const server = createApp({ dbFile });
  server.listen(port, () => console.log(`Life Audit 360 running on http://localhost:${port}`));
}

module.exports = { createApp };
