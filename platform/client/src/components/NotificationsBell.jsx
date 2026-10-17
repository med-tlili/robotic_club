import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { connectSocket } from '../socket';

const timeAgo = (iso) => {
  const diff = (Date.now() - new Date(iso + 'Z').getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
};

/* ============================================================
   Topbar bell — unread badge, dropdown inbox, live via socket
   ============================================================ */
export default function NotificationsBell() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const boxRef = useRef(null);

  const load = () => {
    api('/notifications')
      .then((d) => { setItems(d.items); setUnread(d.unread); })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const socket = connectSocket();
    if (!socket) return undefined;
    const onNotif = (row) => {
      setItems((prev) => [row, ...prev].slice(0, 30));
      setUnread((n) => n + 1);
      setToast(row);
    };
    socket.on('notification', onNotif);
    // only unsubscribe here — the connection itself lives with the auth session
    return () => socket.off('notification', onNotif);
  }, [user?.id]);

  // auto-hide the toast
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // click outside closes the dropdown
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openItem = async (n) => {
    try { await api(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* ignore */ }
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    setUnread((u) => Math.max(0, u - (n.is_read ? 0 : 1)));
    setOpen(false);
    if (n.link) nav(n.link);
  };

  const readAll = async () => {
    try { await api('/notifications/read-all', { method: 'POST' }); } catch { /* ignore */ }
    setItems((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
    setUnread(0);
  };

  return (
    <div className="bell-wrap" ref={boxRef}>
      <button
        className="icon-btn bell"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={17} />
        {unread > 0 && <span className="bell-badge mono">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-menu" role="menu" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn ghost sm" onClick={readAll} title="Mark all as read">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="bell-empty text-dim text-sm">
              Nothing yet — task assignments, comments and applications land here.
            </div>
          ) : (
            <div className="bell-list">
              {items.map((n) => (
                <button
                  key={n.id}
                  className={`bell-item${n.is_read ? '' : ' unread'}`}
                  onClick={() => openItem(n)}
                  role="menuitem"
                >
                  <div className="grow" style={{ textAlign: 'left' }}>
                    <div className="bell-title">{n.title}</div>
                    {n.body && <div className="bell-body">{n.body}</div>}
                    <div className="bell-time">{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="bell-dot" aria-label="unread" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Check size={14} />
          <div>
            <strong>{toast.title}</strong>
            {toast.body && <div className="text-sm">{toast.body}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
