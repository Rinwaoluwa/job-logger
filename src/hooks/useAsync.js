import { useCallback, useState } from "react";

/** Small helper for "click a button, call an async fn, track loading/error/data". */
export function useAsync() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
      return result;
    } catch (e) {
      setError(e.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { run, loading, error, data, setError, setData };
}
