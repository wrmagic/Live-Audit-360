'use strict';
// The admin activity log: who did what to whom, and when.
function log(db, actor, action, target = null, detail = null) {
  db.run('INSERT INTO admin_log (actor_id, actor_name, action, target_id, target_name, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    actor ? actor.id : null, actor ? actor.name : 'System', action, target ? target.id : null, target ? target.name : null, detail, new Date().toISOString());
}
module.exports = { log };
