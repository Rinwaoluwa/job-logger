import { prettyLabel } from "../../lib/profileFormat.js";
import { useTargetRef } from "../../hooks/useTargetRef.js";
import Prose from "./Prose.jsx";
import StoryBody, { MetricsInline } from "./StoryBody.jsx";

function ProseSection({ title, text }) {
  if (!text) return null;
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      <Prose text={text} />
    </div>
  );
}

function MetricRow({ m, target, nonce }) {
  const ref = useTargetRef(m.id, target, nonce);
  return (
    <tr ref={ref} id={m.id} className={m.verified ? "" : "row-muted"}>
      <td>
        <code className="id-chip">{m.id}</code> {m.text}
      </td>
      <td>
        {m.verified
          ? <span className="chip-ok">confirmed</span>
          : <span className="chip-warn" title="Never used in a document until you confirm it">unconfirmed</span>}
      </td>
      <td className="small muted">{m.resume ? "yes" : "—"}</td>
    </tr>
  );
}

// A metric the model is allowed to put in a document, versus one it must
// leave alone. Unverified metrics stay visible — knowing a number exists
// but cannot be used is the point — but they are greyed and labelled.
function MetricsTable({ metrics, target, nonce }) {
  if (metrics.length === 0) {
    return <div className="muted small">No numbers recorded for this role. Bullets here will be qualitative.</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr><th>Metric</th><th>Status</th><th>On résumé</th></tr>
      </thead>
      <tbody>
        {metrics.map((m) => <MetricRow key={m.id} m={m} target={target} nonce={nonce} />)}
      </tbody>
    </table>
  );
}

function Story({ story, target, nonce }) {
  const ref = useTargetRef(story.id, target, nonce);
  const draft = story.status === "draft";
  return (
    <details className="story" id={story.id} ref={ref}>
      <summary>
        <code className="id-chip">{story.id}</code>
        <span className="bold">{story.title}</span>
        {draft && <span className="chip-warn">draft</span>}
        {story.competencies.map((c) => <span key={c} className="tech-chip">{c}</span>)}
        {story.metrics.length > 0 && (
          <div className="story-preview">
            <MetricsInline metrics={story.metrics} />
          </div>
        )}
      </summary>
      <div className="story-body">
        <StoryBody story={story} showMetrics={false} />
      </div>
    </details>
  );
}

/**
 * @param {{role: object, index: object, target?: string, nonce?: number}} props
 *   `index` is the story index (src/lib/storyIndex.js); `target` the
 *   story or metric id the hash points at.
 */
export default function RoleDetail({ role, index, target, nonce }) {
  const unverified = role.metrics.filter((m) => !m.verified).length;
  const stories = role.stories.map((s) => index?.byId.get(s.id)).filter(Boolean);

  return (
    <div>
      <div className="card">
        <div className="spread items-start gap-3 wrap">
          <div>
            <div className="strong text-lg">{role.company}</div>
            <div className="small">{role.title}{role.engagement && <span className="muted"> ({role.engagement})</span>}</div>
            <div className="muted small mt-1">
              {[role.dates, role.location, role.employmentType && prettyLabel(role.employmentType)].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="flex-row gap-2">
            <span className={role.status === "verified" ? "chip-ok" : "chip-warn"}>{role.status}</span>
            {!role.showOnResume && <span className="chip-neutral">hidden from résumé</span>}
          </div>
        </div>

        <div className="flex-row small mt-3 gap-4 wrap">
          <span><b>{role.stories.length}</b> stories</span>
          <span><b>{role.metrics.filter((m) => m.verified).length}</b>/{role.metrics.length} metrics usable</span>
          <span><b>{role.tech.length}</b> technologies</span>
          {unverified > 0 && <span className="inferred-note">{unverified} number{unverified === 1 ? "" : "s"} blocked until confirmed</span>}
        </div>
      </div>

      <div className="card">
        <ProseSection title="Company & product context" text={role.context} />
        <ProseSection title="Team & my role" text={role.team} />

        {role.built.length > 0 && (
          <div className="section">
            <div className="section-title">What I built</div>
            <ul className="small tight-list">{role.built.map((b, i) => <li key={i}><Prose text={b} className="small inline-prose" /></li>)}</ul>
          </div>
        )}

        {role.tech.length > 0 && (
          <div className="section">
            <div className="section-title">Technologies actually used</div>
            {/* The note is usually the part that matters — "no Redis on this
                role", "consumed the APIs, did not write them" — so it is
                shown rather than hidden behind a tooltip. */}
            <ul className="small tech-list">
              {role.tech.map((t, i) => (
                <li key={i}>
                  <span className="medium">{t.name}</span>
                  {t.note && <span className="muted"> — {t.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">Numbers</div>
        <MetricsTable metrics={role.metrics} target={target} nonce={nonce} />
      </div>

      <div className="card">
        <div className="section-title">
          Stories <span className="muted normal normal-case">— the facts every document and answer draws on</span>
        </div>
        {stories.length === 0
          ? <div className="muted small">No stories recorded, so this role can only produce generic bullets.</div>
          : stories.map((s) => <Story key={s.id} story={s} target={target} nonce={nonce} />)}
      </div>

      {role.doNotClaim.length > 0 && (
        <div className="card warn-card">
          <div className="section-title">Do not claim on this role</div>
          <ul className="small tight-list">{role.doNotClaim.map((d, i) => <li key={i}><Prose text={d} className="small inline-prose" /></li>)}</ul>
        </div>
      )}

      {role.notes && (
        <div className="card">
          <div className="section-title">
            Notes from the file <span className="muted normal normal-case">— evidence read, decisions taken, what is still open</span>
          </div>
          <Prose text={role.notes} />
        </div>
      )}
    </div>
  );
}
