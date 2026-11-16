import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toJob } from "../sources/normalize.js";
import { insertJob, getJob } from "../db/repo/jobs.js";
import { startTask } from "../tasks/start.js";

export const router = Router();

const tailorSchema = z.object({
  jdText: z.string().default(""),
  title: z.string().optional(),
  company: z.string().optional(),
  coverLetter: z.boolean().optional(),
});

// Tailor against pasted text: creates a manual job so the documents have
// somewhere to live, then queues the same task "Prepare application" uses.
router.post("/ai/tailor", (req, res) => {
  const parsed = tailorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { jdText, title, company, coverLetter } = parsed.data;

  const job = insertJob(
    toJob({
      source: "manual",
      url: `manual:${randomUUID()}`,
      title: title || "Untitled application",
      company: company || "Unspecified",
      description_text: jdText,
    }),
  );

  res.json(startTask({
    kind: "prepare_application",
    jobId: job.id,
    payload: { jdText, coverLetter: !!coverLetter, fit: false },
  }));
});

const answerSchema = z.object({
  question: z.string().min(1),
  jobId: z.string().optional(),
  jdText: z.string().optional(),
  length: z.enum(["short", "medium", "long"]).default("medium"),
});

// Answers are never deduplicated: asking the same question twice is a
// legitimate way to get a second draft.
router.post("/ai/answer", (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { question, jobId, jdText, length } = parsed.data;

  let effectiveJdText = jdText || "";
  if (jobId) {
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: "job not found" });
    effectiveJdText = job.description_text;
  }

  res.json(startTask({
    kind: "answer",
    jobId: jobId || null,
    payload: { question, jdText: effectiveJdText, length, jobId: jobId || null },
    dedupeKey: null,
  }));
});
