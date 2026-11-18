'use strict';
// The Store: who has what, whether they can use it right now, and PayPal checkout for one-time and monthly fees.
//
// Fees: one_time, monthly, free ("Free forever"). A 7-day free trial can be added to a paid item:
//   one-time: access for 7 days with no payment details (for a program: Days 1-7, pay to unlock Week 2)
//   monthly:  PayPal's trial: they approve the subscription now and are first charged after 7 days
const P = require('./program');
const PP = require('./paypal');

const FEE = { one_time: 'One-time', monthly: 'Monthly', free: 'Free forever' };
const STATUS = {
  pending: 'Payment due', trial: 'Free trial', paid: 'Paid', active: 'Subscribed', free: 'Free', comped: 'Given free',
  cancelled: 'Cancelled', expired: 'Ended', refunded: 'Refunded',
};

function fmt(cents, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
/** "$197", "$29/month", "Free" (plus the trial). */
function priceLabel(p, { trial = true } = {}) {
  if (p.fee === 'free') return 'Free';
  const base = p.fee === 'monthly' ? `${fmt(p.amount_cents ?? p.price_cents, p.currency)}/month` : fmt(p.amount_cents ?? p.price_cents, p.currency);
  return trial && p.trial_days ? `${base} · 7-day free trial` : base;
}

const nowIso = () => new Date().toISOString();

/** Can this purchase be used right now? today: the person's date (for program trials, which end at a date). */
function hasAccess(pu, today) {
  if (!pu) return true; // nothing to pay for
  if (['free', 'comped', 'paid', 'active'].includes(pu.status)) return true;
  if (pu.status === 'trial' && pu.trial_ends) return pu.trial_ends.length === 10 ? (today || P.todayIn()) < pu.trial_ends : nowIso() < pu.trial_ends;
  if (pu.status === 'cancelled' && pu.paid_through) return nowIso() < pu.paid_through;
  return false;
}

function insert(db, row) {
  const t = nowIso();
  return db.insert('purchases', { created_at: t, updated_at: t, ...row });
}
function update(db, id, fields) { db.update('purchases', id, { ...fields, updated_at: nowIso() }); }

/** The program's purchase for one program run (null = no charge). */
const forEnrollment = (db, enrollmentId) => db.get('SELECT * FROM purchases WHERE enrollment_id=? ORDER BY id DESC LIMIT 1', enrollmentId);

/** When a coach assigns a program: what the person owes, and any trial. product null = no charge. */
function assignProgram(db, user, enrollment, product, by) {
  db.run('DELETE FROM purchases WHERE enrollment_id=? AND status IN (\'pending\',\'trial\')', enrollment.id);
  if (!product) return null;
  const row = {
    user_id: user.id, product_id: product.id, enrollment_id: enrollment.id, name: product.name, fee: product.fee,
    amount_cents: product.fee === 'free' ? 0 : product.price_cents, currency: product.currency, created_by: by ? by.id : null,
  };
  if (product.fee === 'free') row.status = 'free';
  else if (product.fee === 'one_time' && product.trial_days) { row.status = 'trial'; row.trial_ends = P.addDays(enrollment.start_date, product.trial_days); }
  else row.status = 'pending';
  return insert(db, row);
}

/** After a program's Day 1 moves: its free week moves with it. */
function syncTrial(db, enrollmentId) {
  const e = db.get('SELECT * FROM enrollments WHERE id=?', enrollmentId);
  const pu = e && forEnrollment(db, e.id);
  if (pu && pu.status === 'trial' && pu.trial_ends && pu.trial_ends.length === 10) {
    const p = pu.product_id ? db.get('SELECT trial_days FROM products WHERE id=?', pu.product_id) : null;
    update(db, pu.id, { trial_ends: P.addDays(e.start_date, (p && p.trial_days) || 7) });
  }
}

/** A participant starts getting an add-on: free now, a one-time trial now, or a pending purchase to pay. */
function startAddon(db, user, product) {
  const mine = db.all('SELECT * FROM purchases WHERE user_id=? AND product_id=? ORDER BY id DESC', user.id, product.id);
  const usable = mine.find((x) => hasAccess(x, P.todayIn(user.timezone)));
  if (usable) return usable;
  const base = { user_id: user.id, product_id: product.id, name: product.name, fee: product.fee, amount_cents: product.fee === 'free' ? 0 : product.price_cents, currency: product.currency, created_by: user.id };
  if (product.fee === 'free') return db.get('SELECT * FROM purchases WHERE id=?', insert(db, { ...base, status: 'free' }));
  const hadTrial = mine.some((x) => x.trial_ends);
  if (product.fee === 'one_time' && product.trial_days && !hadTrial) {
    return db.get('SELECT * FROM purchases WHERE id=?', insert(db, { ...base, status: 'trial', trial_ends: new Date(Date.now() + product.trial_days * 864e5).toISOString() }));
  }
  const pending = mine.find((x) => x.status === 'pending');
  if (pending) return pending;
  return db.get('SELECT * FROM purchases WHERE id=?', insert(db, { ...base, status: 'pending' }));
}

/** A purchase someone can pay for now (pending, a trial, or ended). */
const payable = (pu) => !!pu && pu.fee !== 'free' && ['pending', 'trial', 'expired', 'cancelled'].includes(pu.status);

// ---------------------------------------------------------------- PayPal: one-time
async function startOrder(db, cfg, pu) {
  const o = await PP.createOrder(cfg, { cents: pu.amount_cents, currency: pu.currency, description: pu.name, reference: `p${pu.id}` });
  update(db, pu.id, { paypal_order_id: o.id });
  return o.id;
}

/** Capture and check the money actually collected matches what we asked for. Returns {ok, error}. */
async function finishOrder(db, cfg, pu, orderId) {
  if (!orderId || orderId !== pu.paypal_order_id) return { ok: false, error: 'That payment doesn’t match this purchase. Please try again.' };
  let c;
  try { c = await PP.captureOrder(cfg, orderId); } catch (e) {
    if (e.paypal && /ORDER_ALREADY_CAPTURED/.test(JSON.stringify(e.paypal))) return { ok: false, error: 'This payment was already completed. Refresh the page.' };
    return { ok: false, error: `PayPal couldn’t complete the payment (${e.message}).` };
  }
  const right = c.status === 'COMPLETED' && c.captureStatus === 'COMPLETED' && c.cents === pu.amount_cents && c.currency === pu.currency && c.reference === `p${pu.id}`;
  if (!right) {
    update(db, pu.id, { note: `PayPal capture didn’t match: ${c.status}/${c.captureStatus} ${c.cents} ${c.currency} ${c.reference}`, paypal_capture_id: c.captureId });
    return { ok: false, error: c.captureStatus === 'PENDING' ? 'PayPal is still processing this payment. Your coach will confirm it.' : 'The payment didn’t go through as expected. Your coach has been told.' };
  }
  update(db, pu.id, { status: 'paid', paid_at: nowIso(), paypal_capture_id: c.captureId, payer_email: c.payerEmail, trial_ends: null });
  return { ok: true };
}

// ---------------------------------------------------------------- PayPal: monthly
async function startSubscription(db, cfg, pu) {
  const product = db.get('SELECT * FROM products WHERE id=?', pu.product_id);
  if (!product) throw new Error('That item isn’t available any more.');
  const planId = await PP.ensurePlan(db, cfg, product);
  return { planId, customId: `p${pu.id}` };
}

async function finishSubscription(db, cfg, pu, subId) {
  let s;
  try { s = await PP.getSubscription(cfg, subId); } catch (e) { return { ok: false, error: `PayPal couldn’t confirm the subscription (${e.message}).` }; }
  const product = db.get('SELECT * FROM products WHERE id=?', pu.product_id);
  if (s.reference !== `p${pu.id}` || !product || s.planId !== product.paypal_plan_id) return { ok: false, error: 'That subscription doesn’t match this purchase.' };
  if (!['ACTIVE', 'APPROVED'].includes(s.status)) return { ok: false, error: `The subscription is ${String(s.status).toLowerCase()}. Please try again.` };
  update(db, pu.id, { status: 'active', paid_at: nowIso(), paypal_subscription_id: subId, paid_through: s.nextBilling, payer_email: s.payerEmail, last_checked: nowIso(), trial_ends: null });
  return { ok: true };
}

/** Check a subscription with PayPal (at most every 12 hours unless forced) and update access. */
async function refresh(db, cfg, pu, { force = false } = {}) {
  if (!pu || !pu.paypal_subscription_id || !cfg.ready) return pu;
  if (!force && pu.last_checked && Date.now() - new Date(pu.last_checked) < 12 * 3600e3) return pu;
  try {
    const s = await PP.getSubscription(cfg, pu.paypal_subscription_id);
    const map = { ACTIVE: 'active', APPROVED: 'active', SUSPENDED: 'cancelled', CANCELLED: 'cancelled', EXPIRED: 'expired' };
    const status = map[s.status] || pu.status;
    update(db, pu.id, { status, paid_through: s.nextBilling || pu.paid_through, last_checked: nowIso() });
  } catch (e) {
    update(db, pu.id, { last_checked: nowIso(), note: `Couldn’t check with PayPal: ${e.message}`.slice(0, 300) });
  }
  return db.get('SELECT * FROM purchases WHERE id=?', pu.id);
}

module.exports = { syncTrial, FEE, STATUS, fmt, priceLabel, hasAccess, forEnrollment, assignProgram, startAddon, payable, startOrder, finishOrder, startSubscription, finishSubscription, refresh, update, insert };
