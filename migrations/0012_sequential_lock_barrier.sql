CREATE TABLE IF NOT EXISTS sequential_barrier_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequential_barrier_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  utama_db_before INTEGER,
  utama_source_seen INTEGER,
  utama_db_after INTEGER,
  utama_lock_after INTEGER,
  utama_observer_after INTEGER,
  utama_delta INTEGER,
  europe_db_before INTEGER,
  europe_source_seen INTEGER,
  europe_db_after INTEGER,
  europe_lock_after INTEGER,
  europe_observer_after INTEGER,
  europe_delta INTEGER,
  gap_count INTEGER NOT NULL DEFAULT 0,
  transition_pass_count INTEGER NOT NULL DEFAULT 0,
  transition_fail_count INTEGER NOT NULL DEFAULT 0,
  watchdog_ok INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_barrier_cycles_time
  ON sequential_barrier_cycles(started_at DESC);

CREATE TABLE IF NOT EXISTS sequential_barrier_gaps (
  source TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  detected_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  db_before_period INTEGER,
  source_seen_period INTEGER,
  details_json TEXT,
  PRIMARY KEY(source, anchor_period)
);

CREATE INDEX IF NOT EXISTS idx_barrier_gaps_detected
  ON sequential_barrier_gaps(detected_at DESC);
