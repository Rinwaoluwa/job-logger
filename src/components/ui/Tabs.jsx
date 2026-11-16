import { useRef } from "react";

/**
 * A tab list: real buttons, arrow keys move between them, Home/End jump.
 *
 * @param {object} props
 * @param {Array<{key: string, label: import("react").ReactNode, count?: number, countTitle?: string, title?: string}>} props.items
 * @param {string} props.value
 * @param {(key: string) => void} props.onChange
 * @param {"underline"|"segmented"} [props.variant]
 * @param {string} [props.ariaLabel]
 */
export default function Tabs({ items, value, onChange, variant = "underline", ariaLabel, className = "" }) {
  const refs = useRef([]);
  const hasActive = items.some((t) => t.key === value);

  const onKeyDown = (e, i) => {
    const n = items.length;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={`${variant === "segmented" ? "segmented" : "tabs-underline"} ${className}`.trim()}>
      {items.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
            className={active ? "active" : ""}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            title={t.title}
          >
            {t.label}
            {t.count > 0 && <span className="count" title={t.countTitle}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
