import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toJob } from "../sources/normalize.js";
import { insertJob, listJobs, setJobHidden } from "../db/repo/jobs.js";
import { latestDocumentSummary } from "../db/repo/documents.js";
import { startTask } from "../tasks/start.js";
import { BRIEF_SOURCE, briefText } from "../../shared/briefs.js";

export const router = Router();

// A brief is a résumé generated from a job title and a skills list with
// no posting behind it (the Résumés tab). It is stored as a hidden job
// (source "brief") so the prepare task, document versions, revisions and
// exports work unchanged, while the Jobs and Applications tabs never
// list it. The posting URL is synthetic; "manual:" keeps the people
// search and the open-posting links treating it as a hand-made job.

const briefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  skills: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  company: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  coverLetter: z.boolean().default(false),
});

router.post("/briefs", (req, res) => {
  const parsed = briefSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { title, skills, company, notes, coverLetter } = parsed.data;
  const brief = { title, skills, company: company || null, notes: notes || "" };

  const job = insertJob(
    toJob({
      source: BRIEF_SOURCE,
      url: `manual:${randomUUID()}`,
      title,
      company: company || "",
      description_text: briefText(brief),
      raw: { brief },
    }),
  );
  setJobHidden(job.id, true);

  // No fit score: there is no posting to score against.
  res.json(startTask({
    kind: "prepare_application",
    jobId: job.id,
    payload: { coverLetter, fit: false },
  }));
});

router.get("/briefs", (req, res) => {
  const rows = listJobs({ source: [BRIEF_SOURCE], includeHidden: true, sort: "ingested" });
  res.json(rows.map((j) => ({
    id: j.id,
    title: j.title,
    company: j.company || null,
    brief: j.raw?.brief || { title: j.title, skills: [], company: j.company || null, notes: "" },
    createdAt: j.ingested_at,
    resume: latestDocumentSummary(j.id, "resume"),
    coverLetter: latestDocumentSummary(j.id, "cover_letter"),
  })));
});
