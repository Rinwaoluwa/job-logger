import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useTaskTransition } from "./useTasks.jsx";

// One job's full detail (GET /jobs/:id), reloaded whenever a task for
// that job finishes. Shared by the job drawer and the Interviews page so
// both see the same shape and the same refresh rule. A reply that arrives
// after a newer request went out is dropped, so flicking between two jobs
// never shows the first job's data under the second job's title.
export function useJobDetail(jobId, { onTaskFinished } = {}) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    if (!jobId) { setDetail(null); return Promise.resolve(null); }
    return api.getJob(jobId)
      .then((d) => {
        if (id !== seq.current) return d;
        setDetail(d);
        setError(null);
        return d;
      })
      .catch((e) => {
        if (id === seq.current) setError(e.message);
        return null;
      });
  }, [jobId]);

  // `reload` changes only with jobId, so this clears the detail exactly
  // when the job changes, not on every refresh.
  useEffect(() => {
    setDetail(null);
    reload();
  }, [reload]);

  useTaskTransition(
    (t) => !!jobId && t.jobId === jobId,
    (t) => { reload(); onTaskFinished?.(t); },
  );

  return { detail, error, reload };
}
