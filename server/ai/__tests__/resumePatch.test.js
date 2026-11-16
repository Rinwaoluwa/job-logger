import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyResumePatch, PatchError, overLengthBullets, patchLengthDirective } from "../resumePatch.js";
import { resumePatchSchema, MIN_BULLETS_PER_ROLE } from "../schemas.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/resume.json", import.meta.url), "utf8"));
const load = () => structuredClone(fixture);

const bullet = (id, text, extra = {}) => ({
  id, text, source_story_ids: [], metric_ids: [], jd_items: [], inferred: false, text_without_reframe: null, ...extra,
});
const emptyPatch = (over = {}) => resumePatchSchema.parse({
  summary: null, bullets: [], skill_groups: null, additions: [],
  match_score: null, must_have_gaps: null, nice_to_have_gaps: null, ats_keywords: null, rewrite_notes: [],
  ...over,
});
const bulletsOf = (draft) => Object.fromEntries(draft.resume.experience.flatMap((r) => r.bullets.map((b) => [b.id, b])));

describe("applyResumePatch", () => {
  it("replaces only the named bullet and leaves every other byte identical", () => {
    const prev = load();
    const patch = emptyPatch({
      bullets: [{ op: "replace", role_id: "northwind", id: "northwind-b2", bullet: bullet("northwind-b2", "Rewrote the audit export with streaming CSV.") }],
      rewrite_notes: ["northwind-b2: banned phrase removed"],
    });
    const { draft, changedLocations, log } = applyResumePatch(prev, patch);
    const before = bulletsOf(prev);
    const after = bulletsOf(draft);
    expect(after["northwind-b2"].text).toBe("Rewrote the audit export with streaming CSV.");
    for (const id of Object.keys(before)) {
      if (id !== "northwind-b2") expect(JSON.stringify(after[id])).toBe(JSON.stringify(before[id]));
    }
    expect(draft.resume.professional_summary).toBe(prev.resume.professional_summary);
    expect(draft.additions_to_review).toEqual(prev.additions_to_review);
    expect(draft.rewrite_notes).toEqual([...prev.rewrite_notes, "northwind-b2: banned phrase removed"]);
    expect([...changedLocations]).toEqual(["northwind-b2"]);
    expect(log).toEqual(["replaced northwind-b2"]);
    // The input was not touched.
    expect(JSON.stringify(prev)).toBe(JSON.stringify(fixture));
  });

  it("adds a bullet with the next id and removes one with its review entry", () => {
    const prev = load();
    const fieldstack = prev.resume.experience.find((r) => r.role_id === "fieldstack");
    const n = fieldstack.bullets.length;
    const patch = emptyPatch({
      bullets: [
        { op: "add", role_id: "fieldstack", id: `fieldstack-b${n + 1}`, bullet: bullet(`fieldstack-b${n + 1}`, "Added a thing with Python.", { inferred: true }) },
        { op: "remove", role_id: "fieldstack", id: "fieldstack-b5", bullet: null },
      ],
      additions: [
        { op: "upsert", id: "add-new", entry: { id: "add-new", kind: "bullet", location: `fieldstack-b${n + 1}`, text: "Added a thing with Python.", reason: "Gap fill: Python. Plausible.", confidence: "low" } },
        { op: "remove", id: "add-5", entry: null },
      ],
    });
    const { draft } = applyResumePatch(prev, patch);
    const role = draft.resume.experience.find((r) => r.role_id === "fieldstack");
    expect(role.bullets.map((b) => b.id)).not.toContain("fieldstack-b5");
    expect(role.bullets.at(-1).id).toBe(`fieldstack-b${n + 1}`);
    expect(draft.additions_to_review.find((a) => a.id === "add-5")).toBeUndefined();
    expect(draft.additions_to_review.find((a) => a.id === "add-new").location).toBe(`fieldstack-b${n + 1}`);
  });

  it("drops a review entry whose bullet was removed even if the patch forgot to", () => {
    const prev = load();
    const patch = emptyPatch({ bullets: [{ op: "remove", role_id: "fieldstack", id: "fieldstack-b5", bullet: null }] });
    const { draft } = applyResumePatch(prev, patch);
    expect(prev.additions_to_review.some((a) => a.location === "fieldstack-b5")).toBe(true);
    expect(draft.additions_to_review.some((a) => a.location === "fieldstack-b5")).toBe(false);
  });

  it("replaces the summary pair, the skills and the scalars when given", () => {
    const prev = load();
    const patch = emptyPatch({
      summary: { professional_summary: "New summary.", professional_summary_without_fills: "New summary without fills." },
      skill_groups: [{ title: "A", items: ["x"] }, { title: "B", items: ["y"] }, { title: "C", items: ["z"] }],
      match_score: 77,
      ats_keywords: ["React"],
    });
    const { draft, changedLocations } = applyResumePatch(prev, patch);
    expect(draft.resume.professional_summary).toBe("New summary.");
    expect(draft.resume.professional_summary_without_fills).toBe("New summary without fills.");
    expect(draft.resume.skill_groups.map((g) => g.title)).toEqual(["A", "B", "C"]);
    expect(draft.match_score).toBe(77);
    expect(draft.ats_keywords).toEqual(["React"]);
    expect(draft.must_have_gaps).toEqual(prev.must_have_gaps);
    expect([...changedLocations].sort()).toEqual(["skills", "summary"]);
  });

  it("refuses a patch that points at nothing, listing every problem", () => {
    const prev = load();
    const patch = emptyPatch({
      bullets: [
        { op: "replace", role_id: "northwind", id: "northwind-b99", bullet: bullet("northwind-b99", "x") },
        { op: "add", role_id: "northwind", id: "brightpay-b1", bullet: bullet("brightpay-b1", "x") },
        { op: "add", role_id: "northwind", id: "northwind-b2", bullet: bullet("northwind-b2", "x") },
        { op: "remove", role_id: "nope", id: "nope-b1", bullet: null },
      ],
      additions: [{ op: "upsert", id: "a", entry: { id: "a", kind: "bullet", location: "northwind-b77", text: "", reason: "", confidence: "low" } }],
    });
    let err;
    try { applyResumePatch(prev, patch); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(PatchError);
    expect(err.problems).toHaveLength(5);
    expect(err.problems.join("\n")).toMatch(/northwind-b99: not a bullet/);
    expect(err.problems.join("\n")).toMatch(/brightpay-b1: id must be "northwind-b<n>"/);
    expect(err.problems.join("\n")).toMatch(/northwind-b2: that id is already in use/);
    expect(err.problems.join("\n")).toMatch(/no role "nope"/);
    expect(err.problems.join("\n")).toMatch(/northwind-b77 is not on the résumé/);
  });

  it("refuses to take a role below the bullet floor", () => {
    const prev = load();
    const harbor = prev.resume.experience.find((r) => r.role_id === "harbor");
    const removals = harbor.bullets.slice(0, harbor.bullets.length - MIN_BULLETS_PER_ROLE + 1)
      .map((b) => ({ op: "remove", role_id: "harbor", id: b.id, bullet: null }));
    expect(() => applyResumePatch(prev, emptyPatch({ bullets: removals }))).toThrow(/harbor would be left with/);
  });
});

describe("overLengthBullets", () => {
  const draft = () => ({
    resume: {
      professional_summary: "one two three",
      experience: [
        { role_id: "new", bullets: [bullet("new-b1", "x".repeat(260)), bullet("new-b2", "x".repeat(200))] },
        { role_id: "mid", bullets: [bullet("mid-b1", "x".repeat(200)), bullet("mid-b2", "x".repeat(180)), bullet("mid-b3", "x".repeat(145)), bullet("mid-b4", "x".repeat(100))] },
        { role_id: "old", bullets: [bullet("old-b1", "x".repeat(131)), bullet("old-b2", "x".repeat(130))] },
      ],
    },
  });
  const selection = { role_plan: [{ role_id: "new" }, { role_id: "mid" }, { role_id: "old" }] };

  it("applies the writer's line budget per role and sorts by excess", () => {
    const over = overLengthBullets(draft(), { latestRoleId: "new", selection });
    expect(over.map((b) => b.id)).toEqual(["mid-b3", "new-b1", "old-b1"]);
    expect(over.find((b) => b.id === "mid-b3").limit).toBe(130);
    expect(over.find((b) => b.id === "new-b1").limit).toBe(250);
  });

  it("names those bullets in the LENGTH directive", () => {
    const text = patchLengthDirective({ draft: draft(), measured: { linesOver: 2 }, maxPages: 1, latestRoleId: "new", selection });
    expect(text).toMatch(/runs 2 lines past/);
    expect(text).toMatch(/mid-b3 \(145 characters, at most 130\)/);
    expect(text).toMatch(/it has 3\)/);
    expect(text).not.toMatch(/outside the flagged locations/);
  });
});
