'use strict';
// The Days 8-14 video library. Each video belongs to one life area; participants see the videos for their
// three focus areas. Head coach adds and edits; coaches can browse (and change their own password here).
const { html, raw } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const { str } = require('../lib/site');
const { embed } = require('./participant');

const O = { coach: true };

function videoForm(ctx, v = {}) {
  const action = v.id ? `/videos/${v.id}` : '/videos';
  return html`<form method="post" action="${action}" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">${v.id ? 'Edit video' : html`${icon('plus')} Add a video`}</h3>
<label class="fld"><span>Life area</span><select name="area">${F.AREAS.map((a) => html`<option value="${a.key}"${a.key === v.area ? raw(' selected') : ''}>${a.label}</option>`)}</select></label>
<label class="fld"><span>Unlocks on</span><select name="day"><option value="">Day 8 (with the rest)</option>${[8, 9, 10, 11, 12, 13, 14].map((d) => html`<option value="${d}"${v.day === d ? raw(' selected') : ''}>Day ${d}</option>`)}</select></label>
<label class="fld span2"><span>Title</span><input name="title" value="${v.title || ''}" required maxlength="140"></label>
<label class="fld span2"><span>Video link</span><input type="url" name="url" value="${v.url || ''}" required placeholder="https://youtu.be/… or https://vimeo.com/…"></label>
<label class="fld span2"><span>Description <em>optional</em></span><textarea name="description" rows="2" maxlength="1000">${v.description || ''}</textarea></label>
<label class="fld"><span>Order</span><input type="number" name="sort" value="${v.sort ?? 0}" min="0" max="999"></label>
<label class="check"><input type="checkbox" name="active" value="1"${v.active === 0 ? '' : raw(' checked')}> Show to participants</label>
<p class="hint span2">YouTube (unlisted works) and Vimeo links play inside the app. Other links open in the browser.</p>
<div class="span2"><button class="btn primary">${v.id ? 'Save' : 'Add video'}</button>${v.id ? html` <a class="btn ghost" href="/videos">Cancel</a>` : ''}</div></form>`;
}

function clean(b) {
  const area = F.AREA[b.area] ? b.area : null;
  const title = str(b.title, 140); const url = str(b.url, 500);
  if (!area || !title || !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'Pick an area and enter a title and a full video link (starting with https://).');
  const day = Number(b.day);
  return { area, title, url, description: str(b.description, 1000) || null, day: day >= 8 && day <= 14 ? day : null, sort: Math.max(0, Math.min(999, Number(b.sort) || 0)), active: b.active ? 1 : 0 };
}

module.exports = (r, { db }) => {
  r.get('/videos', (ctx) => {
    const head = ctx.user.role === 'head';
    const vids = db.all('SELECT v.*, (SELECT COUNT(*) FROM video_views w WHERE w.video_id=v.id) views FROM videos v ORDER BY v.sort, v.day, v.id');
    const editing = head && ctx.query.edit ? vids.find((v) => v.id === Number(ctx.query.edit)) : null;
    ctx.html(layout(ctx, { title: 'Videos', nav: 'videos', body: html`
<div class="page-head"><div><p class="eyebrow">Days 8–14</p><h1>Video library</h1><p class="muted">Each participant sees the videos for their three focus areas, starting on Day 8.</p></div></div>
<div class="cols">
<div>${F.AREAS.map((a) => {
      const list = vids.filter((v) => v.area === a.key);
      return html`<section class="panel"><h3>${icon(a.icon)} ${a.label} <small>${list.length}</small></h3>
${list.length ? html`<table class="list"><tbody>${list.map((v) => html`<tr class="${v.active ? '' : 'off'}"><td><b>${v.title}</b><small><a href="${v.url}" target="_blank" rel="noopener">${v.url}</a></small></td><td>${v.day ? `Day ${v.day}` : 'Day 8+'}</td><td>${v.views} watched</td>
<td class="actions">${head ? html`<a class="link" href="/videos?edit=${v.id}">Edit</a><form method="post" action="/videos/${v.id}/delete">${csrfField(ctx)}<button class="link danger" data-confirm="Delete this video?">Delete</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">No videos yet${head ? '' : ''}.</p>`}</section>`;
    })}</div>
<div>${head ? html`${videoForm(ctx, editing || {})}${editing ? html`<section class="panel">${embed(editing.url)}</section>` : ''}` : html`<section class="panel"><p class="muted">The head coach manages the video library.</p></section>
<section class="panel"><h3>Change your password</h3><form method="post" action="/coaches/me/password">${csrfField(ctx)}<label class="fld"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label><label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label><button class="btn">Change</button></form></section>`}</div>
</div>`,
    }));
  }, O);

  r.post('/videos', (ctx) => {
    db.insert('videos', { ...clean(ctx.body), created_at: new Date().toISOString() });
    ctx.setFlash('Video added.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });

  r.post('/videos/:id', (ctx) => {
    const v = db.get('SELECT id FROM videos WHERE id=?', Number(ctx.params.id));
    if (!v) throw new HttpError(404, 'That video wasn’t found.');
    db.update('videos', v.id, clean(ctx.body));
    ctx.setFlash('Video saved.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });

  r.post('/videos/:id/delete', (ctx) => {
    db.run('DELETE FROM videos WHERE id=?', Number(ctx.params.id));
    ctx.setFlash('Video deleted.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });
};
