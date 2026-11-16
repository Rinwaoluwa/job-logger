import { useState } from "react";
import { DEFAULT_FILTERS } from "../../lib/storyIndex.js";

// The competency vocabulary is free text on each story (about 80 near-
// unique phrases across 42 stories), so it is a searchable chip cloud
// sorted by how many stories carry each one, not a dropdown.
export function CompetencyPicker({ competencies, selected, onChange }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = competencies.filter((c) => !needle || c.name.includes(needle));
  const toggle = (name) => onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  return (
    <details className="comp-picker-wrap">
      <summary className="comp-summary">Competencies{selected.length ? ` (${selected.length})` : ""} ▾</summary>
      <div className="comp-picker">
        <input type="search" placeholder="Filter competencies…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="comp-cloud">
          {shown.map((c) => (
            <button
              type="button"
              key={c.name}
              className={`tech-chip chip-btn ${selected.includes(c.name) ? "active" : ""}`}
              onClick={() => toggle(c.name)}
            >
              {c.name} <span className="chip-count">{c.count}</span>
            </button>
          ))}
          {shown.length === 0 && <span className="muted small">No competency matches.</span>}
        </div>
      </div>
    </details>
  );
}

const isFiltered = (f) => !!(f.q || (f.role && f.role !== "all") || f.competencies?.length || f.hideDrafts);

/** The filter bar the stories list and the rehearse deck share. */
export default function StoryFilters({ index, filters, onChange, showSearch = true, total, shown }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return (
    <div className="stories-toolbar">
      {showSearch && (
        <input
          type="search"
          placeholder="Search stories…"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          style={{ minWidth: 220 }}
        />
      )}
      <select value={filters.role} onChange={(e) => set({ role: e.target.value })}>
        <option value="all">All roles</option>
        {index.roles.map((r) => <option key={r.id} value={r.id}>{r.company}</option>)}
        <option value="behavioral">Behavioural</option>
      </select>
      <CompetencyPicker
        competencies={index.competencies}
        selected={filters.competencies}
        onChange={(competencies) => set({ competencies })}
      />
      <label className="small flex-row gap-1">
        <input type="checkbox" checked={!!filters.hideDrafts} onChange={(e) => set({ hideDrafts: e.target.checked })} />
        hide drafts
      </label>
      {filters.competencies.map((c) => (
        <button
          type="button"
          key={c}
          className="tech-chip chip-btn active"
          title="Remove this filter"
          onClick={() => set({ competencies: filters.competencies.filter((x) => x !== c) })}
        >
          {c} ✕
        </button>
      ))}
      <span className="muted small ml-auto">{shown} of {total}</span>
      {isFiltered(filters) && (
        <button type="button" className="btn-sm btn-muted" onClick={() => onChange({ ...DEFAULT_FILTERS })}>Clear</button>
      )}
    </div>
  );
}
