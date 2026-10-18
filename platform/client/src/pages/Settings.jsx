import { Link } from 'react-router-dom';
import {
  Sun, Moon, MonitorSmartphone, Check, UserRound, Mail, ShieldCheck,
  Building2, FileText, Bell, Activity,
} from 'lucide-react';
import { useAuth } from '../auth';
import { useTheme } from '../theme.jsx';
import { ROLE_LABELS } from '../roles';

/* ============================================================
   Settings — appearance + accessibility + account + policies.
   The theme choice is stored on this device (see theme.jsx), so it
   applies instantly and even before signing in.
   ============================================================ */
const THEMES = [
  { id: 'system', label: 'System', hint: 'Follow this device', icon: MonitorSmartphone },
  { id: 'light', label: 'Light', hint: 'Always light', icon: Sun },
  { id: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
];

export default function Settings() {
  const { user } = useAuth();
  const { pref, setPref, motion, setMotion } = useTheme();
  const reduced = motion === 'reduced';

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div>
        <h1>Settings</h1>
        <p className="text-dim text-sm" style={{ marginTop: 4 }}>
          Appearance and preferences for <strong>{user.full_name}</strong> on this device.
        </p>
      </div>

      {/* appearance */}
      <section className="panel">
        <div className="panel-head"><h2><Sun size={15} /> Appearance</h2></div>
        <div className="panel-body">
          <div className="theme-grid" role="radiogroup" aria-label="Colour theme">
            {THEMES.map((t) => {
              const Icon = t.icon;
              const on = pref === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`theme-card${on ? ' on' : ''}`}
                  onClick={() => setPref(t.id)}
                >
                  <Icon size={18} />
                  <span className="t-text">
                    <span className="t-label">{t.label}</span>
                    <span className="t-hint">{t.hint}</span>
                  </span>
                  {on && <span className="t-check"><Check size={15} /></span>}
                </button>
              );
            })}
          </div>
          <p className="text-faint text-xs" style={{ marginTop: 10 }}>
            “System” follows your device’s light/dark setting and updates live.
          </p>
        </div>
      </section>

      {/* accessibility */}
      <section className="panel">
        <div className="panel-head"><h2><Activity size={15} /> Accessibility</h2></div>
        <div className="panel-body">
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">Reduce motion</div>
              <div className="hint">Turn off animations and transitions.</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduced}
              aria-label="Reduce motion"
              className={`switch${reduced ? ' on' : ''}`}
              onClick={() => setMotion(reduced ? 'full' : 'reduced')}
            />
          </div>
        </div>
      </section>

      {/* account */}
      <section className="panel">
        <div className="panel-head">
          <h2><UserRound size={15} /> Account</h2>
          <Link className="panel-action" to="/profile">Edit profile</Link>
        </div>
        <div className="panel-body">
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">{user.full_name}</div>
              <div className="hint">Name</div>
            </div>
            <UserRound size={15} className="text-faint" />
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">{user.email}</div>
              <div className="hint">Email — used to sign in</div>
            </div>
            <Mail size={15} className="text-faint" />
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">{ROLE_LABELS[user.role]}</div>
              <div className="hint">Role — set by club leadership</div>
            </div>
            <ShieldCheck size={15} className="text-faint" />
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">{user.club?.name || 'Robotics Club'}</div>
              <div className="hint">Club</div>
            </div>
            <Building2 size={15} className="text-faint" />
          </div>
        </div>
      </section>

      {/* policies */}
      <section className="panel">
        <div className="panel-head"><h2><FileText size={15} /> Policies</h2></div>
        <div className="panel-body">
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">Terms &amp; Privacy</div>
              <div className="hint">How the platform is used and what it stores.</div>
            </div>
            <Link className="btn secondary sm" to="/terms">Open</Link>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="name">Notifications</div>
              <div className="hint">In-app alerts appear under the bell in the top bar.</div>
            </div>
            <Bell size={15} className="text-faint" />
          </div>
        </div>
      </section>
    </div>
  );
}
