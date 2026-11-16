import { useMemo } from "react";
import { useProfile } from "../../hooks/useProfile.jsx";
import { cheatSheetHtml, cheatSheetText } from "../../lib/cheatSheetHtml.js";
import { downloadHtml, printHtml } from "../../lib/download.js";
import Modal from "../ui/Modal.jsx";
import CopyButton from "../ui/CopyButton.jsx";

// The one page to read before walking in. Previewed as the same HTML
// that prints, so there is no second layout to trust.

export default function CheatSheet({ prep, job, round, onClose }) {
  const { index } = useProfile();
  const ctx = useMemo(() => ({ prep, job, round, storiesById: index?.byId }), [prep, job, round, index]);
  const html = useMemo(() => cheatSheetHtml(ctx), [ctx]);
  const filename = `${job.company} - ${job.title} - cheat sheet.html`.replace(/[\\/:*?"<>|]+/g, "-");

  return (
    <Modal
      onClose={onClose}
      size="xl"
      flush
      title="Cheat sheet"
      description="Watch-outs first, then the beats and the stories. Nothing here is new — it is the prep, condensed."
      headerActions={(
        <>
          <CopyButton text={() => cheatSheetText(ctx)} label="Copy text" />
          <button type="button" className="btn-sm btn-muted" onClick={() => printHtml(html).catch(() => {})}>Print</button>
          <button type="button" className="btn-sm btn-muted" onClick={() => downloadHtml(html, filename)}>Download</button>
        </>
      )}
    >
      <iframe title="Cheat sheet" srcDoc={html} className="cheat-frame" sandbox="" />
    </Modal>
  );
}
