'use strict';
// Participant side of the Store: browse add-ons, start free items and trials, pay with PayPal (one-time or
// monthly), open what they own, cancel a subscription. Also the checkout for a coach-assigned program.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, raw, dateFmt } = require('../lib/html');
const { phone, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const P = require('../lib/program');
const PP = require('../lib/paypal');
const ST = require('../lib/store');

const O = { participant: true };
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const img = (p, cls = '') => (p.image ? html`<img class="${cls}" src="/store-image/${p.id}?v=${p.image.slice(-12, -4)}" alt="" loading="lazy">` : html`<span class="${cls} noimg">${icon(p.kind === 'program' ? 'target' : 'trophy')}</span>`);

function ownedText(pu, tz) {
  if (!pu) return '';
  if (pu.status === 'trial' && pu.trial_ends) return `Free trial until ${pu.trial_ends.length === 10 ? dateFmt(pu.trial_ends, 'dow') : dateFmt(pu.trial_ends.slice(0, 10), 'dow')}`;
  if (pu.status === 'active') return pu.paid_through ? `Subscribed · next payment ${dateFmt(pu.paid_through.slice(0, 10))}` : 'Subscribed';
  if (pu.status === 'cancelled' && ST.hasAccess(pu)) return `Cancelled · yours until ${dateFmt(pu.paid_through.slice(0, 10))}`;
  return ST.STATUS[pu.status] || pu.status;
}

/** The checkout page: PayPal's buttons for one purchase. */
function checkoutPage(ctx, pu, product, cfg, { back = '/m/store', heading } = {}) {
  const monthly = pu.fee === 'monthly';
  const sdk = cfg.ready ? `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=${encodeURIComponent(pu.currency)}${monthly ? '&vault=true&intent=subscription' : '&intent=capture'}&components=buttons` : null;
  return phone(ctx, { title: 'Checkout', back, tab: 'store', body: html`
<section class="card checkout">${product ? img(product, 'co-img') : ''}<div><p class="eyebrow">${heading || (product && product.kind === 'program' ? 'Your program' : 'Store')}</p><h2>${pu.name}</h2>
<p class="co-price">${ST.priceLabel({ ...pu, trial_days: monthly && product ? product.trial_days : 0 })}</p>
${product && product.description ? html`<p class="prewrap">${product.description}</p>` : ''}</div></section>
${pu.status === 'trial' ? html`<p class="tip">${icon('check')} ${ownedText(pu, ctx.user.timezone)}. Pay now to keep going after that.</p>` : ''}
${monthly && product && product.trial_days ? html`<p class="tip">You won’t be charged today. PayPal charges ${ST.fmt(pu.amount_cents, pu.currency)} after your 7-day free trial, then monthly. Cancel any time in the app.</p>` : ''}
${cfg.ready ? html`<div id="paypal-buttons" class="pp" data-kind="${monthly ? 'subscription' : 'order'}" data-start="/m/checkout/${pu.id}/start" data-finish="/m/checkout/${pu.id}/finish" data-csrf="${ctx.csrf}" data-next="${pu.enrollment_id ? '/m?paid=1' : `/m/store/${pu.product_id}`}"></div>
<p class="pp-status" data-pp-status></p>
<p class="hint center">Payments are handled by PayPal: use a PayPal account or a debit or credit card.${cfg.mode === 'sandbox' ? ' (Test mode: no real money is taken.)' : ''}</p>
<script src="${sdk}" data-namespace="paypal" defer></script>`
    : html`<div class="empty">${icon('alert')}<p>Online payment isn’t set up yet. Please contact your coach.</p></div>`}` });
}

module.exports = (r, { db, photoDir }) => {
  const imgDir = path.join(path.dirname(photoDir), 'store-images');
  const product = (id) => db.get('SELECT * FROM products WHERE id=?', Number(id));
  const mine = (ctx, id) => {
    const pu = db.get('SELECT * FROM purchases WHERE id=? AND user_id=?', Number(id), ctx.user.id);
    if (!pu) throw new HttpError(404, 'That purchase wasn’t found.');
    return pu;
  };

  // ---------------------------------------------------------------- Store
  r.get('/m/store', async (ctx) => {
    const items = db.all("SELECT * FROM products WHERE kind='addon' AND active=1 ORDER BY sort, id");
    const owned = db.all("SELECT p.*, pr.image, pr.kind FROM purchases p LEFT JOIN products pr ON pr.id=p.product_id WHERE p.user_id=? AND p.enrollment_id IS NULL ORDER BY p.id DESC", ctx.user.id);
    const cfg = PP.config(db);
    const latest = {};
    for (const pu of owned) if (!latest[pu.product_id]) latest[pu.product_id] = await ST.refresh(db, cfg, pu);
    const today = P.todayIn(ctx.user.timezone);
    ctx.html(phone(ctx, { title: 'Store', tab: 'store', body: html`
${items.length ? html`<div class="store">${items.map((p) => {
      const pu = latest[p.id]; const has = pu && ST.hasAccess(pu, today);
      return html`<a class="store-item${has ? ' owned' : ''}" href="/m/store/${p.id}">${img(p, 'si-img')}<span class="si-body"><b>${p.name}</b>
<span class="si-price">${has ? html`<span class="pill done">${icon('check')} ${ownedText(pu)}</span>` : ST.priceLabel(p)}</span>
${p.description ? html`<small>${p.description.slice(0, 110)}${p.description.length > 110 ? '…' : ''}</small>` : ''}</span></a>`;
    })}</div>` : html`<div class="empty">${icon('trophy')}<p>Nothing in the store yet.</p></div>`}` }));
  }, O);

  r.get('/m/store/:id', async (ctx) => {
    const p = product(ctx.params.id);
    if (!p || p.kind !== 'addon') throw new HttpError(404, 'That item wasn’t found.');
    let pu = db.get('SELECT * FROM purchases WHERE user_id=? AND product_id=? AND enrollment_id IS NULL ORDER BY id DESC LIMIT 1', ctx.user.id, p.id);
    pu = await ST.refresh(db, PP.config(db), pu);
    if (!p.active && !pu) throw new HttpError(404, 'That item isn’t available any more.');
    const has = pu && ST.hasAccess(pu, P.todayIn(ctx.user.timezone));
    const hadTrial = !!db.get('SELECT 1 FROM purchases WHERE user_id=? AND product_id=? AND trial_ends IS NOT NULL', ctx.user.id, p.id);
    const cta = p.fee === 'free' ? 'Get it free' : p.trial_days && !hadTrial ? (p.fee === 'monthly' ? `Start 7-day free trial, then ${ST.priceLabel(p, { trial: false })}` : 'Start 7-day free trial') : p.fee === 'monthly' ? `Subscribe · ${ST.priceLabel(p, { trial: false })}` : `Buy · ${ST.priceLabel(p, { trial: false })}`;
    ctx.html(phone(ctx, { title: p.name, back: '/m/store', tab: 'store', body: html`
<section class="card product">${img(p, 'pd-img')}<h2>${p.name}</h2><p class="co-price">${ST.priceLabel(p)}</p>${p.description ? html`<p class="prewrap">${p.description}</p>` : ''}</section>
${has ? html`<section class="card unlocked"><h3>${icon('check')} ${ownedText(pu)}</h3>
${p.unlock_text ? html`<p class="prewrap">${p.unlock_text}</p>` : ''}${p.unlock_url ? html`<p><a class="btn primary wide" href="${p.unlock_url}" target="_blank" rel="noopener">Open</a></p>` : ''}
${pu.status === 'trial' ? html`<p><a class="btn wide" href="/m/checkout/${pu.id}">Pay now · ${ST.priceLabel(p, { trial: false })}</a></p>` : ''}
${pu.status === 'active' ? html`<form method="post" action="/m/purchases/${pu.id}/cancel">${csrfField(ctx)}<button class="btn ghost wide" data-confirm="Cancel your subscription? You keep access until the end of the month you’ve paid for.">Cancel subscription</button></form>` : ''}</section>`
    : html`<form method="post" action="/m/store/${p.id}/get">${csrfField(ctx)}<button class="btn primary wide">${cta}</button></form>
${p.fee === 'one_time' && p.trial_days && !hadTrial ? html`<p class="hint center">No payment needed to start. After 7 days, pay ${ST.priceLabel(p, { trial: false })} to keep it.</p>` : ''}`}` }));
  }, O);

  r.post('/m/store/:id/get', (ctx) => {
    const p = product(ctx.params.id);
    if (!p || p.kind !== 'addon' || !p.active) throw new HttpError(404, 'That item isn’t available.');
    const pu = ST.startAddon(db, ctx.user, p);
    if (ST.hasAccess(pu, P.todayIn(ctx.user.timezone))) { ctx.setFlash(pu.status === 'trial' ? 'Your 7-day free trial has started.' : 'It’s yours.'); return ctx.redirect(`/m/store/${p.id}`); }
    ctx.redirect(`/m/checkout/${pu.id}`);
  }, O);

  // ---------------------------------------------------------------- Program payment (coach-assigned)
  r.get('/m/pay', (ctx) => {
    const e = P.currentEnrollment(db, ctx.user.id);
    const pu = e && ST.forEnrollment(db, e.id);
    if (!pu || ST.hasAccess(pu, P.todayIn(ctx.user.timezone))) return ctx.redirect('/m');
    ctx.redirect(`/m/checkout/${pu.id}`);
  }, O);

  // ---------------------------------------------------------------- Checkout
  r.get('/m/checkout/:id', (ctx) => {
    const pu = mine(ctx, ctx.params.id);
    if (!ST.payable(pu)) return ctx.redirect(pu.enrollment_id ? '/m' : `/m/store/${pu.product_id}`);
    const p = pu.product_id ? product(pu.product_id) : null;
    const trialOver = pu.status === 'trial' && !ST.hasAccess(pu, P.todayIn(ctx.user.timezone));
    ctx.html(checkoutPage(ctx, pu, p, PP.config(db), {
      back: pu.enrollment_id ? '/m/me' : `/m/store/${pu.product_id}`,
      heading: pu.enrollment_id ? (trialOver ? 'Your free week is over' : 'Before you start') : null,
    }));
  }, O);

  // Start: create the PayPal order (one-time) or make sure the monthly plan exists
  r.post('/m/checkout/:id/start', async (ctx) => {
    const pu = mine(ctx, ctx.params.id);
    if (!ST.payable(pu)) throw new HttpError(400, 'This is already paid.');
    const cfg = PP.config(db);
    if (!cfg.ready) throw new HttpError(400, 'Online payment isn’t set up yet.');
    try {
      if (pu.fee === 'monthly') return ctx.json(await ST.startSubscription(db, cfg, pu));
      return ctx.json({ id: await ST.startOrder(db, cfg, pu) });
    } catch (e) { console.error('PayPal start:', e.message); throw new HttpError(502, `PayPal isn’t responding right now (${e.message}).`); }
  }, { participant: true, binary: true });

  // Finish: capture the order, or confirm the subscription, and check it with PayPal
  r.post('/m/checkout/:id/finish', async (ctx) => {
    const pu = mine(ctx, ctx.params.id);
    let body = {};
    try { body = JSON.parse(ctx.rawBuffer.toString('utf8') || '{}'); } catch { /* empty */ }
    const cfg = PP.config(db);
    const res = pu.fee === 'monthly' ? await ST.finishSubscription(db, cfg, pu, String(body.subscriptionID || '')) : await ST.finishOrder(db, cfg, pu, String(body.orderID || ''));
    if (!res.ok) return ctx.json({ error: res.error }, 400);
    require('../lib/audit').log(db, ctx.user, 'payment', null, `${pu.name}: ${pu.fee === 'monthly' ? 'subscribed' : 'paid'} ${ST.fmt(pu.amount_cents, pu.currency)}`);
    ctx.json({ ok: true });
  }, { participant: true, binary: true });

  r.post('/m/purchases/:id/cancel', async (ctx) => {
    const pu = mine(ctx, ctx.params.id);
    if (pu.status !== 'active' || !pu.paypal_subscription_id) throw new HttpError(400, 'That isn’t an active subscription.');
    try { await PP.cancelSubscription(PP.config(db), pu.paypal_subscription_id, 'Cancelled by the member in Life Audit 360'); } catch (e) { throw new HttpError(502, `PayPal couldn’t cancel it right now (${e.message}). Please try again.`); }
    ST.update(db, pu.id, { status: 'cancelled', last_checked: new Date().toISOString() });
    ctx.setFlash(pu.paid_through ? `Cancelled. You keep access until ${dateFmt(pu.paid_through.slice(0, 10))}.` : 'Cancelled.');
    ctx.redirect(pu.product_id ? `/m/store/${pu.product_id}` : '/m/store');
  }, O);

  // ---------------------------------------------------------------- Product pictures
  r.get('/store-image/:id', (ctx) => {
    const p = product(ctx.params.id);
    if (!p || !p.image) throw new HttpError(404, 'No picture.');
    let buf; try { buf = fs.readFileSync(path.join(imgDir, p.image)); } catch { throw new HttpError(404, 'No picture.'); }
    const ext = path.extname(p.image).slice(1);
    ctx.res.writeHead(200, { 'Content-Type': ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(buf);
  });

  r.post('/admin/store/:id/image', (ctx) => {
    const p = product(ctx.params.id);
    if (!p) throw new HttpError(404, 'That item wasn’t found.');
    const type = sniff(ctx.rawBuffer);
    if (!type) throw new HttpError(415, 'Use a JPEG, PNG or WebP picture.');
    fs.mkdirSync(imgDir, { recursive: true });
    const name = `${p.id}-${crypto.randomBytes(6).toString('hex')}.${IMG_TYPES[type]}`;
    fs.writeFileSync(path.join(imgDir, name), ctx.rawBuffer);
    if (p.image) { try { fs.unlinkSync(path.join(imgDir, p.image)); } catch { /* gone */ } }
    db.run('UPDATE products SET image=? WHERE id=?', name, p.id);
    ctx.json({ ok: true });
  }, { coach: true, super: true, binary: true, maxBody: 8 * 1024 * 1024 });
};

module.exports.img = img;
