import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Video, Globe, Building2, Lock, ArrowLeft, Send, Radio, Check, X,
  UserPlus, LogOut, Square, Hourglass, Users,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { connectSocket } from '../socket';
import { ROLE_LABELS } from '../roles';
import { Avatar, RolePill, Skeleton } from '../components/ui';

const SCOPE_ICON = { global: Globe, department: Building2, private: Lock };
const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso + 'Z').getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};

/* ============================================================
   MeetingRoom — one live meeting: people, requests, invite,
   optional video and the meeting chat (accepted members only).
   ============================================================ */
export default function MeetingRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/meetings/${id}`).then(setM).catch((e) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    const s = connectSocket();
    if (!s) return undefined;
    const onActivity = (p) => { if (!p || p.meeting_id === Number(id)) load(); };
    s.on('meet:activity', onActivity);
    return () => s.off('meet:activity', onActivity);
  }, [id, load]);

  const isHost = m?.is_host;
  useEffect(() => {
    if (isHost) api('/users').then((u) => setMembers(u.filter((x) => x.role !== 'guest'))).catch(() => setMembers([]));
  }, [isHost]);

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) ok(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!m) return <Skeleton h={160} />;

  const Icon = SCOPE_ICON[m.scope] || Globe;
  const accepted = m.my_status === 'accepted' || m.my_status === 'host';
  const room = `isigk-${user.club?.slug || user.club_id || 'club'}-meet-${m.id}`;
  const participantIds = new Set([m.host.id, ...m.participants.map((p) => p.id), ...m.requests.map((r) => r.id)]);
  const invitable = members.filter((x) => !participantIds.has(x.id));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Link to="/meetings" className="row text-sm text-dim" style={{ gap: 6 }}><ArrowLeft size={14} /> All meetings</Link>

      <div className="page-head">
        <div>
          <h1><Icon size={20} /> {m.title}</h1>
          <p className="text-dim text-sm" style={{ margin: 0 }}>
            {m.scope_label}{m.department ? ` · ${m.department.name}` : ''} · hosted by {m.host.full_name}
            {m.status === 'live' ? ' · live' : ' · ended'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {m.status === 'live' && (
            <span className="badge live"><Radio size={11} /> live</span>
          )}
          {isHost && m.status === 'live' && (
            <button className="btn danger ghost" disabled={busy}
              onClick={() => act(() => api(`/meetings/${m.id}/end`, { method: 'POST', body: {} }), load)}>
              <Square size={13} /> End meeting
            </button>
          )}
          {accepted && !isHost && m.status === 'live' && (
            <button className="btn ghost" disabled={busy}
              onClick={() => act(() => api(`/meetings/${m.id}/leave`, { method: 'POST', body: {} }), load)}>
              <LogOut size={13} /> Leave
            </button>
          )}
        </div>
      </div>

      {m.description && <div className="panel"><div className="panel-body"><p style={{ margin: 0 }}>{m.description}</p></div></div>}

      {/* my membership state */}
      {m.status === 'live' && m.can_join && (
        <div className="banner info row" style={{ gap: 10, justifyContent: 'space-between' }}>
          <span>You are not in yet. Asking sends a request to {m.host.full_name}.</span>
          <button className="btn sm" disabled={busy}
            onClick={() => act(() => api(`/meetings/${m.id}/join`, { method: 'POST', body: {} }), load)}>
            <Hourglass size={13} /> Ask to join
          </button>
        </div>
      )}
      {m.my_status === 'pending' && (
        <div className="banner info row" style={{ gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>
            {m.my_origin === 'invited'
              ? `${m.host.full_name} invited you. Accept to join the meeting and its chat.`
              : 'Waiting for the host to accept your request.'}
          </span>
          {m.my_origin === 'invited' && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm" disabled={busy}
                onClick={() => act(() => api(`/meetings/${m.id}/respond`, { method: 'POST', body: { action: 'accept' } }), load)}>
                <Check size={13} /> Accept
              </button>
              <button className="btn ghost sm" disabled={busy}
                onClick={() => act(() => api(`/meetings/${m.id}/respond`, { method: 'POST', body: { action: 'decline' } }), load)}>
                <X size={13} /> Decline
              </button>
            </div>
          )}
        </div>
      )}

      <div className="meet-grid">
        <div className="stack" style={{ gap: 16 }}>
          {/* participants */}
          <div className="panel">
            <div className="panel-head"><h2><Users size={15} /> In the meeting · {m.participants.length}</h2></div>
            <div className="panel-body stack" style={{ gap: 8 }}>
              {m.participants.map((p) => (
                <div key={p.id} className="row" style={{ gap: 10 }}>
                  <Avatar user={{ full_name: p.full_name, role: p.user_role }} size="sm" />
                  <div className="grow">
                    <div className="text-sm"><strong>{p.full_name}</strong> {p.role === 'host' && <span className="badge accent">Host</span>}</div>
                  </div>
                  <RolePill role={p.user_role} />
                </div>
              ))}
              {m.participants.length === 0 && <div className="text-dim text-sm">Nobody yet.</div>}
            </div>
          </div>

          {/* host: pending requests */}
          {isHost && m.status === 'live' && (
            <div className="panel">
              <div className="panel-head"><h2>Join requests</h2></div>
              <div className="panel-body stack" style={{ gap: 8 }}>
                {m.requests.length === 0 && <div className="text-dim text-sm">No one is waiting.</div>}
                {m.requests.map((r) => (
                  <div key={r.id} className="row" style={{ gap: 10 }}>
                    <Avatar user={{ full_name: r.full_name, role: r.user_role }} size="sm" />
                    <div className="grow text-sm"><strong>{r.full_name}</strong> <span className="text-faint">({ROLE_LABELS[r.user_role]})</span></div>
                    <button className="btn sm" disabled={busy}
                      onClick={() => act(() => api(`/meetings/${m.id}/requests/${r.id}`, { method: 'POST', body: { action: 'accept' } }), load)}>
                      <Check size={13} /> Accept
                    </button>
                    <button className="btn ghost sm" disabled={busy}
                      onClick={() => act(() => api(`/meetings/${m.id}/requests/${r.id}`, { method: 'POST', body: { action: 'decline' } }), load)}>
                      <X size={13} /> Decline
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* host: invite */}
          {isHost && m.status === 'live' && (
            <div className="panel">
              <div className="panel-head"><h2><UserPlus size={15} /> Invite people</h2></div>
              <div className="panel-body">
                {invitable.length === 0 ? (
                  <div className="text-dim text-sm">Everyone is already invited.</div>
                ) : (
                  <div className="picker">
                    {invitable.map((x) => (
                      <button key={x.id} className="chip" disabled={busy}
                        onClick={() => act(() => api(`/meetings/${m.id}/invite`, { method: 'POST', body: { user_ids: [x.id] } }), load)}>
                        <UserPlus size={12} /> {x.full_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {accepted && (
            <>
              <VideoPanel room={room} live={m.status === 'live'} />
              <MeetingChat meetingId={Number(id)} canPost={m.status === 'live'} />
            </>
          )}
          {!accepted && (
            <div className="panel"><div className="panel-body text-dim text-sm">
              The meeting chat and video open once you are accepted.
            </div></div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- optional Jitsi video (deterministic room per meeting) ---------- */
function VideoPanel({ room, live }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2><Video size={15} /> Video room</h2>
        <button className="btn sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide video' : live ? 'Join video' : 'Show video'}
        </button>
      </div>
      {open && (
        <div className="panel-body">
          <iframe
            title="Meeting video"
            className="meet-frame"
            allow="camera; microphone; fullscreen; display-capture"
            src={`https://meet.jit.si/${room}`}
          />
          <a className="text-xs text-dim" style={{ marginTop: 6, display: 'inline-block' }}
            href={`https://meet.jit.si/${room}`} target="_blank" rel="noreferrer">
            Open in a new tab if the embed is blocked
          </a>
        </div>
      )}
      {!open && <div className="panel-body text-faint text-xs">Room “{room}” — everyone here shares it.</div>}
    </div>
  );
}

/* ---------- the meeting chat ---------- */
function MeetingChat({ meetingId, canPost }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef(null);

  const load = useCallback(() => {
    api(`/meetings/${meetingId}/messages`).then(setMessages).catch(() => setMessages([]));
  }, [meetingId]);
  useEffect(load, [load]);

  useEffect(() => {
    const s = connectSocket();
    if (!s) return undefined;
    const onMsg = (p) => {
      if (p.meeting_id !== meetingId) return;
      setMessages((cur) => (cur ? [...cur.filter((x) => x.id !== p.message.id), p.message] : [p.message]));
    };
    s.on('meet:message', onMsg);
    return () => s.off('meet:message', onMsg);
  }, [meetingId]);

  useEffect(() => { if (bottom.current) bottom.current.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/meetings/${meetingId}/messages`, { method: 'POST', body: { body: draft } });
      setDraft('');
      load();
    } catch (err) { alert(err.message); }
    finally { setBusy(false); }
  };

  if (messages === null) return <Skeleton h={200} />;

  return (
    <div className="panel meeting-chat">
      <div className="panel-head"><h2>Meeting chat</h2></div>
      <div className="mchat-scroll">
        {messages.length === 0 && <div className="text-faint text-sm">No messages yet — say hello.</div>}
        {messages.map((msg) => {
          const mine = msg.sender_id === user.id;
          return (
            <div key={msg.id} className={`mchat-msg ${mine ? 'mine' : ''}`}>
              {!mine && <div className="mchat-who">{msg.full_name}</div>}
              <div className="mchat-body">{msg.body}</div>
              <div className="mchat-time">{timeAgo(msg.created_at)}</div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form className="mchat-compose" onSubmit={send}>
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={canPost ? 'Message the meeting…' : 'This meeting has ended — read only'}
          disabled={!canPost} aria-label="Message the meeting" />
        <button className="btn" type="submit" disabled={!canPost || busy || !draft.trim()} aria-label="Send">
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
