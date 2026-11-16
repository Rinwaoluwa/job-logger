async function request(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const message = (isJson && body?.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

// `opts` may carry an AbortSignal ({ signal }) from useQuery.
function get(path, opts) {
  return request(path, opts);
}

function query(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.set(k, v);
  }
  const q = qs.toString();
  return q ? `?${q}` : "";
}
function post(path, data) {
  return request(path, { method: "POST", body: JSON.stringify(data ?? {}) });
}
function patch(path, data) {
  return request(path, { method: "PATCH", body: JSON.stringify(data ?? {}) });
}
function del(path) {
  return request(path, { method: "DELETE" });
}

export const api = {
  health: () => get("/health"),

  profile: () => get("/profile"),
  reloadProfile: () => post("/profile/reload"),

  listJobs: (params = {}, opts) => get(`/jobs${query(params)}`, opts),
  getJob: (id, opts) => get(`/jobs/${id}`, opts),
  addJobManual: (data) => post("/jobs/manual", data),
  patchJob: (id, data) => patch(`/jobs/${id}`, data),
  deleteJob: (id) => del(`/jobs/${id}`),
  hydrateJob: (id) => post(`/jobs/${id}/hydrate`),

  // Every generation below queues a background task and resolves at once
  // to { taskId, jobId, task, existing }. Follow it through the tasks
  // context (src/hooks/useTasks.jsx), never by waiting on the request.
  addJobFromLink: (url) => post("/jobs/from-link", { url }),

  // Résumés tab: a résumé from a title + skills, no posting. Resolves to
  // the started prepare task ({ taskId, jobId, task }).
  createBrief: (data) => post("/briefs", data),
  listBriefs: (opts) => get("/briefs", opts),
  runFit: (id, { queue } = {}) => post(`/jobs/${id}/fit`, { queue }),
  // The prep for one round, or the job's general prep without roundId.
  runInterviewPrep: (id, roundId) => post(`/jobs/${id}/interview-prep`, roundId ? { roundId } : {}),
  // One question card rewritten in place (queues an interview_prep_question task).
  regenerateInterviewQuestion: (id, index, note, interviewPrepId) =>
    post(`/jobs/${id}/interview-prep/questions/${index}/regenerate`, { ...(note ? { note } : {}), ...(interviewPrepId ? { interviewPrepId } : {}) }),

  // Interview rounds, debriefs, mock turns and the question bank
  // (server/routes/interviews.js).
  listInterviews: (opts) => get("/interviews", opts),
  createRound: (jobId, data) => post(`/jobs/${jobId}/rounds`, data),
  patchRound: (id, data) => patch(`/rounds/${id}`, data),
  deleteRound: (id) => del(`/rounds/${id}`),
  debriefRound: (id, data) => post(`/rounds/${id}/debrief`, data),
  listMockTurns: (jobId) => get(`/jobs/${jobId}/mock/turns`),
  // Resolves to { turn, taskId, task, existing }: the critique is a task.
  createMockTurn: (jobId, data) => post(`/jobs/${jobId}/mock/turns`, data),
  recritiqueMockTurn: (id) => post(`/mock/turns/${id}/critique`),
  deleteMockTurn: (id) => del(`/mock/turns/${id}`),
  bankMockTurn: (id, answer) => post(`/mock/turns/${id}/bank`, { answer }),
  listQuestionBank: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const q = qs.toString();
    return get(`/question-bank${q ? `?${q}` : ""}`);
  },
  createBankEntry: (data) => post("/question-bank", data),
  patchBankEntry: (id, data) => patch(`/question-bank/${id}`, data),
  deleteBankEntry: (id) => del(`/question-bank/${id}`),
  // { hints, buildOn }: hints are the applicant's free text; buildOn false
  // starts over instead of adding to the job's latest search.
  runPeopleSearch: (id, data) => post(`/jobs/${id}/people`, data),
  linkedInStatus: () => get("/people/linkedin"),
  checkLinkedIn: () => post("/people/linkedin/check"),
  connectLinkedIn: () => post("/people/linkedin/connect"),
  prepareApplication: (id, opts) => post(`/jobs/${id}/prepare`, opts),
  // A new cover letter version from the job's newest résumé (queues a cover_letter task).
  rewriteCoverLetter: (id) => post(`/jobs/${id}/cover-letter`),
  answer: (data) => post("/ai/answer", data),
  refreshSources: (only) => post("/sources/refresh", only ? { only } : {}),

  listTasks: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", params.limit);
    if (params.hours) qs.set("hours", params.hours);
    const q = qs.toString();
    return get(`/tasks${q ? `?${q}` : ""}`);
  },
  getTask: (id) => get(`/tasks/${id}`),
  cancelTask: (id) => post(`/tasks/${id}/cancel`),
  retryTask: (id) => post(`/tasks/${id}/retry`),
  cancelTaskGroup: (groupId) => post(`/tasks/group/${groupId}/cancel`),
  deleteTask: (id) => del(`/tasks/${id}`),
  deleteFailedTasks: () => del("/tasks/failed"),

  patchApplication: (jobId, data) => patch(`/applications/${jobId}`, data),

  // Sends from the People tab. The app never sends mail itself; a row is
  // logged when the Gmail compose window opens or the user says a LinkedIn
  // note went out.
  logOutreach: (jobId, data) => post(`/jobs/${jobId}/outreach`, data),
  patchOutreach: (id, data) => patch(`/outreach/${id}`, data),
  deleteOutreach: (id) => del(`/outreach/${id}`),
  // withJob deletes the job and everything cascading off it; without it,
  // only the application record and its history go.
  deleteApplication: (jobId, { withJob = false } = {}) =>
    del(`/applications/${jobId}${withJob ? "?job=true" : ""}`),

  listDocuments: (jobId, opts) => get(`/documents?jobId=${jobId}`, opts),
  getDocument: (id) => get(`/documents/${id}`),
  patchDocument: (id, data) => patch(`/documents/${id}`, data),
  deleteDocument: (id) => del(`/documents/${id}`),
  // A follow-up instruction on a résumé version: queues a revise_resume
  // task (same { taskId, jobId, task, existing } shape as the others).
  reviseDocument: (id, instruction) => post(`/documents/${id}/revise`, { instruction }),
  getDocumentThread: (id) => get(`/documents/${id}/thread`),

  sourcesStatus: () => get("/sources/status"),

  aiCalls: (limit = 100) => get(`/ai/calls?limit=${limit}`),
  aiCost: () => get("/ai/cost"),

  // Outcome analytics (server/db/repo/analytics.js). days: a number or "all".
  analytics: (params = {}, opts) => get(`/analytics${query(params)}`, opts),

  // Application tracking
  listApplications: (params = {}, opts) => get(`/applications${query(params)}`, opts),
  logApplication: (jobId, data) => post(`/applications/${jobId}/apply`, data),

  listAttachments: (jobId) => get(`/applications/${jobId}/attachments`),
  attachFromFolder: (jobId, data) => post(`/applications/${jobId}/attachments/from-folder`, data),
  attachFromPath: (jobId, data) => post(`/applications/${jobId}/attachments/from-path`, data),
  linkDocument: (jobId, data) => post(`/applications/${jobId}/attachments/link-document`, data),
  deleteAttachment: (id) => del(`/attachments/${id}`),
  revealAttachment: (id) => post(`/attachments/${id}/reveal`),

  sourceFolder: () => get("/attachments/source-folder"),
  revealSourceFolder: (name) => post("/attachments/source-folder/reveal", name ? { name } : {}),

  getSettings: () => get("/settings"),
  patchSettings: (data) => patch("/settings", data),
};
