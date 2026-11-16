import { useCallback, useEffect, useRef, useState } from "react";

/** Clipboard write with a short "Copied" state. Failing silently is right
 * here: the text is on screen to select by hand. */
export function useCopy({ resetMs = 1500 } = {}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
      return true;
    } catch {
      return false;
    }
  }, [resetMs]);
  return { copied, copy };
}

/**
 * @param {object} props
 * @param {string|(() => string)} props.text
 * @param {import("react").ReactNode} [props.label]
 * @param {import("react").ReactNode} [props.copiedLabel]
 * @param {"sm"|"md"} [props.size]
 */
export default function CopyButton({ text, label = "Copy", copiedLabel = "Copied", size = "sm", className = "", ...rest }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={`btn-muted ${size === "sm" ? "btn-sm" : ""} ${className}`.trim()}
      onClick={() => copy(text)}
      aria-live="polite"
      {...rest}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
