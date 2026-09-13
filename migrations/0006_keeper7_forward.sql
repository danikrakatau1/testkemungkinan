CREATE TABLE IF NOT EXISTS keeper7_forward_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  anchor_result TEXT NOT NULL,
  target_hour INTEGER,
  history_fingerprint TEXT NOT NULL,
  history_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  keep7_json TEXT NOT NULL,
  drop3_json TEXT NOT NULL,
  digit_ranking_json TEXT NOT NULL,
  subset_json TEXT NOT NULL,
  assisted_top3_json TEXT NOT NULL,
  model_sources_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TEXT,
  actual_period INTEGER,
  actual_result TEXT,
  covered_positions INTEGER,
  all3_covered INTEGER,
  random_baseline REAL,
  assisted_exact_top3 INTEGER
);

CREATE INDEX IF NOT EXISTS idx_keeper7_status
  ON keeper7_forward_runs(status, id DESC);

CREATE INDEX IF NOT EXISTS idx_keeper7_anchor
  ON keeper7_forward_runs(anchor_period DESC);
