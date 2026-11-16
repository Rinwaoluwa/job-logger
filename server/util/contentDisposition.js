/**
 * A Content-Disposition value that names the file for every client:
 * `filename` is the ASCII-safe form older agents read, `filename*` the
 * UTF-8 one (RFC 6266) that keeps accents and the like intact.
 * @param {"attachment"|"inline"} type
 * @param {string} fileName
 */
export function contentDisposition(type, fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(fileName);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
