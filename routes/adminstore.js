'use strict';
// Admin → Store: programs and add-ons (picture, description, fee, 7-day trial), every purchase, and the
// PayPal settings. Super admins only.
const { html, raw, dateTimeFmt } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const audit = require('../lib/audit');
const S = require('../lib/settings');
const PP = require('../lib/paypal');
const ST = require('../lib/store');
const { str } = require('../lib/site');
const { tabs, pageHead } = require('./admin');
const { img } = require('./store');

const O = { coach: true, super: true };
const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD'];

function productForm(ctx, p = {}, progs = []) {
  const isNew = !p.id;
  return html`<form method="post" action="${isNew ? '/admin/store' : `/admin/store/${p.id}`}" class="panel form-grid">${csrfField(ctx)}
<h3 class="span2">${isNew ? html`${icon('plus')} Add to the store` : `Edit: ${p.name}`}</h3>
<label class="fld"><span>Type</span><select name="kind"><option value="program"${p.kind === 'program' ? raw(' selected') : ''}>Program: coaches assign it when inviting</option><option value="addon"${p.kind !== 'program' ? raw(' selected') : ''}>Add-on: participants buy it in the Store</option></select></label>
<label class="fld"><span>Name</span><input name="name" value="${p.name || ''}" required maxlength="100"></label>
<label class="fld span2"><span>Which program it’s the price for <em>programs only</em></span><select name="program_id">${progs.map((g) => html`<option value="${g.id}"${g.id === p.program_id ? raw(' selected') : ''}>${g.name}</option>`)}</select></label>
<label class="fld span2"><span>Description <em>what it is and why it helps</em></span><textarea name="description" rows="3" maxlength="2000">${p.description || ''}</textarea></label>
<label class="fld"><span>Fee</span><select name="fee" data-fee>${Object.entries(ST.FEE).map(([k, l]) => html`<option value="${k}"${(p.fee || 'one_time') === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
<label class="fld" data-price><span>Price</span><span class="money"><input name="price" inputmode="decimal" value="${p.price_cents ? (p.price_cents / 100).toFixed(2) : ''}" placeholder="0.00"><select name="currency">${CURRENCIES.map((c) => html`<option${(p.currency || 'USD') === c ? raw(' selected') : ''}>${c}</option>`)}</select></span></label>
<label class="check span2" data-price><input type="checkbox" name="trial" value="1"${p.trial_days ? raw(' checked') : ''}> Offer a 7-day free trial</label>
<p class="hint span2" data-price>One-time: 7 days of access with no payment details (for the 14-day program, that’s Week 1; they pay to unlock Week 2). Monthly: they approve the PayPal subscription up front and are first charged after 7 days.</p>
<label class="fld span2"><span>What they get once it’s theirs <em>add-ons: shown after they buy</em></span><textarea name="unlock_text" rows="3" maxlength="4000" placeholder="e.g. Welcome! Here’s your 30-day meal plan…">${p.unlock_text || ''}</textarea></label>
<label class="fld span2"><span>Link <em>optional: a video series, PDF, booking page…</em></span><input type="url" name="unlock_url" value="${p.unlock_url || ''}" placeholder="https://…"></label>
<label class="fld"><span>Order</span><input type="number" name="sort" value="${p.sort ?? 0}" min="0" max="999"></label>
<label class="check"><input type="checkbox" name="active" value="1"${p.active === 0 ? '' : raw(' checked')}> Available</label>
<div class="span2"><button class="btn primary">${isNew ? 'Add' : 'Save'}</button>${isNew ? '' : html` <a class="btn ghost" href="/admin/store">Done</a>`}</div>
${isNew ? html`<p class="hint span2">You can add a picture after saving.</p>` : ''}</form>`;
}

function cleanProduct(b, db) {
  const kind = b.kind === 'program' ? 'program' : 'addon';
  const fee = ST.FEE[b.fee] ? b.fee : 'one_time';
  const name = str(b.name, 100);
  if (!name) throw new HttpError(400, 'Give it a name.');
  const price = Math.round(Number(String(b.price || '').replace(/[$,\s]/g, '')) * 100);
  if (fee !== 'free' && !(price >= 100)) throw new HttpError(400, 'Enter a price of at least 1.00, or choose “Free forever”.');
  const url = str(b.unlock_url, 500);
  if (url && !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'Links need to start with https://.');
  return {
    program_id: kind === 'program' ? (db.get('SELECT id FROM programs WHERE id=?', Number(b.program_id)) || db.get('SELECT id FROM programs WHERE builtin=1')).id : null,
    kind, fee, name, description: str(b.description, 2000) || null, price_cents: fee === 'free' ? 0 : price,
    currency: CURRENCIES.includes(b.currency) ? b.currency : 'USD', trial_days: fee !== 'free' && b.trial ? 7 : 0,
    unlock_text: str(b.unlock_text, 4000) || null, unlock_url: url || null, sort: Math.max(0, Math.min(999, Number(b.sort) || 0)), active: b.active ? 1 : 0,
  };
}

module.exports = (r, { db }) => {
  r.get('/admin/store', (ctx) => {
    const products = db.all('SELECT p.*, g.name program_name, (SELECT COUNT(*) FROM purchases u WHERE u.product_id=p.id) sold FROM products p LEFT JOIN programs g ON g.id=p.program_id ORDER BY p.kind DESC, p.sort, p.id');
    const editing = ctx.query.edit ? products.find((p) => p.id === Number(ctx.query.edit)) : null;
    const purchases = db.all(`SELECT u.*, us.name person FROM purchases u JOIN users us ON us.id=u.user_id ORDER BY u.id DESC LIMIT 100`);
    const cfg = PP.config(db);
    const paid = db.get("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) c FROM purchases WHERE status IN ('paid','active') AND paid_at IS NOT NULL AND fee='one_time'");
    const subs = db.get("SELECT COUNT(*) n FROM purchases WHERE status='active'").n;
    const list = (kind) => products.filter((p) => p.kind === kind);
    const row = (p) => html`<tr class="${p.active ? '' : 'off'}"><td class="thumb">${img(p, 'th-img')}</td><td><b>${p.name}</b><small>${p.kind === 'program' && p.program_name ? `${p.program_name} · ` : ''}${ST.FEE[p.fee]}${p.trial_days ? ' · 7-day trial' : ''}</small></td><td>${ST.priceLabel(p, { trial: false })}</td><td>${p.sold}</td><td class="actions"><a class="link" href="/admin/store?edit=${p.id}#edit">Edit</a></td></tr>`;
    ctx.html(layout(ctx, { title: 'Store', nav: 'admin', body: html`${pageHead('Store', 'Programs coaches assign, add-ons participants buy, and every purchase.')}${tabs('store')}
${!cfg.ready ? html`<p class="notice">${icon('alert')} PayPal isn’t connected yet, so paid items can’t be bought. <a href="/admin/settings#paypal">Connect PayPal</a></p>` : cfg.mode === 'sandbox' ? html`<p class="notice">${icon('alert')} PayPal is in Sandbox (test) mode: no real money is taken. Switch to Live in <a href="/admin/settings#paypal">Settings</a> when you’re ready.</p>` : ''}
<section class="kpis"><div class="kpi"><b>${paid.n}</b><span>One-time payments (${ST.fmt(paid.c)})</span></div><div class="kpi"><b>${subs}</b><span>Active subscriptions</span></div><div class="kpi"><b>${list('program').length}</b><span>Programs</span></div><div class="kpi"><b>${list('addon').length}</b><span>Add-ons</span></div></section>
<div class="cols">
<div>
<section class="panel"><h3>${icon('target')} Program prices</h3>${list('program').length ? html`<table class="list"><tbody>${list('program').map(row)}</tbody></table>` : html`<p class="muted">None yet. Coaches can still invite people at no charge.</p>`}</section>
<section class="panel"><h3>${icon('trophy')} Add-ons <small>in-app purchases</small></h3>${list('addon').length ? html`<table class="list"><tbody>${list('addon').map(row)}</tbody></table>` : html`<p class="muted">None yet.</p>`}</section>
</div>
<div id="edit">${productForm(ctx, editing || {}, db.all('SELECT id, name FROM programs ORDER BY active DESC, builtin DESC, name'))}
${editing ? html`<section class="panel"><h3>Picture</h3>${editing.image ? img(editing, 'pd-preview') : html`<p class="muted">No picture yet.</p>`}
<div class="upload" data-upload="/admin/store/${editing.id}/image" data-csrf="${ctx.csrf}"><label class="btn">${icon('camera')} ${editing.image ? 'Change picture' : 'Add a picture'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-file></label><p class="upload-status" data-status></p></div>
<p class="hint">A square or 4:3 photo works best. It’s shrunk to 1600px before uploading.</p></section>` : ''}
</div></div>
<section class="panel"><h3>${icon('cal')} Purchases <small>latest 100</small></h3>
${purchases.length ? html`<table class="list"><thead><tr><th>When</th><th>Who</th><th>Item</th><th>Amount</th><th>Status</th><th>PayPal</th></tr></thead><tbody>${purchases.map((u) => html`<tr data-href="/participants/${u.user_id}?tab=settings"><td>${dateTimeFmt(u.paid_at || u.created_at, ctx.user.timezone)}</td><td><a href="/participants/${u.user_id}?tab=settings">${u.person}</a>${u.payer_email ? html`<small>${u.payer_email}</small>` : ''}</td><td>${u.name}${u.enrollment_id ? html`<small>Program</small>` : ''}</td><td>${u.fee === 'free' ? 'Free' : ST.priceLabel(u, { trial: false })}</td>
<td><span class="pill ${['paid', 'active', 'free', 'comped'].includes(u.status) ? 'done' : u.status === 'trial' ? 'on' : 'warn'}">${ST.STATUS[u.status] || u.status}</span>${u.note ? html`<small>${u.note.slice(0, 90)}</small>` : ''}</td><td><small>${u.paypal_capture_id || u.paypal_subscription_id || '—'}</small></td></tr>`)}</tbody></table>
<p class="hint">Refunds are made in your PayPal account (Activity → the payment → Refund). Then mark it “Ended” on the person’s page if they shouldn’t keep access.</p>` : html`<p class="muted">No purchases yet.</p>`}</section>` }));
  }, O);

  r.post('/admin/store', (ctx) => {
    const v = cleanProduct(ctx.body, db);
    const id = db.insert('products', { ...v, created_at: new Date().toISOString() });
    audit.log(db, ctx.user, 'store', null, `added ${v.name}`);
    ctx.setFlash(`${v.name} added. Add a picture below.`);
    ctx.redirect(`/admin/store?edit=${id}#edit`);
  }, O);

  r.post('/admin/store/:id', (ctx) => {
    const p = db.get('SELECT * FROM products WHERE id=?', Number(ctx.params.id));
    if (!p) throw new HttpError(404, 'That item wasn’t found.');
    const v = cleanProduct(ctx.body, db);
    db.update('products', p.id, v);
    audit.log(db, ctx.user, 'store', null, `edited ${v.name}`);
    ctx.setFlash('Saved. Existing purchases keep the price they were bought at.');
    ctx.redirect(`/admin/store?edit=${p.id}#edit`);
  }, O);

  // ---------------------------------------------------------------- PayPal settings (shown in Admin → Settings)
  r.post('/admin/settings/paypal', async (ctx) => {
    const b = ctx.body;
    const back = '/admin/settings#paypal';
    if (b.clear) {
      for (const k of ['paypal.client_id', 'paypal.secret', 'paypal.mode']) S.set(db, k, null);
      audit.log(db, ctx.user, 'settings_paypal', null, 'disconnected PayPal');
      ctx.setFlash('PayPal disconnected.');
      return ctx.redirect(back);
    }
    const clientId = str(b.client_id, 200); const secret = str(b.secret, 200);
    if (!/^[A-Za-z0-9_-]{20,}$/.test(clientId)) { ctx.setFlash('Paste the Client ID from your PayPal app.', 'err'); return ctx.redirect(back); }
    if (!secret && !S.get(db, 'paypal.secret')) { ctx.setFlash('Paste the Secret from your PayPal app.', 'err'); return ctx.redirect(back); }
    const mode = b.mode === 'live' ? 'live' : 'sandbox';
    S.set(db, 'paypal.client_id', clientId, { by: ctx.user.id });
    if (secret) S.set(db, 'paypal.secret', secret, { secret: true, by: ctx.user.id });
    S.set(db, 'paypal.mode', mode, { by: ctx.user.id });
    audit.log(db, ctx.user, 'settings_paypal', null, `${mode}${secret ? ', new secret' : ''}`);
    try {
      await PP.test(PP.config(db));
      ctx.setFlash(`PayPal connected (${mode === 'live' ? 'Live: real payments' : 'Sandbox: test payments'}).`);
    } catch (e) {
      ctx.setFlash(`Saved, but PayPal didn’t accept these details: ${e.message}`, 'err');
    }
    ctx.redirect(back);
  }, O);

  r.post('/admin/settings/paypal/test', async (ctx) => {
    try { await PP.test(PP.config(db)); ctx.setFlash('PayPal connection works.'); } catch (e) { ctx.setFlash(`PayPal connection failed: ${e.message}`, 'err'); }
    ctx.redirect('/admin/settings#paypal');
  }, O);
};

/** The PayPal box for Admin → Settings. */
module.exports.paypalPanel = (ctx, db) => {
  const cfg = PP.config(db);
  return html`<form method="post" action="/admin/settings/paypal" class="panel" id="paypal" autocomplete="off">${csrfField(ctx)}<h3>${icon('cal')} Payments (PayPal)</h3>
<p>${cfg.ready ? html`<span class="pill done">Connected · ${cfg.mode === 'live' ? 'Live' : 'Sandbox (test)'}</span>` : html`<span class="pill warn">Not connected</span>`}</p>
<p class="muted">In <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener">developer.paypal.com → Apps &amp; Credentials</a>, sign in with your PayPal Business account, choose <b>Sandbox</b> or <b>Live</b> at the top, open (or create) an app, and copy its Client ID and Secret.</p>
<label class="fld"><span>Mode</span><select name="mode"><option value="sandbox"${cfg.mode !== 'live' ? raw(' selected') : ''}>Sandbox: test payments with PayPal’s test accounts</option><option value="live"${cfg.mode === 'live' ? raw(' selected') : ''}>Live: real payments</option></select></label>
<label class="fld"><span>Client ID</span><input name="client_id" value="${cfg.clientId || ''}" spellcheck="false" autocomplete="off"></label>
<label class="fld"><span>Secret ${cfg.secret ? html`<em>saved: ${S.hint(cfg.secret)}. Leave blank to keep it</em>` : ''}</span><input type="password" name="secret" autocomplete="new-password" spellcheck="false"></label>
<p class="hint">Sandbox and Live have different Client IDs and Secrets. The Secret is stored encrypted and never shown again.</p>
<p class="inline"><button class="btn primary">Save and test</button>${cfg.ready ? html`<button class="btn ghost" formaction="/admin/settings/paypal/test">Test connection</button><button class="btn ghost" name="clear" value="1" data-confirm="Disconnect PayPal? Paid items can’t be bought until it’s connected again.">Disconnect</button>` : ''}</p></form>`;
};
