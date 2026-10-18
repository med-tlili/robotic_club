import { useState } from 'react';
import {
  BrowserRouter, Routes, Route, Link, useNavigate, Navigate, useLocation,
} from 'react-router-dom';
import { Bot, LayoutDashboard, Home as HomeIcon, Users, Calendar as CalIcon, MessagesSquare, FileText, Menu, X, LogOut, HardDrive, UserRound, Video, Settings as SettingsIcon, Sun, Moon } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Feed from './pages/Feed';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import DepartmentHome from './pages/DepartmentHome';
import Chat from './pages/Chat';
import Meetings from './pages/Meetings';
import MeetingRoom from './pages/MeetingRoom';
import Calendar from './pages/Calendar';
import Reports from './pages/Reports';
import Storage from './pages/Storage';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Terms from './pages/Terms';
import NotificationsBell from './components/NotificationsBell';
import { ThemeProvider, useTheme } from './theme.jsx';
import { ROLE_LABELS, ROLE_COLORS, DEPT_ICONS as DEPT_ICON } from './roles';

/* ---------- navigation model (role-aware) ---------- */
function useNavGroups() {
  const { user } = useAuth();
  const groups = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Home', icon: HomeIcon },
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/profile', label: 'My profile', icon: UserRound },
        { to: '/settings', label: 'Settings', icon: SettingsIcon },
      ],
    },
  ];
  // Reports: Supervisor only (downloads monthly / yearly / per-dept reports)
  if (user.role === 'supervisor') {
    groups[0].items.push({ to: '/reports', label: 'Reports', icon: FileText });
  }
  // Storage: Leader / Co-Leader / Supervisor (Drive backups + limit alerts)
  if (['leader', 'coleader', 'supervisor'].includes(user.role)) {
    groups[0].items.push({ to: '/storage', label: 'Storage', icon: HardDrive });
  }
  // Calendar: everyone (dates are public club info); Members + Chat: not for guests
  const clubItems = [
    { to: '/calendar', label: 'Calendar', icon: CalIcon },
  ];
  if (user.role !== 'guest') {
    clubItems.push({ to: '/chat', label: 'Chat', icon: MessagesSquare });
    clubItems.push({ to: '/meetings', label: 'Meetings', icon: Video });
    clubItems.push({ to: '/members', label: 'Members', icon: Users });
  }
  groups.push({ title: 'Club', items: clubItems });
  groups.push({
    title: 'Departments',
    items: [
      { to: '/departments/hr', label: 'HR', icon: null, slug: 'hr' },
      { to: '/departments/events', label: 'Events', icon: null, slug: 'events' },
      { to: '/departments/media', label: 'Media', icon: null, slug: 'media' },
      { to: '/departments/finance', label: 'Finance', icon: null, slug: 'finance' },
      { to: '/departments/materials', label: 'Materials', icon: null, slug: 'materials', tag: 'soon' },
    ],
  });
  return groups;
}

function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const groups = useNavGroups();

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-mark"><Bot size={17} /></div>
        <div>
          {user.club?.name || 'Robotics Club'}
          <small>Club platform</small>
        </div>
      </div>

      {/* restrained circuit trace — the only decorative brand detail */}
      <svg className="brand-circuit" height="10" viewBox="0 0 212 10" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 5 H58 L66 1.5 H104 L112 5 H148 L156 8.5 H196" />
        <circle cx="58" cy="5" r="2" fill="currentColor" stroke="none" />
        <circle cx="148" cy="5" r="2" fill="currentColor" stroke="none" />
        <circle cx="196" cy="8.5" r="2" fill="currentColor" stroke="none" />
      </svg>

      <nav className="nav">
        {groups.map((g) => (
          <div className="nav-group" key={g.title}>
            <div className="nav-group-title">{g.title}</div>
            {g.items.map((item) => {
              const Icon = item.icon || (item.slug && (DEPT_ICON[item.slug]));
              const active = item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={onClose}
                >
                  {Icon && <Icon size={16} />}
                  <span>{item.label}</span>
                  {item.tag && <span className="tag">{item.tag}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="avatar sm" style={{ background: ROLE_COLORS[user.role] }}>
          {user.full_name[0]}
        </div>
        <div className="who">
          <div className="name">{user.full_name}</div>
          <div className="role">{ROLE_LABELS[user.role]}</div>
        </div>
        <button
          className="icon-btn"
          title="Sign out"
          aria-label="Sign out"
          onClick={() => { logout(); nav('/login'); }}
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

/* Guests never reach the members directory (mirrors the API rule) */
function RequireMember({ children }) {
  const { user } = useAuth();
  if (user.role === 'guest') return <Navigate to="/" replace />;
  return children;
}

/* Reports are Supervisor-only (mirrors the API rule) */
function RequireSupervisor({ children }) {
  const { user } = useAuth();
  if (user.role !== 'supervisor') return <Navigate to="/" replace />;
  return children;
}

/* Storage is Leader / Co-Leader / Supervisor (mirrors the API rule) */
function RequireStorage({ children }) {
  const { user } = useAuth();
  if (!['leader', 'coleader', 'supervisor'].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

/* Quick light/dark switch in the top bar (full control lives in Settings) */
function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  const dark = resolved === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={() => setPref(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Layout({ children }) {
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // chat is a working surface: it uses the full content width (no 1060px measure)
  const wide = location.pathname.startsWith('/chat') || location.pathname.startsWith('/meetings');
  // wait for the /auth/me check before deciding — avoids the login flash on hard refresh
  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="skeleton" style={{ width: 260, height: 14 }} aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className={`shell${wide ? ' shell-full' : ''}`}>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu size={19} />
          </button>
          <span className="title">{user.club?.name || 'Robotics Club'}</span>
          <div className="row topbar-user" style={{ gap: 6, marginLeft: 'auto' }}>
            <ThemeToggle />
            <NotificationsBell />
            <div className="avatar sm" style={{ background: ROLE_COLORS[user.role] }}>
              {user.full_name[0]}
            </div>
          </div>
        </div>
        <div className={`page${wide ? ' page-wide' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/" element={<Layout><Feed /></Layout>} />
            <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
            <Route path="/profile" element={<Layout><Profile /></Layout>} />
            <Route path="/settings" element={<Layout><Settings /></Layout>} />
            <Route path="/calendar" element={<Layout><Calendar /></Layout>} />
            <Route path="/members" element={<Layout><RequireMember><Members /></RequireMember></Layout>} />
            <Route path="/departments/:slug" element={<Layout><DepartmentHome /></Layout>} />
            <Route path="/chat" element={<Layout><RequireMember><Chat /></RequireMember></Layout>} />
            <Route path="/chat/:userId" element={<Layout><RequireMember><Chat /></RequireMember></Layout>} />
            <Route path="/meetings" element={<Layout><RequireMember><Meetings /></RequireMember></Layout>} />
            <Route path="/meetings/:id" element={<Layout><RequireMember><MeetingRoom /></RequireMember></Layout>} />
            <Route path="/reports" element={<Layout><RequireSupervisor><Reports /></RequireSupervisor></Layout>} />
            <Route path="/storage" element={<Layout><RequireStorage><Storage /></RequireStorage></Layout>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
