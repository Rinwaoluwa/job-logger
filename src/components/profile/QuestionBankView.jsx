import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client.js";
import ErrorBox from "../ErrorBox.jsx";
import StoryChip from "../job/StoryChip.jsx";
import { QUESTION_KINDS, QUESTION_KIND_LABELS, ROUND_LABELS } from "../../lib/interviews.js";

// Questions you have actually been asked (round debriefs) or practised
// and kept (mock answers), with your answer in your own words. Every
// later prep reads this, so an answer refined here is reused instead of
// regenerated per posting.

const SOURCE_LABEL = { debrief: "asked in an interview", mock: "from a mock", manual: "added by hand" };

function Entry({ entry, onChanged, onDeleted }) {
  const [myAnswer, setMyAnswer] = useState(entry.my_answer || "");
  const [notes, setNotes] = useState(entry.notes || "");
  const [question, setQuestion] = useState(entry.question);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setMyAnswer(entry.my_answer || ""); setNotes(entry.notes || ""); setQuestion(entry.question); }, [entry]);

  const save = async (fields) => {
    setError(null);
    try {
      const res = await api.patchBankEntry(entry.id, fields);
      onChanged(res.entry);
    } catch (e) {
      setError(e.message);
    }
  };
  const meta = [
    entry.company,
    entry.round_kind ? ROUND_LABELS[entry.round_kind] : null,
    SOURCE_LABEL[entry.source],
    entry.times_asked > 1 ? `asked ${entry.times_asked} times` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="card question-card">
      <div className="spread gap-3 items-start">
        {editing ? (
          <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} onBlur={() => { setEditing(false); if (question.trim() && question !== entry.question) save({ question: question.trim() }); }} autoFocus className="grow" />
        ) : (
          <b className="small" onDoubleClick={() => setEditing(true)} title="Double-click to edit">{entry.question}</b>
        )}
        <select value={entry.kind || ""} onChange={(e) => save({ kind: e.target.value || null })} className="w-auto shrink-0">
          <option value="">kind?</option>
          {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="small muted mt-1">{meta}</div>
      {entry.story_ids?.length > 0 && (
        <div className="flex-row mt-2">{entry.story_ids.map((id) => <StoryChip key={id} id={id} />)}</div>
      )}
      <label className="small block mt-2">
        <div className="muted">My answer (in my words — the next prep builds on this)</div>
        <textarea rows={myAnswer ? 4 : 2} value={myAnswer} onChange={(e) => setMyAnswer(e.target.value)} onBlur={() => { if (myAnswer !== (entry.my_answer || "")) save({ myAnswer }); }} placeholder="Not written yet." />
      </label>
      <label className="small block mt-2">
        <div className="muted">Notes</div>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (entry.notes || "")) save({ notes }); }} className="w-full" />
      </label>
      <div className="flex-row mt-2">
        <button type="button" className="btn-sm btn-danger" onClick={() => { if (window.confirm("Remove this question from the bank?")) onDeleted(entry); }}>Delete</button>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </div>
  );
}

export default function QuestionBankView() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [kind, setKind] = useState("");
  const [company, setCompany] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [newQ, setNewQ] = useState({ question: "", kind: "", myAnswer: "" });

  const load = () => api.listQuestionBank().then((r) => setEntries(r.entries)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const companies = useMemo(() => [...new Set((entries || []).map((e) => e.company).filter(Boolean))].sort(), [entries]);
  const shown = useMemo(() => (entries || []).filter((e) =>
    (!kind || e.kind === kind) && (!company || e.company === company) && (!source || e.source === source)
    && (!q || `${e.question} ${e.my_answer} ${e.notes}`.toLowerCase().includes(q.toLowerCase()))), [entries, kind, company, source, q]);

  const add = async () => {
    if (!newQ.question.trim()) return;
    setError(null);
    try {
      await api.createBankEntry({ question: newQ.question.trim(), kind: newQ.kind || null, myAnswer: newQ.myAnswer });
      setNewQ({ question: "", kind: "", myAnswer: "" });
      setAdding(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async (entry) => {
    try {
      await api.deleteBankEntry(entry.id);
      setEntries((list) => list.filter((e) => e.id !== entry.id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <div className="card">
        <div className="spread wrap gap-2">
          <div>
            <div className="section-title mb-1">Question bank</div>
            <div className="muted small">
              What interviewers actually asked you, and the answers you want to keep. A round's debrief adds to it; a mock answer you keep adds to it; every prep reads it.
            </div>
          </div>
          <button type="button" className="btn-sm btn-muted" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add a question"}</button>
        </div>
        {adding && (
          <div className="mt-3">
            <input type="text" placeholder="The question" value={newQ.question} onChange={(e) => setNewQ({ ...newQ, question: e.target.value })} className="w-full" />
            <div className="flex-row mt-2">
              <select value={newQ.kind} onChange={(e) => setNewQ({ ...newQ, kind: e.target.value })} className="w-auto">
                <option value="">kind?</option>
                {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
              </select>
            </div>
            <textarea rows={3} placeholder="My answer (optional)" value={newQ.myAnswer} onChange={(e) => setNewQ({ ...newQ, myAnswer: e.target.value })} className="mt-2" />
            <button type="button" className="btn-sm mt-2" onClick={add} disabled={!newQ.question.trim()}>Add</button>
          </div>
        )}
        <div className="flex-row small mt-3">
          <input type="text" placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
            <option value="">any kind</option>
            {QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}
          </select>
          <select value={company} onChange={(e) => setCompany(e.target.value)} className="w-auto">
            <option value="">any company</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
            <option value="">any source</option>
            {Object.entries(SOURCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span className="muted">{shown.length} of {entries?.length ?? 0}</span>
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {entries && entries.length === 0 && (
        <div className="card muted small">Empty so far. Debrief a round on a job's Interview tab, or keep an answer from a mock interview, and it shows up here.</div>
      )}
      {shown.map((e) => (
        <Entry key={e.id} entry={e} onChanged={(next) => setEntries((list) => list.map((x) => (x.id === next.id ? next : x)))} onDeleted={remove} />
      ))}
    </div>
  );
}
