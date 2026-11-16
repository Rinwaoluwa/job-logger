import { useId } from "react";
import Overlay from "./Overlay.jsx";

const SIZE = { sm: "modal-sm", md: "", lg: "modal-lg", xl: "modal-xl" };

/**
 * A centred dialog. `as="form"` with `onSubmit` makes the whole dialog the
 * form, so a submit button in the footer submits it.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.description]
 * @param {() => void} [props.onClose]
 * @param {"sm"|"md"|"lg"|"xl"} [props.size]
 * @param {import("react").ReactNode} [props.footer]
 * @param {import("react").ReactNode} [props.headerActions]
 * @param {boolean} [props.flush] - no body padding (an iframe, a table)
 * @param {boolean} [props.closeButton]
 */
export default function Modal({
  title, description, onClose, size = "md", footer, headerActions, initialFocusRef,
  as = "div", onSubmit, flush = false, closeButton = true, className = "", children,
}) {
  const titleId = useId();
  return (
    <Overlay
      className="modal-overlay"
      onClose={onClose}
      panelAs={as}
      panelClassName={`modal ${SIZE[size] || ""} ${className}`.trim()}
      panelProps={as === "form" ? { onSubmit } : undefined}
      initialFocusRef={initialFocusRef}
      labelledBy={titleId}
    >
      <div className="modal-header">
        <div className="modal-heading">
          <div className="modal-title" id={titleId}>{title}</div>
          {description && <div className="muted small">{description}</div>}
        </div>
        {(headerActions || (closeButton && onClose)) && (
          <div className="flex-row">
            {headerActions}
            {closeButton && onClose && (
              <button type="button" className="btn-muted btn-icon" onClick={onClose} aria-label="Close">✕</button>
            )}
          </div>
        )}
      </div>
      <div className={`modal-body ${flush ? "modal-body-flush" : ""}`.trim()}>{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </Overlay>
  );
}
