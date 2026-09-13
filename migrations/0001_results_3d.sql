CREATE TABLE IF NOT EXISTS results_3d (
  period INTEGER PRIMARY KEY,
  result TEXT NOT NULL CHECK (length(result) = 3),
  draw_date TEXT,
  draw_time TEXT,
  source_url TEXT NOT NULL,
  collected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_results_3d_period_desc
  ON results_3d(period DESC);

CREATE INDEX IF NOT EXISTS idx_results_3d_collected_at
  ON results_3d(collected_at);
