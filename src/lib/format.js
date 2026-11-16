// dateOnly() never constructs a Date object for display purposes, so it
// can't suffer the old app's UTC-shift bug (toISOString().slice(0,10) on
// a Date shifts a local evening timestamp to "tomorrow" in UTC).
export function dateOnly(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(iso).slice(0, 10);
}

export function money(n) {
  if (n == null) return "";
  return `$${Number(n).toLocaleString()}`;
}

export function costUsd(n) {
  if (n == null) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

// Local-date helpers for the tracking feature (applied_at / next_action_at
// are stored as plain 'YYYY-MM-DD' local dates, never Date objects — see
// dateOnly()'s comment above for why this file avoids the Date/UTC pitfall).
export function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const pad = (v) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function daysSince(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86400000);
}

export function fileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
