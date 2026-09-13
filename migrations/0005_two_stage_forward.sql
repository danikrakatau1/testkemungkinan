CREATE TABLE IF NOT EXISTS two_stage_forward_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  anchor_result TEXT NOT NULL,
  history_fingerprint TEXT NOT NULL,
  history_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  top3_json TEXT NOT NULL,
  top10_json TEXT NOT NULL,
  flows_json TEXT NOT NULL,
  stage1_json TEXT NOT NULL,
  explanations_json TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_two_stage_status
ON two_stage_forward_runs(status, id DESC);

CREATE INDEX IF NOT EXISTS idx_two_stage_anchor
ON two_stage_forward_runs(anchor_period DESC);
