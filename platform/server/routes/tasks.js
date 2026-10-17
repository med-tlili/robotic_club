// ============================================================
//  routes/tasks.js — department tasks (private space)
//  Rules (README):
//   - read: department members + Leader/Co-Leader + Professor
//           (Guests: 403 — private space)
//   - create/edit/delete: the department's manager + Leader/Co-Leader
//   - status: any member can update the status of THEIR OWN task
//   - Professor: read-only everywhere
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notify, notifyMany } = require('../notify');

const router = express.Router();

const STATUSES = ['todo', 'doing', 'done'];
const isEditor = (role) => ['leader', 'coleader'].includes(role);

// may this user manage the tasks of this department?
function canManage(user, deptId) {
  if (isEditor(user.role)) return true;
  return user.role === 'manager' && user.department_id === deptId;
}
// may this user see this department's tasks?
function canView(user, deptId) {
  if (['leader', 'coleader', 'professor'].includes(user.role)) return true;
  if (user.role === 'guest') return false;
  return user.department_id === deptId;
}

function shapeTask(t, user) {
  return {
    ...t,
    assigned_to_name: t.assigned_to_name || null,
    can_edit: canManage(user, t.department_id),
    can_change_status: canManage(user, t.department_id) || (t.assigned_to && t.assigned_to === user.id),
  };
}

// GET /api/tasks?department_id=3[&mine=1][&status=todo]
router.get('/', authenticate, (req, res) => {
  const deptId = Number(req.query.department_id);
  if (!deptId) return res.status(400).json({ error: 'department_id required' });
  if (!canView(req.user, deptId)) {
    return res.status(403).json({ error: 'Tasks are private to this department' });
  }
  let sql = `
    SELECT t.*, u.full_name AS assigned_to_name
    FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.department_id = ?
  `;
  const params = [deptId];
  if (req.query.mine === '1') {
    sql += ' AND t.assigned_to = ?';
    params.push(req.user.id);
  }
  if (STATUSES.includes(req.query.status)) {
    sql += ' AND t.status = ?';
    params.push(req.query.status);
  }
  sql += " ORDER BY (t.status = 'done'), t.created_at DESC";
  res.json(db.prepare(sql).all(...params).map((t) => shapeTask(t, req.user)));
});

// POST /api/tasks — manager of the dept / Leader / Co-Leader
router.post('/', authenticate, (req, res) => {
  const { department_id, title, description, assigned_to, due_date } = req.body || {};
  const deptId = Number(department_id);
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId);
  if (!dept) return res.status(400).json({ error: 'Valid department required' });
  if (!canManage(req.user, deptId)) {
    return res.status(403).json({ error: 'Only this department\'s manager or club leaders can create tasks' });
  }
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });

  // assignee must belong to the same department (manager or member)
  let assignee = null;
  if (assigned_to) {
    assignee = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(assigned_to));
    if (!assignee || assignee.department_id !== deptId
      || !['manager', 'member'].includes(assignee.role)) {
      return res.status(400).json({ error: 'Assignee must be a member of this department' });
    }
  }
  const info = db.prepare(
    `INSERT INTO tasks (department_id, title, description, assigned_to, due_date, created_by)
     VALUES (?,?,?,?,?,?)`
  ).run(deptId, title.trim(), (description || '').trim(),
    assignee ? assignee.id : null, (due_date || '').trim() || null, req.user.id);

  const task = db.prepare(`
    SELECT t.*, u.full_name AS assigned_to_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?
  `).get(info.lastInsertRowid);

  if (assignee) {
    notify(assignee.id, {
      type: 'task_assigned',
      title: 'New task assigned',
      body: `${task.title} — ${dept.name}`,
      link: `/departments/${dept.slug}`,
    });
  }
  res.status(201).json(shapeTask(task, req.user));
});

// PATCH /api/tasks/:id — manager/leader: full edit · assignee: status only
router.patch('/:id', authenticate, (req, res) => {
  const task = db.prepare(`
    SELECT t.*, u.full_name AS assigned_to_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?
  `).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(task.department_id);

  const manager = canManage(req.user, task.department_id);
  const isAssignee = task.assigned_to === req.user.id;

  if (manager) {
    const b = req.body || {};
    let assigneeId = task.assigned_to;
    if ('assigned_to' in b) {
      if (b.assigned_to) {
        const a = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(b.assigned_to));
        if (!a || a.department_id !== task.department_id || !['manager', 'member'].includes(a.role)) {
          return res.status(400).json({ error: 'Assignee must be a member of this department' });
        }
        assigneeId = a.id;
      } else {
        assigneeId = null;
      }
    }
    const status = STATUSES.includes(b.status) ? b.status : task.status;
    db.prepare(
      `UPDATE tasks SET title=?, description=?, assigned_to=?, status=?, due_date=?,
       completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END
       WHERE id=?`
    ).run(
      (b.title ?? task.title).trim(), (b.description ?? task.description).trim(),
      assigneeId, status, (b.due_date ?? task.due_date) || null, status, task.id,
    );
    // reassignment → notify the new assignee
    if (assigneeId && assigneeId !== task.assigned_to) {
      notify(assigneeId, {
        type: 'task_assigned',
        title: 'Task assigned to you',
        body: `${task.title} — ${dept.name}`,
        link: `/departments/${dept.slug}`,
      });
    }
    // finished → tell the task creator / department manager
    if (status === 'done' && task.status !== 'done') {
      notifyMany(
        [task.created_by, db.prepare(
          "SELECT id FROM users WHERE role='manager' AND department_id=?"
        ).get(task.department_id)?.id],
        { type: 'task_done', title: 'Task completed', body: `${task.title} — ${dept.name}`, link: `/departments/${dept.slug}` },
        req.user.id,
      );
    }
  } else if (isAssignee) {
    // an assignee may only move their own task's status
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be todo, doing or done' });
    }
    db.prepare(
      `UPDATE tasks SET status=?, completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id=?`
    ).run(status, status, task.id);
    if (status === 'done' && task.status !== 'done') {
      notifyMany(
        [task.created_by, db.prepare(
          "SELECT id FROM users WHERE role='manager' AND department_id=?"
        ).get(task.department_id)?.id],
        { type: 'task_done', title: 'Task completed', body: `${task.title} — ${req.user.full_name}`, link: `/departments/${dept.slug}` },
        req.user.id,
      );
    }
  } else {
    return res.status(403).json({ error: 'You can only change the status of your own tasks' });
  }

  const fresh = db.prepare(`
    SELECT t.*, u.full_name AS assigned_to_name FROM tasks t
    LEFT JOIN users u ON u.id = t.assigned_to WHERE t.id = ?
  `).get(task.id);
  res.json(shapeTask(fresh, req.user));
});

// DELETE /api/tasks/:id — manager of the dept / Leader / Co-Leader
router.delete('/:id', authenticate, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canManage(req.user, task.department_id)) {
    return res.status(403).json({ error: 'Only this department\'s manager or club leaders can delete tasks' });
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

module.exports = router;
