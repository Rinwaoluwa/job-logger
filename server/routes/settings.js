import { Router } from "express";
import { z } from "zod";
import { getAllSettings, setSetting, DEFAULTS } from "../db/repo/settings.js";

export const router = Router();

router.get("/settings", (_req, res) => {
  res.json({ settings: getAllSettings() });
});

const patchSchema = z.object({}).catchall(z.string());

router.patch("/settings", (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!(key in DEFAULTS)) return res.status(400).json({ error: `unknown setting: ${key}` });
    setSetting(key, value);
  }
  res.json({ settings: getAllSettings() });
});
