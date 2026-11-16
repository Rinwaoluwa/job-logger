import { useTargetRef } from "../../hooks/useTargetRef.js";
import Prose from "./Prose.jsx";

// Personal and side projects. Never a résumé entry (the user's decision);
// a verified project marked "Use: prose" is offered to cover letters,
// application answers and interview prep as background.
const FIELDS = [
  ["stack", "Stack"],
  ["whatItIs", "What it is"],
  ["whatIBuilt", "What I built"],
  ["decisions", "Decisions / trade-offs"],
  ["outcome", "Outcome"],
];

function ProjectCard({ p, target, nonce }) {
  const ref = useTargetRef(p.id, target, nonce);
  return (
    <div className={`card ${p.status === "draft" ? "warn-card" : ""}`} id={p.id} ref={ref}>
      <div className="spread items-start gap-3">
        <div>
          <div className="flex-row">
            <code className="id-chip">{p.id}</code>
            <span className="bold">{p.title}</span>
          </div>
          <div className="muted small">
            {p.dates}
            {p.dates && p.link ? " · " : ""}
            {p.link && <a href={p.link} target="_blank" rel="noreferrer">{p.link}</a>}
          </div>
        </div>
        <div className="flex-row gap-2">
          {p.status === "draft" && <span className="chip-warn">draft</span>}
          {p.status !== "draft" && p.use === "prose" && <span className="chip-ok">prose</span>}
          {p.use === "none" && <span className="chip-warn">profile only</span>}
        </div>
      </div>
      <div className="mt-2">
        {FIELDS.map(([key, label]) => p[key] ? (
          <div key={key} className="mb-2">
            <div className="field-label">{label}</div>
            <Prose text={p[key]} />
          </div>
        ) : null)}
      </div>
    </div>
  );
}

export default function ProjectsDetail({ projects, target, nonce }) {
  const offered = projects.filter((p) => p.status !== "draft" && p.use === "prose");
  return (
    <div>
      <div className="card">
        <div className="spread">
          <div className="section-title mb-0">Projects</div>
          <div className="muted small">{offered.length} of {projects.length} offered to prose</div>
        </div>
        <div className="muted small mt-2">
          Background for cover letters, answers and interview prep only. Projects never appear on the résumé.
          A draft, or a project marked <code>Use: none</code>, is shown here and nowhere else.
        </div>
      </div>

      {projects.length === 0 && (
        <div className="card muted small">No projects yet — add them to <code>profile/projects.md</code>.</div>
      )}

      {projects.map((p) => <ProjectCard key={p.id} p={p} target={target} nonce={nonce} />)}
    </div>
  );
}
