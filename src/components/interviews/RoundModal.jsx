import { useMemo, useState } from "react";
import { api } from "../../api/client.js";
import { useProfile } from "../../hooks/useProfile.jsx";
import ErrorBox from "../ErrorBox.jsx";
import Modal from "../ui/Modal.jsx";
import Field from "../ui/Field.jsx";
import { ROUND_KINDS, ROUND_LABELS } from "../../lib/interviews.js";

// Add or edit one interview round: what kind, when, who is in the room,
// what the recruiter said, and which skills the prep should bear down
// on. Focus skills come from the profile's inventory (grouped by how
// well he knows each) plus a free line for anything else.

const ORDER = ["expert", "strong", "working", "familiar"];
const HINT = {
  expert: "Can be interviewed on at any depth.",
  strong: "Safe to be interviewed on in depth.",
  working: "Used on real work — a question here gets a study entry too.",
  familiar: "Touched, not tested on — pick these to prepare an honest answer.",
};

export default function RoundModal({ jobId, round = null, onClose, onSaved }) {
  const { profile } = useProfile();
  const [kind, setKind] = useState(round?.kind || "recruiter_screen");
  const [scheduledAt, setScheduledAt] = useState(round?.scheduled_at || "");
  const [interviewers, setInterviewers] = useState(round?.interviewers?.length ? round.interviewers : [{ name: "", title: "" }]);
  const [notes, setNotes] = useState(round?.notes || "");
  const [focusSkills, setFocusSkills] = useState(() => new Set(round?.focus_skills || []));
  const [focusText, setFocusText] = useState(round?.focus_text || "");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const skills = useMemo(() => profile?.skills || [], [profile]);
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (s) => !q || s.skill.toLowerCase().includes(q);
    return ORDER.map((p) => [p, skills.filter((s) => s.proficiency === p && match(s))]).filter(([, list]) => list.length);
  }, [skills, filter]);

  const toggle = (name) => setFocusSkills((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const setPerson = (i, field, value) => setInterviewers((list) => list.map((p, j) => (j === i ? { ...p, [field]: value } : p)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = {
        kind,
        scheduledAt: scheduledAt || null,
        interviewers: interviewers.map((p) => ({ name: p.name.trim(), title: p.title.trim() })).filter((p) => p.name),
        notes: notes.trim(),
        focusSkills: [...focusSkills],
        focusText: focusText.trim(),
      };
      const res = round ? await api.patchRound(round.id, data) : await api.createRound(jobId, data);
      onSaved?.(res.round);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const unknownSkills = [...focusSkills].filter((n) => !skills.some((s) => s.skill === n));

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={round ? "Edit round" : "Add an interview round"}
      description="The prep for this round follows what you put here."
      footer={(
        <>
          <button type="button" className="btn-muted" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : round ? "Save round" : "Add round"}</button>
        </>
      )}
    >
      <div className="form-grid">
        <Field label="Round">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {ROUND_KINDS.map((k) => <option key={k} value={k}>{ROUND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="When">
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
      </div>

      <div className="form-row">
        <div className="form-label">Who is in the room</div>
        <div className="stack">
          {interviewers.map((p, i) => (
            <div key={i} className="flex-row">
              <input type="text" placeholder="Name" value={p.name} onChange={(e) => setPerson(i, "name", e.target.value)} className="grow" aria-label="Interviewer name" />
              <input type="text" placeholder="Title (e.g. Engineering Manager)" value={p.title} onChange={(e) => setPerson(i, "title", e.target.value)} className="grow-2" aria-label="Interviewer title" />
              <button type="button" className="btn-sm btn-muted" onClick={() => setInterviewers((list) => list.filter((_, j) => j !== i))} disabled={interviewers.length === 1 && !p.name && !p.title} aria-label="Remove interviewer">✕</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn-sm btn-muted" onClick={() => setInterviewers((list) => [...list, { name: "", title: "" }])}>+ Another interviewer</button>
          </div>
        </div>
      </div>

      <Field label="What the recruiter or the invitation said" hint="Format, topics, length, what they care about.">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 45 minutes with the EM and a senior dev; expect questions on testing strategy and a walkthrough of a recent project" />
      </Field>

      <div className="form-row">
        <div className="spread">
          <div className="form-label">Focus skills — {focusSkills.size} picked</div>
          <input type="text" placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="input-narrow" aria-label="Filter skills" />
        </div>
        {groups.map(([prof, list]) => (
          <div key={prof} className="mt-2">
            <div className="small"><b className="capitalize">{prof}</b> <span className="muted">— {HINT[prof]}</span></div>
            <div className="flex-row chip-cloud mt-1">
              {list.map((s) => (
                <button
                  type="button"
                  key={s.skill}
                  className={`chip-neutral chip-btn ${focusSkills.has(s.skill) ? "active" : ""}`}
                  aria-pressed={focusSkills.has(s.skill)}
                  onClick={() => toggle(s.skill)}
                  title={s.notes || undefined}
                >
                  {s.skill}
                </button>
              ))}
            </div>
          </div>
        ))}
        {unknownSkills.length > 0 && (
          <div className="small muted mt-2">
            Not in the inventory: {unknownSkills.map((n) => (
              <button type="button" key={n} className="chip-neutral chip-btn active ml-1" onClick={() => toggle(n)}>{n} ✕</button>
            ))}
          </div>
        )}
      </div>

      <Field label="Anything else to focus on" hint="Comma-separated, in your words.">
        <input type="text" value={focusText} onChange={(e) => setFocusText(e.target.value)} placeholder="e.g. testing strategy, how I'd ramp up on their Vue codebase, accessibility in banking forms" />
      </Field>

      <ErrorBox>{error}</ErrorBox>
    </Modal>
  );
}
