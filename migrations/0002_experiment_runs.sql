CREATE TABLE IF NOT EXISTS experiment_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  draw_count INTEGER NOT NULL,
  latest_period INTEGER,
  latest_result TEXT,
  decay REAL,
  min_train INTEGER,
  window_count INTEGER NOT NULL,
  evaluated_targets INTEGER NOT NULL,
  holdout_targets INTEGER NOT NULL,
  weighted_top10_hits INTEGER NOT NULL,
  weighted_top10_rate REAL NOT NULL,
  weighted_mean_rank REAL NOT NULL,
  mean_rank_delta REAL NOT NULL,
  p_top10 REAL,
  p_mean_rank REAL,
  stable_windows INTEGER NOT NULL,
  gate_status TEXT NOT NULL,
  regime_verdict TEXT,
  current_top3_json TEXT NOT NULL,
  window_summaries_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  params_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiment_runs_created_at
  ON experiment_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_experiment_runs_fingerprint
  ON experiment_runs(fingerprint);
