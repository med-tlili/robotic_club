import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  MessagesSquare, Building2, Users, Lock, Send, Paperclip,
  X, Globe, ShieldCheck, ArrowLeft, Video,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api, getToken, BASE } from '../api';
import { DEPT_LABELS, ROLE_LABELS } from '../roles';
import { shrinkImage } from '../compress';
import { EmptyState, Skeleton, Avatar } from '../components/ui';
import { connectSocket, getSocket } from '../socket';

/* ============================================================
   Chat — global / managers / department / private (1↔1)
   Guests: no access (App routes already block /chat for guests)
   Supervisor: chats like any member (read-only on content, not on chat)
   ============================================================ */
export default function Chat() {
  const { userId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [members, setMembers] = useState(null); // null = loading
  const [membersError, setMembersError] = useState('');
  const [activeKey, setActiveKey] = useState(userId ? `private:${userId}` : 'global');
  const [showList, setShowList] = useState(true); // mobile: list vs conversation

  const loadRooms = useCallback(() => {
    api('/chat/rooms').then(setRooms).catch(() => setRooms([]));
  }, []);
  useEffect(() => { loadRooms(); }, [loadRooms]);

  // member directory for the private-message list (all except guests)
  const loadMembers = useCallback(() => {
    if (user.role === 'guest') { setMembers([]); return; }
    setMembersError('');
    api('/users').then((all) => setMembers(
      all.filter((m) => m.id !== user.id && m.role !== 'guest'),
    )).catch((e) => { setMembersError(e.message); setMembers([]); });
  }, [user]);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  // switching /chat/:userId keeps the URL in sync
  useEffect(() => {
    setActiveKey(userId ? `private:${userId}` : 'global');
    setShowList(!userId);
  }, [userId]);

  const openRoom = (key) => {
    if (key.startsWith('private:')) nav(`/chat/${key.split(':')[1]}`);
    else { setActiveKey(key); setShowList(false); }
  };

  if (rooms === null) return <Skeleton h={440} />;

  const isBoss = ['leader', 'coleader'].includes(user.role);
  // the supervisor takes part in every room he can see, incl. the managers chat
  const seesManagers = ['manager', 'leader', 'coleader', 'supervisor'].includes(user.role);

  return (
    <div className="chat-layout">
      <section className="panel chat">
        {/* ---------- room rail ---------- */}
        <div className={`chat-rooms${showList ? '' : ' hide-mobile'}`}>
          <div className="chat-rooms-head"><MessagesSquare size={15} /> Chats</div>
          <div className="chat-scroll">
            <div className="room-list">
              <RoomButton
                active={activeKey === 'global'}
                icon={Globe}
                label="Global chat"
                sub="Every club member"
                room={rooms.find((r) => r.key === 'global')}
                onClick={() => openRoom('global')}
              />
              {seesManagers && (
                <RoomButton
                  active={activeKey === 'managers'}
                  icon={ShieldCheck}
                  label="Managers chat"
                  sub="Managers + leaders"
                  room={rooms.find((r) => r.key === 'managers')}
                  onClick={() => openRoom('managers')}
                />
              )}
              {rooms.filter((r) => r.kind === 'dept').map((r) => (
                <RoomButton
                  key={r.key}
                  active={activeKey === r.key}
                  icon={Building2}
                  label={r.label}
                  sub={isBoss ? 'Department space' : 'Your department'}
                  room={r}
                  onClick={() => openRoom(r.key)}
                />
              ))}
            </div>

            <div className="room-section-label">Private messages</div>
            {members === null ? (
              <div className="text-dim text-sm" style={{ padding: '6px 10px' }}>Loading members…</div>
            ) : membersError ? (
              <div className="text-dim text-xs" style={{ padding: '6px 10px' }}>
                {membersError}{' '}
                <button className="btn ghost sm" onClick={loadMembers}>Retry</button>
              </div>
            ) : members.length === 0 ? (
              <div className="text-dim text-sm" style={{ padding: '6px 10px' }}>No other members yet.</div>
            ) : (
              <div className="room-list">
                {members.map((m) => {
                  const key = `private:${m.id}`;
                  return (
                    <RoomButton
                      key={key}
                      active={activeKey === key}
                      icon={null}
                      avatar={m}
                      label={m.full_name}
                      sub={ROLE_LABELS[m.role]}
                      room={null}
                      onClick={() => openRoom(key)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ---------- conversation ---------- */}
        <div className={`chat-main${showList ? ' hide-mobile' : ''}`}>
          <Conversation
            roomKey={activeKey}
            user={user}
            onActivity={loadRooms}
            onBack={() => setShowList(true)}
          />
        </div>
      </section>
    </div>
  );
}

/* ---------- one room in the list ---------- */
function RoomButton({ active, icon: Icon, avatar, label, sub, room, onClick }) {
  const unread = room?.unread || 0;
  return (
    <button className={`room-btn${active ? ' active' : ''}`} onClick={onClick}>
      {avatar
        ? <Avatar user={avatar} size="sm" />
        : <span className="room-icon">{Icon && <Icon size={16} />}</span>}
      <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
        <span className="room-label">{label}</span>
        <span className="room-sub">
          {room?.last_body ? `${room.last_sender ? room.last_sender.split(' ')[0] + ': ' : ''}${room.last_body}` : sub}
        </span>
      </span>
      {unread > 0 && <span className="room-badge mono">{unread > 9 ? '9+' : unread}</span>}
    </button>
  );
}

/* ---------- conversation (messages + composer) ---------- */
function Conversation({ roomKey, user, onActivity, onBack }) {
  const [messages, setMessages] = useState(null);
  const [peer, setPeer] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const bottomRef = useRef(null);
  const fileInput = useRef(null);

  // anyone who can open a room can post in it (the server re-checks per room;
  // guests never reach this screen — App routes block /chat for them)
  const canWriteRoom = user.role !== 'guest';

  const load = useCallback(() => {
    setMessages(null);
    setError('');
    api(`/chat/messages?room=${encodeURIComponent(roomKey)}`)
      .then((d) => { setMessages(d.messages); setPeer(d.peer); })
      .catch((e) => { setError(e.message); setMessages([]); });
    api('/chat/read', { method: 'POST', body: { room: roomKey } })
      .then(onActivity)
      .catch(() => {});
  }, [roomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    // socket: join DM room / listen for live messages
    const socket = connectSocket();
    if (socket) {
      socket.emit('chat:join', roomKey);
      const onMsg = (m) => {
        if (m.room === roomKey) setMessages((prev) => (prev ? [...prev, m] : prev));
      };
      socket.on('chat:message', onMsg);
      return () => {
        socket.off('chat:message', onMsg);
        socket.emit('chat:leave', roomKey);
      };
    }
    return undefined;
  }, [roomKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setBusy(true);
    try {
      if (file) {
        // multipart (attachment + optional text)
        const fd = new FormData();
        fd.append('room', roomKey);
        fd.append('body', text.trim());
        fd.append('attachment', await shrinkImage(file));
        const res = await fetch(`${BASE}/api/chat/messages`, {
          method: 'POST',
          headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        setMessages((prev) => (prev ? [...prev, data] : prev));
      } else {
        await api('/chat/messages', { method: 'POST', body: { room: roomKey, body: text.trim() } });
        // live echo arrives via socket; nothing to append manually
      }
      setText('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onActivity();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (error && messages !== null && messages.length === 0) {
    return (
      <div className="chat-main" style={{ padding: 16 }}>
        <div className="banner error row" style={{ gap: 10 }}>
          <span className="grow">{error}</span>
          <button className="btn sm secondary" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }
  if (messages === null) return <Skeleton h={440} />;

  const title = roomKey === 'global' ? 'Global chat'
    : roomKey === 'managers' ? 'Managers chat'
      : roomKey.startsWith('dept:') ? `${DEPT_LABELS[peer?.department_slug] || 'Department'} chat`
        : peer?.full_name || 'Private chat';

  return (
    <>
      {/* conversation header */}
      <div className="chat-head">
        <div className="chat-title">
          {roomKey.startsWith('private:')
            ? <Avatar user={peer || user} size="sm" />
            : <MessagesSquare size={16} />}
          <span className="t">{title}</span>
          {peer && roomKey.startsWith('private:') && (
            <span className="badge neutral">{ROLE_LABELS[peer.role]}</span>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {!roomKey.startsWith('private:') && (
            <button className="btn secondary sm" onClick={() => setMeetOpen((v) => !v)} title="Video meeting (Jitsi)">
              <Video size={13} /> Meet
            </button>
          )}
          <button className="icon-btn show-mobile" aria-label="Back to chats" onClick={onBack}>
            <ArrowLeft size={16} />
          </button>
        </div>
      </div>

      {meetOpen && <MeetPanel roomKey={roomKey} />}

      <div className="msg-list">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No messages yet"
            text="Start the conversation — keep it professional."
          />
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              m={m}
              me={user.id}
              grouped={i > 0 && messages[i - 1].sender?.id === m.sender?.id}
              last={i === messages.length - 1 || messages[i + 1]?.sender?.id !== m.sender?.id}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-foot">
        {canWriteRoom ? (
          <form className="chat-composer" onSubmit={send}>
            <button
              type="button"
              className="icon-btn"
              title="Attach file (image, pdf, zip or mp4 · max 15MB)"
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInput}
              type="file"
              style={{ display: 'none' }}
              accept="image/*,.pdf,.zip,.mp4"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <input
              className="input"
              placeholder="Write a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
            />
            {file && (
              <span className="attach-chip">
                {file.name}
                <button type="button" className="icon-btn" aria-label="Remove attachment" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>
                  <X size={12} />
                </button>
              </span>
            )}
            <button type="submit" className="btn" disabled={busy || (!text.trim() && !file)} title="Send">
              <Send size={15} />
            </button>
          </form>
        ) : (
          <div className="readonly-note">
            <Lock size={13} />
            You can read this conversation but cannot write in it.
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- one message (grouped when the previous one is from the same sender) ---------- */
function MessageBubble({ m, me, grouped, last }) {
  const mine = m.sender?.id === me;
  return (
    <div className={`msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
      {!mine && !grouped && <Avatar user={m.sender} size="sm" />}
      <div className="msg-bubble">
        {!mine && !grouped && <div className="msg-sender">{m.sender?.full_name}</div>}
        {m.body && <div className="msg-body">{m.body}</div>}
        {m.attachment && (
          m.attachment_image
            ? <a href={`${BASE}${m.attachment}`} target="_blank" rel="noreferrer">
                <img className="msg-img" src={`${BASE}${m.attachment}`} alt={m.attachment_name || 'attachment'} />
              </a>
            : <a className="msg-file" href={`${BASE}${m.attachment}`} target="_blank" rel="noreferrer">
                <Paperclip size={13} /> {m.attachment_name}
              </a>
        )}
        {last && (
          <div className="msg-time">
            {new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Jitsi meeting panel (Sprint 4 test) ---------- */
function MeetPanel({ roomKey }) {
  const name = `isigk-${roomKey.replace(/[:]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="meet-box">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="text-sm text-dim">Live video meeting — anyone in this chat can join from their browser.</span>
        <span className="badge neutral mono">{name}</span>
      </div>
      <iframe
        title="Jitsi meeting"
        className="meet-frame"
        allow="camera; microphone; fullscreen; display-capture"
        src={`https://meet.jit.si/${name}`}
      />
      <a
        className="text-xs text-dim"
        style={{ marginTop: 6, display: 'inline-block' }}
        href={`https://meet.jit.si/${name}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in a new tab if the embed is blocked
      </a>
    </div>
  );
}
