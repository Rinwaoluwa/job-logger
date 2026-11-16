// Outcome analytics over the application history: the funnel, how often
// and how fast applications get a response, what that looks like by
// channel, source and résumé version, which applications have gone
// quiet, and what the AI spend bought. The sample is small (tens of
// applications), so every rate comes with its numerator and denominator
// and the view says so; nothing here is smoothed.
//
// Dates: application_events.at, outreach.*_at and ai_calls.created_at
// are UTC "YYYY-MM-DD HH:MM:SS"; applications.applied_at is a local
// "YYYY-MM-DD". Day arithmetic between the two is therefore ±1 day.

import { all } from "../index.js";
import { getSetting } from "./settings.js";

const DAY_MS = 86_400_000;
const RESPONSE_STAGES = new Set(["interviewing", "offer", "rejected"]);
const INTERVIEW_STAGES = new Set(["interviewing", "offer"]);

const toDate = (s) => (s ? new Date(String(s).length === 10 ? `${s}T00:00:00` : `${String(s).replace(" ", "T")}Z`) : null);
const dayDiff = (a, b) => (a && b ? (a.getTime() - b.getTime()) / DAY_MS : null);
const ymd = (d) => d.toISOString().slice(0, 10);
const rate = (num, den) => ({ num, den, rate: den > 0 ? num / den : null });

/** Monday of the week holding `d`, as YYYY-MM-DD (UTC). */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return ymd(x);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** "Gap fill:" entries and any "Reframed:" entry on a stored résumé. */
function resumeShape(contentJson) {
  let doc;
  try { doc = JSON.parse(contentJson); } catch { return null; }
  const additions = doc?.additions_to_review || [];
  const fills = additions.filter((a) => /^Gap fill:/.test(String(a.reason || ""))).length;
  const reframed = additions.some((a) => /^Reframed:/.test(String(a.reason || "")));
  return { fills, reframed, matchScore: Number.isFinite(doc?.match_score) ? doc.match_score : null };
}

/**
 * @param {{days?: number|null, stalledDays?: number|null}} [opts] - days: the
 *   window, by applied_at (null = everything); stalledDays: quiet-for
 *   threshold, default the follow-up setting with a floor of 14
 */
export function analytics({ days = 90, stalledDays = null } = {}) {
  const now = new Date();
  const since = days ? ymd(new Date(now.getTime() - days * DAY_MS)) : null;
  const sinceTs = since ? `${since} 00:00:00` : null;
  const quietAfter = Math.max(14, stalledDays ?? (Number(getSetting("tracking.followup_days", 7)) || 14));

  // Applications in the window: anything with an applied date, real jobs
  // only, not archived.
  const apps = all(
    `SELECT a.job_id, a.stage, a.applied_at, a.applied_via, a.next_action, a.next_action_at,
            a.sent_resume_document_id, j.company, j.title, j.source
       FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.applied_at IS NOT NULL AND a.archived_at IS NULL AND j.source != 'brief'
        ${since ? "AND a.applied_at >= ?" : ""}
      ORDER BY a.applied_at`,
    since ? [since] : [],
  );
  const jobIds = apps.map((a) => a.job_id);
  const inList = jobIds.length ? `(${jobIds.map(() => "?").join(",")})` : "(NULL)";

  const events = all(`SELECT job_id, from_stage, to_stage, at FROM application_events WHERE job_id IN ${inList} ORDER BY at`, jobIds);
  const outreachRows = all(`SELECT job_id, channel, status, sent_at, updated_at FROM outreach WHERE job_id IN ${inList}`, jobIds);
  const docIds = apps.map((a) => a.sent_resume_document_id).filter(Boolean);
  const docs = docIds.length
    ? all(`SELECT id, content_json FROM documents WHERE id IN (${docIds.map(() => "?").join(",")})`, docIds)
    : [];
  const shapeById = new Map(docs.map((d) => [d.id, resumeShape(d.content_json)]));

  const eventsByJob = new Map();
  for (const e of events) {
    if (!eventsByJob.has(e.job_id)) eventsByJob.set(e.job_id, []);
    eventsByJob.get(e.job_id).push(e);
  }
  const outreachByJob = new Map();
  for (const o of outreachRows) {
    if (!outreachByJob.has(o.job_id)) outreachByJob.set(o.job_id, []);
    outreachByJob.get(o.job_id).push(o);
  }

  // Per application: the stages it reached and its first response.
  const rows = apps.map((a) => {
    const appliedAt = toDate(a.applied_at);
    const evs = eventsByJob.get(a.job_id) || [];
    const appliedEvent = evs.find((e) => e.to_stage === "applied");
    const after = appliedEvent ? toDate(appliedEvent.at) : appliedAt;
    const reached = new Set(evs.map((e) => e.to_stage));
    reached.add(a.stage);
    let first = null;
    for (const e of evs) {
      if (!RESPONSE_STAGES.has(e.to_stage)) continue;
      const at = toDate(e.at);
      if (after && at < after) continue;
      if (!first || at < first) first = at;
    }
    for (const o of outreachByJob.get(a.job_id) || []) {
      if (o.status !== "replied") continue;
      const at = toDate(o.updated_at || o.sent_at);
      if (at && (!first || at < first)) first = at;
    }
    const lastEvent = evs.length ? evs[evs.length - 1] : null;
    return {
      jobId: a.job_id,
      company: a.company,
      title: a.title,
      source: a.source,
      stage: a.stage,
      appliedVia: a.applied_via || "unknown",
      appliedAt: a.applied_at,
      appliedDate: appliedAt,
      nextAction: a.next_action,
      nextActionAt: a.next_action_at,
      interviewed: [...reached].some((s) => INTERVIEW_STAGES.has(s)),
      offered: reached.has("offer"),
      rejected: reached.has("rejected"),
      responded: !!first,
      firstResponse: first,
      daysToResponse: first ? Math.max(0, dayDiff(first, appliedAt)) : null,
      daysSinceApplied: appliedAt ? Math.floor(dayDiff(now, appliedAt)) : null,
      lastEventAt: lastEvent?.at || null,
      outreachSent: (outreachByJob.get(a.job_id) || []).length,
      resume: a.sent_resume_document_id ? shapeById.get(a.sent_resume_document_id) || null : null,
    };
  });

  const applied = rows.length;
  const interviewing = rows.filter((r) => r.interviewed).length;
  const offers = rows.filter((r) => r.offered).length;
  const rejected = rows.filter((r) => r.rejected).length;
  const responded = rows.filter((r) => r.responded).length;
  const open = rows.filter((r) => r.stage === "applied" || r.stage === "interviewing").length;
  const responseDays = rows.filter((r) => r.daysToResponse != null).map((r) => r.daysToResponse).sort((a, b) => a - b);

  const group = (key) => {
    const map = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!map.has(k)) map.set(k, { key: k, applied: 0, responded: 0, interviews: 0, offers: 0 });
      const g = map.get(k);
      g.applied++;
      if (r.responded) g.responded++;
      if (r.interviewed) g.interviews++;
      if (r.offered) g.offers++;
    }
    return [...map.values()].map((g) => ({ ...g, rate: rate(g.responded, g.applied) })).sort((a, b) => b.applied - a.applied);
  };

  // Weekly buckets from the first application in the window to this week.
  const weekly = [];
  if (rows.length) {
    const first = rows[0].appliedDate;
    const start = weekStart(first < now ? first : now);
    const byWeek = new Map();
    for (let d = new Date(`${start}T00:00:00Z`); d <= now; d.setUTCDate(d.getUTCDate() + 7)) {
      byWeek.set(ymd(d), { weekStart: ymd(d), applied: 0, responses: 0, interviews: 0, outreachSent: 0, outreachReplied: 0 });
    }
    const bump = (date, field) => {
      if (!date) return;
      const w = byWeek.get(weekStart(date));
      if (w) w[field]++;
    };
    for (const r of rows) {
      bump(r.appliedDate, "applied");
      bump(r.firstResponse, "responses");
    }
    for (const r of rows) {
      for (const e of eventsByJob.get(r.jobId) || []) if (e.to_stage === "interviewing") bump(toDate(e.at), "interviews");
    }
    for (const o of outreachRows) {
      bump(toDate(o.sent_at), "outreachSent");
      if (o.status === "replied") bump(toDate(o.updated_at || o.sent_at), "outreachReplied");
    }
    weekly.push(...[...byWeek.values()].slice(-53));
  }

  // Quiet applications: applied, no response, older than the threshold.
  // Not limited to the window: silence is about now.
  const stalledRows = since
    ? all(
      `SELECT a.job_id, a.stage, a.applied_at, a.next_action, a.next_action_at, j.company, j.title
         FROM applications a JOIN jobs j ON j.id = a.job_id
        WHERE a.stage = 'applied' AND a.applied_at IS NOT NULL AND a.archived_at IS NULL AND j.source != 'brief'`,
    )
    : rows.filter((r) => r.stage === "applied").map((r) => ({ job_id: r.jobId, stage: r.stage, applied_at: r.appliedAt, next_action: r.nextAction, next_action_at: r.nextActionAt, company: r.company, title: r.title }));
  const stalledIds = stalledRows.map((r) => r.job_id);
  const stalledIn = stalledIds.length ? `(${stalledIds.map(() => "?").join(",")})` : "(NULL)";
  const stalledEvents = since ? all(`SELECT job_id, to_stage, at FROM application_events WHERE job_id IN ${stalledIn} ORDER BY at`, stalledIds) : events;
  const stalledOutreach = since ? all(`SELECT job_id, status, sent_at, updated_at FROM outreach WHERE job_id IN ${stalledIn}`, stalledIds) : outreachRows;
  const stalled = stalledRows
    .map((r) => {
      const appliedAt = toDate(r.applied_at);
      const evs = stalledEvents.filter((e) => e.job_id === r.job_id);
      const appliedEvent = evs.find((e) => e.to_stage === "applied");
      const after = appliedEvent ? toDate(appliedEvent.at) : appliedAt;
      const answered = evs.some((e) => RESPONSE_STAGES.has(e.to_stage) && toDate(e.at) >= after)
        || stalledOutreach.some((o) => o.job_id === r.job_id && o.status === "replied");
      const lastEvent = evs.length ? evs[evs.length - 1].at : null;
      return {
        jobId: r.job_id,
        company: r.company,
        title: r.title,
        appliedAt: r.applied_at,
        daysSinceApplied: Math.floor(dayDiff(now, appliedAt)),
        nextAction: r.next_action,
        nextActionAt: r.next_action_at,
        lastEventAt: lastEvent,
        outreachSent: stalledOutreach.filter((o) => o.job_id === r.job_id).length,
        answered,
      };
    })
    .filter((r) => !r.answered && r.daysSinceApplied >= quietAfter)
    .map(({ answered: _a, ...r }) => r)
    .sort((a, b) => b.daysSinceApplied - a.daysSinceApplied);

  // Résumé effectiveness by the shape of the version that was sent.
  const resumeGroups = new Map([
    ["no_fills", { key: "no_fills", label: "No gap fills", applications: 0, responded: 0, interviews: 0, matchScores: [] }],
    ["fills", { key: "fills", label: "With gap fills", applications: 0, responded: 0, interviews: 0, matchScores: [] }],
    ["reframed", { key: "reframed", label: "Reframed stack", applications: 0, responded: 0, interviews: 0, matchScores: [] }],
    ["unknown", { key: "unknown", label: "No sent version recorded", applications: 0, responded: 0, interviews: 0, matchScores: [] }],
  ]);
  for (const r of rows) {
    const k = !r.resume ? "unknown" : r.resume.reframed ? "reframed" : r.resume.fills > 0 ? "fills" : "no_fills";
    const g = resumeGroups.get(k);
    g.applications++;
    if (r.responded) g.responded++;
    if (r.interviewed) g.interviews++;
    if (r.resume?.matchScore != null) g.matchScores.push(r.resume.matchScore);
  }
  const resumeEffectiveness = [...resumeGroups.values()].map(({ matchScores, ...g }) => ({
    ...g,
    rate: rate(g.responded, g.applications),
    avgMatchScore: matchScores.length ? Math.round(matchScores.reduce((s, v) => s + v, 0) / matchScores.length) : null,
  }));

  // Outreach in the window, by when it was sent.
  const outreachWindow = all(
    `SELECT o.channel, o.status FROM outreach o JOIN jobs j ON j.id = o.job_id
      WHERE j.source != 'brief' ${sinceTs ? "AND o.sent_at >= ?" : ""}`,
    sinceTs ? [sinceTs] : [],
  );
  const outreachSent = outreachWindow.length;
  const outreachReplied = outreachWindow.filter((o) => o.status === "replied").length;
  const byChannel = new Map();
  for (const o of outreachWindow) {
    const c = byChannel.get(o.channel) || { channel: o.channel, sent: 0, replied: 0 };
    c.sent++;
    if (o.status === "replied") c.replied++;
    byChannel.set(o.channel, c);
  }

  // AI spend in the window, and per application / interview for the
  // applications in it (calls tied to those jobs, whenever they ran).
  const costTotal = all(
    `SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS calls FROM ai_calls ${sinceTs ? "WHERE created_at >= ?" : ""}`,
    sinceTs ? [sinceTs] : [],
  )[0];
  const costForApps = jobIds.length
    ? all(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_calls WHERE job_id IN ${inList}`, jobIds)[0].usd
    : 0;
  const byPurpose = all(
    `SELECT CASE WHEN instr(purpose, ':') > 0 THEN substr(purpose, 1, instr(purpose, ':') - 1) ELSE purpose END AS purpose,
            COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS usd,
            AVG(duration_ms) AS avg_ms, AVG(output_tokens) AS avg_output_tokens
       FROM ai_calls ${sinceTs ? "WHERE created_at >= ?" : ""}
      GROUP BY 1 ORDER BY usd DESC LIMIT 12`,
    sinceTs ? [sinceTs] : [],
  ).map((r) => ({
    purpose: r.purpose,
    calls: r.calls,
    usd: r.usd,
    avgSeconds: r.avg_ms != null ? Math.round(r.avg_ms / 1000) : null,
    avgOutputTokens: r.avg_output_tokens != null ? Math.round(r.avg_output_tokens) : null,
  }));

  return {
    range: { days: days || null, since, stalledDays: quietAfter },
    counts: { applied, responded, interviewing, offers, rejected, open, outreachSent, withSentResume: rows.filter((r) => r.resume).length },
    funnel: {
      reached: { applied, interviewing, offer: offers, rejected },
      open,
      rates: {
        applied_to_interview: rate(interviewing, applied),
        interview_to_offer: rate(offers, interviewing),
        applied_to_offer: rate(offers, applied),
      },
    },
    response: {
      applied,
      responded,
      rate: rate(responded, applied),
      medianDays: quantile(responseDays, 0.5),
      p75Days: quantile(responseDays, 0.75),
    },
    byAppliedVia: group((r) => r.appliedVia),
    bySource: group((r) => r.source),
    weekly,
    stalled,
    resumeEffectiveness,
    outreach: {
      sent: outreachSent,
      replied: outreachReplied,
      noResponse: outreachWindow.filter((o) => o.status === "no_response").length,
      rate: rate(outreachReplied, outreachSent),
      byChannel: [...byChannel.values()],
    },
    cost: {
      totalUsd: costTotal.usd,
      calls: costTotal.calls,
      forApplicationsUsd: costForApps,
      perApplicationUsd: applied ? costForApps / applied : null,
      perInterviewUsd: interviewing ? costForApps / interviewing : null,
      byPurpose,
    },
  };
}
