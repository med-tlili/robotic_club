import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Bot, Building2 } from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../api';

/* ============================================================
   Create the club — the first page's second action.
   Anyone can create their OWN club here: the server makes you its
   first Supervisor and gives the club its starter departments.
   Accounts inside the club are then created by the chain
   Supervisor → Leader → everyone else (Members page).
   ============================================================ */
export default function Signup() {
  const { user, signIn, loading } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ club_name: '', full_name: '', email: '', password: '' });
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
      const data = await api('/auth/create-club', { method: 'POST', body: form });
      signIn(data.token, data.user);
      nav('/');
    } catch (err) {
      setError(err.message);
    }
    finally { setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="mark"><Bot size={20} /></div>
          <div>
            <h1>Create your club</h1>
            <p>You become its first Supervisor</p>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="su-club">Club name</label>
            <input
              id="su-club" className="input" autoComplete="organization"
              placeholder="e.g. ISIGK Robotics Club"
              value={form.club_name} onChange={set('club_name')} required
            />
          </div>
          <div className="field">
            <label htmlFor="su-name">Your full name</label>
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
              placeholder="you@example.tn"
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
            <Building2 size={15} /> {busy ? 'Creating…' : 'Create the club'}
          </button>
        </form>

        <div className="text-dim text-xs" style={{ textAlign: 'center', marginTop: 12 }}>
          You become the club's <strong>Supervisor</strong>; you then create the Leader from
          the Members page and the club fills up from there.
          <br />
          By creating a club you agree to the <Link to="/terms">Terms &amp; Privacy</Link>.
          <br />
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
