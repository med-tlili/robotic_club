import { useEffect, useState } from 'react';
import {
  CheckSquare, Plus, Trash2, Circle, Loader, CheckCircle2, User,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { ToolBlock, EmptyState, Skeleton } from './ui';

const STATUS_META = {
  todo: { label: 'To do', icon: Circle, cls: 'neutral' },
  doing: { label: 'In progress', icon: Loader, cls: 'accent' },
  done: { label: 'Done', icon: CheckCircle2, cls: 'success' },
};

/* ============================================================
   Department tasks — private space
   Manager/Leader create & manage; members move their own tasks
   ============================================================ */
export default function TasksPanel({ dept }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState('all');

  const isBoss = ['leader', 'coleader'].includes(user.role);
  const canCreate = isBoss || (user.role === 'manager' && user.department_id === dept.id);

  const load = () => {
    api(`/tasks?department_id=${dept.id}`)
      .then(setTasks)
      .catch((e) => { setError(e.message); setTasks([]); });
  };
  useEffect(load, [dept.id]);

  if (error) return <div className="banner error">{error}</div>;
  if (tasks === null) return <Skeleton h={160} />;

  const counts = {
    todo: tasks.filter((t) => t.status === 'todo').length,
    doing: tasks.filter((t) => t.status === 'doing').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };
  const shown = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <ToolBlock
      label="Tasks"
      sub={`${counts.todo} to do · ${counts.doing} in progress`}
      action={canCreate && !composing ? (
        <button className="btn sm" onClick={() => setComposing(true)}>
          <Plus size={13} /> New task
        </button>
      ) : null}
    >
      {composing && (
        <TaskForm
          dept={dept}
          onCancel={() => setComposing(false)}
          onDone={() => { setComposing(false); load(); }}
        />
      )}

      {/* status filter tabs */}
      <div className="task-tabs">
        {['all', 'todo', 'doing', 'done'].map((s) => (
          <button
            key={s}
            className={`task-tab ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s === 'all' ? `All (${tasks.length})` : `${STATUS_META[s].label} (${counts[s]})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={filter === 'all' ? 'No tasks yet' : `No ${STATUS_META[filter]?.label.toLowerCase()} tasks`}
          text={canCreate
            ? 'Create the first task and assign it to a team member.'
            : 'Tasks assigned by your manager or the leader appear here.'}
        />
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} onChanged={load} />
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

/* ---------- one task ---------- */
function TaskRow({ task, onChanged }) {
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;

  const setStatus = async (status) => {
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
      onChanged();
    } catch (e) { alert(e.message); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); onChanged(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className={`task-row ${task.status}`}>
      {task.can_change_status ? (
        <button
          className="task-check"
          aria-label={task.status === 'done' ? 'Mark as to do' : 'Mark as done'}
          title={task.status === 'done' ? 'Mark as to do' : 'Mark as done'}
          onClick={() => setStatus(task.status === 'done' ? 'todo' : 'done')}
        >
          {task.status === 'done'
            ? <CheckCircle2 size={18} className="ok" />
            : <Circle size={18} />}
        </button>
      ) : (
        <span className="task-check static"><Circle size={18} /></span>
      )}

      <div className="grow">
        <div className={`task-title ${task.status === 'done' ? 'done' : ''}`}>{task.title}</div>
        <div className="row text-xs text-faint" style={{ gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
          <span className={`badge ${meta.cls}`}><Icon size={11} /> {meta.label}</span>
          {task.assigned_to_name ? (
            <span className="row" style={{ gap: 4 }}><User size={11} /> {task.assigned_to_name}</span>
          ) : (
            <span className="row" style={{ gap: 4 }}><User size={11} /> anyone</span>
          )}
          {task.due_date && <span className="mono">Due {task.due_date}</span>}
        </div>
      </div>

      {task.can_change_status && task.status !== 'done' && (
        <select
          className="select task-status-select"
          value={task.status}
          aria-label={`Status of ${task.title}`}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
          <option value="done">Done</option>
        </select>
      )}
      {task.can_edit && (
        <button className="icon-btn" title="Delete task" aria-label="Delete task" onClick={remove}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/* ---------- create form (manager/leader) ---------- */
function TaskForm({ dept, onCancel, onDone }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState([]);

  useEffect(() => {
    // department members come from the users directory (already fetched on the page? no — fetch here)
    api('/users')
      .then((all) => setTeam(all.filter((m) => m.department_id === dept.id
        && ['manager', 'member'].includes(m.role))))
      .catch(() => setTeam([]));
  }, [dept.id]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/tasks', {
        method: 'POST',
        body: {
          department_id: dept.id,
          title,
          description,
          assigned_to: assignedTo ? Number(assignedTo) : null,
          due_date: due || null,
        },
      });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="task-form" onSubmit={submit}>
      {error && <div className="banner error">{error}</div>}
      <div className="field">
        <label htmlFor="t-title">Title</label>
        <input id="t-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done?" required maxLength={140} />
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow">
          <label htmlFor="t-assign">Assign to</label>
          <select id="t-assign" className="select" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Anyone (unassigned)</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="t-due">Due date (optional)</label>
          <input id="t-due" className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="t-desc">Details (optional)</label>
        <textarea id="t-desc" className="textarea" rows={2} value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={busy || !title.trim()}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </form>
  );
}
