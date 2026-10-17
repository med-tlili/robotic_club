// ============================================================
//  routes/reports.js — Professor-only club reports
//  README: "Professor downloads reports (monthly global, full
//  year, per dept)". Aggregates real data; PDF via pdfkit.
// ============================================================
const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// only the Professor may pull reports
function requireProfessor(req, res, next) {
  if (req.user.role !== 'professor') {
    return res.status(403).json({ error: 'Only the Professor can access reports' });
  }
  next();
}

// resolve the requested period into an inclusive [start, end) date window
function periodRange(query) {
  const now = new Date();
  const year = Number(query.year) || now.getUTCFullYear();
  if (query.period === 'yearly') {
    return {
      year,
      label: `Full year ${year}`,
      start: `${year}-01-01`,
      end: `${year + 1}-01-01`,
    };
  }
  // default: monthly
  const month = Math.min(12, Math.max(1, Number(query.month) || now.getUTCMonth() + 1));
  const mm = String(month).padStart(2, '0');
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return {
    year,
    month,
    label: `${MONTHS[month - 1]} ${year}`,
    start: `${year}-${mm}-01`,
    end: nextMonth,
  };
}

// ---------- aggregation ----------
function buildReport(query) {
  const { year, month, label, start, end } = periodRange(query);
  const deptId = Number(query.department_id) || null;
  const dept = deptId ? db.prepare('SELECT id, name, slug FROM departments WHERE id = ?').get(deptId) : null;

  // SQL fragment: restrict to one department when requested
  const inDept = (col) => (deptId ? `${col} = ${deptId}` : '1=1');

  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  // members
  const membersTotal = one('SELECT COUNT(*) c FROM users WHERE role != \'guest\'').c;
  const membersInDept = deptId
    ? one("SELECT COUNT(*) c FROM users WHERE role != 'guest' AND department_id = ?", deptId).c
    : membersTotal;
  const membersByRole = all(
    `SELECT role, COUNT(*) c FROM users WHERE role != 'guest' ${deptId ? 'AND department_id = ?' : ''} GROUP BY role`,
    ...(deptId ? [deptId] : []),
  );
  const newMembers = one(
    `SELECT COUNT(*) c FROM users WHERE role != 'guest' AND created_at >= ? AND created_at < ? ${deptId ? 'AND department_id = ?' : ''}`,
    start, end, ...(deptId ? [deptId] : []),
  ).c;

  // posts + engagement
  const posts = one(
    `SELECT COUNT(*) c FROM posts WHERE ${inDept('department_id')} AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;
  const postsByType = all(
    `SELECT type, COUNT(*) c FROM posts WHERE ${inDept('department_id')} AND created_at >= ? AND created_at < ? GROUP BY type`,
    start, end,
  );
  const votes = one(
    `SELECT COUNT(*) c FROM votes v JOIN posts p ON p.id = v.post_id
     WHERE ${inDept('p.department_id')} AND v.created_at >= ? AND v.created_at < ?`,
    start, end,
  ).c;
  const comments = one(
    `SELECT COUNT(*) c FROM comments c JOIN posts p ON p.id = c.post_id
     WHERE ${inDept('p.department_id')} AND c.created_at >= ? AND c.created_at < ?`,
    start, end,
  ).c;

  // events are club-wide (the calendar is owned by the Leader, not per-department)
  const events = one(
    'SELECT COUNT(*) c FROM events WHERE event_date >= ? AND event_date < ?',
    start, end,
  ).c;

  // tasks
  const tasksTotal = one(
    `SELECT COUNT(*) c FROM tasks WHERE ${inDept('department_id')} AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;
  const tasksDone = one(
    `SELECT COUNT(*) c FROM tasks WHERE ${inDept('department_id')} AND status = 'done'
     AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;

  // applications
  const appsTotal = one(
    `SELECT COUNT(*) c FROM applications WHERE ${inDept('department_id')} AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;
  const appsAccepted = one(
    `SELECT COUNT(*) c FROM applications WHERE ${inDept('department_id')} AND status = 'accepted'
     AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;
  const appsRefused = one(
    `SELECT COUNT(*) c FROM applications WHERE ${inDept('department_id')} AND status = 'refused'
     AND created_at >= ? AND created_at < ?`,
    start, end,
  ).c;

  // chat activity (group scopes; private excluded from the count)
  const messages = one(
    `SELECT COUNT(*) c FROM messages WHERE scope IN ('global','managers','dept')
     ${deptId ? 'AND (department_id = ? OR scope IN (\'global\',\'managers\'))' : ''}
     AND created_at >= ? AND created_at < ?`,
    ...(deptId ? [deptId] : []), start, end,
  ).c;

  return {
    label,
    year,
    month,
    scope: dept ? dept.name : 'Whole club',
    generatedAt: new Date().toISOString(),
    members: { total: membersInDept, new: newMembers, byRole: membersByRole },
    posts: { total: posts, byType: postsByType, votes, comments },
    events,
    tasks: { total: tasksTotal, done: tasksDone, open: tasksTotal - tasksDone },
    applications: { total: appsTotal, accepted: appsAccepted, refused: appsRefused },
    messages,
  };
}

// ---------- GET /api/reports/data — JSON preview ----------
router.get('/data', authenticate, requireProfessor, (req, res) => {
  res.json(buildReport(req.query));
});

// ---------- GET /api/reports/charts — dashboard graphs (professor) ----------
router.get('/charts', authenticate, requireProfessor, (req, res) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getUTCFullYear();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // posts per month for the chosen year
  const postsByMonth = MONTHS.map((label, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const next = i === 11 ? `${year + 1}-01-01` : `${year}-${String(i + 2).padStart(2, '0')}-01`;
    const c = db.prepare(
      'SELECT COUNT(*) c FROM posts WHERE created_at >= ? AND created_at < ?',
    ).get(`${year}-${mm}-01`, next).c;
    return { label, value: c };
  });

  // messages per month (group chat activity)
  const messagesByMonth = MONTHS.map((label, i) => {
    const mm = String(i + 1).padStart(2, '0');
    const next = i === 11 ? `${year + 1}-01-01` : `${year}-${String(i + 2).padStart(2, '0')}-01`;
    const c = db.prepare(
      "SELECT COUNT(*) c FROM messages WHERE scope IN ('global','managers','dept') AND created_at >= ? AND created_at < ?",
    ).get(`${year}-${mm}-01`, next).c;
    return { label, value: c };
  });

  const tasksByStatus = ['todo', 'in_progress', 'done'].map((status) => ({
    label: status.replace('_', ' '),
    value: db.prepare('SELECT COUNT(*) c FROM tasks WHERE status = ?').get(status).c,
  }));

  const membersByRole = db.prepare(
    "SELECT role AS label, COUNT(*) AS value FROM users WHERE role != 'guest' GROUP BY role ORDER BY value DESC",
  ).all();

  const postsByType = db.prepare(
    'SELECT type AS label, COUNT(*) AS value FROM posts GROUP BY type ORDER BY value DESC',
  ).all();

  const applications = ['accepted', 'refused', 'pending'].map((status) => ({
    label: status,
    value: db.prepare('SELECT COUNT(*) c FROM applications WHERE status = ?').get(status).c,
  }));

  res.json({ year, postsByMonth, messagesByMonth, tasksByStatus, membersByRole, postsByType, applications });
});

// ---------- GET /api/reports/pdf — downloadable PDF ----------
router.get('/pdf', authenticate, requireProfessor, (req, res) => {
  const r = buildReport(req.query);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const filename = `isigk-report-${r.scope.toLowerCase().replace(/\s+/g, '-')}-${r.label.toLowerCase().replace(/\s+/g, '-')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const navy = '#12203a';
  const accent = '#2563eb';
  const grey = '#64748b';

  // header
  doc.fillColor(navy).fontSize(20).font('Helvetica-Bold')
    .text('ISIGK Robotics Club — Activity Report');
  doc.moveDown(0.3);
  doc.fillColor(accent).fontSize(13).font('Helvetica-Bold').text(r.label);
  doc.fillColor(grey).fontSize(10).font('Helvetica')
    .text(`Scope: ${r.scope}`);
  doc.text(`Generated: ${new Date(r.generatedAt).toLocaleString()}`);
  doc.moveDown(1);

  const section = (title) => {
    doc.moveDown(0.6);
    doc.fillColor(navy).fontSize(13).font('Helvetica-Bold').text(title);
    doc.moveTo(doc.x, doc.y).lineTo(545, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.4);
  };
  const line = (label, value) => {
    doc.fillColor('#334155').fontSize(11).font('Helvetica')
      .text(`${label}: `, { continued: true })
      .fillColor(navy).font('Helvetica-Bold').text(String(value));
  };

  section('Membership');
  line('Active members (scope)', r.members.total);
  line('New members this period', r.members.new);
  const roleCounts = r.members.byRole.map((x) => `${x.role} (${x.c})`).join(', ');
  line('By role', roleCounts || '—');

  section('Communications');
  line('Announcements / clips / offers', r.posts.total);
  const typeCounts = r.posts.byType.map((x) => `${x.type} (${x.c})`).join(', ');
  line('By type', typeCounts || '—');
  line('Votes cast', r.posts.votes);
  line('Comments', r.posts.comments);
  line('Chat messages', r.messages);

  section('Events & Goals');
  line('Calendar events', r.events);

  section('Tasks');
  line('Created', r.tasks.total);
  line('Completed', r.tasks.done);
  line('Still open', r.tasks.open);

  section('Membership applications');
  line('Total', r.applications.total);
  line('Accepted', r.applications.accepted);
  line('Refused', r.applications.refused);

  doc.moveDown(2);
  doc.fillColor(grey).fontSize(9).font('Helvetica')
    .text('Confidential — generated by the ISIGK Robotics Club platform.', { align: 'center' });

  doc.end();
});

module.exports = router;
