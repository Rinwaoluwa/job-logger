import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A fetch tied to a dependency list, with the three things every list
 * view here was missing: a debounce (typing in a search box fired a
 * request per keystroke), an abort of the request in flight when the
 * inputs change, and a guard so a slow old response never lands on top
 * of a newer one.
 *
 * `data` is kept while refetching, so a table does not blink to
 * "Loading…" on every filter change. `loading` is true only before the
 * first result; `fetching` while any request is out.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher
 * @param {any[]} deps - re-run when these change (debounced)
 * @param {{debounceMs?: number, enabled?: boolean, initialData?: any}} [opts]
 */
export function useQuery(fetcher, deps, { debounceMs = 0, enabled = true, initialData = null } = {}) {
  const [state, setState] = useState({ data: initialData, loading: true, fetching: false, error: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const seq = useRef(0);
  const ranOnce = useRef(false);
  // reload() bumps this; a bump runs at once, a dependency change waits
  // out the debounce.
  const [bump, setBump] = useState(0);
  const lastBump = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = ++seq.current;
    const controller = new AbortController();
    const immediate = !ranOnce.current || bump !== lastBump.current || debounceMs <= 0;
    ranOnce.current = true;
    lastBump.current = bump;

    const go = async () => {
      setState((s) => (s.fetching ? s : { ...s, fetching: true }));
      try {
        const data = await fetcherRef.current(controller.signal);
        if (id !== seq.current || controller.signal.aborted) return;
        setState({ data, loading: false, fetching: false, error: null });
      } catch (e) {
        if (id !== seq.current || controller.signal.aborted || e?.name === "AbortError") return;
        setState((s) => ({ ...s, loading: false, fetching: false, error: e?.message || String(e) }));
      }
    };

    const timer = immediate ? null : setTimeout(go, debounceMs);
    if (immediate) go();
    return () => {
      if (timer) clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, bump, enabled]);

  const reload = useCallback(() => setBump((b) => b + 1), []);
  return { ...state, reload };
}
