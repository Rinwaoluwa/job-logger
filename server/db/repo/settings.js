import { run, get, all } from "../index.js";
import { config } from "../../config.js";

// Defaults used when a key has never been written. attachments.source_folder
// seeds from config so it points at ~/Documents/Generate Resumes out of the
// box; the tracking.* keys back the "Log application" modal.
export const DEFAULTS = {
  "attachments.source_folder": config.defaultSourceFolder,
  "tracking.followup_days": "7",
  "tracking.default_applied_via": "company_site",
};

export function getSetting(key, fallback = null) {
  const row = get(`SELECT value FROM settings WHERE key = ?`, [key]);
  if (row) return row.value;
  return key in DEFAULTS ? DEFAULTS[key] : fallback;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)],
  );
}

export function getAllSettings() {
  const rows = all(`SELECT key, value FROM settings`);
  const merged = { ...DEFAULTS };
  for (const row of rows) merged[row.key] = row.value;
  return merged;
}
