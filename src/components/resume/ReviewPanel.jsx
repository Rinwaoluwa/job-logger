import { useState } from "react";
import { api } from "../../api/client.js";
import { isOpenGate, pendingCount as countPending } from "../../../shared/applyReview.js";

// Where a gap-fill entry sits on the page, for the row label.
function placementLabel(a) {
  if (a.kind === "bullet") return `bullet · ${a.location}`;
  if (a.kind === "summary") return "summary";
  if (a.kind === "stack") {
    const m = /^stack\/([^/]+)/.exec(String(a.location || ""));
    return m ? `stack · ${m[1]}` : "stack";
  }
  if (a.kind === "skill") return "skill";
  return a.kind;
}

// "Gap fill: Python. Nothing in the profile..." -> "Gap fill: Python."
// "Reframed: React. The profile lists..." -> "Reframed: React."
const labelKey = (a) => {
  // The label ends at the first period followed by a space or the end, so
  // "Next.js" inside a label does not cut it short.
  const m = /^(?:Gap fill|Reframed):.*?\.(?=\s|$)/.exec(String(a.reason || ""));
  return m ? m[0] : String(a.reason || "");
};

const groupByLabel = (items) => {
  const groups = [];
  for (const a of items) {
    const key = labelKey(a);
    let group = groups.find((g) => g.key === key);
    if (!group) { group = { key, items: [] }; groups.push(group); }
    group.items.push(a);
  }
  return groups;
};

export default function ReviewPanel({ document, onDecisionsChanged }) {
  const additions = document.content_json.additions_to_review || [];
  const [decisions, setDecisions] = useState(document.review_decisions || {});

  if (additions.length === 0) {
    return <div className="muted small">Nothing to review — every bullet traces to a profile story.</div>;
  }

  const save = async (next) => {
    setDecisions(next);
    await api.patchDocument(document.id, { reviewDecisions: next });
    onDecisionsChanged?.(next);
  };
  const decide = (id, value) => save({ ...decisions, [id]: value });
  const decideMany = (ids, value) => {
    const next = { ...decisions };
    for (const id of ids) next[id] = value;
    return save(next);
  };

  const startsWith = (a, prefix) => String(a.reason || "").startsWith(prefix);
  // Open-gate entries (AI-composed bullets and every gap-fill placement)
  // are on the page unless rejected, so they never count as pending.
  // Everything else is held: off the page until accepted.
  const composed = additions.filter((a) => a.kind === "bullet" && isOpenGate(a) && !startsWith(a, "Gap fill:") && !startsWith(a, "Reframed:"));
  const gated = additions.filter((a) => a.kind === "bullet" && !isOpenGate(a));
  // A gap fill is an invented claim covering a posting requirement. A strong
  // one is placed like a real skill (bullets, a skills entry, the summary),
  // each placement with its own entry; they are grouped by requirement so
  // one decision can cover all of them. A fill may name a Do NOT claim
  // term (the row's reason says which list) and may carry one estimated
  // figure (the reason's "Estimated figure:" sentence says what it rests on).
  const gapFills = additions.filter((a) => a.kind !== "note" && startsWith(a, "Gap fill:"));
  const gapGroups = groupByLabel(gapFills);
  // A reframed bullet is real work written in the posting's framework (the
  // profile lists that framework on the role with a limiting note). On the
  // page unless rejected; rejecting prints the bullet's real-stack wording
  // (text_without_reframe) instead of dropping it. Grouped by technology so
  // one decision can cover the whole role.
  const reframes = additions.filter((a) => a.kind === "bullet" && startsWith(a, "Reframed:"));
  const reframeGroups = groupByLabel(reframes);
  const bulletById = new Map(
    (document.content_json.resume?.experience || []).flatMap((role) => (role.bullets || []).map((b) => [b.id, b])),
  );
  const fallbackOf = (a) => {
    const b = bulletById.get(a.location);
    return typeof b?.text_without_reframe === "string" && b.text_without_reframe.trim() ? b.text_without_reframe : null;
  };
  // "Estimate:" is a figure with no verified metric behind it.
  const estimates = gated.filter((a) => startsWith(a, "Estimate:"));
  // "Reviewer:" is a truth failure the fact-check found that the rewrite
  // budget did not resolve; the bullet is gated like any inferred one.
  const reviewerFlagged = gated.filter((a) => startsWith(a, "Reviewer:"));
  const otherInferred = gated.filter((a) => !startsWith(a, "Gap fill:") && !startsWith(a, "Estimate:") && !startsWith(a, "Reviewer:"));
  const skills = additions.filter((a) => a.kind === "skill" && !startsWith(a, "Gap fill:"));
  // Reviewer notes are informational: nothing to accept or reject, and the
  // bullet stays on the page as written.
  const notes = additions.filter((a) => a.kind === "note");
  const pendingCount = countPending(document.content_json, decisions);

  const renderNotes = (title, items) => (
    items.length > 0 && (
      <div className="mb-3">
        <div className="section-title mb-1">{title}</div>
        {items.map((a) => (
          <div key={a.id} className="review-item">
            <div>
              <div className="review-text">{a.text}</div>
              <div className="review-reason">{a.reason}</div>
            </div>
          </div>
        ))}
      </div>
    )
  );

  const renderItem = (a, { label = null, fallback = null } = {}) => (
    <div key={a.id} className="review-item">
      <div>
        <div className="review-text">
          {label && <span className="badge fit-stretch mr-2">{label}</span>}
          {startsWith(a, "Reframed:") && <span className="badge fit-stretch mr-2">reframed</span>}
          {/Do NOT claim list/.test(String(a.reason || "")) && (
            <span className="badge fit-weak mr-2">do-not-claim term</span>
          )}
          {/Estimated figure:/.test(String(a.reason || "")) && (
            <span className="badge fit-stretch mr-2">estimate</span>
          )}
          {a.text}
        </div>
        <div className="review-reason">{a.reason} <span className="muted">({a.confidence} confidence)</span></div>
        {fallback && <div className="review-reason muted">If rejected: {fallback}</div>}
      </div>
      <div className="review-actions">
        <button
          type="button"
          className={`btn-sm ${decisions[a.id] === "accepted" ? "chosen-accepted" : "btn-muted"}`}
          onClick={() => decide(a.id, "accepted")}
        >
          Accept
        </button>
        <button
          type="button"
          className={`btn-sm ${decisions[a.id] === "rejected" ? "chosen-rejected" : "btn-muted"}`}
          onClick={() => decide(a.id, "rejected")}
        >
          Reject
        </button>
      </div>
    </div>
  );

  const renderGroup = (title, items) => (
    items.length > 0 && (
      <div className="mb-3">
        <div className="section-title mb-1">{title}</div>
        {items.map((a) => renderItem(a))}
      </div>
    )
  );

  // Entries grouped under one label ("Gap fill: Python.", "Reframed:
  // React."), with accept-all / reject-all when a group has several.
  const renderLabelledGroups = (title, groups, { withFallback = false } = {}) => (
    groups.length > 0 && (
      <div className="mb-3">
        <div className="section-title mb-1">{title}</div>
        {groups.map((g) => {
          const ids = g.items.map((a) => a.id);
          const allAccepted = ids.every((id) => decisions[id] === "accepted");
          const allRejected = ids.every((id) => decisions[id] === "rejected");
          return (
            <div key={g.key} className="mb-2">
              {g.items.length > 1 && (
                <div className="review-item items-center">
                  <div className="review-text">
                    {g.key} <span className="muted small">{g.items.length} placements</span>
                  </div>
                  <div className="review-actions">
                    <button type="button" className={`btn-sm ${allAccepted ? "chosen-accepted" : "btn-muted"}`} onClick={() => decideMany(ids, "accepted")}>
                      Accept all
                    </button>
                    <button type="button" className={`btn-sm ${allRejected ? "chosen-rejected" : "btn-muted"}`} onClick={() => decideMany(ids, "rejected")}>
                      Reject all
                    </button>
                  </div>
                </div>
              )}
              {g.items.map((a) => renderItem(a, { label: placementLabel(a), fallback: withFallback ? fallbackOf(a) : null }))}
            </div>
          );
        })}
      </div>
    )
  );

  return (
    <div>
      <div className="muted small mb-2">
        {pendingCount > 0 ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} pending review — excluded from export until accepted.` : "Nothing pending."}
        {gapFills.length > 0 && ` ${gapFills.length} gap-fill placement${gapFills.length === 1 ? " stays" : "s stay"} on the page unless rejected.`}
        {reframes.length > 0 && ` ${reframes.length} reframed bullet${reframes.length === 1 ? " stays" : "s stay"} on the page unless rejected; rejecting one restores its real-stack wording.`}
        {composed.length > 0 && ` ${composed.length} AI-composed bullet${composed.length === 1 ? "" : "s"} stay on the page unless rejected.`}
      </div>
      {renderLabelledGroups("Gap fills (invented to cover a posting requirement; on the page and in the export unless rejected)", gapGroups)}
      {renderLabelledGroups("Reframed stack (real work written in the posting's framework; on the page and in the export unless rejected, and rejecting a row restores that bullet's real-stack wording)", reframeGroups, { withFallback: true })}
      {renderGroup("Estimates (excluded until accepted)", estimates)}
      {renderGroup("Reviewer-flagged claims (not traceable to the profile; excluded until accepted)", reviewerFlagged)}
      {renderGroup("Other inferred bullets (excluded until accepted)", otherInferred)}
      {renderGroup("AI-composed bullets (included unless rejected)", composed)}
      {renderGroup("Added skills", skills)}
      {renderNotes("Reviewer notes (truth and fit; informational, on the page as written)", notes)}
    </div>
  );
}
