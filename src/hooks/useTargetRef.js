import { useEffect, useRef } from "react";

// An entry that the current hash points at: open it (if it is a
// <details>), scroll it into view and flash an outline. `nonce` changes
// on every navigation so the same link clicked twice lands twice.
export function useTargetRef(id, target, nonce) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !id || target !== id) return undefined;
    if (el.tagName === "DETAILS") el.open = true;
    // After the browser has laid out a pane that was hidden a moment ago.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center" });
      el.classList.add("target");
    });
    const timer = setTimeout(() => el.classList.remove("target"), 1800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [id, target, nonce]);
  return ref;
}
