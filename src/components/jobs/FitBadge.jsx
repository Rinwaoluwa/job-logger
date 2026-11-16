const VERDICT_CLASS = { strong: "fit-strong", good: "fit-good", stretch: "fit-stretch", weak: "fit-weak", no: "fit-no" };

export default function FitBadge({ fit, fitStatus }) {
  if (fitStatus === "queued" || fitStatus === "running") {
    return <span className="fit-badge fit-none">{fitStatus === "running" ? "scoring…" : "queued"}</span>;
  }
  if (!fit) return <span className="fit-badge fit-none">—</span>;
  const cls = VERDICT_CLASS[fit.verdict] || "fit-none";
  return (
    <span className={`fit-badge ${cls}`} title={fit.recommendation}>
      {fit.score} · {fit.verdict}
    </span>
  );
}
