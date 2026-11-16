import { useId } from "react";

/**
 * A labelled form control. The child gets the label's `htmlFor` through
 * `id` when it is a single element without one.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.label
 * @param {import("react").ReactNode} [props.hint] - under the control
 * @param {import("react").ReactNode} [props.error]
 * @param {boolean} [props.inline] - label and control on one row (a checkbox)
 */
export default function Field({ label, hint, error, inline = false, className = "", children }) {
  const id = useId();
  const control = children && typeof children === "object" && !Array.isArray(children) && !children.props?.id
    ? { ...children, props: { ...children.props, id } }
    : children;
  if (inline) {
    return (
      <label className={`field field-inline ${className}`.trim()}>
        {children}
        <span>{label}</span>
      </label>
    );
  }
  return (
    <div className={`form-row field ${className}`.trim()}>
      <label className="form-label" htmlFor={control?.props?.id || id}>{label}</label>
      {control}
      {hint && <div className="field-hint muted small">{hint}</div>}
      {error && <div className="field-error small">{error}</div>}
    </div>
  );
}
