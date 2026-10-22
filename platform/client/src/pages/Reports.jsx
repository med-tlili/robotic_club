import { useEffect, useState } from 'react';
import {
  FileText, Download, Users, Megaphone, CalendarDays, CheckSquare,
  Inbox, MessagesSquare, Building2,
} from 'lucide-react';
import { api, getToken, BASE } from '../api';
import { ROLE_LABELS } from '../roles';
import { Panel, EmptyState, Skeleton } from '../components/ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const ROLE_LABEL = {
  supervisor: 'Supervisor', leader: 'Leader', coleader: 'Co-Leader',
  manager: 'Manager', member: 'Member', guest: 'Guest',
};

/* ============================================================
   Reports — Supervisor only (mirrors the API rule)
   Monthly global · full year · per department → preview + PDF
   ============================================================ */
export default function Reports() {
  const [departments, setDepartments] = useState([]);
  const [period, setPeriod] = useState('monthly');
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [deptId, setDeptId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const qs = () => {
    const p = new URLSearchParams({ period, year: String(year) });
    if (period === 'monthly') p.set('month', String(month));
    if (deptId) p.set('department_id', deptId);
    return p.toString();
  };

  const load = () => {
    setError('');
    setData(null);
    api(`/reports/data?${qs()}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [period, year, month, deptId]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${BASE}/api/reports/pdf?${qs()}`, {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `isigk-report-${data.scope.toLowerCase().replace(/\s+/g, '-')}-${data.label.toLowerCase().replace(/\s+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    finally { setDownloading(false); }
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - i);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Club reports</h1>
          <div className="sub">Activity reports for the supervising Supervisor · download as PDF</div>
        </div>
        <div className="head-meta">
          {data && (
            <button className="btn" onClick={download} disabled={downloading}>
              <Download size={14} /> {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          )}
        </div>
      </div>

      {/* filters */}
      <Panel title="Report options" icon={FileText}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="field">
            <label htmlFor="r-period">Period</label>
            <select id="r-period" className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Full year</option>
            </select>
          </div>
          {period === 'monthly' && (
            <div className="field">
              <label htmlFor="r-month">Month</label>
              <select id="r-month" className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="r-year">Year</label>
            <select id="r-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="r-dept">Scope</label>
            <select id="r-dept" className="select" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">Whole club (global)</option>
              {departments.filter((d) => !d.coming_soon).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      {error && (
        <div className="banner error row" style={{ gap: 10 }}>
          <span className="grow">{error}</span>
          <button className="btn sm secondary" onClick={load}>Retry</button>
        </div>
      )}
      {!data && !error && <Skeleton h={280} />}

      {data && (
        <>
          <div className="page-head" style={{ marginTop: 0 }}>
            <div>
              <h2 style={{ fontSize: 18 }}>{data.label}</h2>
              <div className="sub">Scope: {data.scope}</div>
            </div>
          </div>

          <div className="report-grid">
            <ReportCard icon={Users} title="Membership" rows={[
              ['Active members', data.members.total],
              ['New this period', data.members.new],
              ['By role', data.members.byRole.map((x) => `${ROLE_LABEL[x.role] || x.role} (${x.c})`).join(', ') || '—'],
            ]} />
            <ReportCard icon={Megaphone} title="Communications" rows={[
              ['Posts', data.posts.total],
              ['Votes cast', data.posts.votes],
              ['Comments', data.posts.comments],
              ['Chat messages', data.messages],
            ]} />
            <ReportCard icon={CalendarDays} title="Events" rows={[
              ['Calendar events', data.events],
            ]} />
            <ReportCard icon={CheckSquare} title="Tasks" rows={[
              ['Created', data.tasks.total],
              ['Completed', data.tasks.done],
              ['Still open', data.tasks.open],
            ]} />
            <ReportCard icon={Inbox} title="Applications" rows={[
              ['Total', data.applications.total],
              ['Accepted', data.applications.accepted],
              ['Refused', data.applications.refused],
            ]} />
            <ReportCard icon={Building2} title="Posts by type" rows={[
              ['Breakdown', data.posts.byType.map((x) => `${x.type} (${x.c})`).join(', ') || '—'],
            ]} />
          </div>

          <div className="text-dim text-sm" style={{ textAlign: 'center' }}>
            <MessagesSquare size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            The PDF mirrors these figures. Change the options above to build another report.
          </div>
        </>
      )}
    </div>
  );
}

function ReportCard({ icon: Icon, title, rows }) {
  return (
    <Panel title={title} icon={Icon}>
      <div className="list">
        {rows.map(([label, value]) => (
          <div key={label} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', gap: 12 }}>
            <span className="text-dim text-sm">{label}</span>
            <span className="mono text-sm" style={{ textAlign: 'right', fontWeight: 600 }}>{value}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
