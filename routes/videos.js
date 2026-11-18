'use strict';
// The content library: videos, prompts and tools, per program. Each item is for one category, either the whole
// category or one specific challenge (a review question). Once the program's plan unlocks (Day 8 in the
// 14-day program) a participant sees the items for their confirmed priorities: whole-category items, plus
// items for the challenges they rated at or above the threshold.
// The head coach adds and edits; coaches can browse (and change their own password here).
const { html, raw } = require('../lib/html');
const { layout, icon, csrfField } = require('../lib/views');
const { HttpError } = require('../lib/http');
const defs = require('../lib/defs');
const { str } = require('../lib/site');
const { embed } = require('./participant');

const O = { coach: true };
const KINDS = [['video', 'Video'], ['prompt', 'Prompt'], ['tool', 'Tool']];
const KIND_LABEL = Object.fromEntries(KINDS);

function itemForm(ctx, D, v = {}) {
  const action = v.id ? `/videos/${v.id}?program=${D.programId}` : `/videos?program=${D.programId}`;
  const from = D.priorities.unlockDay || 1;
  const target = v.challenge ? `q:${v.challenge}` : v.area ? `area:${v.area}` : '';
  return html`<form method="post" action="${action}" class="panel form-grid">${csrfField(ctx)}<h3 class="span2">${v.id ? 'Edit item' : html`${icon('plus')} Add content`}</h3>
<label class="fld"><span>Type</span><select name="kind">${KINDS.map(([k, l]) => html`<option value="${k}"${(v.kind || 'video') === k ? raw(' selected') : ''}>${l}</option>`)}</select></label>
<label class="fld"><span>Unlocks on</span><select name="day"><option value="">Day ${from} (with the rest)</option>${Array.from({ length: Math.max(0, D.PROGRAM_DAYS - from + 1) }, (_, i) => from + i).map((d) => html`<option value="${d}"${v.day === d ? raw(' selected') : ''}>Day ${d}</option>`)}</select></label>
<label class="fld span2"><span>Who it’s for</span><select name="target" required><option value="">Choose an area or a specific challenge…</option>${D.AREAS.map((a) => html`<optgroup label="${a.label}">
<option value="area:${a.key}"${target === `area:${a.key}` ? raw(' selected') : ''}>Whole area: ${a.label}</option>
${D.reviewQs.filter((q) => q.area === a.key).map((q) => html`<option value="q:${q.key}"${target === `q:${q.key}` ? raw(' selected') : ''}>Challenge: ${q.label}</option>`)}</optgroup>`)}</select></label>
<p class="hint span2">A whole-area item goes to everyone with that priority. A challenge item only goes to people who rated that challenge ${D.priorities.threshold || 3} or higher.</p>
<label class="fld span2"><span>Title</span><input name="title" value="${v.title || ''}" required maxlength="140"></label>
<label class="fld span2"><span>Link <em>required for videos; optional for prompts and tools</em></span><input type="url" name="url" value="${v.url || ''}" placeholder="https://youtu.be/… or https://vimeo.com/…"></label>
<label class="fld span2"><span>Text <em>the prompt itself, instructions, or a short description</em></span><textarea name="description" rows="4" maxlength="2000">${v.description || ''}</textarea></label>
<label class="fld"><span>Order</span><input type="number" name="sort" value="${v.sort ?? 0}" min="0" max="999"></label>
<label class="check"><input type="checkbox" name="active" value="1"${v.active === 0 ? '' : raw(' checked')}> Show to participants</label>
<p class="hint span2">YouTube (unlisted works) and Vimeo links play inside the app. Other links open in the browser.</p>
<div class="span2"><button class="btn primary">${v.id ? 'Save' : 'Add'}</button>${v.id ? html` <a class="btn ghost" href="/videos?program=${D.programId}">Cancel</a>` : ''}</div></form>`;
}

function clean(D, b) {
  const kind = KIND_LABEL[b.kind] ? b.kind : 'video';
  let area = null; let challenge = null;
  const t = String(b.target || '');
  const q = t.startsWith('q:') ? D.reviewQs.find((x) => x.key === t.slice(2)) : null;
  if (t.startsWith('area:') && D.AREA[t.slice(5)]) area = t.slice(5);
  else if (q) { challenge = q.key; area = q.area; }
  const title = str(b.title, 140); const url = str(b.url, 500); const description = str(b.description, 2000) || null;
  if (!area || !title) throw new HttpError(400, 'Choose who it’s for and enter a title.');
  if (url && !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'Links need to be full web addresses, starting with https://.');
  if (kind === 'video' && !url) throw new HttpError(400, 'Videos need a link.');
  if (kind !== 'video' && !url && !description) throw new HttpError(400, 'Add the prompt or tool’s text, a link, or both.');
  const day = Number(b.day);
  return { kind, area, challenge, title, url: url || '', description, day: day >= 1 && day <= D.PROGRAM_DAYS ? day : null, sort: Math.max(0, Math.min(999, Number(b.sort) || 0)), active: b.active ? 1 : 0 };
}

module.exports = (r, { db }) => {
  /** The program whose content is being looked at (?program=id), using its latest published version. */
  function programFor(ctx) {
    const list = defs.activePrograms(db);
    const id = Number(ctx.query.program) || defs.builtinId(db);
    const pg = list.find((x) => x.id === id) || list[0];
    return { list, D: defs.forVersion(db, defs.latestVersion(db, pg.id).id) };
  }

  r.get('/videos', (ctx) => {
    const head = ctx.user.role === 'head';
    const { list: progs, D } = programFor(ctx);
    const items = db.all('SELECT v.*, (SELECT COUNT(*) FROM video_views w WHERE w.video_id=v.id) views FROM videos v WHERE v.program_id=? ORDER BY v.sort, v.day, v.id', D.programId);
    const editing = head && ctx.query.edit ? items.find((v) => v.id === Number(ctx.query.edit)) : null;
    const from = D.priorities.unlockDay || 1;
    const QL = Object.fromEntries(D.reviewQs.map((q) => [q.key, q.label]));
    ctx.html(layout(ctx, { title: 'Content', nav: 'videos', body: html`
<div class="page-head"><div><p class="eyebrow">${D.name}</p><h1>${D.priorities.contentLabel || 'Content'}</h1><p class="muted">Videos, prompts and tools for each category and each challenge. ${D.priorities.enabled ? `Participants see the items for their confirmed priorities, starting on Day ${from}.` : 'This program doesn’t use priorities, so participants see every item for every category.'}</p></div>
${progs.length > 1 ? html`<form class="filters"><select name="program" data-autosubmit>${progs.map((pg) => html`<option value="${pg.id}"${pg.id === D.programId ? raw(' selected') : ''}>${pg.name}</option>`)}</select></form>` : ''}</div>
<div class="cols">
<div>${D.AREAS.map((a) => {
      const list = items.filter((v) => v.area === a.key);
      const qs = D.reviewQs.filter((q) => q.area === a.key);
      const missing = qs.filter((q) => !list.some((v) => v.challenge === q.key && v.active));
      return html`<section class="panel"><h3>${icon(a.icon)} ${a.label} <small>${list.length} item${list.length === 1 ? '' : 's'}</small></h3>
${list.length ? html`<table class="list"><tbody>${list.map((v) => html`<tr class="${v.active ? '' : 'off'}"><td><b>${v.title}</b><small>${KIND_LABEL[v.kind] || 'Video'} · ${v.challenge ? `Challenge: ${QL[v.challenge] || v.challenge}` : 'Whole area'}${v.url ? html` · <a href="${v.url}" target="_blank" rel="noopener">link</a>` : ''}</small></td><td>${v.day ? `Day ${v.day}` : `Day ${from}+`}</td><td>${v.views} done</td>
<td class="actions">${head ? html`<a class="link" href="/videos?program=${D.programId}&edit=${v.id}">Edit</a><form method="post" action="/videos/${v.id}/delete?program=${D.programId}">${csrfField(ctx)}<button class="link danger" data-confirm="Delete this item?">Delete</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nothing yet.</p>`}
${qs.length ? html`<p class="hint">${missing.length ? html`Challenges without their own content yet (${missing.length} of ${qs.length}): ${missing.map((q) => q.label).join(' · ')}` : html`${icon('check')} Every challenge in this area has its own content.`}</p>` : ''}</section>`;
    })}</div>
<div>${head ? html`${itemForm(ctx, D, editing || {})}${editing && editing.url && editing.kind === 'video' ? html`<section class="panel">${embed(editing.url)}</section>` : ''}` : html`<section class="panel"><p class="muted">The head coach manages the content.</p></section>
<section class="panel"><h3>Change your password</h3><form method="post" action="/coaches/me/password">${csrfField(ctx)}<label class="fld"><span>Current password</span><input type="password" name="current" required autocomplete="current-password"></label><label class="fld"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label><button class="btn">Change</button></form></section>`}</div>
</div>`,
    }));
  }, O);

  r.post('/videos', (ctx) => {
    const { D } = programFor(ctx);
    db.insert('videos', { ...clean(D, ctx.body), program_id: D.programId, created_at: new Date().toISOString() });
    ctx.setFlash('Added.');
    ctx.redirect(`/videos?program=${D.programId}`);
  }, { coach: true, head: true });

  r.post('/videos/:id', (ctx) => {
    const v = db.get('SELECT id FROM videos WHERE id=?', Number(ctx.params.id));
    if (!v) throw new HttpError(404, 'That item wasn’t found.');
    const { D } = programFor(ctx);
    db.update('videos', v.id, clean(D, ctx.body));
    ctx.setFlash('Saved.');
    ctx.redirect(`/videos?program=${D.programId}`);
  }, { coach: true, head: true });

  r.post('/videos/:id/delete', (ctx) => {
    db.run('DELETE FROM videos WHERE id=?', Number(ctx.params.id));
    ctx.setFlash('Deleted.');
    ctx.redirect(`/videos?program=${Number(ctx.query.program) || ''}`);
  }, { coach: true, head: true });
};
