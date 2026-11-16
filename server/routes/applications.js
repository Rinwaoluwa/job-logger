import { Router } from "express";
import { z } from "zod";
import { getJob, deleteJob } from "../db/repo/jobs.js";
import { cancelByJob } from "../tasks/worker.js";
import {
  STAGES, APPLIED_VIA, updateStage, updateNotes, setAppliedAt, getApplication,
  updateFields, logApplication, listApplications, stageCounts, deleteApplication, setSentResume,
} from "../db/repo/applications.js";
import { getDocument, contentHash } from "../db/repo/documents.js";
import { insertAttachment, findByPath, findByDocument } from "../db/repo/attachments.js";
import { resolveInsideFolder, resolveAbsolutePath, fingerprint } from "../files/localFiles.js";
import { getSetting } from "../db/repo/settings.js";

export const router = Router();

// --- Static routes first: Express matches "/applications/stats"-shaped
// paths against "/applications/:jobId" too, so any future addition here
// must stay above the :jobId routes. ---

router.get("/applications", (req, res) => {
  const asArray = (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
  const stage = asArray(req.query.stage);
  const q = req.query.q || undefined;
  const includeArchived = req.query.includeArchived === "true";
  const includeNew = req.query.includeNew === "true";
  const sort = req.query.sort || "applied";

  const rows = listApplications({ stage, q, includeArchived, includeNew, sort });
  res.json({ rows, counts: stageCounts({ includeArchived }) });
});

const patchSchema = z.object({
  stage: z.enum(STAGES).optional(),
  notes: z.string().optional(),
  appliedAt: z.string().optional(),
  appliedVia: z.enum(APPLIED_VIA).optional(),
  appliedUrl: z.string().optional(),
  referralName: z.string().optional(),
  salaryExpectation: z.string().optional(),
  nextAction: z.string().optional(),
  nextActionAt: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactLinkedin: z.string().optional(),
  archived: z.boolean().optional(),
  // The résumé version the interviewer has read (null = back to "newest").
  sentResumeDocumentId: z.number().int().nullable().optional(),
});

const CAMEL_TO_COLUMN = {
  appliedVia: "applied_via",
  appliedUrl: "applied_url",
  referralName: "referral_name",
  salaryExpectation: "salary_expectation",
  nextAction: "next_action",
  nextActionAt: "next_action_at",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactLinkedin: "contact_linkedin",
};

router.patch("/applications/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { stage, notes, appliedAt, archived, sentResumeDocumentId, ...rest } = parsed.data;
  if (stage) updateStage(job.id, stage, { appliedAt });
  if (sentResumeDocumentId !== undefined) {
    try {
      setSentResume(job.id, sentResumeDocumentId);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (typeof notes === "string") updateNotes(job.id, notes);
  if (appliedAt && !stage) setAppliedAt(job.id, appliedAt);

  const fields = {};
  for (const [camel, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    fields[CAMEL_TO_COLUMN[camel] || camel] = value;
  }
  if (archived !== undefined) fields.archived_at = archived ? new Date().toISOString() : null;
  if (Object.keys(fields).length > 0) updateFields(job.id, fields);

  res.json({ application: getApplication(job.id) });
});

// Two different things people mean by "delete this application":
//
//   default        drop the application record and its history. The job
//                  stays on the Jobs tab as an ordinary listing, and any
//                  résumé already generated for it is kept.
//   ?job=true      delete the job itself. Everything keyed to it goes with
//                  it via ON DELETE CASCADE — application, stage history,
//                  generated documents, fit analyses, interview prep and
//                  attachment rows. This is what you want for a job you
//                  typed in by hand, which has no life outside the
//                  application you created it for.
//
// Neither touches files on disk: attachments are links to files that were
// never copied into the app.
router.delete("/applications/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });

  if (req.query.job === "true") {
    cancelByJob(job.id);
    deleteJob(job.id);
    return res.json({ ok: true, deleted: "job" });
  }
  deleteApplication(job.id);
  res.json({ ok: true, deleted: "application" });
});

// The single call behind the "Log application" modal: moves the job to
// 'applied' and, in one round trip, records how/when/where you applied
// plus any attachments picked in the modal. File resolution/fingerprinting
// happens before the DB transaction opens (in logApplication) so a slow
// disk read never holds a lock.
const applySchema = z.object({
  appliedAt: z.string(),
  appliedVia: z.enum(APPLIED_VIA).optional(),
  appliedUrl: z.string().optional(),
  referralName: z.string().optional(),
  nextAction: z.string().optional(),
  nextActionAt: z.string().optional(),
  notes: z.string().optional(),
  folderFiles: z.array(z.object({ name: z.string(), kind: z.enum(["resume", "cover_letter", "other"]), label: z.string().optional() })).default([]),
  paths: z.array(z.object({ path: z.string(), kind: z.enum(["resume", "cover_letter", "other"]), label: z.string().optional() })).default([]),
  documentIds: z.array(z.object({ documentId: z.number().int(), kind: z.enum(["resume", "cover_letter", "other"]).optional() })).default([]),
});

router.post("/applications/:jobId/apply", async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { appliedAt, folderFiles, paths, documentIds, ...rest } = parsed.data;

  // Resolve every file reference up front — any bad path/name fails the
  // whole request before anything is written, rather than half-logging.
  const folder = getSetting("attachments.source_folder");
  let resolved;
  try {
    resolved = [
      ...folderFiles.map((f) => ({ ...f, absPath: resolveInsideFolder(folder, f.name), fileName: f.name })),
      ...paths.map((f) => ({ ...f, absPath: resolveAbsolutePath(f.path), fileName: f.path.split("/").pop() })),
    ];
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const fingerprints = await Promise.all(resolved.map((f) => fingerprint(f.absPath)));

  const CAMEL = {
    appliedVia: "applied_via", appliedUrl: "applied_url", referralName: "referral_name",
    nextAction: "next_action", nextActionAt: "next_action_at", notes: "notes",
  };
  const fields = {};
  for (const [camel, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    fields[CAMEL[camel] || camel] = value;
  }

  const application = logApplication(job.id, { appliedAt, ...fields });

  const attachments = [];
  resolved.forEach((f, i) => {
    if (findByPath(job.id, f.absPath)) return;
    attachments.push(insertAttachment({
      jobId: job.id, kind: f.kind, label: f.label || null,
      filePath: f.absPath, fileName: f.fileName, ...fingerprints[i],
    }));
  });
  let sentResumeId = null;
  for (const d of documentIds) {
    const doc = getDocument(d.documentId);
    if (!doc || doc.job_id !== job.id) continue;
    // The résumé version attached to the application is the one sent.
    if (doc.kind === "resume") sentResumeId = Math.max(sentResumeId || 0, doc.id);
    if (findByDocument(job.id, d.documentId)) continue;
    attachments.push(insertAttachment({
      jobId: job.id, kind: d.kind || (doc.kind === "cover_letter" ? "cover_letter" : "resume"),
      label: doc.title, documentId: doc.id, documentHash: contentHash(doc.id),
    }));
  }
  const finalApplication = sentResumeId ? setSentResume(job.id, sentResumeId) : application;

  res.json({ application: finalApplication, attachments });
});
