import { useState, useEffect } from "react";
import { api } from "../../../api/client.js";

// A label + input/select/textarea that PATCHes server/routes/applications.js
// on blur (or immediately on change for a select) — the same "save on blur"
// pattern the original ApplicationPanel used for notes, now shared across
// every details field instead of hand-rolled per field.
export default function Field({ jobId, name, label, value, type = "text", options, onSaved, placeholder }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);

  const save = async (next) => {
    if (next === (value ?? "")) return;
    const { application } = await api.patchApplication(jobId, { [name]: next });
    onSaved?.(application);
  };

  if (type === "select") {
    return (
      <div className="form-row">
        <label className="form-label">{label}</label>
        <select
          value={draft}
          onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}
        >
          {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <div className="form-row">
        <label className="form-label">{label}</label>
        <textarea
          rows={3}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
        />
      </div>
    );
  }

  return (
    <div className="form-row">
      <label className="form-label">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(draft)}
      />
    </div>
  );
}
