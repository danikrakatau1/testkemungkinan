CREATE TABLE IF NOT EXISTS watchdog_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchdog_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  ordered_ok INTEGER NOT NULL DEFAULT 0,
  ordered_elapsed_ms INTEGER,
  heartbeat_gap_seconds REAL,
  utama_result_period INTEGER,
  utama_lock_anchor INTEGER,
  utama_observer_anchor INTEGER,
  europe_result_period INTEGER,
  europe_lock_anchor INTEGER,
  europe_observer_anchor INTEGER,
  details_json TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchdog_cycles_trigger_time
ON watchdog_cycles(trigger, started_at DESC);

CREATE TABLE IF NOT EXISTS watchdog_daily (
  date_key TEXT PRIMARY KEY,
  scheduled_count INTEGER NOT NULL DEFAULT 0,
  healthy_count INTEGER NOT NULL DEFAULT 0,
  degraded_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  max_gap_seconds REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
