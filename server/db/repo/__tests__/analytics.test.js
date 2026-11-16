import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A fresh database: DB_PATH is read when server/db/index.js is imported,
// which also runs the migrations.
process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "analytics-")), "test.db");

let run;
let analytics;

const job = (id, source = "link") => run(
  `INSERT INTO jobs (id, source, url, title, company, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)`,
  [id, source, `https://example.com/${id}`, `Engineer ${id}`, `Co ${id}`, `dk-${id}`],
);
const application = (id, { stage = "applied", appliedAt, via = "company_site", docId = null, archived = null }) => run(
  `INSERT INTO applications (job_id, stage, applied_at, applied_via, sent_resume_document_id, archived_at) VALUES (?, ?, ?, ?, ?, ?)`,
  [id, stage, appliedAt, via, docId, archived],
);
const event = (id, from, to, at) => run(`INSERT INTO application_events (job_id, from_stage, to_stage, at) VALUES (?, ?, ?, ?)`, [id, from, to, at]);
const outreach = (id, status, sentAt, updatedAt = sentAt) => run(
  `INSERT INTO outreach (job_id, person_key, person_name, channel, status, sent_at, updated_at) VALUES (?, 'p', 'P', 'email', ?, ?, ?)`,
  [id, status, sentAt, updatedAt],
);
const resumeDoc = (id, additions, matchScore = 70) => {
  run(`INSERT INTO documents (job_id, kind, version, title, content_json) VALUES (?, 'resume', 1, 'r', ?)`, [id, JSON.stringify({ match_score: matchScore, additions_to_review: additions })]);
  return Number(run("SELECT 1").lastInsertRowid ?? 0) || null;
};

beforeAll(async () => {
  ({ run } = await import("../../index.js"));
  ({ analytics } = await import("../analytics.js"));
  const { get } = await import("../../index.js");
  const lastId = () => get("SELECT last_insert_rowid() AS id").id;

  // a: applied, interviewed via a stage event 3 days later.
  job("a"); application("a", { stage: "interviewing", appliedAt: "2026-10-01", via: "referral" });
  event("a", "new", "applied", "2026-10-01 12:00:00"); event("a", "applied", "interviewing", "2026-10-04 12:00:00");
  // b: applied, outreach reply came before the rejection event: the reply is the first response.
  job("b"); application("b", { stage: "rejected", appliedAt: "2026-10-02" });
  event("b", "new", "applied", "2026-10-02 12:00:00"); event("b", "applied", "rejected", "2026-10-12 12:00:00");
  outreach("b", "replied", "2026-10-03 09:00:00", "2026-10-05 09:00:00");
  // c: applied long ago, nothing since: stalled.
  job("c", "jackandjill"); application("c", { stage: "applied", appliedAt: "2026-09-01" });
  event("c", "new", "applied", "2026-09-01 12:00:00");
  // d: applied long ago, but an outreach reply came: not stalled, responded.
  job("d"); application("d", { stage: "applied", appliedAt: "2026-09-02" });
  event("d", "new", "applied", "2026-09-02 12:00:00");
  outreach("d", "replied", "2026-09-03 09:00:00", "2026-09-04 09:00:00");
  // e: applied yesterday: open but too recent to be stalled.
  job("e"); application("e", { stage: "applied", appliedAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) });
  // f: archived, never counted; g: a brief, never counted.
  job("f"); application("f", { stage: "applied", appliedAt: "2026-10-03", archived: "2026-10-05 00:00:00" });
  job("g", "brief"); application("g", { stage: "applied", appliedAt: "2026-10-03" });
  // h/i: sent résumé versions, one with gap fills, one reframed.
  job("h"); run(`INSERT INTO documents (job_id, kind, version, title, content_json) VALUES ('h', 'resume', 1, 'r', ?)`, [JSON.stringify({ match_score: 80, additions_to_review: [{ reason: "Gap fill: Python." }] })]);
  application("h", { stage: "applied", appliedAt: "2026-10-05", docId: lastId() });
  job("i"); run(`INSERT INTO documents (job_id, kind, version, title, content_json) VALUES ('i', 'resume', 1, 'r', ?)`, [JSON.stringify({ match_score: 60, additions_to_review: [{ reason: "Reframed: React." }, { reason: "Gap fill: Go." }] })]);
  application("i", { stage: "interviewing", appliedAt: "2026-10-06", docId: lastId() });
  event("i", "applied", "interviewing", "2026-10-09 12:00:00");
});

describe("analytics", () => {
  it("counts the funnel from the stages reached, excluding archived rows and briefs", () => {
    const a = analytics({ days: null });
    expect(a.counts.applied).toBe(7);
    expect(a.funnel.reached).toEqual({ applied: 7, interviewing: 2, offer: 0, rejected: 1 });
    expect(a.funnel.rates.applied_to_interview).toEqual({ num: 2, den: 7, rate: 2 / 7 });
  });

  it("takes the first response from whichever came first, a stage event or an outreach reply", () => {
    const a = analytics({ days: null });
    expect(a.response.responded).toBe(4); // a (event), b (reply before rejection), d (reply), i (event)
    const byVia = Object.fromEntries(a.byAppliedVia.map((g) => [g.key, g]));
    expect(byVia.referral.responded).toBe(1);
    // b: reply on Oct 5 (updated_at) against applied Oct 1-2 → about 3 days, not the 10 to the rejection.
    expect(a.response.medianDays).toBeGreaterThan(1);
    expect(a.response.medianDays).toBeLessThan(5);
  });

  it("lists quiet applications oldest first, leaving out the ones that got a reply or are too recent", () => {
    const a = analytics({ days: null, stalledDays: 14 });
    // c (Sept) and h (Oct, no reply); not d (replied), not e (yesterday), not i (interviewing).
    expect(a.stalled.map((r) => r.jobId)).toEqual(["c", "h"]);
    expect(a.stalled[0].daysSinceApplied).toBeGreaterThan(a.stalled[1].daysSinceApplied);
    expect(a.stalled[1].daysSinceApplied).toBeGreaterThanOrEqual(14);
  });

  it("groups by the shape of the résumé version that was sent", () => {
    const a = analytics({ days: null });
    const groups = Object.fromEntries(a.resumeEffectiveness.map((g) => [g.key, g]));
    expect(groups.fills.applications).toBe(1);
    expect(groups.reframed.applications).toBe(1);
    expect(groups.reframed.interviews).toBe(1);
    expect(groups.unknown.applications).toBe(5);
    expect(groups.fills.avgMatchScore).toBe(80);
  });

  it("limits the window by applied date and keeps stalled applications regardless of it", () => {
    const a = analytics({ days: 20, stalledDays: 14 });
    expect(a.counts.applied).toBe(1); // only e
    expect(a.stalled.map((r) => r.jobId)).toEqual(["c", "h"]);
    expect(a.range.since).toBeTruthy();
  });
});
