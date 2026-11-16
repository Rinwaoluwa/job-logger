import CostBadge from "./CostBadge.jsx";
import TasksPill from "./tasks/TasksPill.jsx";
import { useTheme } from "../hooks/useTheme.js";

export const NAV = [
  { key: "jobs", label: "Jobs" },
  { key: "applications", label: "Applications" },
  { key: "interviews", label: "Interviews" },
  { key: "resumes", label: "Résumés" },
  { key: "answer", label: "Answer" },
  { key: "profile", label: "Profile" },
  { key: "insights", label: "Insights" },
];

const THEME = {
  system: { icon: "◐", label: "System theme" },
  light: { icon: "☀", label: "Light theme" },
  dark: { icon: "☾", label: "Dark theme" },
};

/** The left rail: the views, and at the bottom the things that are about
 * the whole app — background work, today's AI spend, profile warnings and
 * the theme. */
export default function Sidebar({ view, onChangeView, profileWarningCount, onOpenProfile }) {
  const { theme, cycle } = useTheme();
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Job Logger</div>
      <nav className="sidebar-nav" aria-label="Main">
        {NAV.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`nav-item ${view === t.key ? "active" : ""}`}
            aria-current={view === t.key ? "page" : undefined}
            onClick={() => onChangeView(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        {profileWarningCount > 0 && (
          <button
            type="button"
            className="profile-warning"
            onClick={onOpenProfile}
            title="Open the Profile tab to see what still needs confirming"
          >
            {profileWarningCount} profile item{profileWarningCount === 1 ? "" : "s"} to confirm
          </button>
        )}
        <TasksPill />
        <CostBadge />
        <button
          type="button"
          className="theme-toggle"
          onClick={cycle}
          title={`${THEME[theme].label} — click to change`}
          aria-label={`${THEME[theme].label}, click to change`}
        >
          <span aria-hidden="true">{THEME[theme].icon}</span>
          {THEME[theme].label}
        </button>
      </div>
    </aside>
  );
}
