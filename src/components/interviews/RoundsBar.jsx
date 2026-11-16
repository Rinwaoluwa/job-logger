import { ROUND_LABELS, whenLabel } from "../../lib/interviews.js";

// The rounds strip at the top of the Interview tab. "General" is the
// prep with no round (how the tab worked before rounds existed); each
// round chip scopes the panel to that round's prep.

export default function RoundsBar({ rounds = [], selectedRoundId, preps = [], onSelect, onAdd, onEdit, onDebrief, onDelete }) {
  const hasPrep = (roundId) => preps.some((p) => (p.round_id || null) === roundId);
  const selected = rounds.find((r) => r.id === selectedRoundId) || null;
  return (
    <div className="card rounds-bar">
      <div className="flex-row items-center">
        <span className="muted small mr-1">Rounds</span>
        <button
          type="button"
          className={`round-chip ${selectedRoundId == null ? "active" : ""}`}
          onClick={() => onSelect(null)}
        >
          General{hasPrep(null) ? " ●" : ""}
        </button>
        {rounds.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`round-chip ${r.id === selectedRoundId ? "active" : ""} ${r.status === "done" ? "done" : ""}`}
            onClick={() => onSelect(r.id)}
            title={r.interviewers?.length ? r.interviewers.map((p) => p.name).join(", ") : undefined}
          >
            {ROUND_LABELS[r.kind] || r.kind}
            {r.scheduled_at && <span className="muted"> · {whenLabel(r.scheduled_at)}</span>}
            {r.status === "done" && <span className="muted"> · debriefed</span>}
            {hasPrep(r.id) ? " ●" : ""}
          </button>
        ))}
        <button type="button" className="btn-sm btn-muted" onClick={onAdd}>+ Add round</button>
      </div>
      {selected && (
        <div className="small mt-2">
          <div className="flex-row gap-3 items-baseline">
            {selected.interviewers?.length > 0 && (
              <span>With {selected.interviewers.map((p) => [p.name, p.title].filter(Boolean).join(", ")).join(" · ")}</span>
            )}
            {selected.focus_skills?.length > 0 && (
              <span className="muted">Focus: {selected.focus_skills.join(", ")}{selected.focus_text ? `; ${selected.focus_text}` : ""}</span>
            )}
            {!selected.focus_skills?.length && selected.focus_text && <span className="muted">Focus: {selected.focus_text}</span>}
          </div>
          {selected.notes && <div className="muted mt-1 pre-wrap">{selected.notes}</div>}
          {selected.debrief && (
            <div className="mt-1">
              Debrief: {selected.debrief.went ? <b>{selected.debrief.went}</b> : "logged"}
              {selected.debrief.questions?.length ? ` · ${selected.debrief.questions.length} question${selected.debrief.questions.length === 1 ? "" : "s"} asked` : ""}
              {selected.debrief.next_steps ? ` · next: ${selected.debrief.next_steps}` : ""}
            </div>
          )}
          <div className="flex-row mt-2">
            <button type="button" className="btn-sm btn-muted" onClick={() => onEdit(selected)}>Edit</button>
            <button type="button" className="btn-sm btn-muted" onClick={() => onDebrief(selected)}>{selected.debrief ? "Edit debrief" : "Debrief"}</button>
            <button type="button" className="btn-sm btn-danger" onClick={() => onDelete(selected)}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
