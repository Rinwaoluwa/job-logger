import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorBox from "../components/ErrorBox.jsx";
import RoleDetail from "../components/profile/RoleDetail.jsx";
import SkillsDetail from "../components/profile/SkillsDetail.jsx";
import BehavioralDetail from "../components/profile/BehavioralDetail.jsx";
import ProjectsDetail from "../components/profile/ProjectsDetail.jsx";
import BasicsDetail from "../components/profile/BasicsDetail.jsx";
import StoriesView from "../components/profile/StoriesView.jsx";
import RehearseView from "../components/profile/RehearseView.jsx";
import QuestionBankView from "../components/profile/QuestionBankView.jsx";
import { ProfileLinkContext } from "../components/profile/ProfileLinkContext.jsx";
import { useProfile } from "../hooks/useProfile.jsx";
import { readStored, writeStored } from "../hooks/useLocalStorage.js";
import { useIsActiveView } from "../hooks/useIsActiveView.jsx";
import { stripFilePrefix } from "../lib/profileFormat.js";
import { parseHash, toHash, isProfileHash } from "../lib/profileHash.js";
import { DEFAULT_FILTERS } from "../lib/storyIndex.js";

// The knowledge base every generated document is built from. Read-only on
// purpose — the files in profile/ are edited by hand — but it shows the
// content rather than a count of it, because "15/18 metrics usable" tells
// you a number is unusable without telling you which one or why.
//
// Where you are is in the URL hash (src/lib/profileHash.js), so a story
// id in the text, a chip in the job drawer or a pasted link all land on
// the entry, and a reload comes back to the same place.

const SEL_KEY = "profile.sel";
const FILTERS_KEY = "profile.stories.filters";

/** A parsed hash ("story brightpay-s7", "metric brightpay-m8") to the pane that holds it. */
function resolveSel(parsed, index, roles) {
  if (!parsed || parsed.kind === "home") return null;
  if (parsed.kind === "metric") {
    const m = index?.metricsById.get(parsed.target);
    return m ? { kind: "role", id: m.roleId, target: parsed.target } : null;
  }
  if (parsed.kind === "story") {
    const id = parsed.target || "";
    const s = index?.byId.get(id);
    if (s) return s.kind === "behavioral" ? { kind: "behavioral", target: id } : { kind: "role", id: s.roleId, target: id };
    if (id.startsWith("proj-")) return { kind: "projects", target: id };
    if (id.startsWith("gen-")) return { kind: "behavioral", target: id };
    const roleId = id.split("-s")[0];
    return roles.some((r) => r.id === roleId) ? { kind: "role", id: roleId, target: id } : null;
  }
  if (parsed.kind === "role" && !roles.some((r) => r.id === parsed.id)) return null;
  return parsed;
}

function WarningsDetail({ warnings }) {
  const byFile = useMemo(() => {
    const map = new Map();
    for (const w of warnings) {
      if (!map.has(w.file)) map.set(w.file, []);
      map.get(w.file).push(stripFilePrefix(w.message, w.file));
    }
    return [...map.entries()];
  }, [warnings]);

  return (
    <div>
      <div className="card">
        <div className="section-title">{warnings.length} thing{warnings.length === 1 ? "" : "s"} to confirm</div>
        <div className="muted small">
          None of these block a document from being generated — they are simply left out of it. An unconfirmed
          number never reaches a résumé, and a draft story is not drawn on. Edit the file, then reload above.
        </div>
      </div>
      {byFile.map(([file, messages]) => (
        <div className="card" key={file}>
          <div className="section-title mb-2"><code>profile/{file}</code></div>
          <ul className="small tight-list">{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

export default function ProfileView() {
  const { profile, index, error: loadError, reload } = useProfile();
  const active = useIsActiveView();
  const [error, setError] = useState(null);
  const [reloading, setReloading] = useState(false);
  // The raw selection: a parsed hash or the stored one; resolved against
  // the loaded profile at render time, so a deep link to a story works
  // before the profile has arrived.
  const [sel, setSel] = useState(() => parseHash(location.hash) || readStored(SEL_KEY, null));
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, ...readStored(FILTERS_KEY, {}) }));

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash(location.hash);
      if (parsed) setSel({ ...parsed, nonce: Date.now() });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const roles = useMemo(() => profile?.roles || [], [profile]);
  const effectiveSel = useMemo(() => {
    const resolved = resolveSel(sel, index, roles);
    if (resolved) return { ...resolved, nonce: sel?.nonce };
    return roles.length ? { kind: "role", id: roles[0].id } : { kind: "basics" };
  }, [sel, index, roles]);

  // Remembered without the target: a reload should come back to the pane,
  // not re-scroll to a story picked an hour ago.
  useEffect(() => {
    if (!profile) return;
    const { nonce: _nonce, target: _target, ...rest } = effectiveSel;
    writeStored(SEL_KEY, rest);
  }, [effectiveSel, profile]);

  useEffect(() => { writeStored(FILTERS_KEY, filters); }, [filters]);

  // Coming back to the tab: put the pane's hash back (App clears it when
  // leaving, so a reload from Jobs stays on Jobs).
  useEffect(() => {
    if (active && profile && !isProfileHash(location.hash)) {
      history.replaceState(null, "", toHash(effectiveSel));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, profile]);

  const select = useCallback((next) => {
    const h = toHash(next);
    if (location.hash === h) setSel({ ...next, nonce: Date.now() });
    else location.hash = h; // the hashchange listener picks it up; back/forward work
  }, []);

  const doReload = async () => {
    setReloading(true);
    setError(null);
    try {
      // The shared cache notifies every reader, the top bar's warning
      // count included.
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setReloading(false);
    }
  };

  const linkContext = useMemo(() => ({ resolve: (id) => index?.resolve(id) || null }), [index]);

  if ((error || loadError) && !profile) {
    return <div className="container container-wide"><ErrorBox>{error || loadError}</ErrorBox></div>;
  }
  if (!profile || !index) {
    return <div className="container container-wide"><div className="muted small">Loading…</div></div>;
  }

  const { header, warnings = [], skills = [], behavioral = [], projects = [] } = profile;
  const totalStories = roles.reduce((n, r) => n + r.storyCount, 0);
  const usableMetrics = roles.reduce((n, r) => n + r.verifiedMetricCount, 0);
  const totalMetrics = roles.reduce((n, r) => n + r.totalMetricCount, 0);
  const writtenBehavioral = behavioral.filter((b) => b.status !== "missing").length;
  const selectedRole = effectiveSel.kind === "role" ? roles.find((r) => r.id === effectiveSel.id) : null;
  const { target, nonce } = effectiveSel;

  const isActive = (kind, id) => effectiveSel.kind === kind && (id === undefined || effectiveSel.id === id);

  return (
    <div className="container container-wide">
      <div className="card mb-4">
        <div className="spread gap-3 wrap">
          <div>
            <div className="strong">{header?.name || "Profile"}</div>
            <div className="muted small">
              Everything written for you comes from these files, and nothing outside them is stated as fact.
            </div>
          </div>
          <button type="button" className="btn-muted" onClick={doReload} disabled={reloading}>
            {reloading ? "Reloading…" : "Reload from disk"}
          </button>
        </div>
        <div className="flex-row small mt-3 gap-4 wrap">
          <span><b>{roles.length}</b> roles</span>
          <span><b>{totalStories}</b> stories</span>
          <span><b>{usableMetrics}</b>/{totalMetrics} numbers usable</span>
          <span><b>{skills.length}</b> skills</span>
          <span><b>{writtenBehavioral}</b>/{behavioral.length} behavioural</span>
          <span><b>{projects.length}</b> projects</span>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      <ProfileLinkContext.Provider value={linkContext}>
        <div className="rail-layout">
          <div className="rail">
            {warnings.length > 0 && (
              <button
                type="button"
                className={`rail-item rail-item-warn ${isActive("warnings") ? "active" : ""}`}
                onClick={() => select({ kind: "warnings" })}
              >
                <div className="bold">Needs confirming</div>
                <div className="rail-meta">{warnings.length} item{warnings.length === 1 ? "" : "s"} left out of documents</div>
              </button>
            )}

            <div className="rail-heading">Prepare</div>
            <button type="button" className={`rail-item ${isActive("stories") ? "active" : ""}`} onClick={() => select({ kind: "stories" })}>
              <div className="bold">All stories</div>
              <div className="rail-meta">{index.stories.length} across roles and behavioural</div>
            </button>
            <button type="button" className={`rail-item ${isActive("rehearse") ? "active" : ""}`} onClick={() => select({ kind: "rehearse" })}>
              <div className="bold">Rehearse</div>
              <div className="rail-meta">flashcards — space to reveal</div>
            </button>
            <button type="button" className={`rail-item ${isActive("questions") ? "active" : ""}`} onClick={() => select({ kind: "questions" })}>
              <div className="bold">Question bank</div>
              <div className="rail-meta">what you have actually been asked</div>
            </button>

            <div className="rail-heading">Roles</div>
            {roles.map((r) => {
              const unverified = r.totalMetricCount - r.verifiedMetricCount;
              return (
                <button
                  type="button"
                  key={r.id}
                  className={`rail-item ${isActive("role", r.id) ? "active" : ""}`}
                  onClick={() => select({ kind: "role", id: r.id })}
                >
                  <div className="bold">{r.company}</div>
                  <div className="rail-meta">
                    {r.dates}
                    <br />
                    {r.storyCount} stories
                    {r.totalMetricCount > 0 && ` · ${r.verifiedMetricCount}/${r.totalMetricCount} numbers`}
                    {(unverified > 0 || r.draftCount > 0) && <span className="rail-dot" title="Has unconfirmed content" />}
                  </div>
                </button>
              );
            })}

            <div className="rail-heading">Everything else</div>
            <button type="button" className={`rail-item ${isActive("skills") ? "active" : ""}`} onClick={() => select({ kind: "skills" })}>
              <div className="bold">Skills</div>
              <div className="rail-meta">{skills.length} across all roles</div>
            </button>
            <button type="button" className={`rail-item ${isActive("behavioral") ? "active" : ""}`} onClick={() => select({ kind: "behavioral" })}>
              <div className="bold">Behavioural</div>
              <div className="rail-meta">{writtenBehavioral} of {behavioral.length} written</div>
            </button>
            <button type="button" className={`rail-item ${isActive("projects") ? "active" : ""}`} onClick={() => select({ kind: "projects" })}>
              <div className="bold">Projects</div>
              <div className="rail-meta">{projects.length} recorded, never on the résumé</div>
            </button>
            <button type="button" className={`rail-item ${isActive("basics") ? "active" : ""}`} onClick={() => select({ kind: "basics" })}>
              <div className="bold">Basics & targets</div>
              <div className="rail-meta">Contact, timeline, why looking</div>
            </button>
          </div>

          <div className="rail-main">
            {effectiveSel.kind === "warnings" && <WarningsDetail warnings={warnings} />}
            {effectiveSel.kind === "role" && selectedRole && (
              <RoleDetail role={selectedRole} index={index} target={target} nonce={nonce} />
            )}
            {effectiveSel.kind === "stories" && (
              <StoriesView index={index} filters={filters} onFilters={setFilters} target={target} nonce={nonce} />
            )}
            {effectiveSel.kind === "rehearse" && (
              <RehearseView index={index} active={active} startStory={target} nonce={nonce} />
            )}
            {effectiveSel.kind === "questions" && <QuestionBankView />}
            {effectiveSel.kind === "skills" && (
              <SkillsDetail skills={skills} doNotClaim={profile.skillsDoNotClaim} roles={roles} />
            )}
            {effectiveSel.kind === "behavioral" && <BehavioralDetail stories={behavioral} target={target} nonce={nonce} />}
            {effectiveSel.kind === "projects" && <ProjectsDetail projects={projects} target={target} nonce={nonce} />}
            {effectiveSel.kind === "basics" && <BasicsDetail profile={profile} />}
          </div>
        </div>
      </ProfileLinkContext.Provider>
    </div>
  );
}
