// Deterministic checks on generated text. Deliberately minimal.
//
// This file used to carry a much larger style enforcement layer — word
// floors and ceilings, opener quotas, a hand-built action-verb table
// driving tense and subjectless-clause detection, JD-parrot n-grams. All
// of it is gone. Those rules encoded one particular bullet shape, and the
// rewrite loop kept dragging output back toward it, which is exactly what
// made the bullets read as stitched-together templates rather than
// sentences. Bullet voice is now the prompt's job (see prompts/system.js:
// RESUME_STYLE and FEW_SHOT_BULLETS), where it can be steered by example
// instead of by regex.
//
// What remains is the mechanical stuff a model genuinely can't be trusted
// to self-police, and that has nothing to do with style: banned marketing
// vocabulary, and profile placeholder text leaking onto the page.
// Truth-side checking (story traceability, unverified numbers) lives in
// ai/verify.js and is untouched.

import { BANNED_PHRASES } from "./prompts/system.js";

function findBannedPhrases(text) {
  const lower = (text || "").toLowerCase();
  const hits = [];
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) hits.push(phrase);
  }
  return hits;
}

// "<ask ...>" is the profile's own marker for a detail the candidate has
// not filled in yet. It must never reach a document.
const PLACEHOLDER_RE = /<ask/i;

// Bullets are written as sentences you could say out loud with "I" in
// front, then printed with the subject dropped. When the model forgets the
// second half of that ("...the program I had come through myself"), the
// pronoun lands on the page. Not a style preference, so it is checked here
// rather than left to the prompt.
const PRONOUN_RE = /\b(I|my|myself|me|we|our)\b/;

/**
 * @param {object} resume - the resume object from resumeTailorSchema
 * @returns {Array<{location,kind,excerpt,fix_hint}>}
 */
export function lintResume(resume) {
  const issues = [];
  const summary = resume.professional_summary || "";

  for (const phrase of findBannedPhrases(summary)) {
    issues.push({ location: "summary", kind: "banned_phrase", excerpt: summary, fix_hint: `Remove or replace "${phrase}".` });
  }
  if (PLACEHOLDER_RE.test(summary)) {
    issues.push({ location: "summary", kind: "placeholder", excerpt: summary, fix_hint: "Profile placeholder text leaked into the summary; drop this detail." });
  }

  for (const role of resume.experience || []) {
    for (const bullet of role.bullets || []) {
      const text = bullet.text || "";

      for (const phrase of findBannedPhrases(text)) {
        issues.push({ location: bullet.id, kind: "banned_phrase", excerpt: text, fix_hint: `Remove or replace "${phrase}".` });
      }

      if (PLACEHOLDER_RE.test(text)) {
        issues.push({ location: bullet.id, kind: "placeholder", excerpt: text, fix_hint: "Profile placeholder text leaked into this bullet; drop this detail." });
      }

      const pronoun = text.match(PRONOUN_RE);
      if (pronoun) {
        issues.push({ location: bullet.id, kind: "pronoun", excerpt: text, fix_hint: `Résumé bullets carry no first-person pronoun, but this one contains "${pronoun[1]}". Rephrase so the sentence still reads naturally with the subject implied.` });
      }
    }
  }

  return issues;
}

export function lintCoverLetter(paragraphs) {
  const issues = [];
  const text = (paragraphs || []).join("\n\n");
  const openers = ["i am writing to", "i am excited", "i am thrilled", "as a passionate"];
  const lower = text.toLowerCase();
  for (const opener of openers) {
    if (lower.includes(opener)) issues.push({ location: "paragraph_1", kind: "banned_phrase", excerpt: opener, fix_hint: `Do not open with "${opener}".` });
  }
  for (const phrase of findBannedPhrases(text)) {
    issues.push({ location: "body", kind: "banned_phrase", excerpt: phrase, fix_hint: `Remove or replace "${phrase}".` });
  }
  return issues;
}

export function lintAnswer(answer) {
  const issues = [];
  for (const phrase of findBannedPhrases(answer || "")) {
    issues.push({ location: "answer", kind: "banned_phrase", excerpt: phrase, fix_hint: `Remove or replace "${phrase}".` });
  }
  return issues;
}
