const ACRONYMS = new Set(["usa", "us", "uk", "cad", "usd", "gpa", "api", "llm", "ai", "hr", "pr"]);

/** "salary_floor_cad" -> "Salary floor CAD". Sentence case, except for
 *  the handful of acronyms that read as typos in lower case. */
export function prettyLabel(key) {
  const words = String(key).replace(/_/g, " ").trim().split(/\s+/);
  return words
    .map((w, i) => {
      if (ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

/** Warning messages already open with the filename; the UI shows that
 *  separately, so drop the duplicated prefix. */
export function stripFilePrefix(message, file) {
  return message.startsWith(`${file}: `) ? message.slice(file.length + 2) : message;
}

/** The profile files are hand-wrapped at ~75 columns, so rendering them
 *  verbatim reproduces those breaks in the middle of a wide column. Blank
 *  lines are real paragraph breaks; single newlines are just wrapping. */
export function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}
