/**
 * What a list shows when there is nothing in it: a line of what this
 * place is for and, when there is one, the action that fills it.
 * @param {{title: import("react").ReactNode, body?: import("react").ReactNode, action?: import("react").ReactNode, compact?: boolean}} props
 */
export default function EmptyState({ title, body, action, compact = false }) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`.trim()}>
      <div className="empty-state-title">{title}</div>
      {body && <div className="empty-state-body muted">{body}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
