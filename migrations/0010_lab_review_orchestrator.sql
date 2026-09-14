CREATE TABLE IF NOT EXISTS lab_review_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  phase_started_at TEXT,
  elapsed_hours REAL,
  reasons_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  simulations INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  edge_json TEXT,
  forensics_json TEXT,
  monte_carlo_json TEXT,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS lab_review_completed_triggers (
  trigger_key TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL,
  report_id INTEGER,
  FOREIGN KEY(report_id) REFERENCES lab_review_reports(id)
);

CREATE INDEX IF NOT EXISTS idx_lab_review_created ON lab_review_reports(created_at DESC);
