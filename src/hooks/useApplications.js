import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useQuery } from "./useQuery.js";
import { useIsActiveView } from "./useIsActiveView.jsx";

const EMPTY = { rows: [], counts: [] };

// Mirrors useJobs.js's shape (filters/reload/loading/error) but backs the
// Applications view's own listApplications() query instead of listJobs() —
// see server/db/repo/applications.js for why they're kept separate.
export function useApplications(initialFilters = {}) {
  const [filters, setFilters] = useState(initialFilters);
  const active = useIsActiveView();
  const { data, loading, fetching, error, reload } = useQuery(
    (signal) => api.listApplications(filters, { signal }),
    [filters],
    { debounceMs: 250, initialData: EMPTY },
  );

  // Cheap refresh when the browser tab regains focus (e.g. after applying
  // to a job in another tab) — but only while this view is the one shown;
  // a hidden pane picks up the change through its own task transitions.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && activeRef.current) reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const { rows, counts } = data || EMPTY;
  return { rows, counts, filters, setFilters, loading, fetching, error, reload };
}
