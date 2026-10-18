import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Target, CalendarDays, Building2, ClipboardList, Megaphone,
  FileDown, ArrowRight, Inbox, Check, X, UserPlus, Info,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { isBoss, DEPT_LABELS } from '../roles';
import { Panel, Skeleton, RolePill, Avatar, DeptIcon } from '../components/ui';
import SupervisorGraphs from '../components/SupervisorGraphs';

/* ============================================================
   Role-aware dashboard — answers "what needs my attention?"
   and "where do I go next?" No filler stat cards, no fake data.
   ============================================================ */
export default function Dashboard() {
  const { user } = useAuth();
  const [departments, setDepartments] = useState(null);
  const [goals, setGoals] = useState(null);
  const [members, setMembers] = useState(null);
  const [tasks, setTasks] = useState(null); // my department's tasks (member/manager)
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoadError('');
    Promise.all([
      api('/departments').then(setDepartments),
      api('/goals').then(setGoals),
      ...(user.role !== 'guest' ? [api('/users').then(setMembers)] : [Promise.resolve()]),
      ...(user.department_id
        ? [api(`/tasks?department_id=${user.department_id}`).then(setTasks).catch(() => setTasks([]))]
        : [Promise.resolve()]),
    ]).catch((e) => setLoadError(e.message || 'Could not load club data'));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div className="stack">
        <div className="banner error">
          <div style={{ flex: 1 }}>
            <strong>Could not load club data.</strong> {loadError} — check that the API server is
            running, then try again.
          </div>
          <button className="btn secondary sm" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (user.role === 'guest') return <GuestDashboard />;
  if (user.role === 'manager') {
    return <ManagerDashboard user={user} departments={departments} goals={goals} members={members} tasks={tasks} />;
  }
  if (isBoss(user.role)) {
    return <BossDashboard user={user} departments={departments} goals={goals} members={members} />;
  }
  return <MemberDashboard user={user} departments={departments} goals={goals} members={members} tasks={tasks} />;
}

/* ---------- shared bits ---------- */
/* Drive-backups limit alert (Leader / Co-Leader / Supervisor) */
function StorageAlertBanner() {
  const [st, setSt] = useState(null);
  useEffect(() => { api('/storage').then(setSt).catch(() => {}); }, []);
  if (!st || st.setupRequired || st.alert === 'ok' || st.alert === 'unknown') return null;
  const pct = st.totalBytes && st.usedBytes != null ? Math.round((st.usedBytes / st.totalBytes) * 100) : '?';
  const crit = st.alert === 'crit';
  return (
    <div className={`banner ${crit ? 'error' : 'warn'}`}>
      <div style={{ flex: 1 }}>
        <strong>{crit ? 'Drive backups nearly full.' : 'Drive backups approaching the limit.'}</strong>
        {' '}Drive usage is at {pct}% — clear old months in Storage to make room.
      </div>
      <Link to="/storage" className="btn secondary sm">Open Storage</Link>
    </div>
  );
}

function DeptGoalsPanel({ deptId, goals }) {
  const list = (goals || []).filter((g) => g.department_id === deptId);
  if (list.length === 0) {
    return (
      <Panel title="Department goals" icon={Target}>
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No goals assigned to your department yet. The Leader sets goals with due dates.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Department goals" icon={Target} action={<span className="panel-action" style={{ pointerEvents: 'none' }}>{list.length}</span>}>
      <div className="list">
        {list.map((g) => (
          <div key={g.id} className="list-row" style={{ padding: '8px 0' }}>
            <Target size={14} className="text-faint" />
            <div className="grow">
              <div className="name">{g.title}</div>
              {g.description && <div className="meta">{g.description}</div>}
            </div>
            {g.due_date && <span className="badge neutral mono">{g.due_date}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* my assigned tasks (real, from the department private space) */
function MyTasksPanel({ user, tasks }) {
  if (tasks === null) return <Skeleton h={120} />;
  const mine = tasks.filter((t) => t.assigned_to === user.id);
  const open = mine.filter((t) => t.status !== 'done').length;
  return (
    <Panel
      title="My tasks"
      icon={ClipboardList}
      action={<span className="panel-action" style={{ pointerEvents: 'none' }}>{open} open</span>}
    >
      {mine.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          Nothing assigned to you right now. Tasks from your manager or the Leader appear here.
        </p>
      ) : (
        <div className="list">
          {mine.map((t) => (
            <div key={t.id} className="list-row" style={{ padding: '8px 0' }}>
              <ClipboardList size={14} className="text-faint" />
              <div className="grow">
                <div className="name" style={t.status === 'done' ? { textDecoration: 'line-through', color: 'var(--text-dim)' } : {}}>
                  {t.title}
                </div>
                {t.due_date && <div className="meta mono">Due {t.due_date}</div>}
              </div>
              <span className={`badge ${t.status === 'done' ? 'success' : t.status === 'doing' ? 'accent' : 'neutral'}`}>
                {t.status === 'done' ? 'Done' : t.status === 'doing' ? 'In progress' : 'To do'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* latest posts of a department */
function RecentPosts({ dept, limit = 3 }) {
  const [posts, setPosts] = useState(null);
  useEffect(() => {
    api(`/posts?department_id=${dept.id}`).then(setPosts).catch(() => setPosts([]));
  }, [dept.id]);

  return (
    <Panel
      title="Latest from the feed"
      icon={Megaphone}
      action={<Link to={`/departments/${dept.slug}`} className="panel-action">Feed <ArrowRight size={12} /></Link>}
    >
      {posts === null ? <Skeleton h={90} /> : posts.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No posts yet from the {DEPT_LABELS[dept.slug] || dept.name} team.
        </p>
      ) : (
        <div className="list">
          {posts.slice(0, limit).map((p) => (
            <Link key={p.id} to={`/departments/${dept.slug}`} className="list-row clickable" style={{ padding: '8px 0' }}>
              <Megaphone size={14} className="text-faint" />
              <div className="grow">
                <div className="name">{p.title}</div>
                <div className="meta">{p.author.full_name} · Yes {p.yes} · Maybe {p.maybe} · No {p.no}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* upcoming club dates (global calendar) */
function UpcomingEvents({ limit = 4 }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    api('/events').then(setEvents).catch(() => setEvents([]));
  }, []);
  // local date (not UTC — the Calendar page uses the same convention)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // multi-day events stay "upcoming" until their last day
  const upcoming = (events || []).filter((e) => (e.end_date || e.event_date) >= today).slice(0, limit);

  return (
    <Panel
      title="Upcoming dates"
      icon={CalendarDays}
      action={<Link to="/calendar" className="panel-action">Calendar <ArrowRight size={12} /></Link>}
    >
      {events === null ? <Skeleton h={90} /> : upcoming.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No upcoming dates. Dates set by the Leader appear on the calendar.
        </p>
      ) : (
        <div className="list">
          {upcoming.map((ev) => (
            <div key={ev.id} className="list-row" style={{ padding: '8px 0' }}>
              <CalendarDays size={14} className="text-faint" />
              <div className="grow">
                <div className="name">{ev.title}</div>
                <div className="meta">
                  {ev.end_date && ev.end_date > ev.event_date ? `${ev.event_date} → ${ev.end_date}` : ev.event_date}
                  {ev.event_time ? ` · ${ev.event_time}` : ''}
                  {ev.location ? ` · ${ev.location}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* compact team pointer — the full directory lives on /members */
function TeamLink({ members, deptId }) {
  const team = (members || []).filter((m) => m.department_id === deptId);
  return (
    <Panel
      title="Your team"
      icon={Users}
      action={<Link to="/members" className="panel-action">Directory <ArrowRight size={12} /></Link>}
    >
      {team.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No teammates yet.</p>
      ) : (
        <div className="row" style={{ gap: 10 }}>
          <div className="team-row">
            {team.slice(0, 8).map((m) => (
              <Link key={m.id} to={`/chat/${m.id}`} title={m.full_name} className="avatar-link">
                <Avatar user={m} />
              </Link>
            ))}
          </div>
          {team.length > 8 && <span className="text-faint text-xs">+{team.length - 8} more</span>}
          <span className="text-dim text-sm" style={{ marginLeft: 'auto' }}>
            {team.length} {team.length === 1 ? 'member' : 'members'} · open the directory to manage
          </span>
        </div>
      )}
    </Panel>
  );
}

/* pending membership applications (manager: own dept · leader: all) */
function ApplicationsPanel({ user }) {
  const [apps, setApps] = useState(null);
  const load = () => {
    api('/applications').then(setApps).catch(() => setApps([]));
  };
  useEffect(load, []);

  const canReview = user.role !== 'supervisor'; // API enforces manager-dept / boss rules
  const act = (id, action) => {
    api(`/applications/${id}/${action}`, { method: 'POST' })
      .then(load)
      .catch((e) => alert(e.message));
  };

  const pending = (apps || []).filter((a) => a.status === 'pending');
  const reviewed = (apps || []).filter((a) => a.status !== 'pending').slice(0, 5);

  // no pending → compact line, not a big empty panel
  if (apps !== null && pending.length === 0) {
    return (
      <Panel title="Membership applications" icon={Inbox}
        action={<span className="panel-action" style={{ pointerEvents: 'none' }}>0 pending</span>}>
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No applications waiting. When a guest applies to join, it shows up here to accept or refuse.
        </p>
        {reviewed.length > 0 && (
          <div className="list" style={{ marginTop: 8 }}>
            {reviewed.map((a) => (
              <div key={a.id} className="list-row" style={{ padding: '7px 0', opacity: 0.7 }}>
                <div className="grow">
                  <div className="name">{a.full_name} → {a.department_name}</div>
                </div>
                <span className={`badge ${a.status === 'accepted' ? 'success' : 'danger'}`}>
                  {a.status === 'accepted' ? 'Accepted' : 'Refused'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Membership applications" icon={Inbox}
      action={<span className="panel-action" style={{ pointerEvents: 'none' }}>{pending.length} pending</span>}>
      {apps === null ? <Skeleton h={90} /> : (
        <div className="list">
          {pending.map((a) => (
            <div key={a.id} className="list-row" style={{ padding: '9px 0' }}>
              <Avatar user={{ full_name: a.full_name, role: a.applicant_role }} size="sm" />
              <div className="grow">
                <div className="name">{a.full_name}</div>
                <div className="meta">
                  wants to join {a.department_name}
                  {a.message ? ` — “${a.message}”` : ''}
                </div>
              </div>
              {canReview ? (
                <span className="row" style={{ gap: 6 }}>
                  <button className="btn sm" title="Accept" aria-label={`Accept ${a.full_name}`}
                    onClick={() => act(a.id, 'accept')}>
                    <Check size={13} /> Accept
                  </button>
                  <button className="btn secondary sm" title="Refuse" aria-label={`Refuse ${a.full_name}`}
                    onClick={() => act(a.id, 'refuse')}>
                    <X size={13} />
                  </button>
                </span>
              ) : (
                <span className="badge neutral">Pending</span>
              )}
            </div>
          ))}
          {reviewed.map((a) => (
            <div key={a.id} className="list-row" style={{ padding: '8px 0', opacity: 0.65 }}>
              <div className="grow">
                <div className="name">{a.full_name} → {a.department_name}</div>
                <div className="meta">reviewed by {a.reviewer_name || '—'}</div>
              </div>
              <span className={`badge ${a.status === 'accepted' ? 'success' : 'danger'}`}>
                {a.status === 'accepted' ? 'Accepted' : 'Refused'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ---------- Manager ---------- */
function ManagerDashboard({ user, departments, goals, members, tasks }) {
  const dept = (departments || []).find((d) => d.id === user.department_id);
  if (!dept) return <Skeleton h={400} />;
  const pendingTasks = (tasks || []).filter((t) => t.status !== 'done').length;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <DeptIcon slug={dept.slug} size={46} />
          <div>
            <h1>{DEPT_LABELS[dept.slug] || dept.name}</h1>
            <div className="sub">You manage this department · {pendingTasks} open {pendingTasks === 1 ? 'task' : 'tasks'}</div>
          </div>
        </div>
        <div className="head-meta">
          <RolePill role={user.role} />
          <Link to={`/departments/${dept.slug}`} className="btn secondary sm">
            Department page <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* attention first: applications waiting on you */}
      <ApplicationsPanel user={user} />

      <MyTasksPanel user={user} tasks={tasks} />

      <div className="grid-2">
        <RecentPosts dept={dept} />
        <UpcomingEvents />
      </div>

      <div className="grid-2">
        <DeptGoalsPanel deptId={dept.id} goals={goals} />
        <TeamLink members={members} deptId={dept.id} />
      </div>
    </div>
  );
}

/* ---------- Leader / Co-leader / Supervisor ---------- */
function BossDashboard({ user, departments, goals, members }) {
  if (!departments || !goals || members === null) return <Skeleton h={400} />;
  const active = departments.filter((d) => !d.coming_soon);
  const realMembers = members.filter((m) => m.role !== 'guest');
  const supervisor = user.role === 'supervisor';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{supervisor ? 'Club overview' : 'Lead the club'}</h1>
          <div className="sub">
            {supervisor
              ? 'Supervisor view — read-only access to all departments, chats and reports'
              : `${active.length} active departments · ${realMembers.length} members · assign goals and manage roles`}
          </div>
        </div>
        <div className="head-meta">
          <RolePill role={user.role} />
          <Link to="/members" className="btn secondary sm">
            <Users size={13} /> Members
          </Link>
          {supervisor && (
            <Link to="/reports" className="btn sm">
              <FileDown size={13} /> Reports
            </Link>
          )}
        </div>
      </div>

      {/* applications are the genuine review queue */}
      <ApplicationsPanel user={user} />
      <StorageAlertBanner />

      {supervisor && <SupervisorGraphs />}

      <div className="grid-2">
        <UpcomingEvents />
        <Panel title="Departments" icon={Building2} flush>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Department</th><th>Members</th><th>Goals</th><th></th></tr>
            </thead>
            <tbody>
              {active.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <DeptIcon slug={d.slug} size={26} />
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                    </div>
                  </td>
                  <td className="mono text-dim">{members.filter((m) => m.department_id === d.id).length}</td>
                  <td className="mono text-dim">{goals.filter((g) => g.department_id === d.id).length}</td>
                  <td style={{ textAlign: 'right' }}><Link to={`/departments/${d.slug}`} className="panel-action">Open <ArrowRight size={12} /></Link></td>
                </tr>
              ))}
              <tr>
                <td>
                  <div className="row" style={{ gap: 10 }}>
                    <DeptIcon slug="materials" size={26} />
                    <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Materials</span>
                    <span className="badge warning">Soon</span>
                  </div>
                </td>
                <td className="text-faint">—</td><td className="text-faint">—</td>
                <td style={{ textAlign: 'right' }}><Link to="/departments/materials" className="panel-action">Open <ArrowRight size={12} /></Link></td>
              </tr>
            </tbody>
          </table>
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Goals across departments" icon={Target}>
          {goals.length === 0 ? (
            <p className="text-dim text-sm" style={{ margin: 0 }}>
              {supervisor ? 'No goals set yet.' : 'No goals defined yet. Open a department to assign the first goal to a team.'}
            </p>
          ) : (
            <div className="list">
              {goals.map((g) => {
                const d = departments.find((x) => x.id === g.department_id);
                return (
                  <div key={g.id} className="list-row" style={{ padding: '8px 0' }}>
                    <DeptIcon slug={d?.slug} size={24} />
                    <div className="grow">
                      <div className="name">{g.title}</div>
                      <div className="meta">{d?.name}</div>
                    </div>
                    {g.due_date && <span className="badge neutral mono">{g.due_date}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {supervisor ? (
          <Panel title="Reports" icon={FileDown}
            action={<Link to="/reports" className="panel-action">Open <ArrowRight size={12} /></Link>}>
            <p className="text-dim text-sm" style={{ margin: 0 }}>
              Download monthly, full-year and per-department reports as PDF, and view club activity graphs.
            </p>
            <Link to="/reports" className="btn secondary sm" style={{ marginTop: 12 }}>
              <FileDown size={13} /> Go to reports
            </Link>
          </Panel>
        ) : (
          <Panel title="Your tools" icon={Target}>
            <div className="stack" style={{ gap: 8 }}>
              <Link to="/members" className="btn secondary">
                <Users size={14} /> Change roles & departments
              </Link>
              <Link to="/calendar" className="btn secondary">
                <CalendarDays size={14} /> Manage the global calendar
              </Link>
              <p className="text-dim text-sm" style={{ margin: '2px 2px 0' }}>
                Use the settings button next to a member to change their role or department.
              </p>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ---------- Member ---------- */
function MemberDashboard({ user, departments, goals, members, tasks }) {
  const dept = (departments || []).find((d) => d.id === user.department_id);
  if (!dept || members === null) return <Skeleton h={400} />;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <DeptIcon slug={dept.slug} size={46} />
          <div>
            <h1>{DEPT_LABELS[dept.slug] || dept.name}</h1>
            <div className="sub">Your department · here's what's on your plate</div>
          </div>
        </div>
        <div className="head-meta">
          <RolePill role={user.role} />
          <Link to={`/departments/${dept.slug}`} className="btn secondary sm">
            Department page <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <MyTasksPanel user={user} tasks={tasks} />

      <div className="grid-2">
        <RecentPosts dept={dept} />
        <UpcomingEvents />
      </div>

      <div className="grid-2">
        <DeptGoalsPanel deptId={dept.id} goals={goals} />
        <TeamLink members={members} deptId={dept.id} />
      </div>
    </div>
  );
}

/* ---------- Guest ---------- */
function GuestDashboard() {
  const [departments, setDepartments] = useState(null);
  const [mine, setMine] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/departments')
      .then((ds) => {
        const active = ds.filter((d) => !d.coming_soon);
        setDepartments(active);
        setDeptId(String(active[0]?.id ?? ''));
      })
      .catch(() => setDepartments([]));
    api('/applications/mine').then(setMine).catch(() => setMine([]));
  }, []);

  const hasPending = mine.some((a) => a.status === 'pending');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/applications', {
        method: 'POST',
        body: { department_id: Number(deptId), message },
      });
      setMessage('');
      api('/applications/mine').then(setMine).catch(() => {});
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const latest = mine[0];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{user.club?.name || 'Robotics Club'}</h1>
          <div className="sub">Public view — see what the club does and apply to join</div>
        </div>
      </div>

      <div className="banner info">
        <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          You are browsing as a <strong>guest</strong>. You can read every department's public page and the
          club calendar. Apply below to become a member — the Leader or the department manager reviews it.
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Apply to join the club" icon={UserPlus}>
          {latest && latest.status === 'pending' ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="badge neutral">Pending</span>
                <span className="text-dim text-sm">
                  Your application for <strong>{latest.department_name}</strong> is being reviewed.
                </span>
              </div>
              <div className="text-faint text-xs">
                You will become a member as soon as the Leader or the manager accepts it.
              </div>
            </div>
          ) : (
            <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
              {error && <div className="banner error">{error}</div>}
              {latest && latest.status !== 'pending' && (
                <div className="row" style={{ gap: 8 }}>
                  <span className={`badge ${latest.status === 'accepted' ? 'success' : 'danger'}`}>
                    {latest.status === 'accepted' ? 'Accepted' : 'Refused'}
                  </span>
                  <span className="text-dim text-sm">
                    Your last application for <strong>{latest.department_name}</strong> was{' '}
                    {latest.status}. You can apply again below.
                  </span>
                </div>
              )}
              <div className="field">
                <label htmlFor="app-dept">Department</label>
                <select id="app-dept" className="select" value={deptId}
                  onChange={(e) => setDeptId(e.target.value)} required>
                  {(departments || []).map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="app-msg">Why do you want to join? (optional)</label>
                <textarea id="app-msg" className="textarea" rows={3} value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="A few words about you and what you'd like to do in the club…" />
              </div>
              <button className="btn" type="submit"
                disabled={busy || hasPending || !departments?.length}>
                {busy ? 'Sending…' : hasPending ? 'Application pending' : 'Send application'}
              </button>
            </form>
          )}
        </Panel>

        <Panel title="Explore the club" icon={Building2}>
          <div className="stack" style={{ gap: 8 }}>
            {[['hr', 'Human Resources'], ['events', 'Events'], ['media', 'Media'], ['finance', 'Finance']].map(([slug, name]) => (
              <Link key={slug} to={`/departments/${slug}`} className="list-row clickable" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <DeptIcon slug={slug} size={30} />
                <div className="grow">
                  <div className="name">{name}</div>
                  <div className="meta">Public posts</div>
                </div>
                <ArrowRight size={15} className="text-faint" />
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <UpcomingEvents />
    </div>
  );
}
