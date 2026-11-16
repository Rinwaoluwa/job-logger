// The LinkedIn sign-in behind the People tab. The profile is a Chrome
// user-data-dir of the app's own (config.people.linkedin.profileDir): the
// user signs in once in a visible window, searches then read LinkedIn
// headless through it. Nothing here stores credentials; Chrome keeps its
// own cookies in that folder.

import { Router } from "express";
import { config } from "../config.js";
import { getSetting, setSetting } from "../db/repo/settings.js";
import { checkSignedIn, openSignInWindow, LOGIN_URL } from "../people/linkedin.js";
import { read as readLinkedIn, ReaderError } from "../people/linkedinReader.js";

export const router = Router();

function storedStatus() {
  try {
    const raw = getSetting("linkedin.status");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function payload(status) {
  const li = config.people.linkedin;
  return {
    enabled: li.enabled,
    profileDir: li.profileDir,
    connected: !!status?.connected,
    reason: status?.reason ?? null,
    checkedAt: status?.checkedAt ?? null,
    closedWindow: !!status?.closedWindow,
  };
}

/** Last known sign-in state, without opening a browser. */
router.get("/people/linkedin", (_req, res) => {
  res.json(payload(storedStatus()));
});

/** Live check: loads the feed in the headless profile (a few seconds). */
router.post("/people/linkedin/check", async (_req, res, next) => {
  try {
    const status = await checkSignedIn(config.people.linkedin.profileDir);
    setSetting("linkedin.status", JSON.stringify(status));
    res.json(payload(status));
  } catch (e) {
    next(e);
  }
});

/** Internal: the linkedin MCP proxies (one per search call) read pages
 * through the server's shared browser. The token names the search run the
 * pipeline opened; without a live one the request is refused. */
router.post("/people/linkedin/read", async (req, res) => {
  const { token, url } = req.body ?? {};
  if (typeof token !== "string" || typeof url !== "string") {
    res.status(400).json({ error: "token and url are required" });
    return;
  }
  try {
    res.json(await readLinkedIn(token, url));
  } catch (e) {
    if (e instanceof ReaderError) res.status(e.status).json({ error: e.message });
    else res.status(502).json({ error: `LinkedIn read failed: ${e.message}` });
  }
});

/** Opens the profile in a visible Chrome window on the login page. */
router.post("/people/linkedin/connect", async (_req, res, next) => {
  try {
    await openSignInWindow(config.people.linkedin.profileDir);
    res.json({ opened: true, loginUrl: LOGIN_URL });
  } catch (e) {
    next(e);
  }
});
