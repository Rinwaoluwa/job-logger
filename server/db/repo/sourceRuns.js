import { run, all, get } from "../index.js";

export function startSourceRun(source) {
  const info = run(
    `INSERT INTO source_runs (source, started_at) VALUES (?, datetime('now'))`,
    [source],
  );
  return info.lastInsertRowid;
}

export function finishSourceRun(id, { ok, fetched = 0, inserted = 0, updated = 0, skipped = 0, error = null }) {
  run(
    `UPDATE source_runs SET finished_at = datetime('now'), ok = ?, fetched = ?, inserted = ?, updated = ?, skipped = ?, error = ?
     WHERE id = ?`,
    [ok ? 1 : 0, fetched, inserted, updated, skipped, error, id],
  );
}

export function latestRunsPerSource() {
  return all(`
    SELECT sr.* FROM source_runs sr
    INNER JOIN (SELECT source, MAX(id) AS max_id FROM source_runs GROUP BY source) latest
      ON latest.source = sr.source AND latest.max_id = sr.id
    ORDER BY sr.source
  `);
}

export function getSourceRun(id) {
  return get(`SELECT * FROM source_runs WHERE id = ?`, [id]);
}
