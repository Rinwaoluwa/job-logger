/**
 * A headline number with its denominator under it. Below `minN`
 * observations the value is greyed and the sub-line says so: a rate
 * over three applications is not a rate.
 */
export const pct = (r) => (r == null ? "—" : `${Math.round(r * 100)}%`);

export default function StatTile({ label, value, sub, n = null, minN = 5, title }) {
  const thin = n != null && n < minN;
  return (
    <div className={`tile ${thin ? "dim" : ""}`} title={title}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{thin ? `too few to read (n = ${n})` : sub}</div>
    </div>
  );
}
