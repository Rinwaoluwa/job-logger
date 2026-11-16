// Filesystem helpers for the attachment picker. Files are linked in place
// (only the absolute path + a fingerprint are stored — see the plan's
// decision to not copy résumé/cover-letter files into the app), so every
// path this module hands back has already been resolved through
// fs.realpathSync and checked to be a regular file. Two entry points exist:
// browsing a configured folder (resolveInsideFolder — name must be a bare
// filename, no separators) and pasting an absolute path anywhere on disk
// (resolveAbsolutePath — still must exist and have an allowed extension).
import { createHash } from "node:crypto";
import { createReadStream, statSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const ALLOWED_EXTS = new Set([".pdf", ".doc", ".docx", ".pages", ".rtf", ".txt", ".md", ".html", ".odt"]);

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pages": "application/x-iwork-pages-sffpages",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".odt": "application/vnd.oasis.opendocument.text",
};

export function mimeFor(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] || "application/octet-stream";
}

export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function resolveSourceFolder(folderSetting) {
  const expanded = expandHome(folderSetting);
  if (!existsSync(expanded)) {
    return { path: expanded, exists: false, real: null };
  }
  const real = realpathSync(expanded);
  const st = statSync(real);
  if (!st.isDirectory()) throw new Error(`${expanded} is not a directory`);
  return { path: expanded, exists: true, real };
}

export function listSourceFolder(folderSetting) {
  const folder = resolveSourceFolder(folderSetting);
  if (!folder.exists) return { path: folder.path, exists: false, files: [] };
  const entries = readdirSync(folder.real, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => {
      const ext = path.extname(e.name).toLowerCase();
      const abs = path.join(folder.real, e.name);
      const st = statSync(abs);
      return { name: e.name, size: st.size, mtime: st.mtime.toISOString(), ext };
    })
    .filter((f) => ALLOWED_EXTS.has(f.ext))
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { path: folder.path, exists: true, files };
}

// name must be a bare filename (no "/", no ".."), and the resolved real
// path must land inside the folder's real path — this is the actual
// traversal guard; basename-equality alone would still allow a symlink
// planted inside the folder pointing elsewhere, which realpath catches.
export function resolveInsideFolder(folderSetting, name) {
  if (typeof name !== "string" || !name || path.basename(name) !== name) {
    throw new Error("invalid file name");
  }
  const folder = resolveSourceFolder(folderSetting);
  if (!folder.exists) throw new Error("source folder does not exist");
  const candidate = path.join(folder.real, name);
  if (!existsSync(candidate)) throw new Error("file not found");
  const real = realpathSync(candidate);
  if (!(real === folder.real || real.startsWith(folder.real + path.sep))) {
    throw new Error("file is outside the source folder");
  }
  const st = statSync(real);
  if (!st.isFile()) throw new Error("not a regular file");
  const ext = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`unsupported file type: ${ext || "(none)"}`);
  return real;
}

// For the "paste an absolute path" input in the modal/drawer — any path on
// disk is allowed (this app is single-user, local-only, unauthenticated by
// design; see server/index.js's bind guard), but it must genuinely exist,
// be a regular file, and have an allowed extension.
export function resolveAbsolutePath(inputPath) {
  const expanded = expandHome(inputPath);
  if (!path.isAbsolute(expanded)) throw new Error("path must be absolute");
  if (!existsSync(expanded)) throw new Error("file not found");
  const real = realpathSync(expanded);
  const st = statSync(real);
  if (!st.isFile()) throw new Error("not a regular file");
  const ext = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`unsupported file type: ${ext || "(none)"}`);
  return real;
}

export function fingerprint(absPath) {
  const st = statSync(absPath);
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => {
      resolve({
        size: st.size,
        mtime: st.mtime.toISOString(),
        sha256: hash.digest("hex"),
        mime: mimeFor(path.extname(absPath)),
      });
    });
  });
}

// ok: file unchanged since it was linked. changed: still there but size or
// mtime differ (edited/re-exported). missing: no longer at that path.
export function statusOf(filePath, storedSize, storedMtime) {
  if (!filePath) return "linked-doc";
  if (!existsSync(filePath)) return "missing";
  const st = statSync(filePath);
  if (String(st.size) !== String(storedSize) || st.mtime.toISOString() !== storedMtime) return "changed";
  return "ok";
}

export function revealInFinder(absPath) {
  if (process.platform !== "darwin") {
    return Promise.reject(Object.assign(new Error("Reveal in Finder is only available on macOS"), { status: 501 }));
  }
  return new Promise((resolve, reject) => {
    execFile("open", ["-R", absPath], (err) => (err ? reject(err) : resolve()));
  });
}
