import { useMemo } from "react";

// Ordered strongest first: the résumé leads with what you can defend in
// an interview, so that is the order worth seeing here too.
const ORDER = ["expert", "strong", "working", "familiar"];
const BLURB = {
  expert: "Can design with it, debug it in production and be interviewed on it at any depth.",
  strong: "Led with on the résumé and safe to be interviewed on in depth.",
  working: "Claimable and used on real work, without leading the résumé.",
  familiar: "Listed last if at all — touched, but not something to be tested on.",
};

export default function SkillsDetail({ skills, doNotClaim, roles }) {
  const companyById = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r.company])),
    [roles],
  );

  const groups = useMemo(() => {
    const known = ORDER.map((p) => [p, skills.filter((s) => s.proficiency === p)]);
    const other = skills.filter((s) => !ORDER.includes(s.proficiency));
    return other.length ? [...known, ["other", other]] : known;
  }, [skills]);

  return (
    <div>
      <div className="card">
        <div className="spread">
          <div className="section-title mb-0">Skills</div>
          <div className="muted small">{skills.length} total</div>
        </div>
        <div className="muted small mt-2">
          A skill is only claimable where it was actually used. “Used in” is what stops a skill from a
          five-year-old role being written up as current.
        </div>
      </div>

      {groups.map(([proficiency, items]) => items.length > 0 && (
        <div className="card" key={proficiency}>
          <div className="section-title mb-1">
            {proficiency} <span className="muted normal">({items.length})</span>
          </div>
          <div className="muted small mb-2">{BLURB[proficiency] || ""}</div>
          <table className="data-table">
            <thead>
              <tr><th>Skill</th><th>Used in</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.skill}>
                  <td className="medium">{s.skill}</td>
                  <td className="small">
                    {s.usedIn.length === 0
                      ? <span className="muted">not tied to a role</span>
                      : s.usedIn.map((id) => (
                          <span className="tech-chip" key={id}>{companyById[id] || id}</span>
                        ))}
                  </td>
                  <td className="small muted">{s.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {doNotClaim?.length > 0 && (
        <div className="card warn-card">
          <div className="section-title">Never claim these</div>
          <ul className="small tight-list">{doNotClaim.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
