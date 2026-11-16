// Applications, responses and interviews per week as grouped bars. Inline
// SVG on a viewBox so it fills its card; three series in a fixed order
// with a legend and a table view, so identity never rests on colour.

const SERIES = [
  { key: "applied", label: "Applied", cls: "swatch-1", fill: "var(--chart-1)" },
  { key: "responses", label: "Responses", cls: "swatch-2", fill: "var(--chart-2)" },
  { key: "interviews", label: "Interviews", cls: "swatch-3", fill: "var(--chart-3)" },
];

const W = 720;
const H = 180;
const PAD = { top: 8, right: 8, bottom: 22, left: 24 };

const shortWeek = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
};

export default function WeeklyBars({ weeks }) {
  if (!weeks.length) return <div className="muted small">No applications in this range.</div>;
  const max = Math.max(1, ...weeks.flatMap((w) => SERIES.map((s) => w[s.key])));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const groupW = innerW / weeks.length;
  const gap = 2;
  const barW = Math.max(2, (groupW - gap * (SERIES.length + 1)) / SERIES.length);
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const ticks = max <= 4 ? [...Array(max + 1).keys()] : [0, Math.round(max / 2), max];
  // Label every nth week so labels never collide.
  const every = Math.max(1, Math.ceil(weeks.length / 8));

  return (
    <div>
      <div className="chart-legend" aria-hidden="true">
        {SERIES.map((s) => <span key={s.key}><i className={`swatch ${s.cls}`} />{s.label}</span>)}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Applications, responses and interviews per week">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={PAD.left - 6} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x0 = PAD.left + i * groupW + gap;
          return (
            <g key={w.weekStart}>
              {SERIES.map((s, j) => {
                const v = w[s.key];
                const h = v ? Math.max(2, y(0) - y(v)) : 0;
                const x = x0 + j * (barW + gap);
                return (
                  <g key={s.key}>
                    <rect className="bar" x={x} y={y(0) - h} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={s.fill}>
                      <title>{`Week of ${shortWeek(w.weekStart)}: ${v} ${s.label.toLowerCase()}`}</title>
                    </rect>
                    {/* A square bottom: the rounding belongs to the data end only. */}
                    {h > 4 && <rect x={x} y={y(0) - Math.min(4, h)} width={barW} height={Math.min(4, h)} fill={s.fill} />}
                  </g>
                );
              })}
              {i % every === 0 && (
                <text className="axis-text" x={x0 + (groupW - gap) / 2} y={H - 6} textAnchor="middle">{shortWeek(w.weekStart)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <details className="chart-table">
        <summary>Show as a table</summary>
        <div className="table-wrap">
          <table className="data-table static">
            <thead>
              <tr><th>Week of</th>{SERIES.map((s) => <th key={s.key} className="num">{s.label}</th>)}<th className="num">Outreach sent</th><th className="num">Outreach replied</th></tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td>{shortWeek(w.weekStart)}</td>
                  {SERIES.map((s) => <td key={s.key} className="num">{w[s.key]}</td>)}
                  <td className="num">{w.outreachSent}</td>
                  <td className="num">{w.outreachReplied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
