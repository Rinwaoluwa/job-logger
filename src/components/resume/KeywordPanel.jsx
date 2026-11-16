// Read-only view of server/ai/coverage.js's report. Everything here is
// already computed and stored on the document — nothing is recalculated in
// the browser, so what you see is exactly what the pipeline decided.

const SURFACE_LABEL = {
  summary: () => "summary",
  bullet: (s) => `bullet ${s.id}`,
  skills: (s) => `skills · ${s.group}`,
  stack: (s) => `stack · ${s.role_id}`,
};

function scoreClass(score) {
  if (score >= 80) return "fit-strong";
  if (score >= 60) return "fit-good";
  if (score >= 40) return "fit-stretch";
  return "fit-weak";
}

function TermRow({ term, badge, badgeClass, children }) {
  return (
    <div className="review-item">
      <div>
        <div className="review-text">
          {term.keyword}
          {badge && (
            <span className={`badge ${badgeClass} ml-2`}>
              {badge}
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function KeywordPanel({ document }) {
  const coverage = document.content_json.keyword_coverage;

  if (!coverage || !coverage.terms?.length) {
    return (
      <div className="muted small">
        No job-description keywords for this résumé — it was generated without a posting to match against.
      </div>
    );
  }

  const { counts, score, terms } = coverage;
  const by = (status) => terms.filter((t) => t.status === status);

  const covered = by("covered");
  const pending = by("covered_pending");
  const claimable = by("missing_claimable");
  const weak = by("missing_weak");
  const gaps = by("missing_gap");
  const forbidden = by("forbidden");

  return (
    <div>
      <div className="mb-3">
        {score !== null && <span className={`fit-badge ${scoreClass(score)}`}>{score}% covered</span>}
        <span className="muted small ml-2">
          {counts.covered} of {counts.total - (counts.forbidden || 0)} matched
          {pending.length > 0 && ` · ${pending.length} pending review`}
          {claimable.length > 0 && ` · ${claimable.length} you can claim ${claimable.length === 1 ? "is" : "are"} missing`}
          {gaps.length > 0 && ` · ${gaps.length} honest ${gaps.length === 1 ? "gap" : "gaps"}`}
        </span>
      </div>

      {covered.length > 0 && (
        <div className="mb-3">
          <div className="section-title mb-1">On the page</div>
          {covered.map((t) => {
            // A term backed only by a skills list has no work behind it —
            // the thing worth spotting before an interview.
            const hasStory = t.surfaces.some((s) => s.surface === "bullet" || s.surface === "summary");
            return (
              <TermRow key={t.keyword} term={t}>
                <div className="review-reason">
                  {t.surfaces.map((s, i) => (
                    <span
                      key={i}
                      className={`badge ${hasStory ? "fit-good" : "fit-stretch"} mr-1`}
                    >
                      {(SURFACE_LABEL[s.surface] || (() => s.surface))(s)}
                    </span>
                  ))}
                  {t.matched_as && t.matched_as.toLowerCase() !== t.keyword.toLowerCase() && (
                    <span className="muted ml-1">found as “{t.matched_as}”</span>
                  )}
                  {!hasStory && (
                    <div className="muted mt-1">
                      Listed as a skill only — no bullet backs this up.
                    </div>
                  )}
                  {t.do_not_claim && (
                    <div className="muted mt-1">
                      <span className="badge fit-weak mr-1">do-not-claim</span>
                      Carried by a gap fill only; the profile says: {t.do_not_claim}
                    </div>
                  )}
                </div>
              </TermRow>
            );
          })}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-3">
          <div className="section-title mb-1">Pending review (estimates and flagged claims)</div>
          {pending.map((t) => (
            <TermRow key={t.keyword} term={t} badge="pending" badgeClass="fit-stretch">
              <div className="review-reason">
                {t.surfaces.map((s, i) => (
                  <span key={i} className="badge fit-stretch mr-1">
                    {(SURFACE_LABEL[s.surface] || (() => s.surface))(s)}
                  </span>
                ))}
                <div className="muted mt-1">{t.note}</div>
              </div>
            </TermRow>
          ))}
        </div>
      )}

      {claimable.length > 0 && (
        <div className="mb-3">
          <div className="section-title mb-1">Missing — your profile supports these</div>
          {claimable.map((t) => (
            <TermRow key={t.keyword} term={t} badge="claimable" badgeClass="fit-stretch">
              <div className="review-reason">
                {t.profile_support.skill} — {t.profile_support.proficiency}
                {t.profile_support.used_in?.length > 0 && `, used at ${t.profile_support.used_in.join(", ")}`}
              </div>
            </TermRow>
          ))}
        </div>
      )}

      {weak.length > 0 && (
        <div className="mb-3">
          <div className="section-title mb-1">Missing — only “familiar”</div>
          {weak.map((t) => (
            <TermRow key={t.keyword} term={t} badge="familiar" badgeClass="fit-weak">
              <div className="review-reason muted">{t.note}</div>
            </TermRow>
          ))}
        </div>
      )}

      {gaps.length > 0 && (
        <div className="mb-3">
          <div className="section-title mb-1">Missing — not in your profile</div>
          {gaps.map((t) => (
            <TermRow key={t.keyword} term={t} badge="gap" badgeClass="fit-none">
              <div className="review-reason muted">
                {t.priority === "critical" ? "The posting states this as a hard requirement." : t.note}
              </div>
            </TermRow>
          ))}
        </div>
      )}

      {forbidden.length > 0 && (
        <div>
          <div className="section-title mb-1">Blocked — do not claim</div>
          {forbidden.map((t) => (
            <TermRow key={t.keyword} term={t} badge="blocked" badgeClass="fit-no">
              <div className="review-reason muted">{t.note}</div>
            </TermRow>
          ))}
        </div>
      )}
    </div>
  );
}
