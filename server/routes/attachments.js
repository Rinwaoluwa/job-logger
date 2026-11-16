import { Router } from "express";
import { getApplication, setSentResume } from "../db/repo/applications.js";
import { z } from "zod";
import { getJob } from "../db/repo/jobs.js";
import { getSetting } from "../db/repo/settings.js";
import { getDocument, contentHash } from "../db/repo/documents.js";
import {
  insertAttachment, getAttachment, listAttachmentsByJob, deleteAttachment, findByPath, findByDocument,
} from "../db/repo/attachments.js";
import {
  listSourceFolder, resolveSourceFolder, resolveInsideFolder, resolveAbsolutePath,
  fingerprint, statusOf, revealInFinder,
} from "../files/localFiles.js";
import { contentDisposition } from "../util/contentDisposition.js";

export const router = Router();

function sourceFolderSetting() {
  return getSetting("attachments.source_folder");
}

// --- Static "source-folder" endpoints (declared before /:id routes) ---

router.get("/attachments/source-folder", (_req, res) => {
  try {
    res.json(listSourceFolder(sourceFolderSetting()));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const revealFolderSchema = z.object({ name: z.string().optional() });
router.post("/attachments/source-folder/reveal", async (req, res) => {
  const parsed = revealFolderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const target = parsed.data.name
      ? resolveInsideFolder(sourceFolderSetting(), parsed.data.name)
      : resolveSourceFolder(sourceFolderSetting()).real;
    if (!target) return res.status(404).json({ error: "source folder does not exist" });
    await revealInFinder(target);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// --- Per-application attachments ---

function decorate(row) {
  const status = row.document_id && !row.file_path ? "linked-doc" : statusOf(row.file_path, row.size, row.mtime);
  const documentEdited = row.document_id ? contentHash(row.document_id) !== row.document_hash : false;
  const { doc_content_json, ...rest } = row;
  return { ...rest, status, documentEdited };
}

router.get("/applications/:jobId/attachments", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(listAttachmentsByJob(job.id).map(decorate));
});

const kindSchema = z.enum(["resume", "cover_letter", "other"]);

const fromFolderSchema = z.object({ name: z.string().min(1), kind: kindSchema, label: z.string().optional() });
router.post("/applications/:jobId/attachments/from-folder", async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = fromFolderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const absPath = resolveInsideFolder(sourceFolderSetting(), parsed.data.name);
    const existing = findByPath(job.id, absPath);
    if (existing) return res.json({ attachment: decorate(existing), duplicate: true });
    const fp = await fingerprint(absPath);
    const attachment = insertAttachment({
      jobId: job.id, kind: parsed.data.kind, label: parsed.data.label || null,
      filePath: absPath, fileName: parsed.data.name, ...fp,
    });
    res.json({ attachment: decorate(attachment) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const fromPathSchema = z.object({ path: z.string().min(1), kind: kindSchema, label: z.string().optional() });
router.post("/applications/:jobId/attachments/from-path", async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = fromPathSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const absPath = resolveAbsolutePath(parsed.data.path);
    const existing = findByPath(job.id, absPath);
    if (existing) return res.json({ attachment: decorate(existing), duplicate: true });
    const fp = await fingerprint(absPath);
    const attachment = insertAttachment({
      jobId: job.id, kind: parsed.data.kind, label: parsed.data.label || null,
      filePath: absPath, fileName: absPath.split("/").pop(), ...fp,
    });
    res.json({ attachment: decorate(attachment) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const DOC_KIND_TO_ATTACHMENT_KIND = { resume: "resume", cover_letter: "cover_letter" };

const linkDocSchema = z.object({ documentId: z.number().int(), kind: kindSchema.optional(), label: z.string().optional() });
router.post("/applications/:jobId/attachments/link-document", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = linkDocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const doc = getDocument(parsed.data.documentId);
  if (!doc || doc.job_id !== job.id) return res.status(404).json({ error: "document not found for this job" });
  const existing = findByDocument(job.id, doc.id);
  if (existing) return res.json({ attachment: decorate(existing), duplicate: true });
  const kind = parsed.data.kind || DOC_KIND_TO_ATTACHMENT_KIND[doc.kind] || "other";
  const attachment = insertAttachment({
    jobId: job.id, kind, label: parsed.data.label || doc.title,
    documentId: doc.id, documentHash: contentHash(doc.id),
  });
  // Linking a résumé is "this is what I sent" unless a version is already marked.
  if (doc.kind === "resume" && !getApplication(job.id)?.sent_resume_document_id) setSentResume(job.id, doc.id);
  res.json({ attachment: decorate(attachment) });
});

// --- Single attachment ---

router.get("/attachments/:id/file", (req, res) => {
  const attachment = getAttachment(Number(req.params.id));
  if (!attachment || !attachment.file_path) return res.status(404).json({ error: "no file for this attachment" });
  const type = req.query.download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", contentDisposition(type, attachment.file_name || "file"));
  if (attachment.mime) res.setHeader("Content-Type", attachment.mime);
  res.sendFile(attachment.file_path, (err) => {
    if (err && !res.headersSent) res.status(err.code === "ENOENT" ? 404 : 500).json({ error: "file not found on disk" });
  });
});

router.post("/attachments/:id/reveal", async (req, res) => {
  const attachment = getAttachment(Number(req.params.id));
  if (!attachment || !attachment.file_path) return res.status(404).json({ error: "no file for this attachment" });
  try {
    await revealInFinder(attachment.file_path);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete("/attachments/:id", (req, res) => {
  // Only removes the row that links a file/document to this application —
  // files are linked in place and never copied, so there is nothing on
  // disk to clean up.
  deleteAttachment(Number(req.params.id));
  res.json({ ok: true });
});
