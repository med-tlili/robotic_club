// ============================================================
//  Charts — lightweight SVG charts (no external chart library).
//  Professional palette: navy bars, blue accent, muted greys.
// ============================================================

/* Vertical bar chart for time series (e.g. posts per month) */
export function BarChart({ data, height = 160, accent = 'var(--accent)' }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const gap = 6;
  const W = 100; // viewBox units (percent-like), scaled via preserveAspectRatio
  const barW = (W - gap * (n - 1)) / n;
  const H = 100;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="Bar chart">
        {/* baseline */}
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = (d.value / max) * (H - 6);
          const x = i * (barW + gap);
          return (
            <rect
              key={d.label}
              x={x}
              y={H - h}
              width={barW}
              height={h}
              fill={accent}
              rx="1"
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="chart-x" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/* Horizontal bar list for distributions (tasks by status, roles, apps) */
export function HBarList({ data, format = (v) => v }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="hbar-list">
      {data.map((d) => (
        <div key={d.label} className="hbar-row">
          <span className="hbar-label">{d.label}</span>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="hbar-value mono">{format(d.value)}</span>
          <span className="hbar-pct">{Math.round((d.value / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/* Donut chart for part-to-whole (members by role) */
export function Donut({ data, size = 132 }) {
  if (!data?.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = ['var(--accent)', 'var(--ink)', 'var(--teal)', 'var(--amber)', 'var(--text-dim)', 'var(--border-strong)'];
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Donut chart">
        <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="14" />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * C;
          const el = (
            <circle
              key={d.label}
              cx="50" cy="50" r={R} fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
        <text x="50" y="47" textAnchor="middle" className="donut-total">{total}</text>
        <text x="50" y="60" textAnchor="middle" className="donut-sub">total</text>
      </svg>
      <div className="donut-legend">
        {data.map((d, i) => (
          <span key={d.label} className="legend-item">
            <span className="legend-dot" style={{ background: ['var(--accent)', 'var(--ink)', 'var(--teal)', 'var(--amber)', 'var(--text-dim)', 'var(--border-strong)'][i % 6] }} />
            {d.label} ({d.value})
          </span>
        ))}
      </div>
    </div>
  );
}
