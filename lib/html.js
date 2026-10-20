'use strict';
// Tiny auto-escaping template helper. Every interpolated value is HTML-escaped
// unless it was produced by html`` itself or wrapped with raw().

class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

const raw = (s) => new Raw(s);

// ---------- formatting helpers ----------
function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parseDate(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); }
function dateFmt(d, style = 'short') {
  if (!d) return '';
  const x = parseDate(d.slice(0, 10));
  if (style === 'long') return `${DOW_LONG[x.getUTCDay()]}, ${MON_LONG[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
  if (style === 'dow') return `${DOW[x.getUTCDay()]} ${MON[x.getUTCMonth()]} ${x.getUTCDate()}`;
  return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
}
function dateTimeFmt(iso, tz = 'America/Los_Angeles') {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

module.exports = { html, raw, esc, Raw, time12, dateFmt, dateTimeFmt, firstName, DOW, DOW_LONG, MON_LONG, parseDate };
