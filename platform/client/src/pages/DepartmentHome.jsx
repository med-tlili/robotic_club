import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Target, Lock, Eye, Megaphone, ArrowRight, Settings2, Trash2,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { isBoss, isLeader } from '../roles';
import { Skeleton, DeptIcon, ToolBlock, Avatar, useModal } from '../components/ui';
import PostFeed from '../components/PostFeed';
import AlbumsGallery from '../components/AlbumsGallery';
import TasksPanel from '../components/TasksPanel';
import { HrTools, AlbumTools, EventsTools, FinanceTools } from '../components/DeptTools';

/* ============================================================
   Department page = PUBLIC home + PRIVATE workspace, in that
   order. The public feed is compact and everyone can read it;
   the private workspace is ONE framed surface holding the
   department's real tools (no wall of equal cards).
   ============================================================ */
export default function DepartmentHome() {
  const { slug } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [dept, setDept] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = () => {
    setDept(null);
    setError('');
    api(`/departments/${slug}`).then(setDept).catch((e) => setError(e.message));
  };
  useEffect(load, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dept && !error) return <Skeleton h={420} />;
  if (!dept && error) {
    return (
      <div className="banner error row" style={{ gap: 10 }}>
        <span className="grow">{error}</span>
        <button className="btn sm secondary" onClick={load}>Retry</button>
      </div>
    );
  }

  if (dept.coming_soon) return <ComingSoon slug={slug} />;

  const inDept = user.department_id === dept.id;
  const boss = isBoss(user.role); // supervisor included → read-only view of everything
  const canPrivate = inDept || boss;
  const canEdit = isLeader(user.role);
  const label = dept.name;
  const meta = DEPT_INFO[dept.slug] || {};
  // a custom description wins over the built-in starter pitch
  const purpose = dept.description && dept.description !== STARTER_DESC[dept.slug]
    ? dept.description
    : (meta.purpose || dept.description);

  return (
    <div className="stack" style={{ gap: 24 }}>
      {/* header — name + what this department is for */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="row" style={{ gap: 14 }}>
          <DeptIcon slug={dept.slug} size={46} />
          <div>
            <h1>{label}</h1>
            <p className="purpose">{purpose}</p>
          </div>
        </div>
        {canEdit && (
          <div className="head-meta">
            <button className="btn sm secondary" onClick={() => setEditing(true)}>
              <Settings2 size={14} /> Edit department
            </button>
          </div>
        )}
      </div>

      {/* public/private legend — replaces the ambiguous pills */}
      <p className="scope">
        {canPrivate ? (
          <>
            <Megaphone size={13} />
            <span>
              The {meta.feedNoun || 'posts'} below are <strong style={{ color: 'var(--text)' }}>public</strong> — the whole club
              and guests can read them. The workspace further down is <strong style={{ color: 'var(--text)' }}>private</strong> to the {label} team.
            </span>
          </>
        ) : (
          <>
            <Eye size={13} />
            <span>
              Public page. The {label} team's private workspace (tasks, tools, chat) is visible only to its members and club leaders.
            </span>
          </>
        )}
      </p>

      {/* Photo albums — first thing on the page, browsable by every club member */}
      {user.role !== 'guest' && <AlbumsGallery dept={dept} />}

      {/* public feed */}
      <PostFeed dept={dept} />

      {/* private workspace */}
      {canPrivate ? (
        <section className="section" id="private">
          <div className="section-head">
            <span className="eyebrow private"><span className="dot" />Private workspace</span>
            <span className="ws-sub row" style={{ gap: 6 }}>
              <Lock size={12} /> {label} team · members & leaders
            </span>
          </div>
          <div className="panel ws">
            {dept.slug === 'hr' && <HrTools dept={dept} />}
            {dept.slug === 'events' && <EventsTools dept={dept} />}
            <AlbumTools dept={dept} />
            {dept.slug === 'finance' && <FinanceTools dept={dept} />}

            <TasksPanel dept={dept} />
            <GoalsBlock dept={dept} label={label} />
            <TeamBlock dept={dept} label={label} />
          </div>
        </section>
      ) : (
        <div className="lock-note">
          <Lock size={15} />
          <span>The {label} workspace — tasks, department tools and internal chat — is available to the team and club leaders.</span>
        </div>
      )}

      {editing && (
        <EditDepartmentModal
          dept={dept}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            setDept((prev) => ({ ...prev, ...updated }));
            window.dispatchEvent(new Event('isigk:departments'));
          }}
          onDeleted={() => {
            window.dispatchEvent(new Event('isigk:departments'));
            nav('/members');
          }}
        />
      )}
    </div>
  );
}

/* ---------- edit / delete a department ----------
   Leader/Co-Leader only. Renaming keeps the slug (links stay valid).
   Deleting first refuses while people are still in the department, then
   asks for confirmation and lists exactly what will be removed. */
const STARTER_DESC = {
  hr: 'Members, attendance and discipline',
  events: 'Events planning, itineraries and decoration',
  media: 'Albums, clips and social media',
  finance: 'Budget, expenses and sponsors',
  materials: 'Inventory and loans',
};

function usageSummary(usage) {
  if (!usage) return 'Checking…';
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  const parts = [];
  if (usage.posts) parts.push(n(usage.posts, 'post', 'posts'));
  if (usage.albums) {
    parts.push(`${n(usage.albums, 'album', 'albums')}${usage.photos ? ` (${usage.photos} photos)` : ''}`);
  }
  if (usage.tasks) parts.push(n(usage.tasks, 'task', 'tasks'));
  if (usage.goals) parts.push(n(usage.goals, 'goal', 'goals'));
  if (usage.meetings) parts.push(n(usage.meetings, 'meeting', 'meetings'));
  if (usage.applications) parts.push(n(usage.applications, 'application', 'applications'));
  if (usage.messages) parts.push(n(usage.messages, 'chat message', 'chat messages'));
  return parts.length ? parts.join(' · ') : 'no content';
}

function EditDepartmentModal({ dept, onClose, onSaved, onDeleted }) {
  const [name, setName] = useState(dept.name);
  const [description, setDescription] = useState(dept.description || '');
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const modalRef = useModal(onClose, busy);

  useEffect(() => {
    api(`/departments/${dept.slug}/usage`).then(setUsage).catch(() => setUsage(null));
  }, [dept.slug]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const updated = await api(`/departments/${dept.slug}`, {
        method: 'PATCH',
        body: { name: name.trim(), description: description.trim() },
      });
      onSaved(updated);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setError('');
    if (usage && usage.members > 0) {
      setError(`Move the ${usage.members} ${usage.members === 1 ? 'person' : 'people'} in ${dept.name} to another department (or remove them) first.`);
      return;
    }
    const ok = window.confirm(
      `Delete “${dept.name}” permanently?\n\nThis will remove: ${usageSummary(usage)}.\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/departments/${dept.slug}?confirm=1`, { method: 'DELETE' });
      onDeleted();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const blocked = !!usage && usage.members > 0;

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <form
        className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="edit-dept-title"
        onClick={(e) => e.stopPropagation()} onSubmit={save}
      >
        <div className="panel-head">
          <h2 id="edit-dept-title"><Settings2 size={15} /> Edit department</h2>
        </div>
        <div className="panel-body stack" style={{ gap: 12 }}>
          {error && <div className="banner error">{error}</div>}

          <div className="field">
            <label htmlFor="e-name">Name</label>
            <input id="e-name" className="input" value={name} required maxLength={60}
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-desc">What it does</label>
            <input id="e-desc" className="input" value={description} maxLength={500}
              placeholder="One line shown on the department page"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-faint text-xs" style={{ margin: 0 }}>
            The web address stays <span className="mono">/departments/{dept.slug}</span> when you rename it,
            so existing links keep working.
          </p>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong style={{ fontSize: 13, color: 'var(--danger, #b42318)' }}>Delete department</strong>
            <p className="text-faint text-xs" style={{ margin: '4px 0 8px' }}>
              {blocked
                ? `${usage.members} ${usage.members === 1 ? 'person is' : 'people are'} still in this department. Move them from Members first.`
                : `This department holds: ${usageSummary(usage)}.`}
            </p>
            <button type="button" className="btn danger ghost" onClick={remove}
              disabled={busy || blocked || usage === null}>
              <Trash2 size={14} /> Delete department
            </button>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ---------- compact goals (Leader-assigned) ---------- */
function GoalsBlock({ dept, label }) {
  const goals = dept.goals || [];
  return (
    <ToolBlock label="Goals" sub="assigned by the Leader">
      {goals.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          No goals assigned to {label} yet. The Leader sets goals with due dates from the department page.
        </p>
      ) : (
        <div className="list">
          {goals.map((g) => (
            <div key={g.id} className="list-row" style={{ padding: '8px 0' }}>
              <Target size={15} className="text-faint" />
              <div className="grow">
                <div className="name">{g.title}</div>
                {g.description && <div className="meta">{g.description}</div>}
              </div>
              {g.due_date && <span className="badge neutral mono">{g.due_date}</span>}
            </div>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

/* ---------- compact team (avatars → full list lives on /members) ---------- */
function TeamBlock({ dept, label }) {
  const members = dept.members || [];
  return (
    <ToolBlock
      label="Team"
      sub={`${members.length} ${members.length === 1 ? 'person' : 'people'}`}
      action={<Link to="/members" className="panel-action">Directory <ArrowRight size={12} /></Link>}
    >
      {members.length === 0 ? (
        <p className="text-dim text-sm" style={{ margin: 0 }}>No members in {label} yet.</p>
      ) : (
        <div className="team-row">
          {members.map((m) => (
            <Link key={m.id} to={`/chat/${m.id}`} title={`${m.full_name} · ${m.role}`} className="avatar-link">
              <Avatar user={m} />
            </Link>
          ))}
        </div>
      )}
    </ToolBlock>
  );
}

/* ---------- Materials: understated coming soon ---------- */
function ComingSoon({ slug }) {
  return (
    <div className="stack">
      <div className="page-head">
        <div className="row" style={{ gap: 14 }}>
          <DeptIcon slug={slug} size={46} />
          <div>
            <h1>Materials</h1>
            <div className="sub">Inventory, loans and stock alerts</div>
          </div>
        </div>
        <span className="badge warning">Coming soon</span>
      </div>

      <div className="panel"><div className="panel-body">
        <p className="text-dim text-sm" style={{ margin: 0 }}>
          Materials management (inventory, borrowing, low-stock alerts) is planned for a future version of the
          platform. Nothing here is functional yet — use the HR or Events pages in the meantime.
        </p>
      </div></div>
    </div>
  );
}

/* ---------- per-department content profiles ---------- */
const DEPT_INFO = {
  hr: {
    purpose: 'Members, attendance and discipline. HR keeps the member roster, marks who attends each meeting, records what was decided, and logs rule breaks.',
    feedNoun: 'posts',
  },
  events: {
    purpose: 'Planning club events from idea to decoration — itineraries, journeys and stand setup.',
    feedNoun: 'posts',
  },
  media: {
    purpose: 'Clips, albums and the club’s social presence — review clips here before they go out.',
    feedNoun: 'posts',
  },
  finance: {
    purpose: 'Sponsor partnerships and budget. Publish offers for the club to vote on, track sponsors from lead to won, and record income and expenses.',
    feedNoun: 'posts',
  },
};
