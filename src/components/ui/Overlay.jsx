import { useEffect, useId, useRef } from "react";
import { useIsActiveView } from "../../hooks/useIsActiveView.jsx";

// The base of Modal and Drawer: the backdrop, the dialog role, the focus
// trap, Escape, and the page scroll lock. Open overlays form a stack so
// Escape closes only the topmost one (a modal over the job drawer closes
// before the drawer does). An overlay inside a hidden tab stays mounted
// with its state but drops out of the stack and releases the scroll
// lock, so it neither swallows keys nor freezes the page from off screen.

const stack = [];
function topId() {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].active.current) return stack[i].id;
  return null;
}

let locks = 0;
function lock() { if (locks++ === 0) document.body.style.overflow = "hidden"; }
function unlock() { if (--locks === 0) document.body.style.overflow = ""; }

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} props
 * @param {() => void} [props.onClose] - Escape and a click on the backdrop
 * @param {string} props.className - the backdrop class
 * @param {string} props.panelClassName
 * @param {string} [props.panelAs="div"] - "form" for a dialog that submits
 * @param {object} [props.panelProps]
 * @param {import("react").RefObject} [props.initialFocusRef] - else the first focusable
 * @param {string} [props.labelledBy] - id of the title element
 */
export default function Overlay({ onClose, className, panelClassName, panelAs: Panel = "div", panelProps, initialFocusRef, labelledBy, children }) {
  const id = useId();
  const active = useIsActiveView();
  const activeRef = useRef(active);
  activeRef.current = active;
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialRef = useRef(initialFocusRef);
  initialRef.current = initialFocusRef;

  useEffect(() => {
    const entry = { id, active: activeRef };
    stack.push(entry);
    const previous = document.activeElement;
    const panel = panelRef.current;
    const focusables = () => [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = initialRef.current?.current || panel.querySelector("[autofocus]") || focusables()[0] || panel;
    first.focus?.({ preventScroll: true });

    const onKey = (e) => {
      if (topId() !== id) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) { e.preventDefault(); return; }
      const head = list[0];
      const tail = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === head || document.activeElement === panel)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(entry), 1);
      if (previous && typeof previous.focus === "function" && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [id]);

  useEffect(() => {
    if (!active) return undefined;
    lock();
    return unlock;
  }, [active]);

  return (
    <div
      className={className}
      // mousedown, not click: a drag that starts inside the panel and ends
      // on the backdrop (selecting text) must not close it.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCloseRef.current?.(); }}
    >
      <Panel
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={panelClassName}
        {...panelProps}
      >
        {children}
      </Panel>
    </div>
  );
}
