import { useId } from "react";
import Overlay from "./Overlay.jsx";

const WIDTH = { narrow: "drawer-narrow", md: "", wide: "drawer-wide" };

/**
 * A panel sliding in from the right: a fixed header (title, subtitle,
 * actions), an optional strip under it, optional tabs, and a body that is
 * the only part that scrolls.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]
 * @param {() => void} props.onClose
 * @param {"narrow"|"md"|"wide"} [props.width]
 * @param {import("react").ReactNode} [props.actions] - header buttons
 * @param {import("react").ReactNode} [props.subhead] - a strip under the header
 * @param {import("react").ReactNode} [props.tabs]
 * @param {boolean} [props.flush] - body without padding, no scroll of its own
 */
export default function Drawer({ title, subtitle, onClose, width = "md", actions, subhead, tabs, flush = false, children }) {
  const titleId = useId();
  return (
    <Overlay className="drawer-overlay" onClose={onClose} panelClassName={`drawer ${WIDTH[width] || ""}`.trim()} labelledBy={titleId}>
      <div className="drawer-header">
        <div className="drawer-heading">
          <div className="drawer-title" id={titleId}>{title}</div>
          {subtitle && <div className="muted small">{subtitle}</div>}
        </div>
        <div className="flex-row">
          {actions}
          <button type="button" className="btn-muted btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      {subhead && <div className="drawer-subhead">{subhead}</div>}
      {tabs}
      <div className={`drawer-body ${flush ? "drawer-body-flush" : ""}`.trim()}>{children}</div>
    </Overlay>
  );
}
