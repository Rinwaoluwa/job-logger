import { useState } from "react";
import { api } from "../../api/client.js";
import ErrorBox from "../ErrorBox.jsx";
import Modal from "../ui/Modal.jsx";
import Field from "../ui/Field.jsx";
import { QUESTION_KINDS, QUESTION_KIND_LABELS, roundTitle } from "../../lib/interviews.js";

// After the round: what they actually asked and how it went. Every
// question logged here goes into the question bank, so the next prep
// for a similar round starts from what real interviewers ask.

const WENT = [["good", "went well"], ["ok", "ok"], ["poor", "went badly"]];
const blankRow = () => ({ question: "", kind: "", went: "", note: "" });

export default function DebriefModal({ round, prep, onClose, onSaved }) {
  const existing = round.debrief;
  const [rows, setRows] = useState(() => (existing?.questions?.length ? existing.questions.map((q) => ({ question: q.question, kind: q.kind || "", went: q.went || "", note: q.note || "" })) : [blankRow()]));
  const [went, setWent] = useState(existing?.went || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [nextSteps, setNextSteps] = useState(existing?.next_steps || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const prepQuestions = prep?.result_json?.questions || [];
  const setRow = (i, field, value) => setRows((list) => list.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  // Picking one of the prep's questions fills its kind too.
  const pickPrep = (i, text) => {
    const q = prepQuestions.find((x) => x.question === text);
    setRows((list) => list.map((r, j) => (j === i ? { ...r, question: text, kind: q?.kind || r.kind } : r)));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.debriefRound(round.id, {
        questions: rows.filter((r) => r.question.trim()).map((r) => ({ question: r.question.trim(), kind: r.kind || null, went: r.went || null, note: r.note.trim() })),
        went: went || null,
        notes: notes.trim(),
        nextSteps: nextSteps.trim(),
      });
      onSaved?.(res);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={`Debrief: ${roundTitle(round)}`}
      description="What they asked goes into your question bank for the next prep."
      footer={(
        <>
          <button type="button" className="btn-muted" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : existing ? "Update debrief" : "Save debrief"}</button>
        </>
      )}
    >
      <div className="form-label">Questions they asked</div>
      <datalist id="debrief-prep-questions">
        {prepQuestions.map((q, i) => <option key={i} value={q.question} />)}
      </datalist>
      <div className="stack">
        {rows.map((r, i) => (
          <div key={i} className="card card-sunken card-tight">
            <div className="flex-row">
              <input
                type="text"
                list="debrief-prep-questions"
                placeholder="The question, as close to their words as you remember (type, or pick one from the prep)"
                value={r.question}
                onChange={(e) => pickPrep(i, e.target.value)}
                className="grow"
                aria-label="Question"
              />
              <button type="button" className="btn-sm btn-muted" onClick={() => setRows((list) => list.length > 1 ? list.filter((_, j) => j !== i) : [blankRow()])} aria-label="Remove question">✕</button>
            </div>
            <div className="flex-row mt-2">
              <select value={r.kind} onChange={(e) => setRow(i, "kind", e.target.value)} className="input-auto" aria-label="Kind">
                <option value="">kind?</option>
                {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
              </select>
              <select value={r.went} onChange={(e) => setRow(i, "went", e.target.value)} className="input-auto" aria-label="How it went">
                <option value="">how did it go?</option>
                {WENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input type="text" placeholder="what you said / what you'd change" value={r.note} onChange={(e) => setRow(i, "note", e.target.value)} className="grow" aria-label="Note" />
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn-sm btn-muted" onClick={() => setRows((list) => [...list, blankRow()])}>+ Another question</button>
        </div>
      </div>

      <div className="form-grid mt-3">
        <Field label="Overall">
          <select value={went} onChange={(e) => setWent(e.target.value)}>
            <option value="">—</option>
            {WENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Next steps they described">
          <input type="text" value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder="e.g. technical round next week with two engineers" />
        </Field>
      </div>
      <Field label="Notes" hint="What landed, what to fix, anything you learned about the team.">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorBox>{error}</ErrorBox>
    </Modal>
  );
}
