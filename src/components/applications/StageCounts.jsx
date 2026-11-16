import { memo } from "react";
import { STAGES, stageLabel } from "../../lib/stages.js";

// Chip strip acting as the stage filter — shown stages exclude 'new' (jobs
// not yet acted on live in the Jobs tab, not here) and 'not_interested'
// (dismissed, not tracked). "All" sums every visible chip's count.
const VISIBLE_STAGES = STAGES.filter((s) => s !== "new" && s !== "not_interested");

function StageCounts({ counts, activeStage, onChangeStage }) {
  const byStage = Object.fromEntries((counts || []).map((c) => [c.stage, c.n]));
  const total = VISIBLE_STAGES.reduce((sum, s) => sum + (byStage[s] || 0), 0);

  return (
    <div className="stage-counts">
      <button
        type="button"
        className={`stage-chip ${!activeStage ? "active" : ""}`}
        onClick={() => onChangeStage(null)}
      >
        All <span className="muted">{total}</span>
      </button>
      {VISIBLE_STAGES.map((s) => (
        <button
          key={s}
          type="button"
          className={`stage-chip ${activeStage === s ? "active" : ""}`}
          onClick={() => onChangeStage(s)}
        >
          {stageLabel(s)} <span className="muted">{byStage[s] || 0}</span>
        </button>
      ))}
    </div>
  );
}

export default memo(StageCounts);
