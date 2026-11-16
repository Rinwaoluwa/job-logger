import { useState } from "react";
import { api } from "../../api/client.js";

// Deep-copies content_json, replaces one bullet's text (and the matching
// additions_to_review entry, if the bullet is a flagged addition), and
// marks the bullet edited so the export/preview pipeline can tell it was
// hand-fixed rather than model-written.
function withEditedBulletText(contentJson, bulletId, newText) {
  const next = JSON.parse(JSON.stringify(contentJson));
  for (const role of next.resume?.experience || []) {
    for (const bullet of role.bullets || []) {
      if (bullet.id === bulletId) {
        bullet.text = newText;
        bullet.edited = true;
      }
    }
  }
  for (const addition of next.additions_to_review || []) {
    if (addition.kind === "bullet" && addition.location === bulletId) {
      addition.text = newText;
    }
  }
  return next;
}

function BulletRow({ bullet, roleId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(bullet.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    const trimmed = draftText.trim();
    if (!trimmed || trimmed === bullet.text) { setEditing(false); setDraftText(bullet.text); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await onSaved(trimmed);
      setEditing(false);
      void updated;
    } catch (e) {
      setError(e.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="review-item" style={{ alignItems: editing ? "stretch" : "flex-start" }}>
      <div className="grow">
        <span className="muted">[{roleId}]</span>{" "}
        {editing ? (
          <textarea
            rows={3}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            className="mt-1"
            autoFocus
          />
        ) : (
          <span className="review-text inline">{bullet.text}</span>
        )}
        {!editing && (
          <div className="mt-1">
            {bullet.edited && <span className="badge fit-good mr-1">edited</span>}
            {bullet.inferred ? (
              <span className="badge fit-stretch">
                {bullet.gapFill
                  ? "gap fill — on the page unless rejected"
                  : bullet.reframe
                    ? "reframed — on the page unless rejected"
                    : "estimated / inferred — accept before export"}
              </span>
            ) : (bullet.source_story_ids || []).length === 0 ? (
              <span className="badge composed">AI-composed — check it happened</span>
            ) : (
              (bullet.source_story_ids || []).map((sid) => (
                <span key={sid} className="badge fit-good mr-1">{sid}</span>
              ))
            )}
            {/* Why this bullet earned its slot for this posting. Muted on
                purpose — the story id is the truth claim, this is only the
                JD term it answers. */}
            {(bullet.jd_items || []).map((x) => (
              <span key={`jd-${x}`} className="badge fit-none mr-1">{x}</span>
            ))}
          </div>
        )}
        {editing && bullet.reframe && (
          <div className="muted small mt-1">Editing the reframed wording; the real-stack fallback is kept as is.</div>
        )}
        {error && <div className="small text-danger mt-1">{error}</div>}
      </div>
      <div className="review-actions">
        {editing ? (
          <>
            <button type="button" className="btn-sm" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn-sm btn-muted"
              disabled={saving}
              onClick={() => { setEditing(false); setDraftText(bullet.text); setError(null); }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn-sm btn-muted" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Editable replacement for the old read-only traceability list: shows
 * every bullet with its story/inferred badges, and lets the user fix the
 * wording of any bullet in place (backed by PATCH /api/documents/:id).
 */
export default function BulletList({ document, onDocumentChanged }) {
  // A gap fill is an inferred bullet whose review entry says so; the badge
  // names it because an invented claim deserves a different look than an
  // estimated figure.
  const additions = document.content_json.additions_to_review || [];
  const hasEntry = (bulletId, prefix) =>
    additions.some((a) => a.kind === "bullet" && a.location === bulletId && String(a.reason || "").startsWith(prefix));
  const isGapFill = (bulletId) => hasEntry(bulletId, "Gap fill:");
  // A reframed bullet is real work in the posting's framework; its review
  // entry says so, and rejecting it restores the real-stack wording.
  const isReframe = (bulletId) => hasEntry(bulletId, "Reframed:");
  const allBullets = (document.content_json.resume.experience || []).flatMap((role) =>
    (role.bullets || []).map((b) => ({ ...b, roleId: role.role_id, gapFill: isGapFill(b.id), reframe: isReframe(b.id) })),
  );

  const saveBulletText = async (bulletId, newText) => {
    const nextContentJson = withEditedBulletText(document.content_json, bulletId, newText);
    const updated = await api.patchDocument(document.id, { contentJson: nextContentJson });
    onDocumentChanged?.(updated);
    return updated;
  };

  return (
    <div>
      {allBullets.map((b) => (
        <BulletRow key={b.id} bullet={b} roleId={b.roleId} onSaved={(text) => saveBulletText(b.id, text)} />
      ))}
    </div>
  );
}
