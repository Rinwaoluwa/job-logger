import { costUsd } from "../../lib/format.js";

const PURPOSE_LABELS = {
  resume_write: "Résumé draft",
  resume_rewrite: "Résumé rewrite (full)",
  resume_rewrite_patch: "Résumé rewrite (patch)",
  resume_review: "Résumé reviewer",
  resume_revise: "Résumé revision",
  story_selection: "Résumé plan",
  jd_analysis: "Job analysis",
  cover_letter: "Cover letter",
  fit: "Fit score",
  answer: "Application answer",
  interview_prep: "Interview prep",
  people_search: "People search",
  people_outreach: "Outreach drafts",
  mock_critique: "Mock critique",
};

/** What the AI spend bought in this range, and what each kind of call costs. */
export default function CostPanel({ cost }) {
  return (
    <div>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">AI spend</div>
          <div className="tile-value">{costUsd(cost.totalUsd)}</div>
          <div className="tile-sub">{cost.calls} call{cost.calls === 1 ? "" : "s"} in this range</div>
        </div>
        <div className="tile">
          <div className="tile-label">Per application</div>
          <div className="tile-value">{cost.perApplicationUsd == null ? "—" : costUsd(cost.perApplicationUsd)}</div>
          <div className="tile-sub">all calls on the jobs applied to</div>
        </div>
        <div className="tile">
          <div className="tile-label">Per interview</div>
          <div className="tile-value">{cost.perInterviewUsd == null ? "—" : costUsd(cost.perInterviewUsd)}</div>
          <div className="tile-sub">same spend over interviews reached</div>
        </div>
      </div>
      {cost.byPurpose.length > 0 && (
        <div className="table-wrap">
          <table className="data-table static">
            <thead>
              <tr><th>Call</th><th className="num">Calls</th><th className="num">Spend</th><th className="num">Avg time</th><th className="num">Avg output tokens</th></tr>
            </thead>
            <tbody>
              {cost.byPurpose.map((p) => (
                <tr key={p.purpose}>
                  <td>{PURPOSE_LABELS[p.purpose] || p.purpose}</td>
                  <td className="num">{p.calls}</td>
                  <td className="num">{costUsd(p.usd)}</td>
                  <td className="num">{p.avgSeconds == null ? "—" : `${p.avgSeconds}s`}</td>
                  <td className="num">{p.avgOutputTokens == null ? "—" : p.avgOutputTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
