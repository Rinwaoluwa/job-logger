// Thin wrapper around node's built-in node:sqlite (DatabaseSync). Chosen
// over better-sqlite3, which segfaulted on the
// original development machine. node:sqlite is still "Experimental" in
// Node 22 — run scripts with --disable-warning=ExperimentalWarning to
// silence the startup notice (already set in package.json scripts).

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { migrations } from "./migrations.js";

// Loaded through require rather than a static import: the test runner's
// module graph does not know the experimental node:sqlite builtin.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

mkdirSync(path.dirname(config.dbPath), { recursive: true });

const sqlite = new DatabaseSync(config.dbPath);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

function migrate() {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const applied = new Set(
    sqlite.prepare("SELECT id FROM _migrations").all().map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(m.sql);
      sqlite.prepare("INSERT INTO _migrations (id) VALUES (?)").run(m.id);
      sqlite.exec("COMMIT");
      console.log(`[db] applied migration ${m.id}`);
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw new Error(`migration ${m.id} failed: ${e.message}`);
    }
  }
}

migrate();

/** Run a statement that doesn't return rows (INSERT/UPDATE/DELETE without RETURNING). */
export function run(sql, params = []) {
  return sqlite.prepare(sql).run(...params);
}

/** Run a statement expected to return zero or one row. */
export function get(sql, params = []) {
  return sqlite.prepare(sql).get(...params);
}

/** Run a statement expected to return zero or more rows. */
export function all(sql, params = []) {
  return sqlite.prepare(sql).all(...params);
}

/** Run fn inside a transaction; rolls back if fn throws. */
export function transaction(fn) {
  sqlite.exec("BEGIN");
  try {
    const result = fn();
    sqlite.exec("COMMIT");
    return result;
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
}

export const db = sqlite;
export default { db, run, get, all, transaction };
