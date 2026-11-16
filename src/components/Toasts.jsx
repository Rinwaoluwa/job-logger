import { useTasks, useToasts } from "../hooks/useTasks.jsx";

/** Bottom-right stack of "X finished / failed" notices from the tasks
 * context. Clicking one opens the job it was about. */
export default function Toasts() {
  const { toasts, dismissToast } = useToasts();
  const { openJob } = useTasks();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => {
            if (t.jobId) openJob?.(t.jobId, t.job);
            dismissToast(t.id);
          }}
        >
          <span className="grow">{t.text}</span>
          <button type="button" className="toast-close" onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }} aria-label="Dismiss">✕</button>
        </div>
      ))}
    </div>
  );
}
