import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, MessageSquare, Settings2, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { ROLE_LABELS, DEPT_LABELS, isLeader } from '../roles';
import { Avatar, RolePill, EmptyState, Skeleton } from '../components/ui';

const ALL = 'all';

/* Members directory — search by name, filter by role + department.
   Guests never reach this page (guarded in App routes + API).
   Leader/Co-Leader additionally manage roles, departments, removal
   and CREATE all accounts; the Professor creates LEADER accounts. */
export default function Members() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [members, setMembers] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [managing, setManaging] = useState(null); // member being edited
  const [creating, setCreating] = useState(false);

  const canManage = isLeader(user.role);
  const canCreate = user.role === 'professor' || canManage;

  const load = () => {
    api('/users').then(setMembers).catch((e) => { setError(e.message); setMembers([]); });
  };
  useEffect(load, []);
  useEffect(() => {
    // assignable departments (Materials is not active yet)
    api('/departments')
      .then((ds) => setDepartments(ds.filter((d) => d.slug !== 'materials')))
      .catch(() => setDepartments([]));
  }, []);

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !m.full_name.toLowerCase().includes(q)) return false;
      if (roleFilter !== ALL && m.role !== roleFilter) return false;
      if (deptFilter !== ALL && String(m.department_id ?? 'none') !== deptFilter) return false;
      return true;
    });
  }, [members, query, roleFilter, deptFilter]);

  const rolesPresent = useMemo(() => {
    if (!members) return [];
    return [...new Set(members.map((m) => m.role))];
  }, [members]);

  if (error) return <div className="banner error">{error}</div>;
  if (members === null) return <Skeleton h={380} />;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Members</h1>
          <div className="sub">
            {members.length} people in the club · click anyone to open a private chat
          </div>
        </div>
        {canCreate && (
          <div className="head-meta">
            <button className="btn sm" onClick={() => setCreating(true)}>
              <UserPlus size={14} /> {user.role === 'professor' ? 'Create leader account' : 'Create account'}
            </button>
          </div>
        )}
      </div>

      {/* filters */}
      <div className="row" style={{ gap: 10 }}>
        <div className="input-search" style={{ flex: 1, minWidth: 200, maxWidth: 340 }}>
          <Search size={15} />
          <input
            className="input"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search members by name"
          />
        </div>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
        >
          <option value={ALL}>All roles</option>
          {rolesPresent.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          aria-label="Filter by department"
        >
          <option value={ALL}>All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          <option value="none">No department</option>
        </select>
      </div>

      {/* results */}
      <section className="panel">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members match your search"
            text="Try a different name, or reset the role and department filters."
          />
        ) : (
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th className="hide-sm">Department</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const protectedRole = ['leader', 'coleader', 'professor'].includes(m.role);
                const canEditThis = canManage && !protectedRole && m.id !== user.id;
                return (
                <tr
                  key={m.id}
                  className="clickable"
                  onClick={() => nav(`/chat/${m.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') nav(`/chat/${m.id}`); }}
                  tabIndex={0}
                >
                  <td>
                    <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <Avatar user={m} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                          {m.full_name}
                          {m.id === user.id && <span className="text-faint text-xs"> (you)</span>}
                        </div>
                        <div className="text-dim text-xs">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><RolePill role={m.role} /></td>
                  <td className="hide-sm text-dim">
                    {m.department_name ? DEPT_LABELS[m.department_slug] || m.department_name : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {canEditThis ? (
                      <button
                        className="icon-btn"
                        title={`Manage ${m.full_name}`}
                        aria-label={`Manage ${m.full_name}`}
                        onClick={(e) => { e.stopPropagation(); setManaging(m); }}
                      >
                        <Settings2 size={15} />
                      </button>
                    ) : (
                      <MessageSquare size={15} className="text-faint" aria-hidden="true" />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {managing && (
        <ManageModal
          member={managing}
          departments={departments}
          onClose={() => setManaging(null)}
          onSaved={() => { setManaging(null); load(); }}
        />
      )}

      {creating && (
        <CreateModal
          onlyLeader={user.role === 'professor'}
          departments={departments}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}

      <p className="text-faint text-xs">
        Directory access:{' '}
        {user.role === 'professor'
          ? 'supervisor view — read-only, except creating the Leader account (the chain starts with you)'
          : canManage
            ? 'full club visibility · create accounts with the button above · manage roles with the ⚙ button'
            : 'all members except guests'}.
      </p>
    </div>
  );
}

/* ---------- create modal — the onboarding chain ----------
   Professor: creates a LEADER (fixed role).
   Leader/Co-Leader: creates co-leader / manager / member / guest. */
function CreateModal({ onlyLeader, departments, onClose, onCreated }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(onlyLeader ? 'leader' : 'member');
  const [deptId, setDeptId] = useState(departments[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const needsDept = role === 'member' || role === 'manager';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/users', {
        method: 'POST',
        body: {
          full_name: fullName,
          email,
          password,
          role,
          department_id: needsDept ? Number(deptId) : null,
        },
      });
      onCreated();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel-head">
          <h2><UserPlus size={15} /> {onlyLeader ? 'Create leader account' : 'Create account'}</h2>
        </div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="c-name">Full name</label>
            <input id="c-name" className="input" value={fullName} required
              placeholder="e.g. Yassine Trabelsi"
              onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-email">Email</label>
            <input id="c-email" className="input" type="email" value={email} required
              placeholder="name@isigk.tn"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-password">Password</label>
            <input id="c-password" className="input" type="password" value={password} required
              autoComplete="new-password" placeholder="At least 6 characters"
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-role">Role</label>
            <select id="c-role" className="select" value={role}
              disabled={onlyLeader} onChange={(e) => setRole(e.target.value)}>
              {onlyLeader ? (
                <option value="leader">Leader</option>
              ) : (
                <>
                  <option value="coleader">Co-Leader</option>
                  <option value="manager">Manager</option>
                  <option value="member">Member</option>
                  <option value="guest">Guest</option>
                </>
              )}
            </select>
          </div>
          {needsDept && (
            <div className="field">
              <label htmlFor="c-dept">Department</label>
              <select id="c-dept" className="select" value={deptId}
                onChange={(e) => setDeptId(e.target.value)} required>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <p className="text-faint text-xs">
            {onlyLeader
              ? 'The chain starts with you: the Leader you create will then create every other account.'
              : 'You create all other accounts — Leader accounts come from the Professor.'}
          </p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ManageModal({ member, departments, onClose, onSaved }) {
  const [role, setRole] = useState(member.role);
  const [deptId, setDeptId] = useState(member.department_id ?? departments[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/users/${member.id}/role`, {
        method: 'PATCH',
        body: { role, department_id: role === 'guest' ? null : Number(deptId) },
      });
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${member.full_name} from the club? This cannot be undone.`)) return;
    setError('');
    setBusy(true);
    try {
      await api(`/users/${member.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="panel-head">
          <h2><Settings2 size={15} /> Manage — {member.full_name}</h2>
        </div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="m-role">Role</label>
            <select id="m-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="guest">Guest</option>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          {role !== 'guest' && (
            <div className="field">
              <label htmlFor="m-dept">Department</label>
              <select id="m-dept" className="select" value={deptId}
                onChange={(e) => setDeptId(e.target.value)} required>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <p className="text-faint text-xs">
            {role === 'manager'
              ? 'Managers lead their department (tasks, posts, attendance…).'
              : role === 'guest'
                ? 'Guests see public pages only — no directory, no chat.'
                : 'Members join a department and take part in chats, tasks and votes.'}
          </p>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <button type="button" className="btn danger ghost" onClick={remove} disabled={busy}>
              <Trash2 size={14} /> Remove from club
            </button>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </span>
          </div>
        </div>
      </form>
    </div>
  );
}
