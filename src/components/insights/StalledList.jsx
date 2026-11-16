import { useTasks } from "../../hooks/useTasks.jsx";
import { dateOnly } from "../../lib/format.js";

/** Applications that have gone quiet, oldest first, each with the way to
 * its Application tab to follow up. */
export default function StalledList({ stalled, quietAfter }) {
  const { openJob } = useTasks();
  if (!stalled.length) {
    return <div className="muted small">Nothing has gone quiet for {quietAfter} days or more.</div>;
  }
  return (
    <div>
      {stalled.map((r) => (
        <div key={r.jobId} className="stalled-row">
          <div className="stalled-main">
            <div className="bold">{r.company} <span className="muted normal">— {r.title}</span></div>
            <div className="small muted">
              Applied {dateOnly(r.appliedAt)} · {r.daysSinceApplied} days, no reply
              {r.outreachSent > 0 && ` · ${r.outreachSent} outreach message${r.outreachSent === 1 ? "" : "s"} sent`}
              {r.nextAction && ` · next: ${r.nextAction}${r.nextActionAt ? ` (${dateOnly(r.nextActionAt)})` : ""}`}
            </div>
          </div>
          <button type="button" className="btn-sm btn-muted" onClick={() => openJob(r.jobId, null, { tab: "Application" })}>
            Follow up
          </button>
        </div>
      ))}
    </div>
  );
}
