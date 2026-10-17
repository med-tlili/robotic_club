// Shared UI building blocks
import { Link } from 'react-router-dom';
import { Inbox, Wrench } from 'lucide-react';
import { ROLE_LABELS, ROLE_COLORS, DEPT_ICONS } from '../roles';

/* Avatar with initials, tinted by role */
export function Avatar({ user, size = '' }) {
  const initial = (user.full_name || '?').trim()[0].toUpperCase();
  return (
    <div
      className={`avatar ${size}`}
      style={{ background: ROLE_COLORS[user.role] || 'var(--role-guest)' }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

/* Role pill — bordered, role-colored */
export function RolePill({ role }) {
  const color = ROLE_COLORS[role] || 'var(--role-guest)';
  return (
    <span className="role-pill" style={{ color, borderColor: color }}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

/* Section panel with optional header action */
export function Panel({ title, icon: Icon, action, children, flush = false }) {
  return (
    <section className="panel">
      {(title || action) && (
        <div className="panel-head">
          <h2>{Icon && <Icon size={15} style={{ color: 'var(--text-dim)' }} />}{title}</h2>
          {action}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

/* Honest empty state — explains what arrives and where */
export function EmptyState({ icon: Icon = Inbox, title, text }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon size={17} /></div>
      <div className="empty-title">{title}</div>
      {text && <p className="empty-text">{text}</p>}
    </div>
  );
}

/* Department icon tile */
export function DeptIcon({ slug, size = 38 }) {
  const Icon = DEPT_ICONS[slug] || Wrench;
  return (
    <div className="dept-icon" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} />
    </div>
  );
}

/* Member row used in directory / department member lists */
export function MemberRow({ member, onClick }) {
  const content = (
    <>
      <Avatar user={member} />
      <div className="grow">
        <div className="name">{member.full_name}</div>
        <div className="meta">
          {member.department_name || 'No department'}
        </div>
      </div>
      <RolePill role={member.role} />
    </>
  );
  if (onClick) {
    return <div className="list-row clickable" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}>{content}</div>;
  }
  return <Link to={`/chat/${member.id}`} className="list-row clickable">{content}</Link>;
}

/* Loading skeleton block */
export function Skeleton({ h = 16, w = '100%', r = 6 }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

/* Flat labeled block used inside the department "workspace" surface
   (replaces wrapping every tool in its own rounded panel) */
export function ToolBlock({ label, sub, action, children }) {
  return (
    <div className="ws-block">
      <div className="ws-head">
        <div className="row" style={{ gap: 10 }}>
          <span className="eyebrow">{label}</span>
          {sub && <span className="ws-sub">{sub}</span>}
        </div>
        {action && <div className="ws-actions">{action}</div>}
      </div>
      {children}
    </div>
  );
}
