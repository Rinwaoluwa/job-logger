import { memo } from "react";
import { dateOnly } from "../../lib/format.js";
import FitBadge from "./FitBadge.jsx";
import StageSelect from "./StageSelect.jsx";
import EmptyState from "../ui/EmptyState.jsx";

/** One line under the title: the routine's fit and note for a logged job,
 * else Jack's take for an older Jack & Jill import. */
function subline(job) {
  const r = job.raw?.routine;
  if (r) {
    const label = r.fit ? (r.fit === "stretch" ? "Stretch" : "Strong fit") : r.via === "jackandjill" ? "Jack & Jill pick" : null;
    return [label, r.note].filter(Boolean).join(" · ") || null;
  }
  return job.raw?.jackandjill?.jacks_take || null;
}

function JobsTable({ jobs, onOpen, onStageChanged, onRequestApplied }) {
  if (jobs.length === 0) {
    return <EmptyState title="No jobs yet" body={<>Click "Read log" to pull the routine's picks from the Job Search Log doc, or add one by link.</>} />;
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Title</th>
            <th>Location</th>
            <th>Posted</th>
            <th>Fit</th>
            <th>Stage</th>
            <th>Docs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} onClick={() => onOpen(j.id)}>
              <td>{j.company}</td>
              <td>
                {j.title}
                {subline(j) && (
                  <div className="muted small" style={{ marginTop: 2, maxWidth: 520 }}>{subline(j)}</div>
                )}
              </td>
              <td>{j.location_raw || j.remote_scope || "—"} <span className="muted small">· {j.work_mode}</span></td>
              <td className="small muted">{dateOnly(j.posted_at)}</td>
              <td><FitBadge fit={j.fit} fitStatus={j.fitStatus} /></td>
              <td><StageSelect jobId={j.id} stage={j.stage} onChanged={() => onStageChanged?.()} onRequestApplied={onRequestApplied} /></td>
              <td className="small muted">
                {j.docs.resume ? "R" : ""}{j.docs.coverLetter ? " CL" : ""}{j.docs.interviewPrep ? " IP" : ""}
                {!j.docs.resume && !j.docs.coverLetter && !j.docs.interviewPrep ? "—" : ""}
              </td>
              <td>
                <a href={j.apply_url || j.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open ↗</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(JobsTable);
