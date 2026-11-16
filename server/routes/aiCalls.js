import { Router } from "express";
import { listAiCalls, costSummary } from "../db/repo/aiCalls.js";
import { latestRunsPerSource } from "../db/repo/sourceRuns.js";

export const router = Router();

router.get("/ai/calls", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  res.json(listAiCalls(limit));
});

router.get("/ai/cost", (_req, res) => {
  res.json(costSummary());
});

router.get("/ai/source-runs", (_req, res) => {
  res.json(latestRunsPerSource());
});
