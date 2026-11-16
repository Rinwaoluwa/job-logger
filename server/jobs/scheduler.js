import { config } from "../config.js";
import { PRIORITY } from "../../shared/tasks.js";
import { startTask } from "../tasks/start.js";

/** Periodic source refresh, when config/sources.json enables it. It is
 * queued as an ordinary background task, so it shows in the activity
 * panel and can never overlap a refresh the user started by hand (the
 * two share a dedupe key). */
export function startScheduler() {
  const schedule = config.sources?.schedule;
  if (!schedule?.enabled) return;
  const everyMs = (schedule.every_hours || 6) * 3600_000;
  console.log(`[scheduler] refreshing job sources every ${schedule.every_hours || 6}h`);
  setInterval(() => {
    try {
      startTask({ kind: "sources_refresh", payload: { scheduled: true }, priority: PRIORITY.background });
    } catch (e) {
      console.error("[scheduler] could not queue refresh:", e.message);
    }
  }, everyMs);
}
