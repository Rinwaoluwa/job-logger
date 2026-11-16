// Vocabulary shared by the server's task worker and the browser's activity
// panel, so a status or stage name can never drift between the two.

export const TASK_KINDS = ["prepare_application", "revise_resume", "cover_letter", "interview_prep", "interview_prep_question", "mock_critique", "answer", "fit", "add_job_link", "sources_refresh", "people"];
export const TASK_STATUSES = ["queued", "running", "done", "failed", "cancelled"];
export const ACTIVE_STATUSES = ["queued", "running"];

// Higher runs first. A task the user clicked for outranks the bulk fit
// scoring a source refresh queues up behind it.
export const PRIORITY = { user: 10, background: 0 };

export const KIND_LABELS = {
  prepare_application: "Prepare application",
  revise_resume: "Revise résumé",
  cover_letter: "Rewrite cover letter",
  interview_prep: "Interview prep",
  interview_prep_question: "Rewrite interview question",
  mock_critique: "Mock answer critique",
  answer: "Application answer",
  fit: "Fit analysis",
  add_job_link: "Add job by link",
  sources_refresh: "Refresh sources",
  people: "Find people",
};

export const STAGE_LABELS = {
  jd_analysis: "Analyzing job description",
  story_selection: "Selecting relevant stories",
  resume_write: "Writing résumé",
  resume_revise: "Applying your instructions",
  verify_lint: "Checking traceability & style",
  page_fit: "Measuring page length",
  resume_review: "Checking claims against the profile",
  resume_rewrite: "Rewriting flagged bullets",
  cover_letter: "Writing cover letter",
  cover_letter_context: "Preparing cover letter context",
  cover_letter_rewrite: "Polishing cover letter",
  fit: "Scoring fit",
  interview_prep: "Preparing interview plan",
  interview_prep_question: "Rewriting one question",
  mock_critique: "Critiquing your answer",
  answer_write: "Writing answer",
  job_fetch: "Fetching posting",
  job_extract: "Extracting job details",
  linkedin_check: "Checking LinkedIn sign-in",
  people_search: "Searching for people",
  people_outreach: "Drafting outreach",
};

export const isActive = (task) => !!task && ACTIVE_STATUSES.includes(task.status);
export const isTerminal = (task) => !!task && !ACTIVE_STATUSES.includes(task.status);
