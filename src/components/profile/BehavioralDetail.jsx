import { useTargetRef } from "../../hooks/useTargetRef.js";
import Prose from "./Prose.jsx";

// Interview stories in STAR form. These never reach a résumé; they back
// the Interview tab and the longer application answers.
const FIELDS = [["s", "Situation"], ["t", "Task"], ["a", "Action"], ["r", "Result"]];

function StoryCard({ story, target, nonce }) {
  const ref = useTargetRef(story.id, target, nonce);
  return (
    <div className={`card ${story.status === "missing" ? "warn-card" : ""}`} id={story.id} ref={ref}>
      <div className="spread items-start gap-3">
        <div className="flex-row">
          {/* The id is shown because the rest of the profile refers to
              these by it ("see gen-s6"). */}
          <code className="id-chip">{story.id}</code>
          <span className="bold">{story.title}</span>
        </div>
        {story.status === "missing" && <span className="chip-warn">empty</span>}
      </div>
      {story.prompt && <div className="muted small mt-1">{story.prompt}</div>}
      {story.status === "missing" ? (
        <div className="muted small mt-2">
          Nothing recorded yet, so this competency has no story to draw on.
        </div>
      ) : (
        <div className="mt-2">
          {FIELDS.map(([key, label]) => story[key] ? (
            <div key={key} className="mb-2">
              <div className="field-label">{label}</div>
              <Prose text={story[key]} />
            </div>
          ) : null)}
        </div>
      )}
    </div>
  );
}

export default function BehavioralDetail({ stories, target, nonce }) {
  const missing = stories.filter((s) => s.status === "missing");

  return (
    <div>
      <div className="card">
        <div className="spread">
          <div className="section-title mb-0">Behavioural stories</div>
          <div className="muted small">{stories.length - missing.length} of {stories.length} written</div>
        </div>
        <div className="muted small mt-2">
          Used for interview prep and longer application answers, not for résumé bullets.
        </div>
      </div>

      {stories.map((story) => <StoryCard key={story.id} story={story} target={target} nonce={nonce} />)}
    </div>
  );
}
