import { pct } from "./StatTile.jsx";

/** Applied → interviewing → offer, with rejections alongside: one hue,
 * widths by count, every count printed. */
export default function FunnelBars({ funnel }) {
  const { reached, open, rates } = funnel;
  const base = Math.max(1, reached.applied);
  const steps = [
    ["Applied", reached.applied],
    ["Interviewing", reached.interviewing],
    ["Offer", reached.offer],
    ["Rejected", reached.rejected],
    ["Still open", open],
  ];
  return (
    <div>
      <div className="funnel" role="table" aria-label="Application funnel">
        {steps.map(([label, n]) => (
          <div key={label} role="row" className="contents">
            <div className="funnel-label" role="cell">{label}</div>
            <div className="funnel-track" role="cell" aria-hidden="true">
              <div className="funnel-bar" style={{ width: `${Math.round((n / base) * 100)}%` }} />
            </div>
            <div className="funnel-n" role="cell">{n}</div>
          </div>
        ))}
      </div>
      <div className="funnel-rates">
        <span>Applied → interview <b>{pct(rates.applied_to_interview.rate)}</b> <span className="rate-n">({rates.applied_to_interview.num} of {rates.applied_to_interview.den})</span></span>
        <span>Interview → offer <b>{pct(rates.interview_to_offer.rate)}</b> <span className="rate-n">({rates.interview_to_offer.num} of {rates.interview_to_offer.den})</span></span>
        <span>Applied → offer <b>{pct(rates.applied_to_offer.rate)}</b></span>
      </div>
    </div>
  );
}
