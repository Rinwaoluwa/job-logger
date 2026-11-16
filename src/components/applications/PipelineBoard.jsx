import { memo, useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { STAGES, stageLabel } from "../../lib/stages.js";
import BoardCard from "./BoardCard.jsx";

// Excludes 'new' (not yet acted on — lives in the Jobs tab) and
// 'not_interested' (dismissed) from the board, matching StageCounts.
const COLUMNS = STAGES.filter((s) => s !== "new" && s !== "not_interested");

// Native HTML5 drag-and-drop — no library. Cards carry the jobId via
// dataTransfer("text/plain"); dropping onto a column either moves the card
// with an optimistic local update (reverted on API failure) or, for a drop
// onto "Applied" from a job with no applied_at yet, hands off to the "Log
// application" modal instead of moving the card directly — the modal is
// what actually records the stage change once its fields are submitted.
function PipelineBoard({ rows, onOpen, onRequestApplied, onChanged, onRequestDelete }) {
  const [localRows, setLocalRows] = useState(rows);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => setLocalRows(rows), [rows]);

  const onDragStart = (e, jobId) => {
    e.dataTransfer.setData("text/plain", jobId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = async (targetStage, e) => {
    e.preventDefault();
    setDragOverCol(null);
    const jobId = e.dataTransfer.getData("text/plain");
    const row = localRows.find((r) => r.jobId === jobId);
    if (!row || row.stage === targetStage) return;

    if (targetStage === "applied" && !row.appliedAt) {
      onRequestApplied(jobId);
      return;
    }

    const previous = localRows;
    setLocalRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, stage: targetStage } : r)));
    try {
      await api.patchApplication(jobId, { stage: targetStage });
      onChanged?.();
    } catch (e2) {
      setLocalRows(previous);
      setError(e2.message);
    }
  };

  return (
    <div>
      {error && <div className="err-box">{error}</div>}
      <div className="board">
        {COLUMNS.map((stage) => {
          const cards = localRows.filter((r) => r.stage === stage);
          return (
            <div
              key={stage}
              className={`board-col ${dragOverCol === stage ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(stage); }}
              onDragLeave={() => setDragOverCol((s) => (s === stage ? null : s))}
              onDrop={(e) => onDrop(stage, e)}
            >
              <div className="board-col-header">{stageLabel(stage)} <span className="muted">{cards.length}</span></div>
              {cards.map((row) => (
                <BoardCard
                  key={row.jobId}
                  row={row}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onRequestDelete={onRequestDelete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(PipelineBoard);
