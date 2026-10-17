import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Bot, UserPlus } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';

/* ============================================================
   Professor sign-up — OPEN to everyone, at any time (user
   decision): fill the form, get a Professor account, you're in.

   The chain stays manual inside the app: the Professor creates
   the Leader from the Members page, the Leader creates the
   rest.
   ============================================================ */
export default function Signup() {
  const { user, signIn, loading } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="login-page">
        <div className="skeleton" style={{ width: 260, height: 14 }} aria-label="Loading" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api('/auth/signup-professor', { method: 'POST', body: form });
      signIn(data.token, data.user);
      nav('/');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="mark"><Bot size={20} /></div>
          <div>
            <h1>ISIGK Robotics Club</h1>
            <p>Create the Professor account</p>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="su-name">Full name</label>
            <input
              id="su-name" className="input" autoComplete="name"
              placeholder="e.g. Pr. Ahmed Supervisor"
              value={form.full_name} onChange={set('full_name')} required
            />
          </div>
          <div className="field">
            <label htmlFor="su-email">Email</label>
            <input
              id="su-email" className="input" type="email" autoComplete="email"
              placeholder="you@isigk.tn"
              value={form.email} onChange={set('email')} required
            />
          </div>
          <div className="field">
            <label htmlFor="su-password">Password</label>
            <input
              id="su-password" className="input" type="password" autoComplete="new-password"
              placeholder="At least 6 characters"
              value={form.password} onChange={set('password')} required
            />
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            <UserPlus size={15} /> {busy ? 'Creating…' : 'Sign up as Professor'}
          </button>
        </form>

        <div className="text-dim text-xs" style={{ textAlign: 'center', marginTop: 12 }}>
          You become the club's Professor, then create the Leader from the Members page.
          <br />
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
