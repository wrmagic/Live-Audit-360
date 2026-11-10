'use strict';
// The Week 2 content library: videos, prompts and tools. Each item is for one life area, either the whole
// area or one specific challenge (an End of Week Review question). On Days 8-14 a participant sees the
// items for their confirmed priorities: whole-area items, plus items for the challenges they rated 3-5.
// The head coach adds and edits; coaches can browse (and change their own password here).
const { html, raw } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const F = require('../lib/forms');
const Pr = require('../lib/priorities');
const { str } = require('../lib/site');
const { embed } = require('./participant');

const O = { coach: true };
const KINDS = [['video', 'Video'], ['prompt', 'Prompt'], ['tool', 'Tool']];
const KIND_LABEL = Object.fromEntries(KINDS);

function itemForm(ctx, v = {}) {
  const action = v.id ? `/videos/${v.id}` : '/videos';
  const target = v.challenge ? `q:${v.challenge}` : v.area ? `area:${v.area}` : '';
  return html`<form method="post" action="${action}" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">${v.id ? 'Edit item' : html`${icon('plus')} Add content`}</h3>
<label class="fld"><span>Type</span><select name="kind">${KINDS.map(([k, l]) => html`<option value="${k}"${(v.kind || 'video') === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
<label class="fld"><span>Unlocks on</span><select name="day"><option value="">Day 8 (with the rest)</option>${[8, 9, 10, 11, 12, 13, 14].map((d) => html`<option value="${d}"${v.day === d ? raw(' selected') : ''}>Day ${d}</option>`)}</select></label>
<label class="fld span2"><span>Who it’s for</span><select name="target" required><option value="">Choose an area or a specific challenge…</option>${F.AREAS.map((a) => html`<optgroup label="${a.label}">
<option value="area:${a.key}"${target === `area:${a.key}` ? raw(' selected') : ''}>Whole area: ${a.label}</option>
${Pr.QUESTIONS.filter((q) => q.area === a.key).map((q) => html`<option value="q:${q.key}"${target === `q:${q.key}` ? raw(' selected') : ''}>Challenge: ${q.label}</option>`)}</optgroup>`)}</select></label>
<p class="hint span2">A whole-area item goes to everyone with that priority. A challenge item only goes to people who rated that challenge 3 or higher.</p>
<label class="fld span2"><span>Title</span><input name="title" value="${v.title || ''}" required maxlength="140"></label>
<label class="fld span2"><span>Link <em>required for videos; optional for prompts and tools</em></span><input type="url" name="url" value="${v.url || ''}" placeholder="https://youtu.be/… or https://vimeo.com/…"></label>
<label class="fld span2"><span>Text <em>the prompt itself, instructions, or a short description</em></span><textarea name="description" rows="4" maxlength="2000">${v.description || ''}</textarea></label>
<label class="fld"><span>Order</span><input type="number" name="sort" value="${v.sort ?? 0}" min="0" max="999"></label>
<label class="check"><input type="checkbox" name="active" value="1"${v.active === 0 ? '' : raw(' checked')}> Show to participants</label>
<p class="hint span2">YouTube (unlisted works) and Vimeo links play inside the app. Other links open in the browser.</p>
<div class="span2"><button class="btn primary">${v.id ? 'Save' : 'Add'}</button>${v.id ? html` <a class="btn ghost" href="/videos">Cancel</a>` : ''}</div></form>`;
}

function clean(b) {
  const kind = KIND_LABEL[b.kind] ? b.kind : 'video';
  let area = null; let challenge = null;
  const t = String(b.target || '');
  if (t.startsWith('area:') && F.AREA[t.slice(5)]) area = t.slice(5);
  else if (t.startsWith('q:') && Pr.QUESTION[t.slice(2)]) { challenge = t.slice(2); area = Pr.QUESTION[challenge].area; }
  const title = str(b.title, 140); const url = str(b.url, 500); const description = str(b.description, 2000) || null;
  if (!area || !title) throw new HttpError(400, 'Choose who it’s for and enter a title.');
  if (url && !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'Links need to be full web addresses, starting with https://.');
  if (kind === 'video' && !url) throw new HttpError(400, 'Videos need a link.');
  if (kind !== 'video' && !url && !description) throw new HttpError(400, 'Add the prompt or tool’s text, a link, or both.');
  const day = Number(b.day);
  return { kind, area, challenge, title, url: url || '', description, day: day >= 8 && day <= 14 ? day : null, sort: Math.max(0, Math.min(999, Number(b.sort) || 0)), active: b.active ? 1 : 0 };
}

module.exports = (r, { db }) => {
  r.get('/videos', (ctx) => {
    const head = ctx.user.role === 'head';
    const items = db.all('SELECT v.*, (SELECT COUNT(*) FROM video_views w WHERE w.video_id=v.id) views FROM videos v ORDER BY v.sort, v.day, v.id');
    const editing = head && ctx.query.edit ? items.find((v) => v.id === Number(ctx.query.edit)) : null;
    ctx.html(layout(ctx, { title: 'Week 2 content', nav: 'videos', body: html`
<div class="page-head"><div><p class="eyebrow">Days 8–14</p><h1>Week 2 content</h1><p class="muted">Videos, prompts and tools for each area and each challenge. Participants see the items for their confirmed priorities, starting on Day 8.</p></div></div>
<div class="cols">
<div>${F.AREAS.map((a) => {
      const list = items.filter((v) => v.area === a.key);
      const qs = Pr.QUESTIONS.filter((q) => q.area === a.key);
      const missing = qs.filter((q) => !list.some((v) => v.challenge === q.key && v.active));
      return html`<section class="panel"><h3>${icon(a.icon)} ${a.label} <small>${list.length} item${list.length === 1 ? '' : 's'}</small></h3>
${list.length ? html`<table class="list"><tbody>${list.map((v) => html`<tr class="${v.active ? '' : 'off'}"><td><b>${v.title}</b><small>${KIND_LABEL[v.kind] || 'Video'} · ${v.challenge ? `Challenge: ${(Pr.QUESTION[v.challenge] || {}).label || v.challenge}` : 'Whole area'}${v.url ? html` · <a href="${v.url}" target="_blank" rel="noopener">link</a>` : ''}</small></td><td>${v.day ? `Day ${v.day}` : 'Day 8+'}</td><td>${v.views} done</td>
<td class="actions">${head ? html`<a class="link" href="/videos?edit=${v.id}">Edit</a><form method="post" action="/videos/${v.id}/delete">${csrfField(ctx)}<button class="link danger" data-confirm="Delete this item?">Delete</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}
<p class="hint">${missing.length ? html`Challenges without their own content yet (${missing.length} of ${qs.length}): ${missing.map((q) => q.label).join(' · ')}` : html`${icon('check')} Every challenge in this area has its own content.`}</p></section>`;
    })}</div>
<div>${head ? html`${itemForm(ctx, editing || {})}${editing && editing.url && editing.kind === 'video' ? html`<section class="panel">${embed(editing.url)}</section>` : ''}` : html`<section class="panel"><p class="muted">The head coach manages the Week 2 content.</p></section>
<section class="panel"><h3>Change your password</h3><form method="post" action="/coaches/me/password">${csrfField(ctx)}<label class="fld"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label><label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label><button class="btn">Change</button></form></section>`}</div>
</div>`,
    }));
  }, O);

  r.post('/videos', (ctx) => {
    db.insert('videos', { ...clean(ctx.body), created_at: new Date().toISOString() });
    ctx.setFlash('Added.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });

  r.post('/videos/:id', (ctx) => {
    const v = db.get('SELECT id FROM videos WHERE id=?', Number(ctx.params.id));
    if (!v) throw new HttpError(404, 'That item wasn’t found.');
    db.update('videos', v.id, clean(ctx.body));
    ctx.setFlash('Saved.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });

  r.post('/videos/:id/delete', (ctx) => {
    db.run('DELETE FROM videos WHERE id=?', Number(ctx.params.id));
    ctx.setFlash('Deleted.');
    ctx.redirect('/videos');
  }, { coach: true, head: true });
};
