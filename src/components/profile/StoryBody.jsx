import RichText from "./RichText.jsx";

/** A story's numbers, with the text rather than just a count. An id the
 *  profile could not resolve ("none usable — see Notes") stays as text. */
export function MetricsInline({ metrics }) {
  if (!metrics?.length) return null;
  return (
    <div className="story-metrics-inline small">
      {metrics.map((m) => m.unresolved ? (
        <span key={m.id} className="muted">{m.id}</span>
      ) : (
        <span key={m.id} className="metric-inline">
          <code className="id-chip">{m.id}</code> {m.text}{" "}
          {m.verified
            ? <span className="chip-ok">confirmed</span>
            : <span className="chip-warn" title="Never used in a document until you confirm it">unconfirmed</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * The full story: the STAR fields on the left, the spoken "Interview
 * version" on the right. A story from the index (src/lib/storyIndex.js).
 */
export default function StoryBody({ story, showMeta = false, showMetrics = true }) {
  const hasSpokenPanel = story.kind === "role" || story.spoken || story.spokenNote;
  const meta = [story.company, story.roleTitle, story.roleDates].filter(Boolean).join(" · ");
  return (
    <div className={`story-grid ${hasSpokenPanel ? "" : "single"}`}>
      <div>
        {showMeta && meta && <div className="muted small mb-2">{meta}</div>}
        {story.star.map((f) => (
          <div key={f.key} className="story-field">
            <div className="field-label">{f.label}</div>
            <RichText text={f.text} />
          </div>
        ))}
        {showMetrics && story.metrics.length > 0 && (
          <div className="story-field">
            <div className="field-label">Numbers</div>
            <MetricsInline metrics={story.metrics} />
          </div>
        )}
      </div>
      {hasSpokenPanel && (
        <div className="spoken">
          <div className="field-label">How I tell it</div>
          {story.spoken
            ? <RichText text={story.spoken} />
            : story.spokenNote
              ? <div className="note small">{story.spokenNote}</div>
              : <div className="muted small">No spoken version written yet — add an <b>Interview version</b> line to this story in the file.</div>}
        </div>
      )}
    </div>
  );
}
