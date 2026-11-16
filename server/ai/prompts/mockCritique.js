import { ROUND_LABELS, RESUME_RULES_FOR_PREP } from "./interviewPrep.js";

/**
 * One mock-interview answer, judged against the prep's card and the
 * stories behind it. The whole profile is not sent: the cited stories
 * (and the do-not-claim lists) are the facts that matter for one answer.
 * @param {object} p
 * @param {string} p.jobTitle
 * @param {string} p.jobCompany
 * @param {string|null} p.roundKind
 * @param {object} p.turn - the mock_turns row (question, answer, via, seconds)
 * @param {object|null} p.card - the prep's question card, if the turn came from one
 * @param {object|null} p.parent - the parent turn when this answers a follow-up
 * @param {string} p.storiesText - the cited stories rendered for the prompt
 * @param {string} p.doNotClaimText - global + role + skill do-not-claim lines
 * @param {Array} p.watchOuts - the prep's watch_outs
 * @param {Array} p.gapFills - the résumé's gap fills [{text, reason}]
 */
export function mockCritiquePrompt({ jobTitle, jobCompany, roundKind, turn, card, parent, storiesText, doNotClaimText, watchOuts = [], gapFills = [] }) {
  const isBehavioral = (card?.kind || turn.kind) === "behavioral";
  return `Judge one mock-interview answer. The candidate is practising for ${roundKind ? `the ${ROUND_LABELS[roundKind] || roundKind}` : "an interview"} at ${jobCompany} for the role "${jobTitle}". He reads this himself: second person ("you"), direct, specific, no praise padding.

${parent ? `THIS IS A FOLLOW-UP. The interviewer first asked: "${parent.question}"\nHe answered: """${parent.answer}"""\nThe follow-up now being answered:` : "THE QUESTION"} (${card?.kind || turn.kind || "unknown kind"}): ${turn.question}
${card?.why_asked ? `WHY IT IS ASKED: ${card.why_asked}\n` : ""}${card?.talking_points?.length ? `WHAT A GOOD ANSWER HITS (talking points):\n${card.talking_points.map((t) => `- ${t}`).join("\n")}\n` : ""}${card?.draft_answer ? `THE PREP'S DRAFT ANSWER (a reference, not the standard — his own words that hit the points are better):\n${card.draft_answer}\n` : ""}
THE STORIES THE ANSWER SHOULD DRAW ON (the only facts; "How he tells it" is his spoken version):
${storiesText || "(no story is linked to this question — judge the answer on structure and on the do-not-claim lists)"}

DO NOT CLAIM (from his profile):
${doNotClaimText || "(nothing listed)"}
${watchOuts.length ? `\nWATCH-OUTS FOR THIS INTERVIEW (things he must not say):\n${watchOuts.map((w) => `- ${w.text}${w.why ? ` (${w.why})` : ""}`).join("\n")}\n` : ""}${gapFills.length ? `\nRÉSUMÉ CLAIMS NOT IN THE PROFILE (on his résumé by his choice; he must never assert one as done work):\n${gapFills.map((g) => `- ${g.text}`).join("\n")}\n${RESUME_RULES_FOR_PREP}\n` : ""}
HIS ANSWER (${turn.via === "voice" ? "spoken, transcribed" : "typed"}${turn.seconds ? `, ${turn.seconds} seconds` : ""}):
"""
${turn.answer}
"""

Return the critique object:
- score 1-5. 5: hits every talking point, outcome stated plainly, specific, right length, nothing risky. 4: one point thin or slightly long. 3: the substance is there but a point is missing or it rambles. 2: vague, generic, or the outcome never lands. 1: does not answer the question, or says something untrue to the stories.
- landed: the talking points he hit, each with a short quote of his words.
- missed: the points he did not hit, each with what to add in one line (from the stories only).
- risky: anything said that the stories do not support, that a watch-out or do-not-claim forbids, or that asserts a résumé claim as done work: quote the words, say why. Empty when clean. A transcription slip is not risky.
- timing: words = his word count. est_seconds = ${turn.seconds ? `${turn.seconds} (measured)` : "words divided by 2.3, rounded"}. verdict: short when under ${isBehavioral ? 40 : 25} seconds, long when over ${isBehavioral ? 120 : 90}, else good.
- tightened: his answer in his own words and order, trimmed to the beats, with a missed point folded in only where a story supports it. ${isBehavioral ? "90-160" : "80-150"} words, first person, spoken. Nothing the stories do not support; nothing risky kept.
- follow_up: the one probing question an interviewer would ask next, aimed at the vaguest or weakest part; null only when there is nothing left to probe.`;
}
