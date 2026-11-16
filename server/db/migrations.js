// Ordered migrations, applied once each inside a transaction and tracked in
// _migrations. Append new migrations to this array; never edit an already
// shipped one.

export const migrations = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT,
        url TEXT NOT NULL UNIQUE,
        apply_url TEXT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location_raw TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        work_mode TEXT NOT NULL DEFAULT 'unknown',
        remote_scope TEXT,
        salary_text TEXT,
        salary_min REAL,
        salary_max REAL,
        currency TEXT,
        description_text TEXT NOT NULL DEFAULT '',
        description_html TEXT,
        description_truncated INTEGER NOT NULL DEFAULT 0,
        posted_at TEXT,
        dedupe_key TEXT NOT NULL,
        also_seen_on TEXT NOT NULL DEFAULT '[]',
        raw TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        jd_analysis TEXT,
        jd_analysis_at TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key);
      CREATE INDEX IF NOT EXISTS jobs_posted ON jobs(posted_at);
      CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company);

      CREATE TABLE IF NOT EXISTS applications (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL DEFAULT 'new'
          CHECK (stage IN ('new','saved','applied','interviewing','offer','rejected','not_interested')),
        notes TEXT NOT NULL DEFAULT '',
        applied_at TEXT,
        stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        from_stage TEXT,
        to_stage TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter','answer','fit_report')),
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        content_text TEXT,
        review_decisions TEXT NOT NULL DEFAULT '{}',
        question TEXT,
        cost_usd REAL,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (job_id, kind, version)
      );

      CREATE TABLE IF NOT EXISTS fit_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        score INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        apply_recommendation TEXT NOT NULL,
        result_json TEXT NOT NULL,
        profile_hash TEXT NOT NULL,
        model TEXT,
        cost_usd REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS fit_job ON fit_analyses(job_id, id);

      CREATE TABLE IF NOT EXISTS interview_preps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        result_json TEXT NOT NULL,
        cost_usd REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ai_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purpose TEXT NOT NULL,
        job_id TEXT,
        model TEXT,
        effort TEXT,
        duration_ms INTEGER NOT NULL,
        cost_usd REAL,
        ok INTEGER NOT NULL,
        error TEXT,
        input_chars INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS source_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        ok INTEGER,
        fetched INTEGER DEFAULT 0,
        inserted INTEGER DEFAULT 0,
        updated INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS fit_queue (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        enqueued_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    // Adds the fields needed to track a real application: how/when/where
    // you applied, a frozen snapshot of the JD as it was at that moment,
    // a follow-up date, contact info, and an archive flag — plus the
    // attachments table linking résumé/cover-letter files (or a generated
    // document) to an application. Additive only (ALTER ... ADD COLUMN +
    // CREATE TABLE), so it is safe to run against the live, populated db;
    // no existing column or the stage CHECK constraint is touched.
    id: "002_tracking",
    sql: `
      ALTER TABLE applications ADD COLUMN applied_via TEXT
        CHECK (applied_via IS NULL OR applied_via IN ('company_site','linkedin','indeed','referral','email','recruiter','other'));
      ALTER TABLE applications ADD COLUMN applied_url TEXT;
      ALTER TABLE applications ADD COLUMN referral_name TEXT;
      ALTER TABLE applications ADD COLUMN jd_snapshot TEXT;
      ALTER TABLE applications ADD COLUMN jd_snapshot_at TEXT;
      ALTER TABLE applications ADD COLUMN salary_expectation TEXT;
      ALTER TABLE applications ADD COLUMN next_action TEXT;
      ALTER TABLE applications ADD COLUMN next_action_at TEXT;
      ALTER TABLE applications ADD COLUMN contact_name TEXT;
      ALTER TABLE applications ADD COLUMN contact_email TEXT;
      ALTER TABLE applications ADD COLUMN contact_linkedin TEXT;
      ALTER TABLE applications ADD COLUMN archived_at TEXT;

      CREATE INDEX IF NOT EXISTS applications_stage ON applications(stage);
      CREATE INDEX IF NOT EXISTS applications_applied ON applications(applied_at);
      CREATE INDEX IF NOT EXISTS applications_next_action ON applications(next_action_at);

      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter','other')),
        label TEXT,
        file_path TEXT,
        file_name TEXT,
        size INTEGER,
        mtime TEXT,
        sha256 TEXT,
        mime TEXT,
        document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
        document_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (file_path IS NOT NULL OR document_id IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS attachments_job ON attachments(job_id, created_at);
    `,
  },
  {
    // Persistent background tasks. Replaces the in-memory run registry
    // (which a server restart wiped, taking every in-flight generation's
    // progress with it) and absorbs fit_queue, which was the same idea
    // for one task kind. Every long operation — prepare application,
    // interview prep, answer, fit, add job by link, sources refresh — is a
    // row here, with its stage progress, result, cost and attempts.
    id: "003_tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL
          CHECK (kind IN ('prepare_application','interview_prep','answer','fit','add_job_link','sources_refresh')),
        job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        group_id TEXT,
        dedupe_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued','running','done','failed','cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        stages_json TEXT NOT NULL DEFAULT '[]',
        result_json TEXT,
        error TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tasks_status_prio ON tasks(status, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS tasks_job ON tasks(job_id, created_at);
      CREATE INDEX IF NOT EXISTS tasks_group ON tasks(group_id);
      CREATE INDEX IF NOT EXISTS tasks_finished ON tasks(finished_at);
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_dedupe ON tasks(dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

      INSERT INTO tasks (id, kind, job_id, dedupe_key, status, priority, attempts, error, created_at, stages_json)
      SELECT lower(hex(randomblob(16))), 'fit', job_id,
             CASE WHEN status = 'failed' THEN NULL ELSE 'fit:' || job_id END,
             CASE WHEN status = 'failed' THEN 'failed' ELSE 'queued' END,
             0, attempts, error,
             strftime('%Y-%m-%dT%H:%M:%fZ', enqueued_at),
             '[{"name":"fit","status":"pending"}]'
      FROM fit_queue;
      DROP TABLE fit_queue;
    `,
  },
  {
    // Follow-up instructions on a generated résumé. A revision is a new
    // version that remembers which version it came from and what the user
    // asked for, so the thread of instructions can be shown and fed back
    // to the model on the next revision. The tasks table loses its kind
    // CHECK (SQLite cannot alter one): every new task kind needed a table
    // rebuild, and startTask already rejects a kind with no handler.
    id: "004_revisions",
    sql: `
      ALTER TABLE documents ADD COLUMN parent_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
      ALTER TABLE documents ADD COLUMN instruction TEXT;

      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        group_id TEXT,
        dedupe_key TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued','running','done','failed','cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        stages_json TEXT NOT NULL DEFAULT '[]',
        result_json TEXT,
        error TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      INSERT INTO tasks_new (id, kind, job_id, group_id, dedupe_key, payload_json, status, priority,
                             stages_json, result_json, error, cost_usd, attempts, created_at, started_at, finished_at)
      SELECT id, kind, job_id, group_id, dedupe_key, payload_json, status, priority,
             stages_json, result_json, error, cost_usd, attempts, created_at, started_at, finished_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS tasks_status_prio ON tasks(status, priority DESC, created_at);
      CREATE INDEX IF NOT EXISTS tasks_job ON tasks(job_id, created_at);
      CREATE INDEX IF NOT EXISTS tasks_group ON tasks(group_id);
      CREATE INDEX IF NOT EXISTS tasks_finished ON tasks(finished_at);
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_active_dedupe ON tasks(dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');
    `,
  },
  {
    // A deleted job leaves a tombstone keyed by its URL so a list-style
    // source (the Jack & Jill file import, the daily routine log) does not
    // quietly re-insert it on the next refresh. "Add by link" ignores
    // tombstones, so a job can still be brought back on purpose. The
    // (source, source_id) index lets an import recognise a record it has
    // already stored under a different URL.
    id: "005_tombstones",
    sql: `
      CREATE TABLE IF NOT EXISTS job_tombstones (
        url TEXT PRIMARY KEY,
        source TEXT,
        source_id TEXT,
        title TEXT,
        company TEXT,
        deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS job_tombstones_source ON job_tombstones(source, source_id);
      CREATE INDEX IF NOT EXISTS jobs_source_id ON jobs(source, source_id);
    `,
  },
  {
    // One row per "Find people" run for a job, like interview_preps: the
    // UI shows the latest, history is kept. Each person inside result_json
    // carries a stable person_key so a later outreach table can point at
    // (people_search_id, person_key) without rewriting these rows.
    id: "006_people_searches",
    sql: `
      CREATE TABLE IF NOT EXISTS people_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        company_domain TEXT,
        result_json TEXT NOT NULL,
        cost_usd REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS people_searches_job ON people_searches(job_id, id);
    `,
  },
  {
    // One row per message the user sent (or opened in Gmail) to a person
    // from the People tab. Keyed by person_key, not the search row, so a
    // re-run of the search keeps the history on the card. body is what
    // actually went out: a later run can change the draft.
    id: "007_outreach",
    sql: `
      CREATE TABLE IF NOT EXISTS outreach (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        people_search_id INTEGER REFERENCES people_searches(id) ON DELETE SET NULL,
        person_key TEXT NOT NULL,
        person_name TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('email','linkedin')),
        status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','replied','no_response')),
        to_address TEXT,
        subject TEXT,
        body TEXT,
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS outreach_job_person ON outreach(job_id, person_key, id);
    `,
  },
  {
    // Token usage and timing the CLI's JSON result already reports but the
    // log used to throw away: what each call read from the prompt cache,
    // how long the API itself took (duration_ms includes the wait for a
    // semaphore slot, kept separately as queue_ms) and how much it wrote.
    id: "008_ai_calls_usage",
    sql: `
      ALTER TABLE ai_calls ADD COLUMN input_tokens INTEGER;
      ALTER TABLE ai_calls ADD COLUMN output_tokens INTEGER;
      ALTER TABLE ai_calls ADD COLUMN cache_read_tokens INTEGER;
      ALTER TABLE ai_calls ADD COLUMN cache_create_tokens INTEGER;
      ALTER TABLE ai_calls ADD COLUMN api_ms INTEGER;
      ALTER TABLE ai_calls ADD COLUMN queue_ms INTEGER;
    `,
  },
  {
    // Interview rounds (one per screen / technical / panel the user is
    // going into, with who is in the room and what to focus on), the
    // prep a round was generated for, mock-interview turns (one answer
    // and its critique each) and the cross-job question bank that a
    // debrief or a saved mock answer feeds and later preps read.
    id: "009_interview_rounds",
    sql: `
      CREATE TABLE IF NOT EXISTS interview_rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('recruiter_screen','hiring_manager','technical','panel','coding','other')),
        scheduled_at TEXT,
        interviewers_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        focus_skills_json TEXT NOT NULL DEFAULT '[]',
        focus_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','done','cancelled')),
        debrief_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS interview_rounds_job ON interview_rounds(job_id, id);

      ALTER TABLE interview_preps ADD COLUMN round_id INTEGER REFERENCES interview_rounds(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS interview_preps_job ON interview_preps(job_id, id);

      CREATE TABLE IF NOT EXISTS mock_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        interview_prep_id INTEGER REFERENCES interview_preps(id) ON DELETE SET NULL,
        session_id TEXT NOT NULL,
        parent_turn_id INTEGER REFERENCES mock_turns(id) ON DELETE SET NULL,
        question_index INTEGER,
        question TEXT NOT NULL,
        kind TEXT,
        answer TEXT NOT NULL,
        via TEXT NOT NULL CHECK (via IN ('voice','typed')),
        seconds INTEGER,
        critique_json TEXT,
        cost_usd REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS mock_turns_job ON mock_turns(job_id, id);

      CREATE TABLE IF NOT EXISTS question_bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        kind TEXT,
        source TEXT NOT NULL CHECK (source IN ('debrief','mock','manual')),
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        company TEXT,
        round_kind TEXT,
        story_ids_json TEXT NOT NULL DEFAULT '[]',
        my_answer TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        times_asked INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // Which résumé version was actually sent for a job: the one the
    // interviewer has read, so the interview prep must agree with it
    // rather than with whatever version is newest. Backfilled from the
    // newest résumé-linked attachment (the Log-application modal links
    // the versions it sends).
    id: "010_sent_resume",
    sql: `
      ALTER TABLE applications ADD COLUMN sent_resume_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;
      UPDATE applications SET sent_resume_document_id = (
        SELECT a.document_id FROM attachments a JOIN documents d ON d.id = a.document_id
        WHERE a.job_id = applications.job_id AND d.kind = 'resume'
        ORDER BY a.id DESC LIMIT 1
      );
    `,
  },
  {
    // What the user typed into the People tab's hints box for a run (team
    // name, known names, company site). Kept on the row so the next run
    // can prefill it and so a result can be read with its inputs.
    id: "011_people_hints",
    sql: `
      ALTER TABLE people_searches ADD COLUMN hints TEXT;
    `,
  },
];
