import { prettyLabel } from "../../lib/profileFormat.js";
import Prose from "./Prose.jsx";

function KeyValues({ title, data, blurb, prose = false }) {
  const entries = Object.entries(data || {});
  if (entries.length === 0) return null;
  return (
    <div className="card">
      <div className="section-title">{title}</div>
      {blurb && <div className="muted small mb-2">{blurb}</div>}
      <dl className="kv">
        {entries.map(([k, v]) => (
          <div className="kv-row" key={k}>
            <dt>{prettyLabel(k)}</dt>
            <dd>{prose ? <Prose text={String(v)} className="" /> : String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BulletCard({ title, items, blurb, tone }) {
  if (!items?.length) return null;
  return (
    <div className={`card ${tone === "warn" ? "warn-card" : ""}`}>
      <div className="section-title">{title}</div>
      {blurb && <div className="muted small mb-2">{blurb}</div>}
      <ul className="small tight-list">{items.map((x, i) => <li key={i}><Prose text={x} className="small inline-prose" /></li>)}</ul>
    </div>
  );
}

function TimelineTable({ timeline }) {
  if (!timeline?.length) return null;
  return (
    <div className="card">
      <div className="section-title">Employment timeline — the truth</div>
      <div className="muted small mb-2">
        Dates and arrangements as they are stated on every document and in any background check.
      </div>
      <div className="table-wrap">
        <table className="data-table timeline-table">
          <thead>
            <tr><th>Id</th><th>Company</th><th>Title</th><th>Dates</th><th>Arrangement</th><th>On résumé</th></tr>
          </thead>
          <tbody>
            {timeline.map((t) => (
              <tr key={t.id}>
                <td><code className="id-chip">{t.id}</code></td>
                <td className="medium">{t.company}</td>
                <td className="small">{t.title}</td>
                <td className="small nowrap">{t.dates}</td>
                <td className="small muted">{t.employmentType}</td>
                <td className="small muted">{t.showOnResume ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BasicsDetail({ profile }) {
  const {
    header, targets, workAuth, education, certifications, globalDoNotClaim,
    overlapExplanation, timeline, timelineNotes, whyLooking, years,
  } = profile;

  return (
    <div>
      <KeyValues
        title="Contact — as it appears at the top of every résumé"
        data={header}
      />
      <KeyValues
        title="What you are looking for"
        data={{ ...(years != null ? { years_of_experience_to_state: years } : {}), ...targets }}
        blurb="Used to judge fit and to decide which roles are worth tailoring for."
        prose
      />
      {whyLooking && (
        <div className="card">
          <div className="section-title">Why looking / what next</div>
          <div className="muted small mb-2">
            The framing for "why are you looking", "why Canada", "where in five years" and the strengths and
            weakness to state. Cover letters, outreach and interview prep all read this.
          </div>
          <Prose text={whyLooking} />
        </div>
      )}
      <KeyValues
        title="Work authorization"
        data={workAuth}
        blurb="Quoted directly when an application asks. Nothing here is ever softened or guessed at."
      />
      <TimelineTable timeline={timeline} />
      {overlapExplanation && (
        <div className="card">
          <div className="section-title">Overlapping employment — the agreed explanation</div>
          <Prose text={overlapExplanation} />
        </div>
      )}
      <KeyValues
        title="Timeline notes — how to talk about the dates"
        data={timelineNotes}
        blurb="Where each role was worked from, the tails after each end date, the study overlap."
        prose
      />
      <BulletCard title="Education" items={education} />
      <BulletCard title="Certifications" items={certifications} />
      <BulletCard
        title="Never claim, on any role"
        items={globalDoNotClaim}
        tone="warn"
        blurb="Applied across every document, on top of each role's own list."
      />
    </div>
  );
}
