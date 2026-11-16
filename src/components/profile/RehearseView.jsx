import { useEffect, useMemo, useState } from "react";
import { applyFilters, DEFAULT_FILTERS } from "../../lib/storyIndex.js";
import StoryFilters from "./StoryFilters.jsx";
import StoryBody from "./StoryBody.jsx";

// Flashcards over the story index: a prompt, answer it out loud, reveal
// the story. No AI — the prompt comes from the story's own competency
// or title, so it is the same every time and cheap to redo.

const SEEN_KEY = "profile.rehearse.seen";

function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* non-fatal */ }
}

// Behavioural stories are titled by competency; this is the question an
// interviewer actually asks for each.
const BEHAVIORAL_PROMPTS = [
  [/giving difficult feedback/, "Tell me about a time you had to give someone difficult feedback."],
  [/feedback/, "Tell me about difficult feedback you received, and what you did with it."],
  [/conflict/, "Tell me about a time you disagreed with a manager or a teammate. How did it end?"],
  [/failure/, "Tell me about a time you failed. What did you learn?"],
  [/priorit|time management/, "How do you prioritize when everything is urgent? Give me an example."],
  [/ambiguity/, "Tell me about a time you had to work with unclear requirements."],
  [/learn/, "Tell me about a time you had to learn something quickly."],
  [/proudest/, "What is the achievement you are proudest of?"],
  [/wrong|changed course/, "Tell me about a time you were wrong and changed course."],
  [/deadline/, "Tell me about a time you pushed back on a deadline."],
  [/cross-team|timezone|time zone|collaboration/, "Tell me about working with people across teams or time zones."],
  [/leadership|led/, "Tell me about a time you led a team or an effort."],
  [/initiative|ownership/, "Tell me about something you did without being asked."],
];

function promptFor(story, style) {
  if (story.kind === "behavioral") {
    if (story.prompt) return story.prompt;
    const hit = BEHAVIORAL_PROMPTS.find(([re]) => re.test(story.title.toLowerCase()));
    return hit ? hit[1] : `Tell me about: ${story.title}.`;
  }
  const byTitle = `Walk me through the "${story.title}" work at ${story.company}.`;
  if (style === "title") return byTitle;
  const c = story.competencies[0];
  return c ? `Give me an example of ${c}.` : byTitle;
}

function shuffled(ids) {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function RehearseView({ index, active, startStory, nonce }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [style, setStyle] = useState("competency");
  const [unseenOnly, setUnseenOnly] = useState(false);
  const [seen, setSeen] = useState(() => new Set(readSeen()));
  const [order, setOrder] = useState(null);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const pool = useMemo(
    () => applyFilters(index.stories, filters).filter((s) => !unseenOnly || !seen.has(s.id)),
    [index, filters, unseenOnly, seen],
  );
  // A shuffle fixes an order; stories that enter the pool later go on
  // the end, stories that leave it drop out.
  const deck = useMemo(() => {
    if (!order) return pool;
    const inPool = new Map(pool.map((s) => [s.id, s]));
    const placed = new Set(order);
    return [...order.map((id) => inPool.get(id)).filter(Boolean), ...pool.filter((s) => !placed.has(s.id))];
  }, [pool, order]);

  // Opened from a link ("Rehearse" on a story chip): clear the filters so
  // the story is in the deck, and start on it.
  useEffect(() => {
    if (!startStory) return;
    setFilters(DEFAULT_FILTERS);
    setUnseenOnly(false);
    setOrder(null);
    const i = index.stories.findIndex((s) => s.id === startStory);
    setPos(i >= 0 ? i : 0);
    setRevealed(false);
  }, [startStory, nonce, index]);

  const safePos = deck.length ? Math.min(pos, deck.length - 1) : 0;
  const current = deck[safePos] || null;

  const markSeen = (id) => {
    if (seen.has(id)) return;
    const next = new Set(seen);
    next.add(id);
    writeSeen(next);
    setSeen(next);
  };
  const resetSeen = () => {
    const next = new Set();
    writeSeen(next);
    setSeen(next);
  };

  const reveal = () => {
    // With "unseen only" on, marking a card seen would drop it from the
    // deck mid-read; it is marked when you move on instead.
    if (!revealed && current && !unseenOnly) markSeen(current.id);
    setRevealed(!revealed);
  };
  const go = (delta) => {
    if (!deck.length) return;
    const removing = unseenOnly && revealed && current && !seen.has(current.id);
    if (revealed && current) markSeen(current.id);
    const len = removing ? deck.length - 1 : deck.length;
    if (len <= 0) {
      setPos(0);
      setRevealed(false);
      return;
    }
    // After the current card leaves, the next one sits at the same index.
    const base = removing && delta > 0 ? safePos - 1 : safePos;
    setPos((((base + delta) % len) + len) % len);
    setRevealed(false);
  };
  const shuffle = () => {
    setOrder(shuffled(pool.map((s) => s.id)));
    setPos(0);
    setRevealed(false);
  };
  const changeFilters = (f) => {
    setFilters(f);
    setPos(0);
    setRevealed(false);
  };

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        reveal();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "s" || e.key === "S") shuffle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const seenCount = index.stories.filter((s) => seen.has(s.id)).length;

  return (
    <div>
      <div className="card">
        <div className="spread wrap gap-2 items-start">
          <div>
            <div className="section-title mb-1">Rehearse</div>
            <div className="muted small">
              Read the prompt, answer out loud, then reveal the story.{" "}
              <span className="kbd">space</span> reveal · <span className="kbd">←</span> <span className="kbd">→</span> move · <span className="kbd">s</span> shuffle
            </div>
          </div>
          <div className="muted small flex-row">
            <span>{seenCount} of {index.stories.length} seen</span>
            <button type="button" className="btn-sm btn-muted" onClick={resetSeen} disabled={seenCount === 0}>Reset</button>
          </div>
        </div>
        <div className="mt-3">
          <StoryFilters
            index={index}
            filters={filters}
            onChange={changeFilters}
            showSearch={false}
            total={index.stories.length}
            shown={pool.length}
          />
        </div>
        <div className="flex-row small mt-2 gap-4">
          <label className="flex-row gap-1">
            <input
              type="checkbox"
              checked={unseenOnly}
              onChange={(e) => { setUnseenOnly(e.target.checked); setPos(0); setRevealed(false); }}
            />
            unseen only
          </label>
          <label className="flex-row gap-2">
            <span className="muted">Prompt</span>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="competency">by competency</option>
              <option value="title">by title</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card flash-card">
        {current ? (
          <>
            <div className="muted small">
              {safePos + 1} / {deck.length}{seen.has(current.id) ? " · seen" : ""}
            </div>
            <div className="flash-prompt">{promptFor(current, style)}</div>
            {revealed && (
              <div className="flash-answer">
                <div className="flex-row small mb-3">
                  <code className="id-chip">{current.id}</code>
                  <b>{current.title}</b>
                  <span className="chip-neutral">{current.company || "Behavioural"}</span>
                  {current.kind === "role" && current.competencies.map((c) => <span key={c} className="tech-chip">{c}</span>)}
                  <a href={current.hash} className="small ml-auto">Open in profile</a>
                </div>
                <StoryBody story={current} />
              </div>
            )}
            <div className="flash-actions">
              <button type="button" className="btn-muted" onClick={() => go(-1)}>← Prev</button>
              <button type="button" onClick={reveal}>{revealed ? "Hide" : "Reveal"}</button>
              <button type="button" className="btn-muted" onClick={() => go(1)}>Next →</button>
              <button type="button" className="btn-muted" onClick={shuffle}>Shuffle</button>
            </div>
          </>
        ) : (
          <div className="muted small">
            {unseenOnly && pool.length === 0 && seenCount > 0
              ? "Everything that matches has been seen — reset, or turn off “unseen only”."
              : "No stories match these filters."}
          </div>
        )}
      </div>
    </div>
  );
}
