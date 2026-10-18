import { useEffect, useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Bot, LogIn, UserPlus, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';
import { ROLE_LABELS, ROLE_COLORS } from '../roles';

// Seeded demo accounts — only shown when the server reports demo mode
// (production installs set ISIGK_DEMO_ACCOUNTS=0 and never see this panel).
const DEMO = [
  ['supervisor@isigk.tn', 'supervisor'],
  ['leader@isigk.tn', 'leader'],
  ['coleader@isigk.tn', 'coleader'],
  ['hr@isigk.tn', 'manager'],
  ['events@isigk.tn', 'manager'],
  ['media@isigk.tn', 'manager'],
  ['finance@isigk.tn', 'manager'],
  ['member@isigk.tn', 'member'],
  ['guest@isigk.tn', 'guest'],
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);

  // demo panel only when the server actually seeded demo accounts
  useEffect(() => { api('/health').then((h) => setDemo(!!h.demo)).catch(() => setDemo(false)); }, []);

  // wait for the auth check, then send signed-in users to the dashboard
  if (loading) {
    return (
      <div className="login-page">
        <div className="skeleton" style={{ width: 260, height: 14 }} aria-label="Loading" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try { await login(email, password); nav('/'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="mark"><Bot size={20} /></div>
          <div>
            <h1>Robotics Club Platform</h1>
            <p>Management platform</p>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email" className="input" type="email" autoComplete="email"
              placeholder="you@isigk.tn"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password" className="input" type="password" autoComplete="current-password"
              placeholder="••••••••"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            <LogIn size={15} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <Link to="/signup" className="login-cta">
          <UserPlus size={17} />
          <span>
            <strong>Create a club</strong>
            <span className="sub">Start your own club — you become its Supervisor</span>
          </span>
          <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
        </Link>

        {demo && (
          <>
            <div className="demo-title">Demo accounts — password: password123</div>
            <div className="demo-grid">
              {DEMO.map(([mail, role]) => (
                <button
                  key={mail}
                  type="button"
                  className="demo-item"
                  onClick={() => { setEmail(mail); setPassword('password123'); setError(''); }}
                >
                  <span className="demo-dot" style={{ background: ROLE_COLORS[role] }} />
                  {ROLE_LABELS[role]}{role === 'manager' ? ` · ${mail.split('@')[0]}` : ''}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="text-dim text-xs" style={{ textAlign: 'center', marginTop: 14 }}>
          By signing in you agree to the <Link to="/terms">Terms &amp; Privacy</Link>.
        </div>
      </div>
    </div>
  );
}
