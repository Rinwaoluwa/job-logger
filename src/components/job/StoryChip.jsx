import { memo, useState } from "react";
import { useProfile } from "../../hooks/useProfile.jsx";
import { storyHash } from "../../lib/storyIndex.js";
import RichText from "../profile/RichText.jsx";

/**
 * A story id as the interview prep cites it, shown by its title, with the
 * spoken version a click away and links into the Profile tab. `angle` is
 * what the prep says to emphasise from this story for the item it sits
 * under.
 */
function StoryChip({ id, angle }) {
  const { index } = useProfile();
  const [open, setOpen] = useState(false);
  const story = index?.byId.get(id);

  return (
    <span className="story-chip-wrap">
      <button
        type="button"
        className={`badge fit-good story-chip ${open ? "open" : ""}`}
        onClick={() => setOpen(!open)}
        title={story ? `${story.company || "Behavioural"} — click for how you tell it` : "Not found in the profile"}
      >
        {story ? story.title : id}
      </button>
      {angle && <span className="small muted story-chip-angle"> — {angle}</span>}
      {open && (
        <span className="story-chip-pop">
          <span className="flex-row small mb-2">
            <code className="id-chip">{id}</code>
            {story && <span className="chip-neutral">{story.company || "Behavioural"}</span>}
            <a href={storyHash(id)} className="small ml-auto">Open in profile</a>
            <a href={storyHash(id, { rehearse: true })} className="small">Rehearse</a>
          </span>
          {!story ? (
            <span className="muted small">This id is not in the profile any more.</span>
          ) : story.spoken ? (
            <span className="spoken block">
              <span className="field-label">How I tell it</span>
              <RichText text={story.spoken} />
            </span>
          ) : (
            <>
              <span className="muted small block mb-1">No spoken version in the profile yet.</span>
              {story.outcome && <RichText text={story.outcome} />}
            </>
          )}
        </span>
      )}
    </span>
  );
}

export default memo(StoryChip);
