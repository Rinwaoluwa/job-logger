// The Profile tab's place in the URL. Every story, metric and project is
// addressable, so the AI-written text ("see brightpay-s7"), the job drawer's
// story chips and a pasted link all land on the same entry.
//
//   #/profile/role/<roleId>[/story/<storyId>]
//   #/profile/story/<id>        canonical deep link, any kind of story
//   #/profile/metric/<id>
//   #/profile/project/<id>
//   #/profile/stories · rehearse[?story=<id>] · questions · skills ·
//   behavioral · projects · basics · warnings

export const PROFILE_HASH_PREFIX = "#/profile";

export function isProfileHash(hash = typeof location !== "undefined" ? location.hash : "") {
  return String(hash || "").startsWith(PROFILE_HASH_PREFIX);
}

const PANES = new Set(["stories", "rehearse", "questions", "skills", "behavioral", "projects", "basics", "warnings"]);

/** @returns {null | {kind:string, id?:string, target?:string}} */
export function parseHash(hash) {
  if (!isProfileHash(hash)) return null;
  const rest = hash.slice(PROFILE_HASH_PREFIX.length);
  const [path, query = ""] = rest.split("?");
  const parts = path.split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
  const params = Object.fromEntries(new URLSearchParams(query));
  if (parts.length === 0) return { kind: "home" };
  switch (parts[0]) {
    case "role":
      return { kind: "role", id: parts[1], target: parts[2] === "story" ? parts[3] : undefined };
    case "story":
      return { kind: "story", target: parts[1] };
    case "metric":
      return { kind: "metric", target: parts[1] };
    case "project":
      return { kind: "projects", target: parts[1] };
    case "rehearse":
      return { kind: "rehearse", target: params.story || undefined };
    default:
      return PANES.has(parts[0]) ? { kind: parts[0] } : null;
  }
}

export function toHash(sel) {
  const enc = encodeURIComponent;
  if (!sel) return PROFILE_HASH_PREFIX;
  switch (sel.kind) {
    case "role":
      return sel.target
        ? `${PROFILE_HASH_PREFIX}/role/${enc(sel.id)}/story/${enc(sel.target)}`
        : `${PROFILE_HASH_PREFIX}/role/${enc(sel.id)}`;
    case "rehearse":
      return sel.target ? `${PROFILE_HASH_PREFIX}/rehearse?story=${enc(sel.target)}` : `${PROFILE_HASH_PREFIX}/rehearse`;
    case "projects":
      return sel.target ? `${PROFILE_HASH_PREFIX}/project/${enc(sel.target)}` : `${PROFILE_HASH_PREFIX}/projects`;
    case "behavioral":
      return sel.target ? `${PROFILE_HASH_PREFIX}/story/${enc(sel.target)}` : `${PROFILE_HASH_PREFIX}/behavioral`;
    case "story":
    case "metric":
      return `${PROFILE_HASH_PREFIX}/${sel.kind}/${enc(sel.target)}`;
    default:
      return `${PROFILE_HASH_PREFIX}/${sel.kind}`;
  }
}
