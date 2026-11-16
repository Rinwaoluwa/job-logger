import { resumePromptSection } from "../resumeContext.js";

// What the prep is allowed to do with the résumé. The letter and the
// answers are told to use the résumé's gap fills freely, because those
// go out under his name by his choice. An interview is different: he has
// to say these things out loud to someone who can ask a follow-up, so
// the fills are listed only to be prepared for, never spoken as fact.
export const RESUME_RULES_FOR_PREP = `HOW TO TREAT THE RÉSUMÉ IN THIS PREP: the résumé above is what the interviewer has read, so the pitch's title and years and every answer must agree with it. The "RÉSUMÉ CLAIMS NOT IN THE PROFILE" list (if present) is invented work the candidate chose to keep on the page. In this prep they are NOT facts: never use one in a draft_answer, a pitch, a talking point or the story_map as something he did. They appear only in resume_claims, one entry each, with an honest line that bridges from real experience in the profile and states his true hands-on depth. Invent nothing further anywhere.`;

export const ROUND_LABELS = {
  recruiter_screen: "recruiter screen",
  hiring_manager: "hiring-manager interview",
  technical: "technical interview",
  panel: "panel interview",
  coding: "coding assessment / live coding",
  other: "interview",
};

// What each kind of round asks, so the question mix follows the room
// rather than the posting alone.
const ROUND_GUIDANCE = {
  recruiter_screen: `This is a recruiter screen. 8-10 questions: the three pitch questions (as questions, so he can practise them), logistics (location and work mode, work eligibility, notice period, salary expectations — answered from CANDIDATE FACTS only; where the facts give no salary figure, the talking points say to decide the number, never invent one), motivation, and 2-3 light technical sanity checks a recruiter reads off a sheet. study_list: at most 2 entries.`,
  hiring_manager: `This is a hiring-manager interview. 10-14 questions: behavioral and role_specific are the majority; 2-3 technical at the depth a manager asks (approach, trade-offs, judgment, not syntax); 1-2 culture. Draft answers show ownership and outcomes.`,
  technical: `This is a technical interview. 10-14 questions: technical and system_design are at least two thirds; the rest role_specific. Every technical draft_answer is a real answer (see TECHNICAL ANSWERS). Behavioral is at most 2.`,
  panel: `This is a panel. 10-14 questions, an even mix across kinds. Where the interviewers' titles make it clear, say in why_asked who is likely to ask it.`,
  coding: `This is a coding assessment. 6-8 questions: how he approaches an unfamiliar problem, how he tests, trade-offs he reaches for, two behavioral warm-ups, and what he asks before writing code. The main output is study_list: 5-8 entries covering what the assessment is likely to exercise given the stack and the focus skills.`,
  other: `The round's format is not known. 10-14 questions across behavioral, technical, system_design, role_specific and culture.`,
};

const TECHNICAL_RULES = `TECHNICAL ANSWERS: a technical or system_design draft_answer is a real answer, not a scaffold. Draw its content from the Skills inventory, each role's "Technologies actually used" and the stories: name the library, the pattern and the trade-off he would actually cite, in the shape "what I'd do, why, what I'd watch for". 120-200 words, first person, spoken. "inferred" is true only when neither a story nor the inventory shows he has used the thing; then still give the best honest answer, opening with his true depth ("I haven't run that in production, but the approach is…"). Never use anything in "Do NOT claim skills" or a role's "Do NOT claim".`;

function fitSlice(fit) {
  if (!fit) return null;
  const { must_have_gaps, nice_to_have_gaps, red_flags, reasons_against, suggested_angle } = fit;
  return { must_have_gaps, nice_to_have_gaps, red_flags, reasons_against, suggested_angle };
}

function dateLine(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The round the prep is for, as prompt text. Empty when the prep is the
 * job's general one (no round recorded).
 * @param {object|null} round - interview_rounds row (deserialized)
 * @param {Array<{skill:string, proficiency:string, usedIn:string[], notes:string}>} focusSkills
 */
export function roundSection(round, focusSkills = []) {
  if (!round) return "";
  const lines = [`THE ROUND: ${ROUND_LABELS[round.kind] || round.kind}${round.scheduled_at ? ` on ${dateLine(round.scheduled_at)}` : ""}.`];
  if (round.interviewers?.length) {
    lines.push(`Interviewers (tailor questions_to_ask_them and culture questions to who is in the room):`);
    for (const p of round.interviewers) lines.push(`- ${p.name}${p.title ? ` — ${p.title}` : ""}`);
  }
  if (round.notes) lines.push(`What the recruiter / invitation said about this round:\n${round.notes}`);
  if (focusSkills.length) {
    lines.push(`FOCUS SKILLS (chosen by the candidate for this round; proficiency from his inventory — a "working" or "familiar" one gets a question he can answer honestly at that depth AND a study_list entry):`);
    for (const s of focusSkills) lines.push(`- ${s.skill} — ${s.proficiency}${s.usedIn?.length ? ` (used in: ${s.usedIn.join(", ")})` : ""}${s.notes ? ` — ${s.notes}` : ""}`);
  }
  if (round.focus_text) lines.push(`OTHER FOCUS (his words; at least one question each):\n${round.focus_text}`);
  lines.push(`Every focus skill and focus item is covered by at least one question.`);
  lines.push(ROUND_GUIDANCE[round.kind] || ROUND_GUIDANCE.other);
  return lines.join("\n");
}

/**
 * Questions he has actually been asked, with his own answers where he
 * wrote one. Empty when the bank has nothing relevant.
 * @param {Array} bank - question_bank rows (deserialized)
 */
export function bankSection(bank = []) {
  if (!bank.length) return "";
  const lines = [`QUESTIONS HE HAS BEEN ASKED BEFORE (the question bank; "his answer" is in his own words and already rehearsed):`];
  for (const b of bank) {
    const where = [b.company, b.round_kind ? ROUND_LABELS[b.round_kind] || b.round_kind : null].filter(Boolean).join(", ");
    lines.push(`- [${b.kind || "unknown kind"}] ${b.question}${b.times_asked > 1 ? ` (asked ${b.times_asked} times)` : ""}${where ? ` — at ${where}` : ""}${b.my_answer ? `\n  his answer: ${b.my_answer}` : ""}${b.notes ? `\n  note: ${b.notes}` : ""}`);
  }
  lines.push(`Where a bank question fits this round, include it (or its close variant) with from_bank true and base its draft_answer on his answer: tighten it, keep its substance and voice, never contradict it or add facts. Every other question has from_bank false.`);
  return lines.join("\n");
}

/**
 * @param {object} p
 * @param {string} p.jobTitle
 * @param {string} p.jobCompany
 * @param {object} p.jdAnalysis
 * @param {object|null} p.fit - the fit analysis result_json
 * @param {string} p.profileFullText - profileFull() with spoken versions
 * @param {string} p.whyLookingText - facts.whyLooking, or ""
 * @param {object|null} p.resume - resumeContext() of the sent résumé, or null
 * @param {object|null} p.startingMap - buildStoryMap() from the résumé plan, or null
 * @param {object|null} p.round - the interview round, or null for the general prep
 * @param {Array} p.focusSkills - the round's focus skills resolved from the inventory
 * @param {Array} p.bank - question-bank rows worth showing
 */
export function interviewPrepPrompt({ jobTitle, jobCompany, jdAnalysis, fit, profileFullText, whyLookingText, resume, startingMap, round = null, focusSkills = [], bank = [] }) {
  const fitPart = fitSlice(fit);
  const roundText = roundSection(round, focusSkills);
  const bankText = bankSection(bank);
  const technicalRound = round && (round.kind === "technical" || round.kind === "coding");
  return `Prepare this candidate for ${round ? `a ${ROUND_LABELS[round.kind] || "round"}` : "an interview"} at ${jobCompany} for the role "${jobTitle}". This is private preparation he reads himself: first person, spoken register, specific. Everything he will say must be true to the CANDIDATE PROFILE.

JOB ANALYSIS:
${JSON.stringify(jdAnalysis, null, 2)}
${fitPart ? `\nFIT ANALYSIS (known gaps and concerns to prepare for):\n${JSON.stringify(fitPart, null, 2)}\n` : ""}
${roundText ? `${roundText}\n` : "No round has been recorded: prepare for the interview as a whole, 10-14 questions across behavioral, technical, system_design, role_specific and culture.\n"}
${resume ? `${resumePromptSection(resume)}\n\n${RESUME_RULES_FOR_PREP}\n` : "No résumé has been written for this job yet; work from the profile alone, and leave resume_claims empty.\n"}
${startingMap ? `STARTING STORY MAP (from the plan the résumé was written to — which profile stories answer each posting item, and how well):\n${JSON.stringify(startingMap.items, null, 2)}\nKeep every jd_item in it. You may re-rank the stories, change a strength only where the profile shows it is wrong, add a responsibility that implies distinct work, and must add an "angle" to every story: one sentence on what to emphasise from that story for this item.\n` : ""}
${bankText ? `${bankText}\n` : ""}
CANDIDATE PROFILE (the only source of facts; "How he tells it" is his own spoken version of a story):
${profileFullText}
${whyLookingText ? `\nWHY LOOKING / WHAT NEXT (his framing, in his words; use it for why_leaving_current and the end of about_me):\n${whyLookingText}\n` : ""}
${TECHNICAL_RULES}

Produce every section below.

story_map — one item per must-have in the job analysis (all of them), plus each responsibility that implies distinct work, merged where two say the same thing; at most 25. For each: kind, critical (as the analysis marks it), strength (strong: a verified story shows exactly this; partial: adjacent or thinner; none: nothing in the profile), up to 3 stories strongest first, each with an "angle". For partial and none, "if_asked": the honest one-liner to open with if it comes up, bridging from the nearest real experience; null for strong.

questions — likely questions for this round (count and mix as THE ROUND says; 10-14 across kinds when there is no round), built from the must-haves, responsibilities, the focus and the bank. Every behavioral and role_specific question cites at least one story id from a strong or partial story_map item. draft_answer: 100-170 words (technical: 120-200), first person, spoken, built on the story's "How he tells it" where one exists, with the outcome stated plainly. talking_points: the 2-5 things to hit however the question is phrased. "inferred": true only when no story and no inventory entry supports it; then the draft is still the best honest answer. from_bank as the bank section says (false when there is no bank).

pitch — three spoken answers, each with its beats and the story ids it draws on:
- about_me: ${technicalRound ? "100-150 words (45-60 seconds), leading with the stack and the systems he owns" : "150-220 words (60-90 seconds)"}. Open with the title and years as the résumé states them, then two or three areas of practice with one concrete example each from the profile, and close on why this role, in his words from WHY LOOKING.
- why_this_role: 80-130 words, from what the job analysis says the product, team and stack are; do not assert anything about the company that is not in the job analysis — put any such line in inferred_claims with a reason.
- why_leaving_current: 60-110 words, the substance of WHY LOOKING and nothing more: no new reasons, nothing negative about the current employer or its client, never implying the role was temporary.

gap_defenses — one per must_have_gaps entry in the fit analysis and one per story_map item with strength "none", deduplicated by requirement. honest_line: the one sentence of truth to say first, no hedging and no new claim. bridge: how to get from the nearest real experience (bridge_story_id) to the requirement. severity from the fit analysis where it has one, else null.

resume_claims — one entry per line in RÉSUMÉ CLAIMS NOT IN THE PROFILE, in the order given, "claim" copied verbatim and "reason" copied verbatim. depth: his true depth on that claim given the profile (did_it: a profile story supports it as done; set_it_up: he did adjacent setup or a part of it; know_the_approach: he knows how it is done but has not done it). honest_line: what to say if probed, which never asserts the claim as done work unless depth is did_it. probe_questions: up to 3 follow-ups an interviewer would ask about that claim. nearest_real_story_id: the real story to steer toward.

watch_outs — 4-10 entries: the things that would hurt if said. Deleted or unverified numbers and metrics marked not for the résumé; "Do NOT claim" items the posting tempts him toward; the employment-overlap framing; each résumé gap fill (never to be asserted as done); any red flag in the fit analysis. text: the rule as one imperative line ("Don't quote the 45-to-10-minute release time"). why: one line.

top_stories — the 3-6 stories to have ready for this round: the ones the story_map and questions lean on most, strongest first. lead_with: the one sentence to open that story with in this interview.

study_list — what to brush up before this round (count as THE ROUND says; 0-6 otherwise). Every focus skill at "working" or "familiar" gets an entry. topic; why (which question or requirement it serves); what_to_review (concrete: the API, the pattern, the pitfalls, the comparison he will be asked for); depth: refresh (he has done it, needs the vocabulary back) or learn (he has not done it in earnest).

questions_to_ask_them — 4-6 questions about the team, product and role, based on what the job description does and does not say${round?.interviewers?.length ? ", aimed at the people in the room" : ""}.

prep_notes — anything else worth flagging: a story that needs practising, a clarification to ask early, a concern from the fit analysis to raise or wait for. Do not repeat watch_outs here.`;
}

/**
 * One question card rewritten in place. The profile and résumé context
 * are the same as the full run so the new card follows the same rules.
 */
export function interviewQuestionPrompt({ jobTitle, jobCompany, jdAnalysis, existing, otherQuestions, note, profileFullText, resume, round = null, focusSkills = [], bank = [] }) {
  const slice = {
    must_haves: jdAnalysis?.must_haves,
    responsibilities: jdAnalysis?.responsibilities,
    product_summary: jdAnalysis?.product_summary,
  };
  const roundText = roundSection(round, focusSkills);
  const bankText = bankSection(bank);
  return `Rewrite one interview-prep question for the candidate's ${round ? ROUND_LABELS[round.kind] || "interview" : "interview"} at ${jobCompany} for the role "${jobTitle}". Return a single question object.

JOB (the relevant part of the analysis):
${JSON.stringify(slice, null, 2)}
${roundText ? `\n${roundText}\n` : ""}
THE CARD TO REWRITE:
${JSON.stringify(existing, null, 2)}
${note ? `\nWHAT THE CANDIDATE WANTS CHANGED: ${note}\n` : "\nWrite a different, equally likely question of the same kind, or the same question with a stronger draft answer — whichever the card most needs.\n"}
OTHER QUESTIONS ALREADY IN THE PREP (do not duplicate these):
${(otherQuestions || []).map((q) => `- ${q}`).join("\n")}
${bankText ? `\n${bankText}\n` : ""}
${resume ? `\n${resumePromptSection(resume)}\n\n${RESUME_RULES_FOR_PREP}\n` : ""}
CANDIDATE PROFILE (the only source of facts; "How he tells it" is his own spoken version of a story):
${profileFullText}

${TECHNICAL_RULES}

Rules: keep the same "kind" unless the note asks otherwise. A behavioral or role_specific question cites at least one real story id. draft_answer: 100-170 words (technical: 120-200), first person, spoken, built on the story's "How he tells it" where one exists. talking_points: 2-5. "inferred": true only when no story and no inventory entry supports it. from_bank: true only when the question comes from the bank section.`;
}
