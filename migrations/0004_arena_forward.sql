CREATE TABLE IF NOT EXISTS arena_forward_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  anchor_result TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  history_json TEXT NOT NULL,
  decay REAL NOT NULL,
  engine_version TEXT NOT NULL,
  predictions_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TEXT,
  actual_period INTEGER,
  actual_result TEXT,
  scores_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_arena_forward_status
  ON arena_forward_runs(status, id DESC);
