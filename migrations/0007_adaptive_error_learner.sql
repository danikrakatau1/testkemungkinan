-- V0.9.2 Adaptive Error Learner
-- Keeper7's two new snapshot columns are added defensively at runtime because
-- SQLite/D1 has no portable ADD COLUMN IF NOT EXISTS syntax.

CREATE TABLE IF NOT EXISTS adaptive_error_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  latest_actual_period INTEGER,
  keeper_settled INTEGER NOT NULL,
  arena_settled INTEGER NOT NULL,
  two_stage_settled INTEGER NOT NULL,
  phase TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  model_trust_json TEXT NOT NULL,
  component_stats_json TEXT NOT NULL,
  model_stats_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adaptive_error_latest
  ON adaptive_error_states(id DESC);
