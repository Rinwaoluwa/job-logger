import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { buildStoryIndex } from "../lib/storyIndex.js";

// One copy of the profile for the whole app. The Profile tab, the job
// drawer's story chips and the top bar's warning count all read it;
// fetching it once and sharing one parsed story index keeps thirty chips
// in an interview prep from each re-reading 40 stories.

let cache = null;
let inflight = null;
const listeners = new Set();
const indexes = new WeakMap();

/** The story index for a profile object, built once per object. */
export function indexFor(profile) {
  if (!profile) return null;
  let index = indexes.get(profile);
  if (!index) {
    index = buildStoryIndex(profile);
    indexes.set(profile, index);
  }
  return index;
}

/** @param {{force?: boolean}} [opts] force re-reads the files on the server. */
export function loadProfile({ force = false } = {}) {
  if (cache && !force) return Promise.resolve(cache);
  if (!inflight || force) {
    inflight = (force ? api.reloadProfile() : api.profile())
      .then((p) => {
        cache = p;
        inflight = null;
        for (const l of listeners) l(p);
        return p;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

export function useProfile() {
  const [profile, setProfile] = useState(cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    listeners.add(setProfile);
    if (cache && profile !== cache) setProfile(cache);
    if (!cache) loadProfile().catch((e) => setError(e.message));
    return () => listeners.delete(setProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(() => loadProfile({ force: true }), []);
  return { profile, index: indexFor(profile), error, reload };
}
