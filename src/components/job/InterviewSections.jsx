import { useState } from "react";
import CopyButton from "../ui/CopyButton.jsx";
import StoryChip from "./StoryChip.jsx";

// The sections of a job's interview prep. Each is a card that collapses;
// the data shapes are server/ai/schemas.js interviewPrepSchema, and the
// story map also arrives pre-AI from server/ai/storyMap.js in the same
// item shape.

export function Section({ title, hint, open = true, tone, children }) {
  return (
    <details className={`card prep-section ${tone === "warn" ? "warn-card" : ""}`} open={open}>
      <summary>
        <span className="section-title mb-0">{title}</span>
        {hint && <span className="muted small">{hint}</span>}
      </summary>
      <div className="prep-section-body">{children}</div>
    </details>
  );
}

const STRENGTH = {
  strong: ["fit-strong", "strong"],
  partial: ["fit-stretch", "partial"],
  none: ["fit-weak", "none"],
};
const KIND = { must_have: "must-have", responsibility: "responsibility", nice_to_have: "nice-to-have" };
const KIND_ORDER = { must_have: 0, responsibility: 1, nice_to_have: 2 };

export function StoryMapSection({ items, fromPlan, resumeVersion, open = true }) {
  const sorted = [...(items || [])].sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 3) - (KIND_ORDER[b.kind] ?? 3) || (b.critical ? 1 : 0) - (a.critical ? 1 : 0));
  return (
    <Section
      title="Story map"
      open={open}
      hint={fromPlan
        ? `from the résumé plan (v${resumeVersion}) — Generate to add angles and what to say when a story is thin`
        : "which story to reach for when each requirement comes up"}
    >
      {sorted.length === 0 && <div className="muted small">Nothing to map yet.</div>}
      {sorted.map((item, i) => {
        const [cls, label] = STRENGTH[item.strength] || STRENGTH.none;
        return (
          <div key={i} className="map-row">
            <div className="map-head">
              <span className={`badge ${cls}`}>{label}</span>
              <span className="badge fit-none">{KIND[item.kind] || item.kind}{item.critical ? " · critical" : ""}</span>
              <span className="small bold">{item.jd_item}</span>
            </div>
            {item.stories?.length > 0 ? (
              <ul className="map-stories">
                {item.stories.map((s) => (
                  <li key={s.story_id}><StoryChip id={s.story_id} angle={s.angle} /></li>
                ))}
              </ul>
            ) : (
              <div className="muted small ml-1">No story covers this.</div>
            )}
            {item.if_asked && <div className="small if-asked">If asked: {item.if_asked}</div>}
          </div>
        );
      })}
    </Section>
  );
}

function Pitch({ title, pitch }) {
  if (!pitch) return null;
  return (
    <div className="pitch">
      <div className="spread mb-2">
        <b className="small">{title}</b>
        <CopyButton text={pitch.spoken} />
      </div>
      <div className="spoken small pre-wrap">{pitch.spoken}</div>
      {pitch.beats?.length > 0 && (
        <ul className="small tight-list mt-2">
          {pitch.beats.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {pitch.story_ids?.length > 0 && (
        <div className="flex-row mt-2">
          {pitch.story_ids.map((id) => <StoryChip key={id} id={id} />)}
        </div>
      )}
      {pitch.inferred_claims?.length > 0 && (
        <div className="small inferred-note mt-2">
          Not from the profile — check before saying it:
          <ul className="tight-list">{pitch.inferred_claims.map((c, i) => <li key={i}>{c.text} <span className="muted">({c.reason})</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function PitchSection({ pitch }) {
  if (!pitch) return null;
  return (
    <Section title="Opening pitch and framing" hint="say these in your own words; the beats are what must land">
      <Pitch title="Tell me about yourself" pitch={pitch.about_me} />
      <Pitch title="Why this role" pitch={pitch.why_this_role} />
      <Pitch title="Why leave your current role" pitch={pitch.why_leaving_current} />
    </Section>
  );
}

export function QuestionCard({ q, index, expanded, onToggle, rewriting, onRewrite, failed, onRetry }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="card question-card">
      <div className="spread gap-3 items-start">
        <b className="small">{q.question}</b>
        <span className="flex-row shrink-0 gap-1">
          {q.from_bank && <span className="badge fit-good" title="In your question bank: you have been asked this before">asked before</span>}
          <span className="badge fit-none">{q.kind}</span>
        </span>
      </div>
      <div className="small muted mt-1">{q.why_asked}</div>
      {q.story_ids?.length > 0 && (
        <div className="flex-row mt-2">
          {q.story_ids.map((id) => <StoryChip key={id} id={id} />)}
        </div>
      )}
      <div className="flex-row mt-2">
        <button type="button" className="btn-sm btn-muted" onClick={onToggle}>
          {expanded ? "Hide draft answer" : "Show draft answer"}
        </button>
        <button type="button" className="btn-sm btn-muted" disabled={rewriting} onClick={() => onRewrite(index, "")}>
          {rewriting ? "Rewriting…" : "Rewrite"}
        </button>
        {!rewriting && (
          <button type="button" className="btn-sm btn-muted" onClick={() => setNoteOpen(!noteOpen)}>
            {noteOpen ? "Cancel" : "Rewrite with a note"}
          </button>
        )}
      </div>
      {noteOpen && !rewriting && (
        <form
          className="flex-row mt-2"
          onSubmit={(e) => { e.preventDefault(); onRewrite(index, note); setNoteOpen(false); setNote(""); }}
        >
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. make it about the BrightPay incident, or ask it the way a bank would"
            style={{ flex: 1, minWidth: 220 }}
            autoFocus
          />
          <button type="button" className="btn-sm" onClick={() => { onRewrite(index, note); setNoteOpen(false); setNote(""); }}>Go</button>
        </form>
      )}
      {failed && (
        <div className="err-box small spread gap-2">
          <span>Rewrite failed: {failed.error}</span>
          <button type="button" className="btn-sm btn-muted" onClick={() => onRetry(failed.id)}>Retry</button>
        </div>
      )}
      {expanded && (
        <div className="mt-2">
          <ul className="small tight-list">{q.talking_points.map((t, ti) => <li key={ti}>{t}</li>)}</ul>
          <div className="spoken small pre-wrap mt-2">{q.draft_answer}</div>
          {q.inferred && <div className="small inferred-note mt-1">No profile story backs this — treat as a scaffold, not a script.</div>}
        </div>
      )}
    </div>
  );
}

const SEVERITY = { blocker: "fit-weak", major: "fit-stretch", minor: "fit-none" };

export function GapDefensesSection({ items }) {
  if (!items?.length) return null;
  return (
    <Section title="Gap defenses" hint="the truth first, then the nearest real experience">
      {items.map((g, i) => (
        <div key={i} className="map-row">
          <div className="map-head">
            {g.severity && <span className={`badge ${SEVERITY[g.severity] || "fit-none"}`}>{g.severity}</span>}
            <span className="small bold">{g.requirement}</span>
          </div>
          <div className="small bold my-1">{g.honest_line}</div>
          <div className="small muted">{g.bridge}</div>
          {g.bridge_story_id && <div className="mt-1"><StoryChip id={g.bridge_story_id} /></div>}
        </div>
      ))}
    </Section>
  );
}

const DEPTH = {
  did_it: ["fit-strong", "did it"],
  set_it_up: ["fit-stretch", "set it up"],
  know_the_approach: ["fit-weak", "know the approach"],
};

export function ResumeClaimsSection({ items }) {
  if (!items?.length) return null;
  return (
    <Section
      title="Résumé claims to be ready for"
      tone="warn"
      hint="on the résumé by your choice; these lines are for speaking honestly about them, not for extending them"
    >
      {items.map((c, i) => {
        const [cls, label] = DEPTH[c.depth] || DEPTH.know_the_approach;
        return (
          <div key={i} className="map-row">
            <div className="map-head">
              <span className={`badge ${cls}`}>{label}</span>
              <span className="badge fit-stretch">gap fill on the résumé</span>
            </div>
            <div className="small my-1">“{c.claim}”</div>
            <div className="small muted">{c.reason}</div>
            <div className="small bold mt-1 mb-1">What to say: {c.honest_line}</div>
            {c.probe_questions?.length > 0 && (
              <div className="small muted">
                They may ask:
                <ul className="tight-list">{c.probe_questions.map((p, pi) => <li key={pi}>{p}</li>)}</ul>
              </div>
            )}
            {c.nearest_real_story_id && (
              <div className="small mt-1">Steer toward <StoryChip id={c.nearest_real_story_id} /></div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

export function WatchOutsSection({ items }) {
  if (!items?.length) return null;
  return (
    <Section title="Watch-outs" tone="warn" hint="read these in the lobby — the things that would hurt if said">
      <ul className="small tight-list watch-outs">
        {items.map((w, i) => (
          <li key={i}><b>{w.text}</b>{w.why && <span className="muted"> — {w.why}</span>}</li>
        ))}
      </ul>
    </Section>
  );
}

export function TopStoriesSection({ items }) {
  if (!items?.length) return null;
  return (
    <Section title="Stories to have ready" hint="the handful this round leans on, and the sentence to open each with">
      {items.map((t, i) => (
        <div key={i} className="map-row">
          <div className="map-head"><StoryChip id={t.story_id} /></div>
          <div className="small mt-1">Lead with: {t.lead_with}</div>
        </div>
      ))}
    </Section>
  );
}

const DEPTH_STUDY = { refresh: ["fit-good", "refresh"], learn: ["fit-stretch", "learn"] };

export function StudyListSection({ items }) {
  if (!items?.length) return null;
  return (
    <Section title="Study list" hint="what to brush up before this round">
      {items.map((s, i) => {
        const [cls, label] = DEPTH_STUDY[s.depth] || DEPTH_STUDY.refresh;
        return (
          <div key={i} className="map-row">
            <div className="map-head">
              <span className={`badge ${cls}`}>{label}</span>
              <span className="small bold">{s.topic}</span>
            </div>
            <div className="small muted mt-1">{s.why}</div>
            <div className="small mt-1">{s.what_to_review}</div>
          </div>
        );
      })}
    </Section>
  );
}
