import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Target, Lock, Eye, Megaphone, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { DEPT_LABELS, isBoss } from '../roles';
import { Skeleton, DeptIcon, ToolBlock, Avatar } from '../components/ui';
import PostFeed from '../components/PostFeed';
import AlbumsGallery from '../components/AlbumsGallery';
import TasksPanel from '../components/TasksPanel';
import { HrTools, MediaTools, EventsTools, FinanceTools } from '../components/DeptTools';

/* ============================================================
   Department page = PUBLIC home + PRIVATE workspace, in that
   order. The public feed is compact and everyone can read it;
   the private workspace is ONE framed surface holding the
   department's real tools (no wall of equal cards).
   ============================================================ */
export default function DepartmentHome() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [dept, setDept] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setDept(null);
    const q = user.role === 'guest' ? '?guest=1' : '';
    api(`/departments/${slug}${q}`).then(setDept).catch((e) => setError(e.message));
  }, [slug, user]);

  if (error) return <div className="banner error">{error}</div>;
  if (!dept) return <Skeleton h={420} />;

  if (dept.coming_soon) return <ComingSoon slug={slug} />;

  const inDept = user.department_id === dept.id;
  const boss = isBoss(user.role); // professor included → read-only view of everything
  const canPrivate = inDept || boss;
  const label = DEPT_LABELS[dept.slug] || dept.name;
  const meta = DEPT_INFO[dept.slug] || {};

  return (
    <div className="stack" style={{ gap: 24 }}>
      {/* header — name + what this department is for */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="row" style={{ gap: 14 }}>
          <DeptIcon slug={dept.slug} size={46} />
          <div>
            <h1>{label}</h1>
            <p className="purpose">{meta.purpose || dept.description}</p>
          </div>
        </div>
      </div>

      {/* public/private legend — replaces the ambiguous pills */}
      <p className="scope">
        {canPrivate ? (
          <>
            <Megaphone size={13} />
            <span>
              The {meta.feedNoun || 'announcements'} below are <strong style={{ color: 'var(--text)' }}>public</strong> — the whole club
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

      {/* Media albums — first thing on the page, browsable by every club member */}
      {dept.slug === 'media' && user.role !== 'guest' && <AlbumsGallery />}

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
            {dept.slug === 'media' && <MediaTools dept={dept} />}
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
    feedNoun: 'announcements',
  },
  events: {
    purpose: 'Planning club events from idea to decoration — itineraries, journeys and stand setup.',
    feedNoun: 'event announcements',
  },
  media: {
    purpose: 'Clips, albums and the club’s social presence — review clips here before they go out.',
    feedNoun: 'clips',
  },
  finance: {
    purpose: 'Sponsor partnerships and budget. Publish offers for the club to vote on, track sponsors from lead to won, and record income and expenses.',
    feedNoun: 'sponsor offers',
  },
};
