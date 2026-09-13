CREATE TABLE IF NOT EXISTS ai_v2_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'OBSERVER',
  feature_version TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_lock_created_at TEXT NOT NULL,
  anchor_period INTEGER NOT NULL,
  anchor_result TEXT NOT NULL,
  target_period INTEGER,
  target_time TEXT,
  source_status_at_capture TEXT NOT NULL,
  features_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TEXT,
  actual_period INTEGER,
  actual_result TEXT,
  settlement_json TEXT
);

CREATE TABLE IF NOT EXISTS ai_v2_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_v2_source_status
  ON ai_v2_observations(source, status, anchor_period DESC);

CREATE INDEX IF NOT EXISTS idx_ai_v2_observed_at
  ON ai_v2_observations(observed_at DESC);
