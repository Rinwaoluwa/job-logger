import { useCallback, useState } from "react";

// A piece of state remembered in localStorage as JSON. Reads and writes
// are wrapped: a private window or a full store leaves the fallback in
// place rather than throwing.
export function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStored(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

/**
 * @template T
 * @param {string} key
 * @param {T|(() => T)} fallback
 * @param {{validate?: (v: any) => boolean}} [opts] - reject a stored value that no longer fits
 * @returns {[T, (next: T | ((cur: T) => T)) => void]}
 */
export function useLocalStorage(key, fallback, { validate } = {}) {
  const [value, setValue] = useState(() => {
    const initial = typeof fallback === "function" ? fallback() : fallback;
    const stored = readStored(key, initial);
    return validate && !validate(stored) ? initial : stored;
  });
  const set = useCallback((next) => {
    setValue((cur) => {
      const resolved = typeof next === "function" ? next(cur) : next;
      writeStored(key, resolved);
      return resolved;
    });
  }, [key]);
  return [value, set];
}
