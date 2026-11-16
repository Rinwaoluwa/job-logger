// Single source of truth for application stages, shared by StageSelect,
// ApplicationPanel/StatusSection, JobFilters, and the Applications view —
// previously this array was duplicated in three client files and mirrored
// server-side in server/db/repo/applications.js.
export const STAGES = ["new", "saved", "applied", "interviewing", "offer", "rejected", "not_interested"];

export const STAGE_LABELS = {
  new: "New",
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  not_interested: "Not interested",
};

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || (stage || "").replace("_", " ");
}

const STAGE_CLASS = {
  new: "stage-new",
  saved: "stage-saved",
  applied: "stage-applied",
  interviewing: "stage-interviewing",
  offer: "stage-offer",
  rejected: "stage-rejected",
  not_interested: "stage-not_interested",
};

export function stageBadgeClass(stage) {
  return STAGE_CLASS[stage] || "stage-new";
}

export const APPLIED_VIA = ["company_site", "linkedin", "indeed", "referral", "email", "recruiter", "other"];

export const APPLIED_VIA_LABELS = {
  company_site: "Company site",
  linkedin: "LinkedIn",
  indeed: "Indeed",
  referral: "Referral",
  email: "Email",
  recruiter: "Recruiter",
  other: "Other",
};
