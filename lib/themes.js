'use strict';
// Color palettes. Each person picks Light, Dark or Automatic (follow their phone or computer), plus which
// light palette and which dark palette to use. Served as /themes.css; Sunset is the built-in default
// (its colors are the :root values in public/app.css).

const DARK_BASE = { 'color-scheme': 'dark', shadow: '0 1px 2px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.35)' };

const PALETTES = {
  sunset: {
    label: 'Sunset', kind: 'light', note: 'Cream and sunset orange, like the printed forms.',
    preview: { bg: '#faf5ee', surface: '#ffffff', bar: '#15111b', accent: '#f26a21', ink: '#17131c', q: '#1f45b5' },
    vars: {},
  },
  daylight: {
    label: 'Daylight Gold', kind: 'light', note: 'Clean white and gold: the website’s colors, made light.',
    preview: { bg: '#f5f5f5', surface: '#ffffff', bar: '#0d0d0d', accent: '#df9c3e', ink: '#111111', q: '#8a5a14' },
    vars: {
      ink: '#111111', 'ink-2': '#333333', muted: '#6b6b6b',
      night: '#0d0d0d', 'night-2': '#1f1f1f', 'on-night': '#ffffff', 'on-night-2': '#d6d6d6', 'on-night-3': '#a0a0a0',
      sun: '#b97f27', 'sun-2': '#df9c3e', ember: '#a8742a', gold: '#df9c3e',
      blue: '#8a5a14', 'blue-2': '#b07a28', 'blue-soft': 'rgba(223,156,62,.25)', 'blue-line': '#e6d3ae', 'on-blue': '#ffffff',
      cream: '#f5f5f5', 'cream-2': '#ece8e1', line: '#e2ddd3', card: '#ffffff', surface: '#ffffff', hover: '#fbf7ef',
      'on-accent': '#111111', 'accent-glow': 'rgba(223,156,62,.35)', 'accent-tint': 'rgba(223,156,62,.22)',
      'icon-bg': '#0d0d0d', 'icon-ink': '#df9c3e', rose: '#fbf1e1', peach: '#f7e9d2', 'peach-ink': '#7a4f12',
      'info-bg': '#fbf6ec', 'info-line': '#e6d3ae',
    },
  },
  gold: {
    label: 'Midnight Gold', kind: 'dark', note: 'Black and gold, matching lifeaudit360.com.',
    preview: { bg: '#0d0d0d', surface: '#161616', bar: '#000000', accent: '#df9c3e', ink: '#f5f5f5', q: '#e0a84e' },
    vars: {
      ...DARK_BASE,
      ink: '#f5f5f5', 'ink-2': '#d6d6d6', muted: '#a0a0a0',
      night: '#000000', 'night-2': '#1a1a1a', 'on-night': '#ffffff', 'on-night-2': '#d6d6d6', 'on-night-3': '#a0a0a0',
      sun: '#df9c3e', 'sun-2': '#edb55e', ember: '#bd8834', gold: '#d1a966',
      blue: '#e0a84e', 'blue-2': '#f0c070', 'blue-soft': 'rgba(223,156,62,.25)', 'blue-line': '#4a3b22', 'on-blue': '#000000',
      cream: '#0d0d0d', 'cream-2': '#1e1e1e', line: '#2e2e2e', card: '#161616', surface: '#161616', hover: '#1d1a15',
      'on-accent': '#000000', 'accent-glow': 'rgba(223,156,62,.3)', 'accent-tint': 'rgba(223,156,62,.18)',
      'icon-bg': '#df9c3e', 'icon-ink': '#000000',
      rose: '#2a2016', ok: '#3fae6a', warn: '#e0a84e', bad: '#f06a6a',
      'ok-bg': '#13281b', 'ok-ink': '#8fddae', 'err-bg': '#351717', 'err-ink': '#ffb3b3', 'err-line': '#5a2a2a',
      'warn-bg': '#2e2412', 'warn-ink': '#f2c879', peach: '#33240f', 'peach-ink': '#f2b46b', amber: '#3a2c12', 'amber-line': '#6b5226',
      'missed-line': '#6b3a2e', 'info-bg': '#1e1b15', 'info-line': '#4a3b22', 'neutral-bg': '#232323', 'prev-line': '#8a8a8a',
    },
  },
  nightsky: {
    label: 'Night Sky', kind: 'dark', note: 'Deep navy with soft blue and orange.',
    preview: { bg: '#0f1524', surface: '#151d30', bar: '#0a0f1a', accent: '#ff8a3d', ink: '#e8edf5', q: '#8eb0ff' },
    vars: {
      ...DARK_BASE,
      ink: '#e8edf5', 'ink-2': '#c3ccda', muted: '#8d99ae',
      night: '#0a0f1a', 'night-2': '#18213a', 'on-night': '#ffffff', 'on-night-2': '#c9d3e5', 'on-night-3': '#8d99ae',
      sun: '#ff8a3d', 'sun-2': '#ffa563', ember: '#e0582a', gold: '#f6c177',
      blue: '#8eb0ff', 'blue-2': '#a9c2ff', 'blue-soft': 'rgba(142,176,255,.25)', 'blue-line': '#2e3d5e', 'on-blue': '#0a0f1a',
      cream: '#0f1524', 'cream-2': '#1a2338', line: '#26314a', card: '#151d30', surface: '#151d30', hover: '#1a2440',
      'on-accent': '#ffffff', 'accent-glow': 'rgba(255,138,61,.3)', 'accent-tint': 'rgba(255,138,61,.2)',
      'icon-bg': '#24324f', 'icon-ink': '#ffffff',
      rose: '#2a1e2a', ok: '#45b97a', warn: '#f2b04a', bad: '#ff7a7a',
      'ok-bg': '#12291f', 'ok-ink': '#8ee0b4', 'err-bg': '#341a22', 'err-ink': '#ffb4be', 'err-line': '#5a2b36',
      'warn-bg': '#2d2615', 'warn-ink': '#f5cf7a', peach: '#33231a', 'peach-ink': '#ffb98a', amber: '#3a2e18', 'amber-line': '#6e5629',
      'missed-line': '#6b3b3b', 'info-bg': '#18223a', 'info-line': '#34466e', 'neutral-bg': '#1e273d', 'prev-line': '#8d99ae',
    },
  },
};

const MODES = { light: 'Light', dark: 'Dark', auto: 'Automatic' };
const DEFAULTS = { mode: 'light', light: 'sunset', dark: 'gold' };
const lights = () => Object.keys(PALETTES).filter((k) => PALETTES[k].kind === 'light');
const darks = () => Object.keys(PALETTES).filter((k) => PALETTES[k].kind === 'dark');

/** A person's choice, made safe. */
function prefs(u) {
  return {
    mode: u && MODES[u.theme_mode] ? u.theme_mode : DEFAULTS.mode,
    light: u && lights().includes(u.theme_light) ? u.theme_light : DEFAULTS.light,
    dark: u && darks().includes(u.theme_dark) ? u.theme_dark : DEFAULTS.dark,
  };
}

function block(vars) {
  return Object.entries(vars).map(([k, v]) => (k === 'color-scheme' ? `color-scheme: ${v};` : `--${k}: ${v};`)).join(' ');
}

/** The CSS for every palette. Dark palettes apply when mode is dark, or automatic on a device set to dark. */
function css() {
  const out = ['/* Life Audit 360 palettes (generated from lib/themes.js) */'];
  for (const k of lights()) if (Object.keys(PALETTES[k].vars).length) out.push(`:root[data-light="${k}"]:not([data-mode="dark"]) { ${block(PALETTES[k].vars)} }`);
  for (const k of darks()) out.push(`:root[data-mode="dark"][data-dark="${k}"] { ${block(PALETTES[k].vars)} }`);
  out.push('@media (prefers-color-scheme: dark) {');
  for (const k of darks()) out.push(`  :root[data-mode="auto"][data-dark="${k}"] { ${block(PALETTES[k].vars)} }`);
  out.push('}');
  return out.join('\n') + '\n';
}

/** The browser-bar color, for each case. */
function themeColor(p) {
  const l = PALETTES[p.light].preview.bar; const d = PALETTES[p.dark].preview.bar;
  if (p.mode === 'light') return [[l]];
  if (p.mode === 'dark') return [[d]];
  return [[l, '(prefers-color-scheme: light)'], [d, '(prefers-color-scheme: dark)']];
}

module.exports = { PALETTES, MODES, DEFAULTS, lights, darks, prefs, css, themeColor };
