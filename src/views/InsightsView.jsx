import { api } from "../api/client.js";
import { useQuery } from "../hooks/useQuery.js";
import { useIsActiveView } from "../hooks/useIsActiveView.jsx";
import { useLocalStorage } from "../hooks/useLocalStorage.js";
import { APPLIED_VIA_LABELS } from "../lib/stages.js";
import ErrorBox from "../components/ErrorBox.jsx";
import Tabs from "../components/ui/Tabs.jsx";
import Card from "../components/ui/Card.jsx";
import StatTile, { pct } from "../components/insights/StatTile.jsx";
import FunnelBars from "../components/insights/FunnelBars.jsx";
import WeeklyBars from "../components/insights/WeeklyBars.jsx";
import BreakdownTable from "../components/insights/BreakdownTable.jsx";
import StalledList from "../components/insights/StalledList.jsx";
import CostPanel from "../components/insights/CostPanel.jsx";

// What the search is actually producing: the funnel, how often and how
// fast applications get an answer, by channel and by résumé version, the
// applications that have gone quiet, and what the AI spend bought. Every
// rate shows its counts; the sample is small and the page says so.

const RANGES = [
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "Year" },
  { key: "all", label: "All" },
];
const SOURCE_LABELS = { jackandjill: "Jack & Jill", routine: "Job Search Log", link: "Added by link", manual: "Manual" };

const days = (d) => (d == null ? "—" : `${Math.round(d)}d`);

export default function InsightsView() {
  const active = useIsActiveView();
  const [range, setRange] = useLocalStorage("insights.range", "90", { validate: (v) => RANGES.some((r) => r.key === v) });
  const { data, loading, fetching, error, reload } = useQuery(
    (signal) => api.analytics({ days: range }, { signal }),
    [range, active],
    { enabled: active },
  );

  return (
    <div className="container container-wide">
      <div className="insights-head">
        <div className="section-title">Insights</div>
        <Tabs variant="segmented" ariaLabel="Range" items={RANGES} value={range} onChange={setRange} />
        <button type="button" className="btn-sm btn-muted" onClick={reload} disabled={fetching}>{fetching ? "Updating…" : "Refresh"}</button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {loading && !data && <div className="muted small">Loading…</div>}
      {data && <Body data={data} />}
      <div className="insights-foot">
        Applied dates are local days and replies are timestamped in UTC, so days-to-reply can be off by one. A response is
        the first move to interviewing, offer or rejected after the application, or a reply logged on the People tab.
        Rates over fewer than five applications are greyed out.
      </div>
    </div>
  );
}

function Body({ data }) {
  const { counts, funnel, response, byAppliedVia, bySource, weekly, stalled, resumeEffectiveness, outreach, cost, range } = data;
  return (
    <>
      <div className="tiles">
        <StatTile label="Applied" value={counts.applied} sub={range.since ? `since ${range.since}` : "all time"} />
        <StatTile label="Response rate" value={pct(response.rate.rate)} sub={`${response.responded} of ${response.applied} heard back`} n={response.applied} />
        <StatTile label="Median time to reply" value={days(response.medianDays)} sub={response.p75Days == null ? "no replies yet" : `75% within ${days(response.p75Days)}`} n={response.responded} />
        <StatTile label="Interviews" value={counts.interviewing} sub={`${pct(funnel.rates.applied_to_interview.rate)} of applications`} n={response.applied} />
        <StatTile label="Offers" value={counts.offers} sub={`${counts.rejected} rejected · ${counts.open} still open`} />
        <StatTile label="Gone quiet" value={stalled.length} sub={`applied, no reply in ${range.stalledDays}+ days`} />
      </div>

      <div className="insights-grid">
        <Card title="Funnel"><FunnelBars funnel={funnel} /></Card>
        <Card title="By channel"><BreakdownTable rows={byAppliedVia} keyLabel="Applied via" labelFor={(k) => APPLIED_VIA_LABELS[k] || k} /></Card>
        <Card title="Per week" className="span-2"><WeeklyBars weeks={weekly} /></Card>
        <Card title="Gone quiet" actions={<span className="muted small">{stalled.length} application{stalled.length === 1 ? "" : "s"}</span>}>
          <StalledList stalled={stalled} quietAfter={range.stalledDays} />
        </Card>
        <Card title="By résumé version sent">
          <BreakdownTable
            rows={resumeEffectiveness.filter((g) => g.applications > 0).map((g) => ({ ...g, applied: g.applications }))}
            keyLabel="Résumé"
          />
          <div className="muted small mt-2">
            Gap fills and reframes are the review-gated claims on the sent version; 
            {counts.withSentResume} of {counts.applied} applications have a sent version recorded.
          </div>
        </Card>
        <Card title="By source"><BreakdownTable rows={bySource} keyLabel="Source" labelFor={(k) => SOURCE_LABELS[k] || k} /></Card>
        <Card title="Outreach" actions={<span className="muted small">{outreach.sent} sent</span>}>
          {outreach.sent === 0 ? <div className="muted small">No outreach in this range.</div> : (
            <>
              <div className="tiles">
                <StatTile label="Reply rate" value={pct(outreach.rate.rate)} sub={`${outreach.replied} replied · ${outreach.noResponse} marked no response`} n={outreach.sent} />
                {outreach.byChannel.map((c) => (
                  <StatTile key={c.channel} label={c.channel === "email" ? "Email" : "LinkedIn"} value={`${c.replied} / ${c.sent}`} sub="replied / sent" />
                ))}
              </div>
            </>
          )}
        </Card>
        <Card title="AI spend" className="span-2"><CostPanel cost={cost} /></Card>
      </div>
    </>
  );
}
