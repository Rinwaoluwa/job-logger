/**
 * A small pill. Tones map to the status tokens; the fit/stage classes the
 * tables use are their own palettes in the area styles.
 * @param {{tone?: "neutral"|"ok"|"warn"|"danger"|"info"|"accent", className?: string, title?: string, children: import("react").ReactNode}} props
 */
export default function Badge({ tone = "neutral", className = "", title, children }) {
  return <span className={`badge badge-${tone} ${className}`.trim()} title={title}>{children}</span>;
}
