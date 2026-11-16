export function downloadHtml(html, filename) {
  const blob = new Blob([html], { type: "text/html" });
  saveBlob(blob, filename);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * The filename the server put in Content-Disposition, if any. The UTF-8
 * `filename*` form wins (it keeps accents); the plain `filename` is the
 * fallback.
 */
export function servedFilename(res) {
  const header = res.headers.get("content-disposition") || "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      /* fall through to the plain name */
    }
  }
  return /filename="([^"]+)"/.exec(header)?.[1] || null;
}

/**
 * Fetch a server-rendered file and save it. The server names the file
 * (it knows the job's company); `fallbackName` is only for a response
 * without a Content-Disposition.
 */
export async function downloadFromApi(path, fallbackName) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  saveBlob(await res.blob(), servedFilename(res) || fallbackName);
}

/** Prints HTML via a hidden iframe, waiting for the iframe's load event
 * before calling print() — fixes the old app's race where print() ran
 * before the document (and its <style>) had actually loaded. */
export function printHtml(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.removeEventListener("focus", onAfterPrint);
      setTimeout(() => iframe.remove(), 500);
    };
    const onAfterPrint = () => {
      cleanup();
      resolve();
    };

    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        // "afterprint" doesn't reliably fire in every browser's iframe
        // print flow, so also fall back to a focus-return heuristic.
        iframe.contentWindow.addEventListener("afterprint", onAfterPrint);
        window.addEventListener("focus", onAfterPrint, { once: true });
        iframe.contentWindow.print();
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    iframe.srcdoc = html;
  });
}
