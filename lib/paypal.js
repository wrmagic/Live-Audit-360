'use strict';
// PayPal Checkout (REST Orders v2). The browser shows PayPal's own buttons (PayPal account or card);
// our server creates the order with the price from the database and captures it, then checks what was
// actually collected before marking anything paid. Credentials come from Admin → Settings.
const S = require('./settings');

const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };
let fetchFn = (...a) => fetch(...a);
const setFetch = (fn) => { fetchFn = fn; }; // for tests

function config(db) {
  const clientId = S.get(db, 'paypal.client_id');
  const secret = S.get(db, 'paypal.secret');
  const mode = S.get(db, 'paypal.mode') === 'live' ? 'live' : 'sandbox';
  const currency = S.get(db, 'paypal.currency') || 'USD';
  return { clientId, secret, mode, currency, ready: !!(clientId && secret), base: BASE[mode] };
}

const tokens = new Map(); // clientId+mode -> {token, exp}
async function token(cfg) {
  const k = `${cfg.mode}:${cfg.clientId}`;
  const t = tokens.get(k);
  if (t && t.exp > Date.now() + 60e3) return t.token;
  const r = await fetchFn(`${cfg.base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`PayPal sign-in failed (${r.status}): ${j.error_description || j.error || 'check the Client ID and Secret, and Sandbox vs Live'}`);
  tokens.set(k, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 });
  return j.access_token;
}

async function api(cfg, method, path, body, idempotencyKey) {
  const r = await fetchFn(`${cfg.base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(cfg)}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (j.details && j.details[0] && (j.details[0].description || j.details[0].issue)) || j.message || j.name || '';
    const e = new Error(`PayPal ${r.status}${detail ? `: ${detail}` : ''}`); e.paypal = j; e.status = r.status;
    throw e;
  }
  return j;
}

const money = (cents) => (cents / 100).toFixed(2);
const toCents = (v) => Math.round(Number(v) * 100);

/** Create an order for an exact amount. reference: our own id for the program run. */
function createOrder(cfg, { cents, currency, description, reference }) {
  return api(cfg, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: String(reference), custom_id: String(reference), description: String(description).slice(0, 127), amount: { currency_code: currency, value: money(cents) } }],
  }, `la360-order-${reference}-${Date.now()}`);
}

/** Capture an approved order. Returns a summary of what was actually collected. */
async function captureOrder(cfg, orderId) {
  const j = await api(cfg, 'POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `la360-capture-${orderId}`);
  const pu = (j.purchase_units || [])[0] || {};
  const cap = ((pu.payments || {}).captures || [])[0] || {};
  return {
    status: j.status, captureStatus: cap.status, captureId: cap.id || null,
    cents: cap.amount ? toCents(cap.amount.value) : null, currency: cap.amount ? cap.amount.currency_code : null,
    reference: pu.reference_id || cap.custom_id || null,
    payerEmail: (j.payer && j.payer.email_address) || null,
    raw: j,
  };
}

// ---------------------------------------------------------------- Monthly subscriptions
/**
 * The PayPal billing plan for a monthly product, created the first time it's needed and again whenever
 * the price, currency, trial or PayPal mode changes (PayPal plans can't change price in place).
 */
async function ensurePlan(db, cfg, product) {
  const key = `${cfg.mode}:${product.price_cents}:${product.currency}:${product.trial_days}`;
  if (product.paypal_plan_id && product.paypal_plan_key === key) return product.paypal_plan_id;
  let ppProduct = product.paypal_product_id && String(product.paypal_plan_key || '').startsWith(`${cfg.mode}:`) ? product.paypal_product_id : null;
  if (!ppProduct) {
    const pr = await api(cfg, 'POST', '/v1/catalogs/products', { name: product.name.slice(0, 127), type: 'SERVICE', category: 'SOFTWARE', ...(product.description ? { description: product.description.slice(0, 256) } : {}) }, `la360-prod-${product.id}-${key}`);
    ppProduct = pr.id;
  }
  const cycles = [];
  if (product.trial_days > 0) cycles.push({ frequency: { interval_unit: 'DAY', interval_count: product.trial_days }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1 });
  cycles.push({ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: cycles.length + 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: money(product.price_cents), currency_code: product.currency } } });
  const plan = await api(cfg, 'POST', '/v1/billing/plans', {
    product_id: ppProduct, name: `${product.name} (monthly)`.slice(0, 127), status: 'ACTIVE', billing_cycles: cycles,
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  }, `la360-plan-${product.id}-${key}`);
  db.run('UPDATE products SET paypal_product_id=?, paypal_plan_id=?, paypal_plan_key=? WHERE id=?', ppProduct, plan.id, key, product.id);
  return plan.id;
}

async function getSubscription(cfg, id) {
  const j = await api(cfg, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  return {
    status: j.status, planId: j.plan_id, reference: j.custom_id || null,
    nextBilling: (j.billing_info && j.billing_info.next_billing_time) || null,
    payerEmail: (j.subscriber && j.subscriber.email_address) || null, raw: j,
  };
}
const cancelSubscription = (cfg, id, reason) => api(cfg, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: String(reason || 'Cancelled in Life Audit 360').slice(0, 127) });

/** Check the credentials work (gets a token). */
async function test(cfg) { tokens.delete(`${cfg.mode}:${cfg.clientId}`); await token(cfg); return true; }

module.exports = { config, createOrder, captureOrder, ensurePlan, getSubscription, cancelSubscription, test, setFetch, money, toCents, BASE };
