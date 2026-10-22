import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, MessageSquare, Settings2, Trash2, UserPlus, Building2, Plus } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { ROLE_LABELS, isLeader } from '../roles';
import { Avatar, RolePill, EmptyState, Skeleton, useModal } from '../components/ui';

const ALL = 'all';

/* Members directory — search by name, filter by role + department.
   Guests never reach this page (guarded in App routes + API).
   Leader/Co-Leader additionally manage roles, departments, removal
   and CREATE all accounts; the Supervisor creates LEADER accounts
   and can add further SUPERVISORS (a club may have several). */
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
  const [creatingDept, setCreatingDept] = useState(false);

  const canManage = isLeader(user.role);
  const canCreate = user.role === 'supervisor' || canManage;

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

  if (members === null && !error) return <Skeleton h={380} />;
  if (error && (!members || members.length === 0)) {
    return (
      <div className="banner error row" style={{ gap: 10 }}>
        <span className="grow">{error}</span>
        <button className="btn sm secondary" onClick={load}>Retry</button>
      </div>
    );
  }

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
              <UserPlus size={14} /> Create account
            </button>
            {canManage && (
              <button className="btn sm secondary" onClick={() => setCreatingDept(true)}>
                <Building2 size={14} /> New department
              </button>
            )}
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
                const protectedRole = ['leader', 'coleader', 'supervisor'].includes(m.role);
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
                    {m.department_name || '—'}
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
          isSupervisor={user.role === 'supervisor'}
          departments={departments}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}

      {creatingDept && (
        <CreateDepartmentModal
          onClose={() => setCreatingDept(false)}
          onCreated={(dept) => {
            setCreatingDept(false);
            load();
            // the sidebar reads the real department list — tell it to refresh
            window.dispatchEvent(new Event('isigk:departments'));
            nav(`/departments/${dept.slug}`);
          }}
        />
      )}

      <p className="text-faint text-xs">
        Directory access:{' '}
        {user.role === 'supervisor'
          ? 'supervisor view — read-only, except creating the Leader and further Supervisors (the chain starts with you)'
          : canManage
            ? 'full club visibility · create accounts and whole departments with the buttons above · manage roles with the ⚙ button'
            : 'all members except guests'}.
      </p>
    </div>
  );
}

/* ---------- create modal — the onboarding chain ----------
   Supervisor: creates a LEADER or another SUPERVISOR.
   Leader/Co-Leader: creates co-leader / manager / member / guest. */
function CreateModal({ isSupervisor, departments, onClose, onCreated }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(isSupervisor ? 'leader' : 'member');
  const [deptId, setDeptId] = useState(departments[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const modalRef = useModal(onClose, busy);

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
      <form
        className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="create-modal-title"
        onClick={(e) => e.stopPropagation()} onSubmit={submit}
      >
        <div className="panel-head">
          <h2 id="create-modal-title"><UserPlus size={15} /> Create account</h2>
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
              onChange={(e) => setRole(e.target.value)}>
              {isSupervisor ? (
                <>
                  <option value="leader">Leader</option>
                  <option value="supervisor">Supervisor</option>
                </>
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
            {isSupervisor
              ? 'The chain starts with you: create the Leader who will then create every other account — or add another Supervisor to share the responsibility.'
              : 'You create all other accounts — Supervisor and Leader accounts come from the Supervisor.'}
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

/* ---------- create a whole department ----------
   Leader/Co-Leader: names the department and can create its first manager
   and members in the same request. The server validates the whole form
   before writing anything, so a bad email never leaves a half department. */
const EMPTY_PERSON = { full_name: '', email: '', password: '' };

function CreateDepartmentModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [manager, setManager] = useState({ ...EMPTY_PERSON });
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const modalRef = useModal(onClose, busy);

  const setMgr = (field) => (e) => setManager((m) => ({ ...m, [field]: e.target.value }));
  const setMember = (i, field) => (e) => setMembers((list) => list.map(
    (m, j) => (j === i ? { ...m, [field]: e.target.value } : m),
  ));
  const addMember = () => setMembers((list) => [...list, { ...EMPTY_PERSON }]);
  const removeMember = (i) => setMembers((list) => list.filter((_, j) => j !== i));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const clean = (p) => ({
      full_name: p.full_name.trim(), email: p.email.trim().toLowerCase(), password: p.password,
    });
    const mgr = clean(manager);
    const managerTouched = !!(mgr.full_name || mgr.email || mgr.password);
    if (managerTouched && (!mgr.full_name || !mgr.email || !mgr.password)) {
      setError("Complete the manager's name, email and password — or leave all three empty.");
      return;
    }
    const rows = members.map(clean);
    const incomplete = rows.findIndex(
      (m) => (m.full_name || m.email || m.password) && (!m.full_name || !m.email || !m.password),
    );
    if (incomplete !== -1) {
      setError(`Complete member ${incomplete + 1}'s name, email and password — or remove the row.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api('/departments', {
        method: 'POST',
        body: {
          name: name.trim(),
          description: description.trim(),
          manager: managerTouched ? mgr : undefined,
          members: rows.filter((m) => m.full_name && m.email && m.password),
        },
      });
      onCreated(r.department);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <form
        className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="dept-modal-title"
        style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}
      >
        <div className="panel-head">
          <h2 id="dept-modal-title"><Building2 size={15} /> Create a department</h2>
        </div>
        <div className="panel-body stack" style={{ gap: 12 }}>
          {error && <div className="banner error">{error}</div>}

          <div className="field">
            <label htmlFor="d-name">Department name</label>
            <input id="d-name" className="input" value={name} required maxLength={60}
              placeholder="e.g. Competition Team"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-desc">What it does <span className="text-faint">(optional)</span></label>
            <input id="d-desc" className="input" value={description} maxLength={500}
              placeholder="One line shown on the department page"
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13 }}>First manager <span className="text-faint text-xs">(optional)</span></strong>
            <p className="text-faint text-xs" style={{ margin: '4px 0 8px' }}>
              The manager gets the department workspace: tasks, albums and its tools.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: '1 1 150px' }} aria-label="Manager full name"
                placeholder="Full name" value={manager.full_name}
                onChange={setMgr('full_name')} autoComplete="off" />
              <input className="input" style={{ flex: '1 1 170px' }} aria-label="Manager email"
                type="email" placeholder="Email" value={manager.email}
                onChange={setMgr('email')} autoComplete="off" />
              <input className="input" style={{ flex: '1 1 150px' }} aria-label="Manager password"
                type="password" placeholder="Password (6+)" value={manager.password}
                onChange={setMgr('password')} autoComplete="new-password" />
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>First members <span className="text-faint text-xs">(optional)</span></strong>
              <button type="button" className="btn ghost sm" onClick={addMember}>
                <Plus size={14} /> Add member
              </button>
            </div>
            {members.length === 0 ? (
              <p className="text-faint text-xs" style={{ margin: '4px 0 0' }}>
                Add teammates now, or create them later from the Members page.
              </p>
            ) : (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {members.map((m, i) => (
                  <div className="row" key={i} style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input className="input" style={{ flex: '1 1 150px' }} aria-label={`Member ${i + 1} full name`}
                      placeholder={`Member ${i + 1} — full name`} value={m.full_name}
                      onChange={setMember(i, 'full_name')} autoComplete="off" />
                    <input className="input" style={{ flex: '1 1 170px' }} aria-label={`Member ${i + 1} email`}
                      type="email" placeholder="Email" value={m.email}
                      onChange={setMember(i, 'email')} autoComplete="off" />
                    <input className="input" style={{ flex: '1 1 150px' }} aria-label={`Member ${i + 1} password`}
                      type="password" placeholder="Password (6+)" value={m.password}
                      onChange={setMember(i, 'password')} autoComplete="new-password" />
                    <button type="button" className="icon-btn" title={`Remove member ${i + 1}`}
                      aria-label={`Remove member ${i + 1}`} onClick={() => removeMember(i)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-faint text-xs" style={{ margin: 0 }}>
            The department gets its own page, feed, albums and team. You can add more managers and members
            from the Members page at any time.
          </p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Creating…' : 'Create department'}
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
  const modalRef = useModal(onClose, busy);

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
      <form
        className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="manage-modal-title"
        onClick={(e) => e.stopPropagation()} onSubmit={save}
      >
        <div className="panel-head">
          <h2 id="manage-modal-title"><Settings2 size={15} /> Manage — {member.full_name}</h2>
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
