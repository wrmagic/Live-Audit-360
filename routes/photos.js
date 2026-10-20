'use strict';
// Food and drink photos. The phone shrinks each picture before uploading it (about 1600px, JPEG),
// so they stay small; the files live next to the database on the server's disk.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { html, dateTimeFmt } = require('../lib/html');
const { phone, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const P = require('../lib/program');
const { participantFor } = require('../lib/site');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const MAX = 8 * 1024 * 1024;
const PER_DAY = 40;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(4, 12).toString().startsWith('ftyp') && /heic|heix|mif1/.test(buf.slice(8, 12).toString())) return 'image/heic';
  return null;
}

let photoDir;

function page(ctx, e, day) {
  const photos = ctx.db.all('SELECT * FROM photos WHERE enrollment_id=? AND day=? ORDER BY created_at', e.id, day);
  ctx.html(phone(ctx, { title: `Day ${day} · Photos`, back: `/m/day/${day}`, tab: 'today', body: html`
<p class="tip">Take a photo of everything you eat and drink today: meals, snacks and drinks. Your coach sees them with your answers.</p>
<div class="upload" data-upload="/m/photos/${day}" data-csrf="${ctx.csrf}">
<label class="btn primary wide">${icon('camera')} Take a photo<input type="file" accept="image/*" capture="environment" hidden data-file></label>
<label class="btn wide">${icon('plus')} Choose from library<input type="file" accept="image/*" multiple hidden data-file></label>
<p class="upload-status" data-status></p></div>
<div class="gallery">${photos.length ? photos.map((p) => html`<figure><a href="/photo/${p.id}" target="_blank"><img src="/photo/${p.id}" alt="Photo" loading="lazy"></a>
<figcaption>${dateTimeFmt(p.created_at, ctx.user.timezone).split(', ').pop()}<form method="post" action="/m/photos/${p.id}/delete">${csrfField(ctx)}<button class="link" data-confirm="Delete this photo?">Delete</button></form></figcaption></figure>`) : html`<p class="hint">No photos for Day ${day} yet.</p>`}</div>`,
  }));
}

module.exports = (r, { db, photoDir: dir }) => {
  photoDir = dir;

  r.post('/m/photos/:day', (ctx) => {
    const e = P.currentEnrollment(db, ctx.user.id);
    const pos = P.position(e, ctx.user.timezone);
    const day = Number(ctx.params.day);
    if (!e || !pos || !Number.isInteger(day) || day < 1 || day > Math.min(pos.open, F.PROGRAM_DAYS)) throw new HttpError(403, 'Photos can be added from Day 1 up to today.');
    const buf = ctx.rawBuffer;
    const mime = sniff(buf);
    if (!mime) throw new HttpError(415, 'That file isn’t a photo.');
    if (db.get('SELECT COUNT(*) n FROM photos WHERE enrollment_id=? AND day=?', e.id, day).n >= PER_DAY) throw new HttpError(400, `That’s the limit of ${PER_DAY} photos for one day.`);
    const name = `${e.id}/${day}-${crypto.randomBytes(8).toString('hex')}.${TYPES[mime]}`;
    fs.mkdirSync(path.join(photoDir, String(e.id)), { recursive: true });
    fs.writeFileSync(path.join(photoDir, name), buf);
    const id = db.insert('photos', { enrollment_id: e.id, day, file: name, mime, bytes: buf.length, created_at: new Date().toISOString() });
    ctx.json({ ok: true, id });
  }, { participant: true, binary: true, maxBody: MAX });

  r.post('/m/photos/:id/delete', (ctx) => {
    const p = db.get('SELECT p.* FROM photos p JOIN enrollments e ON e.id=p.enrollment_id WHERE p.id=? AND e.user_id=?', Number(ctx.params.id), ctx.user.id);
    if (!p) throw new HttpError(404, 'That photo wasn’t found.');
    db.run('DELETE FROM photos WHERE id=?', p.id);
    try { fs.unlinkSync(path.join(photoDir, p.file)); } catch { /* already gone */ }
    ctx.setFlash('Photo deleted.');
    ctx.redirect(`/m/day/${p.day}/photos`);
  }, { participant: true });

  // Viewing a photo: its participant, or a coach who can see that participant
  r.get('/photo/:id', (ctx) => {
    const p = db.get('SELECT p.*, e.user_id FROM photos p JOIN enrollments e ON e.id=p.enrollment_id WHERE p.id=?', Number(ctx.params.id));
    if (!p) throw new HttpError(404, 'That photo wasn’t found.');
    if (ctx.user.role === 'participant') { if (p.user_id !== ctx.user.id) throw new HttpError(403, 'Not your photo.'); } else participantFor(ctx, p.user_id);
    let buf;
    try { buf = fs.readFileSync(path.join(photoDir, p.file)); } catch { throw new HttpError(404, 'The photo file is missing.'); }
    ctx.res.writeHead(200, { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=86400', 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : buf);
  });
};

module.exports.page = page;
