CREATE TABLE IF NOT EXISTS forward_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  anchor_result TEXT NOT NULL,
  history_fingerprint TEXT NOT NULL,
  history_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  decay REAL NOT NULL,
  top3_json TEXT NOT NULL,
  top10_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TEXT,
  actual_period INTEGER,
  actual_result TEXT,
  actual_rank INTEGER,
  exact_top3 INTEGER,
  top10_hit INTEGER,
  permutation_hit INTEGER,
  best_digit_overlap INTEGER,
  best_position_hits INTEGER,
  pool_digit_coverage INTEGER,
  best_candidate TEXT
);

CREATE INDEX IF NOT EXISTS idx_forward_status ON forward_predictions(status, id DESC);
CREATE INDEX IF NOT EXISTS idx_forward_anchor ON forward_predictions(anchor_period DESC);
