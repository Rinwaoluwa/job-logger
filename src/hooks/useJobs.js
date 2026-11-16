import { useState } from "react";
import { api } from "../api/client.js";
import { useQuery } from "./useQuery.js";

/**
 * @param {object} initialFilters - user-editable filters
 * @param {object} [pinned] - filters the view fixes (the Jack & Jill tab
 *   pins its tag); merged at request time so the filter bar never shows
 *   or clears them.
 */
export function useJobs(initialFilters = {}, pinned = undefined) {
  const [filters, setFilters] = useState(initialFilters);
  const pinnedKey = JSON.stringify(pinned || null);
  // Debounced: typing in the search box used to fire a request per
  // keystroke, with no guarantee the last reply was for the last keystroke.
  const { data, loading, fetching, error, reload } = useQuery(
    (signal) => api.listJobs(pinned ? { ...filters, ...pinned } : filters, { signal }),
    [filters, pinnedKey],
    { debounceMs: 250, initialData: [] },
  );
  return { jobs: data || [], filters, setFilters, loading, fetching, error, reload };
}
