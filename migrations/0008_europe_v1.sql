-- Europe V1 · isolated 3D First Place dataset + forward locks + adaptive states

CREATE TABLE IF NOT EXISTS europe_results_3d (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  period INTEGER NOT NULL UNIQUE,
  result TEXT NOT NULL,
  draw_datetime TEXT,
  next_draw_time TEXT,
  collected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_europe_results_period
  ON europe_results_3d(period DESC);

CREATE TABLE IF NOT EXISTS europe_forward_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  anchor_period INTEGER NOT NULL UNIQUE,
  anchor_result TEXT NOT NULL,
  target_period INTEGER,
  target_draw_time TEXT,
  history_size INTEGER NOT NULL,
  models_json TEXT NOT NULL,
  two_stage_json TEXT NOT NULL,
  keeper_json TEXT NOT NULL,
  adaptive_state_json TEXT NOT NULL,
  component_snapshot_json TEXT NOT NULL,
  actual_period INTEGER,
  actual_result TEXT,
  actual_datetime TEXT,
  model_scores_json TEXT,
  keeper_score_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_europe_forward_status
  ON europe_forward_runs(status, anchor_period DESC);

CREATE TABLE IF NOT EXISTS europe_adaptive_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  latest_actual_period INTEGER,
  settled_count INTEGER NOT NULL,
  phase TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  model_trust_json TEXT NOT NULL,
  component_stats_json TEXT NOT NULL,
  model_stats_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_europe_adaptive_latest
  ON europe_adaptive_states(id DESC);
