// The Interviews page's place in the URL, like src/lib/profileHash.js:
//
//   #/interviews                          the list
//   #/interviews/<jobId>                  a job, on its default round
//   #/interviews/<jobId>/round/<roundId>  one round
//   #/interviews/<jobId>/general          the job's general prep
//   …?mock=1                              open the mock interview on load

export const INTERVIEWS_HASH_PREFIX = "#/interviews";

export function isInterviewsHash(hash = typeof location !== "undefined" ? location.hash : "") {
  return String(hash || "").startsWith(INTERVIEWS_HASH_PREFIX);
}

/** @returns {null | {jobId?: string, roundId?: number|"general", mock?: boolean}} */
export function parseInterviewsHash(hash) {
  if (!isInterviewsHash(hash)) return null;
  const rest = hash.slice(INTERVIEWS_HASH_PREFIX.length);
  const [path, query = ""] = rest.split("?");
  const parts = path.split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const params = new URLSearchParams(query);
  const sel = {};
  if (parts[0]) sel.jobId = parts[0];
  if (parts[1] === "round" && parts[2] && /^\d+$/.test(parts[2])) sel.roundId = Number(parts[2]);
  else if (parts[1] === "general") sel.roundId = "general";
  if (params.get("mock") === "1") sel.mock = true;
  return sel;
}

export function toInterviewsHash(sel) {
  const enc = encodeURIComponent;
  if (!sel?.jobId) return INTERVIEWS_HASH_PREFIX;
  let h = `${INTERVIEWS_HASH_PREFIX}/${enc(sel.jobId)}`;
  if (sel.roundId === "general") h += "/general";
  else if (Number.isInteger(sel.roundId)) h += `/round/${sel.roundId}`;
  if (sel.mock) h += "?mock=1";
  return h;
}
