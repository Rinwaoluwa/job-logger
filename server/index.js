import express from "express";
import path from "node:path";
import { config } from "./config.js";
import "./db/index.js"; // runs migrations on import

import { router as healthRouter } from "./routes/health.js";
import { router as profileRouter } from "./routes/profile.js";
import { router as jobsRouter } from "./routes/jobs.js";
import { router as sourcesRouter } from "./routes/sources.js";
import { router as applicationsRouter } from "./routes/applications.js";
import { router as attachmentsRouter } from "./routes/attachments.js";
import { router as settingsRouter } from "./routes/settings.js";
import { router as documentsRouter } from "./routes/documents.js";
import { router as aiRouter } from "./routes/ai.js";
import { router as tasksRouter } from "./routes/tasks.js";
import { router as aiCallsRouter } from "./routes/aiCalls.js";
import { router as outreachRouter } from "./routes/outreach.js";
import { router as briefsRouter } from "./routes/briefs.js";
import { router as interviewsRouter } from "./routes/interviews.js";
import { router as peopleRouter } from "./routes/people.js";
import { router as analyticsRouter } from "./routes/analytics.js";

import { startWorker, shutdownWorker } from "./tasks/worker.js";
import { startScheduler } from "./jobs/scheduler.js";

if (config.host !== "127.0.0.1" && config.host !== "localhost" && !config.allowRemote) {
  console.error(
    `[server] refusing to bind to "${config.host}" — this app has no auth and exposes AI/job data. ` +
    `Set ALLOW_REMOTE=1 in .env if you really want that (e.g. accessing it from another device on your LAN).`,
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

// The résumé typeface, served so the preview iframe and the exported .html
// render in the same font the PDF and .docx embed. The preview iframe is
// sandboxed (opaque origin), and a font fetch from there is a CORS
// request, hence the header.
app.use(
  "/api/fonts",
  (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(path.join(path.dirname(new URL(import.meta.url).pathname), "render/fonts"), { maxAge: "30d" }),
);

app.use("/api", healthRouter);
app.use("/api", profileRouter);
app.use("/api", jobsRouter);
app.use("/api", sourcesRouter);
app.use("/api", applicationsRouter);
app.use("/api", attachmentsRouter);
app.use("/api", settingsRouter);
app.use("/api", documentsRouter);
app.use("/api", aiRouter);
app.use("/api", tasksRouter);
app.use("/api", aiCallsRouter);
app.use("/api", outreachRouter);
app.use("/api", briefsRouter);
app.use("/api", interviewsRouter);
app.use("/api", peopleRouter);
app.use("/api", analyticsRouter);

// Centralized error handler — anything an inner handler throws or forwards
// via next(err) lands here as JSON instead of Express's default HTML page.
app.use((err, _req, res, _next) => {
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Production: serve the built SPA and fall back to it for client-side routing.
if (process.env.NODE_ENV === "production") {
  app.use(express.static(config.distDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(config.distDir, "index.html"));
  });
}

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  startWorker();
  startScheduler();
});

// Every long operation is a background task (POST returns a taskId at
// once), so no request is expected to run long; still, never cut one off.
server.timeout = 0;

// On shutdown — including the SIGTERM `node --watch` sends on every file
// change — abort the running tasks so their `claude`/Chrome children die
// with us. They are re-queued on the next boot; without this, the old
// process would keep spending while the new one started a second copy.
let shuttingDown = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownWorker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
