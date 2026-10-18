import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Video, Plus, Globe, Building2, Lock, Users, Radio, Hourglass, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { connectSocket } from '../socket';
import { Skeleton, EmptyState } from '../components/ui';

const LEADERSHIP = ['supervisor', 'leader', 'coleader', 'manager'];
const SCOPE_ICON = { global: Globe, department: Building2, private: Lock };

/* ============================================================
   Meetings — the live-room list. Leadership starts meetings;
   joining needs the host's approval; each meeting has a chat.
   Guests never reach this page (App routes block it).
   ============================================================ */
export default function Meetings() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const leadership = LEADERSHIP.includes(user.role);

  const load = useCallback(() => {
    api('/meetings').then(setMeetings).catch((e) => { setError(e.message); setMeetings([]); });
  }, []);
  useEffect(load, [load]);

  // live refresh when a meeting starts, someone asks to join, or is accepted
  useEffect(() => {
    const s = connectSocket();
    if (!s) return undefined;
    const onActivity = () => load();
    s.on('meet:activity', onActivity);
    return () => s.off('meet:activity', onActivity);
  }, [load]);

  const live = (meetings || []).filter((m) => m.status === 'live');
  const past = (meetings || []).filter((m) => m.status === 'ended');

  const join = async (m) => {
    try { await api(`/meetings/${m.id}/join`, { method: 'POST', body: {} }); load(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1><Video size={20} /> Meetings</h1>
          <p className="text-dim text-sm" style={{ margin: 0 }}>
            Live rooms with their own chat. Anyone can ask to join — the host decides.
          </p>
        </div>
        {leadership && !creating && (
          <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> Start a meeting</button>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      {creating && (
        <CreateMeeting
          user={user}
          onDone={() => { setCreating(false); load(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {meetings === null ? (
        <Skeleton h={120} />
      ) : meetings.length === 0 ? (
        <div className="panel"><div className="panel-body">
          <EmptyState
            icon={Video}
            title="No meetings yet"
            text={leadership
              ? 'Start one — pick a scope (club-wide, a department, or a private group).'
              : 'When a meeting starts you will see it here and can ask to join.'}
          />
        </div></div>
      ) : (
        <>
          <section className="stack" style={{ gap: 10 }}>
            <div className="eyebrow"><span className="dot" /> Live now · {live.length}</div>
            {live.length === 0 && <div className="text-dim text-sm">Nothing is live right now.</div>}
            {live.map((m) => (
              <MeetingCard key={m.id} m={m} onJoin={() => join(m)} onOpen={() => nav(`/meetings/${m.id}`)} />
            ))}
          </section>

          {past.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              <div className="eyebrow">Recently ended</div>
              {past.map((m) => (
                <MeetingCard key={m.id} m={m} onOpen={() => nav(`/meetings/${m.id}`)} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- one meeting card ---------- */
function MeetingCard({ m, onJoin, onOpen }) {
  const Icon = SCOPE_ICON[m.scope] || Globe;
  const status = m.status === 'ended'
    ? { label: 'Ended', cls: 'neutral' }
    : m.is_host ? { label: 'You host', cls: 'accent' }
      : m.my_status === 'accepted' ? { label: 'Joined', cls: 'success' }
        : m.my_status === 'pending' ? { label: m.my_origin === 'invited' ? 'Invited' : 'Waiting', cls: 'warning' }
          : { label: 'Open', cls: 'neutral' };
  return (
    <article className="panel meeting-card">
      <div className="panel-body row" style={{ gap: 14, alignItems: 'center' }}>
        <div className="meeting-icon"><Icon size={18} /></div>
        <div className="grow">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong>{m.title}</strong>
            <span className={`badge ${status.cls}`}>{status.label}</span>
            <span className="badge neutral"><Icon size={11} /> {m.scope_label}{m.department ? ` · ${m.department.name}` : ''}</span>
            {m.status === 'live' && <span className="badge live"><Radio size={11} /> live</span>}
            {m.unread > 0 && <span className="badge accent">{m.unread} new</span>}
          </div>
          <div className="text-faint text-xs" style={{ marginTop: 3 }}>
            {m.host.full_name} · {m.accepted} in
            {m.pending > 0 ? ` · ${m.pending} waiting` : ''}
            {m.last_body ? ` · “${m.last_body.slice(0, 60)}”` : ''}
          </div>
        </div>
        {m.status === 'live' && m.can_join && (
          <button className="btn sm" onClick={onJoin}><Hourglass size={13} /> Ask to join</button>
        )}
        {(m.is_host || m.my_status === 'accepted' || m.my_status === 'pending' || m.status === 'ended') && (
          <button className={`btn sm ${m.can_join ? 'ghost' : ''}`} onClick={onOpen}>
            Open <ArrowRight size={13} />
          </button>
        )}
      </div>
    </article>
  );
}

/* ---------- start-a-meeting form (leadership only) ---------- */
function CreateMeeting({ user, onDone, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('global');
  const [deptId, setDeptId] = useState('');
  const [depts, setDepts] = useState([]);
  const [members, setMembers] = useState([]);
  const [invite, setInvite] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/departments').then((d) => { setDepts(d); if (d[0]) setDeptId(String(d[0].id)); }).catch(() => setDepts([]));
    api('/users').then((u) => setMembers(u.filter((m) => m.role !== 'guest' && m.id !== user.id))).catch(() => setMembers([]));
  }, [user.id]);

  const toggle = (id) => setInvite((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (scope === 'department' && !deptId) return setError('Pick a department');
    if (scope === 'private' && invite.length === 0) return setError('Invite at least one person to a private meeting');
    setBusy(true);
    try {
      await api('/meetings', {
        method: 'POST',
        body: {
          title, description, scope,
          department_id: scope === 'department' ? Number(deptId) : undefined,
          invite_ids: invite,
        },
      });
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-head"><h2>Start a meeting</h2></div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        {error && <div className="banner error">{error}</div>}
        <div className="field">
          <label htmlFor="mt-title">Title</label>
          <input id="mt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly sync, emergency plan, budget review…" required maxLength={140} />
        </div>
        <div className="field">
          <label htmlFor="mt-desc">Agenda (optional)</label>
          <textarea id="mt-desc" className="textarea" rows={2} value={description}
            onChange={(e) => setDescription(e.target.value)} placeholder="What is this meeting about?" />
        </div>
        <div className="field">
          <label htmlFor="mt-scope">Who can see it</label>
          <select id="mt-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="global">Club-wide — any member may ask to join</option>
            <option value="department">One department</option>
            <option value="private">Private — invite only</option>
          </select>
        </div>
        {scope === 'department' && (
          <div className="field">
            <label htmlFor="mt-dept">Department</label>
            <select id="mt-dept" className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}
        {(scope === 'private' || scope === 'global' || scope === 'department') && (
          <div className="field">
            <label>
              {scope === 'private' ? 'Invite people (required)' : 'Invite specific people (optional)'}
            </label>
            <div className="picker">
              {members.length === 0 && <span className="text-faint text-sm">No other members.</span>}
              {members.map((m) => (
                <button type="button" key={m.id}
                  className={`chip ${invite.includes(m.id) ? 'on' : ''}`}
                  onClick={() => toggle(m.id)}>
                  {m.full_name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || !title.trim()}>
            {busy ? 'Starting…' : 'Start meeting'}
          </button>
        </div>
      </div>
    </form>
  );
}
