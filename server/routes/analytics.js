import { Router } from "express";
import { z } from "zod";
import { analytics } from "../db/repo/analytics.js";

export const router = Router();

const querySchema = z.object({
  // A number of days, or "all".
  days: z.string().optional(),
  stalledDays: z.coerce.number().int().min(1).max(365).optional(),
});

router.get("/analytics", (req, res) => {
  const q = querySchema.parse(req.query);
  const days = q.days === "all" ? null : q.days ? Math.min(3650, Math.max(1, Number(q.days) || 90)) : 90;
  res.json(analytics({ days, stalledDays: q.stalledDays ?? null }));
});
