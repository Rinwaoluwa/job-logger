import { useState } from "react";
import { api } from "../../api/client.js";
import { parseSkills } from "../../../shared/briefs.js";
import { useTasks } from "../../hooks/useTasks.jsx";
import ErrorBox from "../ErrorBox.jsx";

/** Title + skills in, a prepare task out. The parent lists the result. */
export default function BriefForm({ onStarted }) {
  const { start } = useTasks();
  const [title, setTitle] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [coverLetter, setCoverLetter] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const skills = parseSkills(skillsText);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await start(() => api.createBrief({
        title: title.trim(),
        skills,
        company: company.trim() || undefined,
        notes: notes.trim() || undefined,
        coverLetter,
      }));
      setTitle("");
      setSkillsText("");
      setCompany("");
      setNotes("");
      setCoverLetter(false);
      onStarted?.(res);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="brief-form">
      <div className="form-grid">
        <div className="form-row col-span-all">
          <label className="form-label">Job title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior Frontend Engineer"
            required
            autoFocus
          />
        </div>
        <div className="form-row col-span-all">
          <label className="form-label">Skills to feature (optional)</label>
          <textarea
            rows={2}
            value={skillsText}
            onChange={(e) => setSkillsText(e.target.value)}
            placeholder="React, TypeScript, GraphQL, Jest — comma or newline separated"
          />
          {skills.length > 0 && (
            <div className="flex-row mt-2">
              {skills.map((s) => <span key={s} className="chip-neutral">{s}</span>)}
            </div>
          )}
        </div>
        <div className="form-row">
          <label className="form-label">Company (optional)</label>
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Names the résumé and letter" />
        </div>
        <div className="form-row">
          <label className="form-label">Notes (optional)</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="fintech, B2B, design-system heavy…" />
        </div>
      </div>
      <div className="flex-row mt-2">
        <button type="submit" disabled={submitting || !title.trim()}>{submitting ? "Starting…" : "Generate résumé"}</button>
        <label className="small flex-row gap-2">
          <input type="checkbox" checked={coverLetter} onChange={(e) => setCoverLetter(e.target.checked)} />
          Also write a cover letter
        </label>
        <span className="muted small">
          Skills you list become must-haves; the usual expectations for the title fill in the rest. Invented bullets stay review-gated.
        </span>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </form>
  );
}
