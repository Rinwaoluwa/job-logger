// Where the typeface lives on disk, for the three server-side consumers:
// the PDF writer registers the files with pdfkit, the .docx writer embeds
// the regular face as a Buffer, and the page measurement points Chrome at
// the directory over file://. The family and file names themselves are in
// shared/resumeLayout.js so the browser template agrees with them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FONT } from "../../shared/resumeLayout.js";

export const FONT_DIR = fileURLToPath(new URL("./fonts/", import.meta.url));
export const FONT_FILE_URL_BASE = pathToFileURL(FONT_DIR).href.replace(/\/$/, "");

/** @param {"regular"|"bold"} weight */
export const fontPath = (weight) => path.join(FONT_DIR, FONT.files[weight]);

const cache = new Map();

/** The TTF bytes, read once per process. @param {"regular"|"bold"} weight */
export function fontData(weight) {
  if (!cache.has(weight)) cache.set(weight, readFileSync(fontPath(weight)));
  return cache.get(weight);
}
