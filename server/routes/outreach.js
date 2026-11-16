// The send log behind the People tab. Nothing here sends mail: the browser
// opens a prefilled Gmail compose window and tells us it did.

import { Router } from "express";
import { z } from "zod";
import { getJob } from "../db/repo/jobs.js";
import {
  OUTREACH_CHANNELS, OUTREACH_STATUSES,
  insertOutreach, getOutreach, updateOutreachStatus, deleteOutreach,
} from "../db/repo/outreach.js";

export const router = Router();

const logSchema = z.object({
  personKey: z.string().min(1),
  personName: z.string().min(1),
  channel: z.enum(OUTREACH_CHANNELS),
  toAddress: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  peopleSearchId: z.number().int().optional(),
});

router.post("/jobs/:id/outreach", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { personKey, personName, channel, toAddress, subject, body, peopleSearchId } = parsed.data;
  const row = insertOutreach({
    jobId: job.id, peopleSearchId: peopleSearchId ?? null, personKey, personName, channel,
    toAddress: toAddress ?? null, subject: subject ?? null, body: body ?? null,
  });
  res.json({ outreach: row });
});

const statusSchema = z.object({ status: z.enum(OUTREACH_STATUSES) });

router.patch("/outreach/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getOutreach(id)) return res.status(404).json({ error: "outreach row not found" });
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  res.json({ outreach: updateOutreachStatus(id, parsed.data.status) });
});

router.delete("/outreach/:id", (req, res) => {
  deleteOutreach(Number(req.params.id));
  res.json({ ok: true });
});
