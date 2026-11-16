import { Router } from "express";
import { z } from "zod";
import { listDocumentsByJob, getDocument, updateReviewDecisions, updateContentJson, deleteDocument, instructionThread } from "../db/repo/documents.js";
import { listTasksByJob } from "../db/repo/tasks.js";
import { isActive } from "../../shared/tasks.js";
import { startTask } from "../tasks/start.js";
import { getJob } from "../db/repo/jobs.js";
import { getProfile } from "../profile/loader.js";
import { resumePdf, coverLetterPdf } from "../render/pdf.js";
import { resumeDocx, coverLetterDocx } from "../render/docx.js";
import { documentFilename, companyFromTitle } from "../../shared/resumeFilename.js";
import { BRIEF_SOURCE } from "../../shared/briefs.js";
import { contentDisposition } from "../util/contentDisposition.js";

export const router = Router();

/** The active task of a kind for a job, if any. */
export function activeTaskOfKind(jobId, kind) {
  return listTasksByJob(jobId, 20).find((t) => t.kind === kind && isActive(t)) || null;
}

router.get("/documents", (req, res) => {
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: "jobId query param required" });
  res.json(listDocumentsByJob(jobId));
});

router.get("/documents/:id", (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "document not found" });
  res.json(doc);
});

// Downloads. PDF is the default: written with pdfkit, so its text is real
// strings and an ATS extracts it exactly (the Chrome-printed PDF this
// replaced positioned every glyph separately and parsers split words).
// .docx is the fallback behind "More". Same review decisions, same
// content, in both.
const WORD_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The candidate's contact block for a cover letter, which carries no
// header of its own, comes from the profile.
const letterHeader = () => getProfile()?.facts?.header || {};

const EXPORTS = {
  pdf: {
    mime: "application/pdf",
    render: { resume: resumePdf, cover_letter: (doc) => coverLetterPdf(doc, letterHeader()) },
  },
  docx: {
    mime: WORD_MIME,
    render: { resume: resumeDocx, cover_letter: (doc) => coverLetterDocx(doc, letterHeader()) },
  },
};

// Name plus company ("Alex_Morgan_Cohere"), the company from the job
// itself — always known — rather than from the title, which only carries
// it when the JD analysis found one.
// A brief (Résumés tab) has no company to name the file after, so it
// takes the role title instead: "Alex_Morgan_Senior_Frontend_Engineer".
function exportName(doc) {
  const job = getJob(doc.job_id);
  const company = job?.company || (job?.source === BRIEF_SOURCE ? job.title : companyFromTitle(doc.title));
  const name = (doc.kind === "resume" && doc.content_json?.resume?.header?.name) || letterHeader().name;
  return documentFilename({ name, company, kind: doc.kind });
}

router.get("/documents/:id/:format(pdf|docx)", async (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "document not found" });
  const format = EXPORTS[req.params.format];
  const render = format.render[doc.kind];
  if (!render) return res.status(400).json({ error: `Export is only available for résumés and cover letters, not "${doc.kind}"` });

  try {
    const buf = await render(doc);
    res.setHeader("Content-Type", format.mime);
    res.setHeader("Content-Disposition", contentDisposition("attachment", `${exportName(doc)}.${req.params.format}`));
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// contentJson is normally the full resumeTailorSchema-shaped object saved
// by the tailor pipeline, but the review UI only ever PATCHes it to edit
// bullet text in place — so we validate only the shape that edit needs
// (plus passthrough for every other field) rather than re-declaring the
// whole pipeline schema here, to avoid a malformed body silently wiping a
// document's other fields.
const bulletPatchSchema = z.object({ id: z.string(), text: z.string().min(1) }).passthrough();
const roleEntryPatchSchema = z.object({ role_id: z.string(), bullets: z.array(bulletPatchSchema).optional() }).passthrough();
const contentJsonPatchSchema = z.object({
  resume: z.object({ experience: z.array(roleEntryPatchSchema).optional() }).passthrough().optional(),
}).passthrough();

const patchSchema = z.object({
  reviewDecisions: z.record(z.string(), z.enum(["accepted", "rejected"])).optional(),
  contentJson: contentJsonPatchSchema.optional(),
});

router.patch("/documents/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = getDocument(id);
  if (!existing) return res.status(404).json({ error: "document not found" });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  let doc = existing;
  if (parsed.data.reviewDecisions) doc = updateReviewDecisions(id, parsed.data.reviewDecisions);
  if (parsed.data.contentJson) doc = updateContentJson(id, parsed.data.contentJson);
  res.json(doc);
});

router.delete("/documents/:id", (req, res) => {
  deleteDocument(Number(req.params.id));
  res.json({ ok: true });
});

// A follow-up instruction on a résumé version. Queues a revise_resume
// task that saves the result as the next version of that résumé. One
// revision runs per job at a time (the task's default dedupe key), and a
// revision never starts while "Prepare application" is replacing the
// résumé underneath it.
// 8000 characters: a numbered, multi-part brief for one application fits
// comfortably; the prompt it rides in is bounded elsewhere.
const INSTRUCTION_MAX = 8000;
const reviseSchema = z.object({ instruction: z.string().trim().min(1).max(INSTRUCTION_MAX) });

router.post("/documents/:id/revise", (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "document not found" });
  if (doc.kind !== "resume") return res.status(400).json({ error: `Only résumés can be revised, not "${doc.kind}"` });
  const parsed = reviseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `instruction is required (up to ${INSTRUCTION_MAX} characters)` });
  if (activeTaskOfKind(doc.job_id, "prepare_application")) {
    return res.status(409).json({ error: "Prepare application is still running for this job; wait for it to finish, then revise the new résumé." });
  }
  // A job that has a cover letter gets a fresh one from the revised
  // résumé; one that never had a letter does not grow one here.
  const coverLetter = listDocumentsByJob(doc.job_id).some((d) => d.kind === "cover_letter");
  res.json(startTask({
    kind: "revise_resume",
    jobId: doc.job_id,
    payload: { documentId: doc.id, instruction: parsed.data.instruction, coverLetter },
  }));
});

// The chain of instructions that led to a version, oldest first, each with
// the notes the model returned. Empty for a version made by a fresh run.
router.get("/documents/:id/thread", (req, res) => {
  const doc = getDocument(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: "document not found" });
  res.json(instructionThread(doc.id));
});
