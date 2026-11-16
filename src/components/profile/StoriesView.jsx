import { useMemo } from "react";
import { applyFilters } from "../../lib/storyIndex.js";
import { useTargetRef } from "../../hooks/useTargetRef.js";
import StoryFilters from "./StoryFilters.jsx";
import StoryBody from "./StoryBody.jsx";
import RichText from "./RichText.jsx";

function StoryRow({ story, target, nonce }) {
  const ref = useTargetRef(story.id, target, nonce);
  return (
    <details className="story story-row" id={story.id} ref={ref}>
      <summary>
        <code className="id-chip">{story.id}</code>
        <span className="bold">{story.title}</span>
        <span className="chip-neutral">{story.company || "Behavioural"}</span>
        {story.status === "draft" && <span className="chip-warn">draft</span>}
        {story.kind === "role" && story.competencies.map((c) => <span key={c} className="tech-chip">{c}</span>)}
        {/* The outcome is the part worth seeing without opening anything:
            inside the summary so it shows while the row is closed. */}
        {story.outcome && (
          <div className="story-preview">
            <span className="field-label inline mr-2">{story.kind === "role" ? "Outcome" : "Result"}</span>
            <RichText text={story.outcome} className="small inline-prose" />
          </div>
        )}
      </summary>
      <div className="story-body">
        <StoryBody story={story} showMeta />
      </div>
    </details>
  );
}

/** Every story in the profile in one list, searchable and filterable. */
export default function StoriesView({ index, filters, onFilters, target, nonce }) {
  const shown = useMemo(() => applyFilters(index.stories, filters), [index, filters]);
  return (
    <div>
      <div className="card">
        <div className="section-title">All stories</div>
        <div className="muted small mb-3">
          Every story in the profile, across the roles and the behavioural set. Open one for the full STAR and the
          way you tell it; ids in the text are links.
        </div>
        <StoryFilters index={index} filters={filters} onChange={onFilters} total={index.stories.length} shown={shown.length} />
      </div>
      <div className="card">
        {shown.length === 0
          ? <div className="muted small">Nothing matches — clear a filter.</div>
          : shown.map((s) => <StoryRow key={s.id} story={s} target={target} nonce={nonce} />)}
      </div>
    </div>
  );
}
