import { Router } from "express";
import { getProfile, reloadProfile } from "../profile/loader.js";

export const router = Router();

// The Profile tab shows what the generator will actually draw on, so this
// returns the content itself and not only counts of it. Counts alone
// ("15/18 metrics usable") tell you a number is wrong but not which line
// to go and fix.
function summarize(profile) {
  const roles = profile.roles.map((r) => ({
    id: r.id,
    company: r.company,
    title: r.title,
    dates: r.dates,
    location: r.location,
    employmentType: r.employmentType,
    engagement: r.engagement,
    status: r.status,
    showOnResume: r.showOnResume,
    context: r.context,
    team: r.team,
    built: r.built,
    tech: r.tech,
    metrics: r.metrics,
    doNotClaim: r.doNotClaim,
    notes: r.notes,
    // The page shows each field as it was written (paragraph breaks
    // kept), not the blank-line-stripped copy the prompts get.
    stories: r.stories.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      competencies: s.competencies,
      situation: s.verbatim?.situation ?? s.situation,
      whatIDid: s.verbatim?.whatIDid ?? s.whatIDid,
      decisions: s.verbatim?.decisions ?? s.decisions,
      outcome: s.verbatim?.outcome ?? s.outcome,
      interviewVersion: s.verbatim?.interviewVersion ?? s.interviewVersion,
      metricIds: s.metricIds,
    })),
    // Kept alongside the content so the summary strip and the rail don't
    // each have to recount.
    storyCount: r.stories.length,
    draftCount: r.stories.filter((s) => s.status === "draft").length,
    verifiedMetricCount: r.metrics.filter((m) => m.verified).length,
    totalMetricCount: r.metrics.length,
  }));

  return {
    header: profile.facts.header,
    targets: profile.facts.targets,
    workAuth: profile.facts.workAuth,
    education: profile.facts.education,
    certifications: profile.facts.certifications,
    globalDoNotClaim: profile.facts.globalDoNotClaim,
    overlapExplanation: profile.facts.overlapExplanation,
    timeline: profile.facts.timeline,
    timelineNotes: profile.facts.timelineNotes || {},
    whyLooking: profile.facts.whyLooking,
    years: profile.facts.years,
    roles,
    skills: profile.skills,
    skillsDoNotClaim: profile.skillsDoNotClaim,
    behavioral: profile.behavioral,
    projects: profile.projects || [],
    skillsCount: profile.skills.length,
    behavioralCount: profile.behavioral.filter((s) => s.status !== "missing").length,
    behavioralTotal: profile.behavioral.length,
    warnings: profile.warnings,
  };
}

router.get("/profile", (_req, res) => {
  res.json(summarize(getProfile()));
});

router.post("/profile/reload", (_req, res) => {
  res.json(summarize(reloadProfile()));
});
