#!/usr/bin/env node
// A cheap way to exercise one rewrite pass on an existing résumé version
// without a full generation: loads the document, optionally plants a
// banned phrase in one bullet so the lint forces a rewrite, runs
// finishResume with the reviewer off, and prints what changed, the cost
// and the time. Nothing is saved.
//
//   node --disable-warning=ExperimentalWarning server/scripts/rewritePass.js <documentId> [--inject <bulletId>] [--mode patch|full]
//
// Compare the two modes on the same document:
//   ... rewritePass.js 165 --inject northwind-b2 --mode patch
//   ... rewritePass.js 165 --inject northwind-b2 --mode full

const args = process.argv.slice(2);
const documentId = Number(args[0]);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const inject = flag("--inject");
const mode = flag("--mode") || "patch";
if (!documentId) {
  console.error("usage: rewritePass.js <documentId> [--inject <bulletId>] [--mode patch|full]");
  process.exit(2);
}
process.env.RESUME_REWRITE_MODE = mode;
process.env.RESUME_REVIEWER = "0";

const { getDocument } = await import("../db/repo/documents.js");
const { getJob } = await import("../db/repo/jobs.js");
const { getProfile } = await import("../profile/loader.js");
const { genericJdAnalysis, buildGenericSelection } = await import("../ai/pipelines/shared.js");
const { finishResume } = await import("../ai/pipelines/finishResume.js");
const { NOOP_CTX } = await import("../tasks/ctx.js");

const base = getDocument(documentId);
if (!base || base.kind !== "resume") {
  console.error(`document ${documentId} is not a résumé`);
  process.exit(2);
}
const profile = getProfile();
const job = getJob(base.job_id);
const jdAnalysis = job?.jd_analysis || genericJdAnalysis(profile);
const plan = base.content_json.plan && typeof base.content_json.plan === "object" ? base.content_json.plan : buildGenericSelection(profile);

// The same shaping reviseResume.js gives the model: schema keys only, the
// regenerated review entries dropped, engagement as the override.
const SCHEMA_KEYS = ["resume", "additions_to_review", "match_score", "must_have_gaps", "nice_to_have_gaps", "ats_keywords", "rewrite_notes"];
const REGENERATED = ["reviewer-note-", "blocked-", "composed-"];
const draft = {};
for (const k of SCHEMA_KEYS) if (k in base.content_json) draft[k] = structuredClone(base.content_json[k]);
draft.additions_to_review = (draft.additions_to_review || []).filter((a) => !REGENERATED.some((p) => String(a.id || "").startsWith(p)));
draft.rewrite_notes = [];
draft.resume.experience = draft.resume.experience.map(({ engagement_label: _l, ...role }) => ({ ...role, engagement: role.engagement ?? null }));

const bulletsOf = (d) => Object.fromEntries(d.resume.experience.flatMap((r) => r.bullets.map((b) => [b.id, b.text])));

if (inject) {
  const target = draft.resume.experience.flatMap((r) => r.bullets).find((b) => b.id === inject);
  if (!target) { console.error(`no bullet ${inject}`); process.exit(2); }
  target.text = `Spearheaded and leveraged: ${target.text}`;
  console.log(`[harness] planted a banned phrase in ${inject}`);
}
// Snapshot after the injection, so the fix shows as a change.
const before = bulletsOf(draft);

console.log(`[harness] document ${documentId} (${base.title || ""} v${base.version}), mode=${mode}, ${Object.keys(before).length} bullets`);
const t0 = Date.now();
const stages = [];
const ctx = { ...NOOP_CTX, beginStage: (n) => stages.push(n), finishStage() {}, failStage: (n, e) => console.error(`[harness] stage ${n} failed: ${e.message}`) };
const { draft: out, costUsd } = await finishResume({
  draft, profile, jdAnalysis, selection: plan, jobId: base.job_id, ctx,
  reviewer: false, coverageMayForce: false, styleMayForce: true,
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const after = bulletsOf(out);
const changed = Object.keys(before).filter((id) => after[id] !== before[id]);
const removed = Object.keys(before).filter((id) => !(id in after));
const added = Object.keys(after).filter((id) => !(id in before));
console.log(`\n[harness] ${secs}s, $${costUsd.toFixed(3)}, stages: ${stages.join(" > ")}`);
console.log(`[harness] changed ${changed.length}, added ${added.length}, removed ${removed.length}, untouched ${Object.keys(before).length - changed.length - removed.length}`);
for (const id of changed) console.log(`  ~ ${id}\n      - ${before[id]}\n      + ${after[id]}`);
for (const id of added) console.log(`  + ${id}: ${after[id]}`);
for (const id of removed) console.log(`  - ${id}`);
console.log(`[harness] pages: ${out.layout?.pages ?? "?"} (step ${out.layout?.step ?? 0})`);
console.log("[harness] rewrite_notes:");
for (const n of out.rewrite_notes || []) console.log(`  · ${n}`);
process.exit(0);
