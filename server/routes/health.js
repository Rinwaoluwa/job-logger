import { Router } from "express";
import { config } from "../config.js";

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, claudeBin: config.claude.bin, db: true });
});
