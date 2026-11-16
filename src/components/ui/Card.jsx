/**
 * A bordered surface with an optional heading row.
 * @param {object} props
 * @param {import("react").ReactNode} [props.title]
 * @param {import("react").ReactNode} [props.actions] - right of the title
 * @param {"default"|"warn"|"sunken"} [props.tone]
 * @param {boolean} [props.flush] - no padding
 */
export default function Card({ title, actions, tone = "default", flush = false, className = "", style, children }) {
  const cls = ["card", tone === "warn" ? "warn-card" : "", tone === "sunken" ? "card-sunken" : "", flush ? "card-flush" : "", className].filter(Boolean).join(" ");
  return (
    <section className={cls} style={style}>
      {(title || actions) && (
        <div className="card-head">
          {title && <div className="section-title">{title}</div>}
          {actions && <div className="flex-row card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
