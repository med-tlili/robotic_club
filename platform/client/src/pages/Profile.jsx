import { useEffect, useState } from 'react';
import { UserRound, KeyRound, Save, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../roles';
import { Panel, RolePill } from '../components/ui';

/* ============================================================
   Profile — every signed-in user (guests included) edits their
   OWN account: display name + short bio, and changes their own
   password. Role and department are read-only here — those are
   managed by the Leader from the Members page (the trust chain).
   ============================================================ */
export default function Profile() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ full_name: user.full_name || '', bio: user.bio || '' });
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [pwInfo, setPwInfo] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [deptName, setDeptName] = useState('');

  // department id → name (public list; works for guests too)
  useEffect(() => {
    if (!user.department_id) { setDeptName(''); return; }
    api('/departments')
      .then((ds) => setDeptName(ds.find((d) => d.id === user.department_id)?.name || ''))
      .catch(() => setDeptName(''));
  }, [user.department_id]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setInfo(''); setError(''); setBusy(true);
    try {
      await api('/users/me', { method: 'PATCH', body: form });
      await refreshUser();
      setInfo('Profile saved.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwInfo(''); setPwError(''); setPwBusy(true);
    try {
      await api('/users/me/password', { method: 'POST', body: pw });
      setPw({ current_password: '', new_password: '' });
      setPwInfo('Password updated — use it the next time you sign in.');
    } catch (err) { setPwError(err.message); }
    finally { setPwBusy(false); }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <div className="sub">Your name, short bio and password.</div>
        </div>
      </div>

      <Panel title="Account" icon={UserRound}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div className="grow">
            <div className="text-sm text-dim">{user.email}</div>
          </div>
          <RolePill role={user.role} />
          <span className="text-sm text-dim">
            {user.department_id ? (deptName || 'Department') : 'No department'}
          </span>
        </div>
        <p className="text-xs text-faint" style={{ marginTop: 0 }}>
          <ShieldCheck size={12} style={{ verticalAlign: '-2px' }} /> Your role
          ({ROLE_LABELS[user.role]}) and department are set by the club leadership.
        </p>

        <form className="stack" style={{ gap: 10 }} onSubmit={saveProfile}>
          {info && <div className="banner info">{info}</div>}
          {error && <div className="banner error">{error}</div>}
          <div className="field">
            <label htmlFor="pf-name">Full name</label>
            <input
              id="pf-name" className="input" value={form.full_name} maxLength={80} required
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-bio">Short bio (optional)</label>
            <textarea
              id="pf-bio" className="textarea" rows={3} maxLength={500}
              placeholder="What you work on in the club…"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="submit" disabled={busy || form.full_name.trim().length < 2}>
              <Save size={14} /> {busy ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Password" icon={KeyRound}>
        <form className="stack" style={{ gap: 10 }} onSubmit={savePassword}>
          {pwInfo && <div className="banner info">{pwInfo}</div>}
          {pwError && <div className="banner error">{pwError}</div>}
          <div className="field">
            <label htmlFor="pf-cur">Current password</label>
            <input
              id="pf-cur" className="input" type="password" autoComplete="current-password"
              value={pw.current_password} required
              onChange={(e) => setPw({ ...pw, current_password: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-new">New password</label>
            <input
              id="pf-new" className="input" type="password" autoComplete="new-password" minLength={6}
              placeholder="At least 6 characters"
              value={pw.new_password} required
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })}
            />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="submit" disabled={pwBusy || !pw.current_password || pw.new_password.length < 6}>
              <KeyRound size={14} /> {pwBusy ? 'Updating…' : 'Change password'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
