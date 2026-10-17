import { useEffect, useState } from 'react';
import {
  HardDrive, RefreshCw, AlertTriangle, CheckCircle2, Clock, Trash2, CloudUpload,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Panel, EmptyState, Skeleton } from '../components/ui';

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
};
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/* ============================================================
   Storage — Drive backups for the Leader/Co-Leader (Professor
   read-only): real quota with amber/red limit alerts, monthly
   snapshots, and safe pruning (backup copies only — the live
   site is never touched).
   ============================================================ */
export default function Storage() {
  const { user } = useAuth();
  const boss = ['leader', 'coleader'].includes(user.role);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('/storage').then(setSt).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runSync = async () => {
    setBusy(true); setError('');
    try { setSt(await api('/storage/sync', { method: 'POST' })); } catch (e) { setError(e.message); load(); }
    finally { setBusy(false); }
  };
  const clearMonth = async (month) => {
    const ok = window.confirm(
      `Delete the ${month} backup from Google Drive?\n\n`
      + 'This removes ONLY the off-site backup copy — every live file on the platform stays untouched.',
    );
    if (!ok) return;
    setBusy(true); setError('');
    try { setSt(await api(`/storage/months/${month}/clear`, { method: 'POST' })); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!st) {
    return (
      <section className="section">
        <Skeleton h={18} w={220} />
        <div style={{ marginTop: 14 }}><Skeleton h={120} /></div>
      </section>
    );
  }

  const pct = (st.usedBytes != null && st.totalBytes)
    ? Math.min(100, Math.round((st.usedBytes / st.totalBytes) * 100))
    : null;
  const ALERT_TEXT = {
    ok: 'Healthy — plenty of room.',
    warn: 'Approaching the limit — clear old months below.',
    crit: 'Nearly full — clear old months now.',
    unknown: 'Quota not reported by this account — showing what the club pushed.',
  };
  const Icon = st.alert === 'ok' ? CheckCircle2 : st.alert === 'unknown' ? Clock : AlertTriangle;
  const chipCls = st.alert === 'ok' ? 'success' : st.alert === 'unknown' ? '' : st.alert === 'crit' ? 'danger' : 'warning';

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow private"><span className="dot" />Storage · drive backups</span>
        {boss && (
          <button className="btn primary sm" onClick={runSync} disabled={busy || st.setupRequired}>
            {busy ? <RefreshCw size={13} className="spin" /> : <CloudUpload size={13} />}
            {busy ? 'Backing up…' : 'Run backup now'}
          </button>
        )}
      </div>

      {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      {st.setupRequired ? (
        <Panel title="One-time setup" icon={HardDrive}>
          {st.backend === 'cloud' ? (
            <>
              <p className="text-dim" style={{ margin: '0 0 6px' }}>
                Backups go to Google Drive through the Drive API — the project needs its
                Google credentials as environment variables (this server cannot run rclone).
              </p>
              <ol className="setup-steps">
                <li>One Google Cloud project with the <strong>Drive API enabled</strong>.</li>
                <li>Either a <strong>service account</strong> key (share the backup folder
                  with its email), or an OAuth client + one authorization
                  (<code className="code-line">node drive-auth.js</code> prints both).</li>
                <li>Set the environment variables on the host:
                  <code className="code-line">ISIGK_DRIVE_SA_JSON=…</code>
                  <span className="text-faint"> — or — </span>
                  <code className="code-line">ISIGK_DRIVE_CLIENT_ID=… / ISIGK_DRIVE_CLIENT_SECRET=… / ISIGK_DRIVE_REFRESH_TOKEN=…</code>
                </li>
                <li>Reload this page and press <strong>Run backup now</strong>.</li>
              </ol>
            </>
          ) : (
            <>
              <p className="text-dim" style={{ margin: '0 0 6px' }}>
                Backups go to Google Drive through <code>rclone</code>. {!st.rcloneInstalled && 'Right now rclone is not installed.'}
                {st.rcloneInstalled && !st.remoteConfigured && ' rclone is installed but no Drive account is linked yet.'}
              </p>
              <ol className="setup-steps">
                <li>Create a <strong>fresh Google account</strong> for the club (its whole 15&nbsp;GB then belongs to backups).</li>
                <li>Install rclone: <code className="code-line">winget install Rclone.Rclone</code></li>
                <li>Link the account once:
                  <code className="code-line">rclone config create gdrive drive scope=drive</code>
                  <code className="code-line">rclone about gdrive:</code>
                  (a browser opens — sign in to the new account and press Allow)
                </li>
                <li>Reload this page and press <strong>Run backup now</strong>.</li>
              </ol>
              <p className="text-faint text-xs" style={{ marginTop: 12 }}>
                Optional — automatic monthly backup (1st of the month, 02:00):
                <code className="code-line">schtasks /create /tn "ISIGK Drive backup" /sc monthly /d 1 /st 02:00 /tr "cmd /c cd C:\Users\USER\Desktop\club_robotic\platform\server &amp;&amp; npm run sync-drive"</code>
              </p>
            </>
          )}
        </Panel>
      ) : (
        <>
          {/* ---- quota ---- */}
          <Panel title="Drive usage" icon={HardDrive}>
            <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong className="num">
                {st.usedBytes != null ? fmtBytes(st.usedBytes) : `${fmtBytes(st.pushedBytes)} pushed`}
              </strong>
              <span className="text-dim">of {st.totalBytes ? fmtBytes(st.totalBytes) : '—'}{pct != null ? ` (${pct}%)` : ''}</span>
              <span className={`badge ${chipCls}`}><Icon size={12} /> {ALERT_TEXT[st.alert]}</span>
            </div>
            {pct != null && (
              <div className="usage-bar" style={{ marginTop: 10 }} role="img" aria-label={`${pct}% of the Drive quota used`}>
                <div className={`usage-fill ${st.alert}`} style={{ width: `${pct}%` }} />
              </div>
            )}
            {st.lastSync && (
              <div className="meta" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={12} />
                Last backup {fmtWhen(st.lastSync.at)}
                {st.lastSync.ok ? ' — ok' : ` — FAILED: ${st.lastSync.error}`}
              </div>
            )}
            <p className="text-faint text-xs" style={{ marginTop: 10, marginBottom: 0 }}>
              Every backup pushes the database plus all uploads into <code>/{st.remote.split(':').pop()}/YYYY-MM</code>.
              Running it again replaces this month's copy. Clearing a month below only removes the off-site copy.
            </p>
          </Panel>

          {/* ---- months ---- */}
          <Panel title="Monthly backups" icon={CloudUpload}>
            {st.months.length === 0 ? (
              <EmptyState
                icon={CloudUpload}
                title="No backup pushed yet"
                text={boss ? 'Press “Run backup now” above to push the first monthly snapshot.' : 'The Leader or Co-Leader runs the backup.'}
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="right">Size</th>
                    <th className="right">Files</th>
                    {boss && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {st.months.map((m) => (
                    <tr key={m.month}>
                      <td className="num">{m.month}</td>
                      <td className="right num">{fmtBytes(m.bytes)}</td>
                      <td className="right num">{m.files}</td>
                      {boss && (
                        <td className="right">
                          <button
                            className="icon-btn"
                            title={`Delete the ${m.month} backup from Drive`}
                            aria-label={`Delete the ${m.month} backup`}
                            disabled={busy}
                            onClick={() => clearMonth(m.month)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </section>
  );
}
