import { pct } from "./StatTile.jsx";

/** Response rate by a dimension, always with the counts behind it. */
export default function BreakdownTable({ rows, keyLabel, labelFor = (k) => k, countKey = "applied", countLabel = "Applied" }) {
  if (!rows.length) return <div className="muted small">Nothing in this range.</div>;
  return (
    <div className="table-wrap">
      <table className="data-table static">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            <th className="num">{countLabel}</th>
            <th className="num">Responded</th>
            <th className="num">Interviews</th>
            <th className="num">Response rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.label || labelFor(r.key)}</td>
              <td className="num">{r[countKey]}</td>
              <td className="num">{r.responded}</td>
              <td className="num">{r.interviews}</td>
              <td className="num">
                {r[countKey] < 3 ? <span className="muted">n too small</span> : pct(r.rate.rate)}
                <span className="rate-n">({r.rate.num} of {r.rate.den})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
