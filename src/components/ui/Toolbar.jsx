/**
 * A row of controls above a list: filters on the left, `end` on the right.
 * @param {{end?: import("react").ReactNode, className?: string, children: import("react").ReactNode}} props
 */
export default function Toolbar({ end, className = "", children }) {
  return (
    <div className={`toolbar ${className}`.trim()}>
      {children}
      {end && <div className="toolbar-end">{end}</div>}
    </div>
  );
}
