// Life Audit 360: small enhancements on top of plain HTML forms. Everything still works without it.
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- confirmations, copy buttons, clickable rows, auto-submitting filters
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-confirm]');
    if (c && !window.confirm(c.dataset.confirm)) { e.preventDefault(); return; }
    const cp = e.target.closest('[data-copybtn]');
    if (cp) {
      const inp = cp.parentElement.querySelector('[data-copy]');
      inp.select();
      (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(() => { cp.textContent = 'Copied!'; }, () => { document.execCommand('copy'); cp.textContent = 'Copied!'; });
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button,input,form')) window.location = row.dataset.href;
    const hide = e.target.closest('[data-install-hide]');
    if (hide) { try { localStorage.setItem('la-install-hide', '1'); } catch (err) { /* private mode */ } $$('[data-install]').forEach((x) => x.remove()); }
  });
  $$('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // ---------- installable app
  if ('serviceWorker' in navigator && document.body.classList.contains('phone')) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let hideInstall = standalone;
  try { hideInstall = hideInstall || localStorage.getItem('la-install-hide') === '1'; } catch (err) { /* private mode */ }
  if (hideInstall) $$('[data-install]').forEach((x) => x.remove());

  // ---------- the audit forms
  const form = $('form.audit-form');
  if (form) {
    const valueOf = (name) => {
      const els = $$(`[name="${CSS.escape(name)}"]`, form);
      const c = els.find((x) => x.checked);
      return c ? c.value : '';
    };
    const refresh = () => {
      // "If yes…" questions
      $$('[data-showif]', form).forEach((q) => { q.hidden = valueOf(q.dataset.showif) !== q.dataset.eq; });
      // "Other" write-in boxes
      $$('[data-otherfor]', form).forEach((box) => {
        const n = box.dataset.otherfor;
        const on = $$(`[name="${CSS.escape(n)}"], [name="${CSS.escape(n + '[]')}"]`, form).some((x) => x.checked && x.value === 'Other');
        box.classList.toggle('show', on);
      });
      // Pick-up-to-N
      $$('.chips[data-max]', form).forEach((g) => {
        const max = Number(g.dataset.max); const boxes = $$('input', g); const n = boxes.filter((b) => b.checked).length;
        boxes.forEach((b) => { b.disabled = !b.checked && n >= max; });
      });
      // Morning / midday / evening counts
      $$('[data-tod]', form).forEach((t) => $$('[data-count]', t).forEach((c) => {
        const pane = $(`[data-pane="${c.dataset.count}"]`, t);
        const rows = $$('.grid-row', pane).length;
        const done = $$('.grid-row', pane).filter((r) => $$('input', r).some((i) => i.checked)).length;
        c.textContent = `${done}/${rows}`;
      }));
    };
    form.addEventListener('change', (e) => {
      // "None of the above" clears the others, and the others clear it
      const t = e.target;
      if (t.type === 'checkbox' && t.checked) {
        const group = $$(`[name="${CSS.escape(t.name)}"]`, form);
        if (t.dataset.none) group.forEach((x) => { if (x !== t) x.checked = false; });
        else group.forEach((x) => { if (x.dataset.none) x.checked = false; });
      }
      refresh();
      queueSave();
    });
    form.addEventListener('input', (e) => { if (e.target.matches('textarea, input[type=text]')) queueSave(1500); });

    // Time-of-day tabs, opening on the current part of the day
    $$('[data-tod]', form).forEach((t) => {
      t.classList.add('js');
      const h = new Date().getHours();
      const pick = (c) => {
        $$('[data-tab]', t).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === c)));
        $$('[data-pane]', t).forEach((p) => p.classList.toggle('on', p.dataset.pane === c));
      };
      $$('[data-tab]', t).forEach((b) => b.addEventListener('click', () => pick(b.dataset.tab)));
      pick(h < 11 ? 'morning' : h < 16 ? 'midday' : 'evening');
    });
    refresh();

    // Save as you go
    const state = $('[data-savestate]');
    let timer = null; let inflight = false; let again = false;
    const show = (t) => { if (state) state.textContent = t; };
    function queueSave(ms = 600) { clearTimeout(timer); show('Saving…'); timer = setTimeout(save, ms); }
    async function save() {
      timer = null;
      if (inflight) { again = true; return; }
      inflight = true;
      try {
        const body = new URLSearchParams(new FormData(form));
        const r = await fetch(form.dataset.autosave, { method: 'POST', body, headers: { 'x-autosave': '1' }, credentials: 'same-origin' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Not saved');
        show(j.answered >= j.total ? '✓ Done' : '✓ Saved');
      } catch (err) { show('Not saved'); }
      inflight = false;
      if (again) { again = false; save(); }
    }
    window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); fetch(form.dataset.autosave, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { 'x-autosave': '1' }, keepalive: true }); } });
  }

  // ---------- food photos: shrink on the phone, then upload one by one
  const up = $('[data-upload]');
  if (up) {
    const status = $('[data-status]', up);
    async function shrink(file) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const max = 1600; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
      } catch (err) { return file; }
    }
    $$('[data-file]', up).forEach((inp) => inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []);
      let ok = 0;
      for (let i = 0; i < files.length; i++) {
        status.textContent = `Uploading ${i + 1} of ${files.length}…`;
        try {
          const blob = await shrink(files[i]);
          const r = await fetch(up.dataset.upload, { method: 'POST', body: blob, headers: { 'x-csrf': up.dataset.csrf, 'Content-Type': blob.type || 'application/octet-stream' }, credentials: 'same-origin' });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          ok++;
        } catch (err) { status.textContent = (err && err.message) || 'Upload failed. Try again.'; }
      }
      if (ok) window.location.reload();
    }));
  }
})();
