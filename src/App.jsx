import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { TasksProvider } from "./hooks/useTasks.jsx";
import { useProfile } from "./hooks/useProfile.jsx";
import { ActiveViewContext } from "./hooks/useIsActiveView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Toasts from "./components/Toasts.jsx";
import { BRIEF_SOURCE } from "../shared/briefs.js";
import { isProfileHash } from "./lib/profileHash.js";
import { isInterviewsHash } from "./lib/interviewsHash.js";

// One chunk per tab: the first paint loads the shell and the tab you were
// on, not the mock interview, the profile reader and the résumé workspace.
const JobsView = lazy(() => import("./views/JobsView.jsx"));
const ApplicationsView = lazy(() => import("./views/ApplicationsView.jsx"));
const InterviewsView = lazy(() => import("./views/InterviewsView.jsx"));
const ResumesView = lazy(() => import("./views/ResumesView.jsx"));
const AnswerView = lazy(() => import("./views/AnswerView.jsx"));
const ProfileView = lazy(() => import("./views/ProfileView.jsx"));
const InsightsView = lazy(() => import("./views/InsightsView.jsx"));

const DEFAULT_VIEW = "jobs";

// A profile link in the URL (#/profile/story/brightpay-s7) wins over the tab
// that was open last: that is what a pasted or clicked link means.
function readLastView() {
  if (isProfileHash(location.hash)) return "profile";
  if (isInterviewsHash(location.hash)) return "interviews";
  try {
    return localStorage.getItem("app.view") || DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

const Fallback = () => <div className="container muted small">Loading…</div>;

export default function App() {
  const [view, setView] = useState(readLastView);
  // The warning count in the top bar comes from the shared profile cache,
  // the same object the Profile tab and the story chips read.
  const { profile } = useProfile();
  const profileWarningCount = profile?.warnings?.length || 0;
  // A request from outside the Jobs tab (a toast, the activity panel) to
  // open a job's drawer. The nonce makes the same job openable twice.
  const [openRequest, setOpenRequest] = useState(null);
  // The same for a brief on the Résumés tab, which has no job drawer.
  const [briefOpenRequest, setBriefOpenRequest] = useState(null);

  // Views are mounted on first visit and then kept mounted, hidden with
  // CSS rather than unmounted. Switching tabs used to throw away every
  // view's state — filters, search text, scroll position, which job drawer
  // was open, an answer you were half way through writing — and refetch
  // from scratch on the way back. Keeping them alive costs a little memory
  // and makes the tabs behave the way people expect. Each pane knows
  // whether it is the one on screen through ActiveViewContext, so hidden
  // ones hold off their polling and refetching.
  const [mounted, setMounted] = useState(() => new Set([readLastView()]));

  const changeView = useCallback((next) => {
    setView(next);
    setMounted((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    try {
      localStorage.setItem("app.view", next);
    } catch {
      /* private window etc — non-fatal */
    }
    // The Profile and Interviews tabs keep their place in the hash; leaving
    // one clears it so a reload from another tab does not jump back.
    if ((next !== "profile" && isProfileHash(location.hash)) || (next !== "interviews" && isInterviewsHash(location.hash))) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, []);

  // A story chip in a job drawer, or any other in-app link, sets a profile
  // hash: switch to the tab so the link lands.
  useEffect(() => {
    const onHash = () => {
      if (isProfileHash(location.hash)) changeView("profile");
      else if (isInterviewsHash(location.hash)) changeView("interviews");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [changeView]);

  // A toast or notification about a job. Briefs (Résumés tab) are hidden
  // jobs with no drawer, so they open on their own tab instead.
  // `tab` opens the drawer on that tab (the Insights page sends "Application").
  const openJob = useCallback((jobId, job = null, { tab = null } = {}) => {
    if (job?.source === BRIEF_SOURCE) {
      changeView("resumes");
      setBriefOpenRequest({ id: jobId, nonce: Date.now() });
      return;
    }
    changeView("jobs");
    setOpenRequest({ id: jobId, nonce: Date.now(), tab });
  }, [changeView]);

  const openProfile = useCallback(() => changeView("profile"), [changeView]);

  // The elements do not depend on which tab is showing, so a tab switch
  // re-renders the shell and nothing inside the panes.
  const panes = useMemo(() => ([
    { key: "jobs", node: <JobsView openRequest={openRequest} /> },
    { key: "applications", node: <ApplicationsView /> },
    { key: "interviews", node: <InterviewsView /> },
    { key: "resumes", node: <ResumesView openRequest={briefOpenRequest} /> },
    { key: "answer", node: <AnswerView /> },
    { key: "profile", node: <ProfileView /> },
    { key: "insights", node: <InsightsView /> },
  ]), [openRequest, briefOpenRequest]);

  return (
    <TasksProvider onOpenJob={openJob}>
      <div className="app-shell">
        <Sidebar
          view={view}
          onChangeView={changeView}
          profileWarningCount={profileWarningCount}
          onOpenProfile={openProfile}
        />
        <main className="app-main">
          {panes.map(({ key, node }) =>
            mounted.has(key) ? (
              // `hidden` rather than conditional rendering: the pane keeps its
              // state while it is off screen.
              <div key={key} hidden={view !== key}>
                <ActiveViewContext.Provider value={view === key}>
                  <Suspense fallback={<Fallback />}>{node}</Suspense>
                </ActiveViewContext.Provider>
              </div>
            ) : null,
          )}
        </main>
        <Toasts />
      </div>
    </TasksProvider>
  );
}
