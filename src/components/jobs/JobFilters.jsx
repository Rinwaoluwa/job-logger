import { memo } from "react";
import { STAGES, stageLabel } from "../../lib/stages.js";
import Toolbar from "../ui/Toolbar.jsx";

const WORK_MODES = ["onsite", "hybrid", "remote"];
const COUNTRIES = ["CA", "US"];
const VERDICTS = ["strong", "good", "stretch", "weak", "no"];
// Adapter names (server/sources/adapters/*.js) plus the two ad-hoc sources.
const SOURCES = [
  ["jackandjill", "Jack & Jill"], ["routine", "Job Search Log"], ["link", "Added by link"], ["manual", "Manual"],
  ["ashby", "Ashby"], ["greenhouse", "Greenhouse"], ["lever", "Lever"], ["adzuna", "Adzuna"], ["muse", "The Muse"],
  ["remotive", "Remotive"], ["jobicy", "Jobicy"], ["remoteok", "RemoteOK"], ["arbeitnow", "Arbeitnow"],
];

/** `lockedSource` hides the Source select when the view already pins one. */
function JobFilters({ filters, onChange, lockedSource = null }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  return (
    <Toolbar className="job-filters">
      <input
        type="search"
        placeholder="Search company, title, location…"
        aria-label="Search jobs"
        value={filters.q || ""}
        onChange={(e) => set({ q: e.target.value })}
      />
      <select
        aria-label="Work mode"
        value={filters.workMode?.[0] || ""}
        onChange={(e) => set({ workMode: e.target.value ? [e.target.value] : undefined })}
      >
        <option value="">Any work mode</option>
        {WORK_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        aria-label="Country"
        value={filters.country?.[0] || ""}
        onChange={(e) => set({ country: e.target.value ? [e.target.value] : undefined })}
      >
        <option value="">Any country</option>
        {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        aria-label="Stage"
        value={filters.stage?.[0] || ""}
        onChange={(e) => set({ stage: e.target.value ? [e.target.value] : undefined })}
      >
        <option value="">Any stage</option>
        {STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
      </select>
      <select
        aria-label="Fit"
        value={filters.verdict?.[0] || ""}
        onChange={(e) => set({ verdict: e.target.value ? [e.target.value] : undefined })}
      >
        <option value="">Any fit</option>
        {VERDICTS.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      <input
        type="number"
        placeholder="Min fit"
        aria-label="Minimum fit score"
        className="input-xs"
        value={filters.minFit || ""}
        onChange={(e) => set({ minFit: e.target.value ? Number(e.target.value) : undefined })}
      />
      {!lockedSource && (
        <select
          aria-label="Source"
          value={filters.source?.[0] || ""}
          onChange={(e) => set({ source: e.target.value ? [e.target.value] : undefined })}
        >
          <option value="">Any source</option>
          {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      )}
      <select aria-label="Sort" value={filters.sort || "posted"} onChange={(e) => set({ sort: e.target.value })}>
        <option value="posted">Newest posted</option>
        <option value="fit">Best fit</option>
        <option value="company">Company A-Z</option>
      </select>
    </Toolbar>
  );
}

export default memo(JobFilters);
