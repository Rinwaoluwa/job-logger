// The day-of page: one sheet built from a prep with no model call. The
// same HTML is previewed, printed and downloaded, so what you read in
// the lobby is what you saw on screen.

import { ROUND_LABELS, whenLabel } from "./interviews.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const firstSentence = (s) => {
  const t = String(s || "").trim();
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 180);
};

/**
 * @param {object} p
 * @param {object} p.prep - interview_preps row (result_json)
 * @param {object} p.job
 * @param {object|null} p.round
 * @param {Map} p.storiesById - the profile index's byId
 */
export function cheatSheetSections({ prep, storiesById }) {
  const d = prep.result_json || {};
  const storyTitle = (id) => storiesById?.get(id)?.title || id;
  const storySpoken = (id) => storiesById?.get(id)?.spoken || "";
  const sections = [];

  sections.push({
    key: "watch", title: "Watch-outs", tone: "warn",
    items: (d.watch_outs || []).map((w) => ({ text: w.text, sub: w.why })),
  });
  sections.push({
    key: "stories", title: "Stories to have ready",
    items: (d.top_stories || []).map((t) => ({ text: storyTitle(t.story_id), sub: [t.lead_with, firstSentence(storySpoken(t.story_id))].filter(Boolean).join(" — ") })),
  });
  const pitch = d.pitch || {};
  sections.push({
    key: "pitch", title: "Pitch beats",
    groups: [
      { title: "Tell me about yourself", items: (pitch.about_me?.beats || []).map((b) => ({ text: b })) },
      { title: "Why this role", items: (pitch.why_this_role?.beats || []).map((b) => ({ text: b })) },
      { title: "Why leave", items: (pitch.why_leaving_current?.beats || []).map((b) => ({ text: b })) },
    ],
  });
  sections.push({
    key: "gaps", title: "If a gap comes up",
    items: [
      ...(d.gap_defenses || []).map((g) => ({ text: g.requirement, sub: g.honest_line })),
      ...(d.resume_claims || []).map((c) => ({ text: `Résumé says: ${c.claim}`, sub: c.honest_line })),
    ],
  });
  sections.push({
    key: "study", title: "Brushed up on",
    items: (d.study_list || []).map((s) => ({ text: s.topic, sub: s.what_to_review })),
  });
  sections.push({
    key: "ask", title: "Questions to ask them",
    items: (d.questions_to_ask_them || []).map((q) => ({ text: q })),
  });
  sections.push({
    key: "notes", title: "Notes",
    items: (d.prep_notes || []).map((n) => ({ text: n })),
  });
  return sections.filter((s) => (s.items && s.items.length) || (s.groups && s.groups.some((g) => g.items.length)));
}

function headerLines({ job, round }) {
  const lines = [`${job.company} — ${job.title}`];
  if (round) {
    const bits = [ROUND_LABELS[round.kind] || round.kind, whenLabel(round.scheduled_at)].filter(Boolean);
    lines.push(bits.join(" · "));
    if (round.interviewers?.length) lines.push(`With: ${round.interviewers.map((p) => [p.name, p.title].filter(Boolean).join(", ")).join(" · ")}`);
  }
  return lines;
}

export function cheatSheetText(ctx) {
  const out = [...headerLines(ctx), ""];
  for (const s of cheatSheetSections(ctx)) {
    out.push(s.title.toUpperCase());
    if (s.groups) {
      for (const g of s.groups) {
        if (!g.items.length) continue;
        out.push(`  ${g.title}`);
        for (const it of g.items) out.push(`    - ${it.text}`);
      }
    } else {
      for (const it of s.items) out.push(`  - ${it.text}${it.sub ? `\n      ${it.sub}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

export function cheatSheetHtml(ctx) {
  const header = headerLines(ctx);
  const sections = cheatSheetSections(ctx);
  const renderItems = (items) => `<ul>${items.map((it) => `<li><span class="t">${esc(it.text)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ""}</li>`).join("")}</ul>`;
  const body = sections.map((s) => `
    <section class="${s.tone === "warn" ? "warn" : ""} ${s.key}">
      <h2>${esc(s.title)}</h2>
      ${s.groups
        ? s.groups.filter((g) => g.items.length).map((g) => `<h3>${esc(g.title)}</h3>${renderItems(g.items)}`).join("")
        : renderItems(s.items)}
    </section>`).join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(header[0])} — cheat sheet</title>
<style>
  @page { size: auto; margin: 11mm; }
  * { box-sizing: border-box; }
  body { font: 10.5px/1.35 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 14px; background: #fff; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
  header .h1 { font-size: 15px; font-weight: 700; }
  header .h2 { color: #334155; }
  .grid { column-count: 2; column-gap: 18px; }
  section { break-inside: avoid; margin-bottom: 10px; padding: 6px 8px; border: 1px solid #e2e8f0; border-radius: 6px; }
  section.warn { border-color: #f59e0b; background: #fffbeb; column-span: all; }
  section.watch ul { column-count: 2; column-gap: 16px; }
  h2 { font-size: 10px; letter-spacing: .4px; text-transform: uppercase; margin: 0 0 4px; color: #475569; }
  section.warn h2 { color: #92400e; }
  h3 { font-size: 10.5px; margin: 6px 0 2px; }
  ul { margin: 0; padding-left: 14px; }
  li { margin: 0 0 3px; break-inside: avoid; }
  .t { font-weight: 600; }
  .s { display: block; color: #475569; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <header>
    <div class="h1">${esc(header[0])}</div>
    ${header.slice(1).map((l) => `<div class="h2">${esc(l)}</div>`).join("")}
  </header>
  <div class="grid">${body}</div>
</body></html>`;
}
