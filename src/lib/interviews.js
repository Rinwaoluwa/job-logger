// Vocabulary for the Interview tab and the question bank. The server's
// enums live in server/db/repo/interviewRounds.js and routes/interviews.js.

export const ROUND_KINDS = ["recruiter_screen", "hiring_manager", "technical", "panel", "coding", "other"];
export const ROUND_LABELS = {
  recruiter_screen: "Recruiter screen",
  hiring_manager: "Hiring manager",
  technical: "Technical",
  panel: "Panel",
  coding: "Coding assessment",
  other: "Interview",
};
export const QUESTION_KINDS = ["behavioral", "technical", "system_design", "role_specific", "culture"];
export const QUESTION_KIND_LABELS = {
  behavioral: "behavioral",
  technical: "technical",
  system_design: "system design",
  role_specific: "role-specific",
  culture: "culture",
};

/** "Oct 20, 2:00 PM" from a datetime-local string or ISO; "" when unset. */
export function whenLabel(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const hasTime = /T\d{2}:\d{2}/.test(String(value));
  return d.toLocaleString(undefined, hasTime ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
}

export function roundTitle(round) {
  if (!round) return "General";
  const when = whenLabel(round.scheduled_at);
  return `${ROUND_LABELS[round.kind] || round.kind}${when ? ` · ${when}` : ""}`;
}

/** A prep written before the round's focus or notes last changed. */
export function prepStaleForRound(prep, round) {
  if (!prep || !round) return false;
  const at = prep.result_json?.round_updated_at;
  return !!at && !!round.updated_at && round.updated_at > at;
}

export const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
