const VARIANT = {
  primary: "",
  secondary: "btn-muted",
  ghost: "btn-ghost",
  danger: "btn-danger",
  "danger-solid": "btn-danger-solid",
};

/**
 * @param {object} props
 * @param {"primary"|"secondary"|"ghost"|"danger"|"danger-solid"} [props.variant]
 * @param {"sm"|"md"} [props.size]
 * @param {boolean} [props.loading] - disabled, with `loadingLabel` as the text
 * @param {import("react").ReactNode} [props.loadingLabel]
 */
export default function Button({ variant = "primary", size = "md", loading = false, loadingLabel, type = "button", className = "", disabled, children, ...rest }) {
  const cls = [VARIANT[variant] || "", size === "sm" ? "btn-sm" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls || undefined} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}
