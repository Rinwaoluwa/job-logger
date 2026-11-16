import { Router } from "express";
import { z } from "zod";
import { sourcesStatus } from "../sources/index.js";
import { startTask } from "../tasks/start.js";
import { config } from "../config.js";
import { REMOTEOK_ATTRIBUTION, describeJackAndJill, describeRoutine } from "../sources/adapters/index.js";

export const router = Router();

const refreshSchema = z.object({ only: z.array(z.string()).optional() });

// A refresh fans out to every enabled board and can run for minutes, so
// it is a background task; the fit scoring it queues is grouped under it.
router.post("/sources/refresh", (req, res) => {
  const parsed = refreshSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  if (!config.sources) return res.status(400).json({ error: `Sources config not found at ${config.sourcesConfigPath}` });
  res.json(startTask({ kind: "sources_refresh", payload: { only: parsed.data.only } }));
});

router.get("/sources/status", (_req, res) => {
  const status = sourcesStatus();
  res.json({
    ...status,
    remoteOkAttribution: status.sources.find((s) => s.name === "remoteok" && s.enabled) ? REMOTEOK_ATTRIBUTION : null,
    // Folder + per-file results for the Jack & Jill import card.
    jackandjill: config.sources ? describeJackAndJill(config.sources) : null,
    // Doc link + last read's numbers for the Job Search Log card.
    routine: config.sources ? describeRoutine(config.sources) : null,
    fitMaxPerRefresh: config.sources?.fit?.max_per_refresh ?? 40,
  });
});

router.get("/config/sources", (_req, res) => {
  if (!config.sources) return res.status(404).json({ error: `not found at ${config.sourcesConfigPath}` });
  res.json(config.sources);
});
