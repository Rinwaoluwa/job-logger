import { api } from "../../api/client.js";
import { STAGES, stageLabel } from "../../lib/stages.js";

// onRequestApplied, when given, intercepts the move to 'applied': instead
// of PATCHing immediately, it hands control to the caller (which opens the
// "Log application" modal) — the modal is what actually completes the move
// once the date/via/attachments are collected. Every other stage change
// still PATCHes directly, same as before.
export default function StageSelect({ jobId, stage, onChanged, onRequestApplied }) {
  return (
    <select
      value={stage}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        e.stopPropagation();
        const next = e.target.value;
        if (next === "applied" && onRequestApplied) {
          onRequestApplied(jobId);
          return;
        }
        await api.patchApplication(jobId, { stage: next });
        onChanged?.(next);
      }}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>{stageLabel(s)}</option>
      ))}
    </select>
  );
}
