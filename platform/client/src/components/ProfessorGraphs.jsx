import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, CheckSquare, Users, Inbox } from 'lucide-react';
import { api } from '../api';
import { Panel, Skeleton } from './ui';
import { BarChart, HBarList, Donut } from './Charts';

/* ============================================================
   Professor dashboard graphs — real club data from /reports/charts
   Only rendered for the Professor (see Dashboard.jsx).
   ============================================================ */
export default function ProfessorGraphs() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const years = Array.from({ length: 5 }, (_, i) => now.getUTCFullYear() - i);

  const load = (y) => {
    setError('');
    setData(null);
    api(`/reports/charts?year=${y}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { load(year); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <Skeleton h={320} />;

  return (
    <div className="stack">
      <div className="page-head" style={{ marginTop: 4 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Club activity at a glance</h2>
          <div className="sub">Visual trends for the supervising Professor</div>
        </div>
        <div className="head-meta">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="g-year" className="sr-only">Year</label>
            <select id="g-year" className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="graph-grid">
        <Panel title={`Posts per month · ${data.year}`} icon={TrendingUp}>
          <BarChart data={data.postsByMonth} height={150} accent="var(--accent)" />
        </Panel>

        <Panel title={`Chat messages per month · ${data.year}`} icon={BarChart3}>
          <BarChart data={data.messagesByMonth} height={150} accent="#2457c5" />
        </Panel>

        <Panel title="Members by role" icon={Users}>
          <Donut data={data.membersByRole} />
        </Panel>

        <Panel title="Tasks by status" icon={CheckSquare}>
          <HBarList data={data.tasksByStatus} />
        </Panel>

        <Panel title="Posts by type" icon={BarChart3}>
          <HBarList data={data.postsByType} />
        </Panel>

        <Panel title="Applications outcome" icon={Inbox}>
          <HBarList data={data.applications} />
        </Panel>
      </div>
    </div>
  );
}
