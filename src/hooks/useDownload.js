import { useState } from "react";
import { downloadFromApi } from "../lib/download.js";

/**
 * Busy/error state around a server-rendered download, shared by the
 * résumé and cover-letter toolbars. `busy` is the key of the format in
 * flight ("pdf", "docx") so the right button can show "Building…".
 */
export function useDownload() {
  const [state, setState] = useState({ busy: null, error: null });
  const download = async (key, path, fallbackName) => {
    setState({ busy: key, error: null });
    try {
      await downloadFromApi(path, fallbackName);
      setState({ busy: null, error: null });
    } catch (e) {
      setState({ busy: null, error: e.message });
    }
  };
  return { ...state, download };
}
