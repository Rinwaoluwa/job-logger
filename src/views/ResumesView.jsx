import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { BRIEF_SOURCE } from "../../shared/briefs.js";
import { useTaskTransition } from "../hooks/useTasks.jsx";
import BriefForm from "../components/briefs/BriefForm.jsx";
import BriefList from "../components/briefs/BriefList.jsx";
import ErrorBox from "../components/ErrorBox.jsx";

/** Résumés tab: a résumé from a job title and skills, with no posting.
 * Each run is a hidden job (shared/briefs.js) so documents, revisions and
 * exports are the same ones a real job gets; this view is the only place
 * they are listed. */
export default function ResumesView({ openRequest }) {
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      setBriefs(await api.listBriefs());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // A toast about a brief lands on its row.
  useEffect(() => {
    if (openRequest?.id) setOpenId(openRequest.id);
  }, [openRequest]);

  // A finished prepare adds the résumé; a finished revision or cover
  // letter adds a version the open panel should show.
  useTaskTransition(
    (t) => t.job?.source === BRIEF_SOURCE,
    () => {
      reload();
      setRefreshKey((k) => k + 1);
    },
  );

  const onStarted = async (res) => {
    await reload();
    setOpenId(res.jobId);
  };

  const onDelete = async (id) => {
    try {
      await api.deleteJob(id);
      if (openId === id) setOpenId(null);
      await reload();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="container container-wide">
      <div className="card mb-4">
        <div className="strong mb-1">Résumé for a role</div>
        <div className="muted small mb-3">
          No posting needed. Give the title you are going for and the skills to lead with; the résumé is written from your profile the same way a tailored one is.
        </div>
        <BriefForm onStarted={onStarted} />
      </div>
      <ErrorBox>{error}</ErrorBox>
      {loading ? (
        <div className="card muted small">Loading…</div>
      ) : (
        <BriefList
          briefs={briefs}
          openId={openId}
          onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
          onDelete={onDelete}
          refreshKey={refreshKey}
        />
      )}
    </div>
  );
}
