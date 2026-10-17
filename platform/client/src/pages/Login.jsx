import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Bot, LogIn, UserPlus, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABELS, ROLE_COLORS } from '../roles';

const DEMO = [
  ['professor@isigk.tn', 'professor'],
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
            <h1>ISIGK Robotics Club</h1>
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
            <strong>Sign up</strong>
            <span className="sub">Create the club's Professor account</span>
          </span>
          <ChevronRight size={15} style={{ marginLeft: 'auto' }} />
        </Link>

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
      </div>
    </div>
  );
}
