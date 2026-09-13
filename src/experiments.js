const ENGINE_VERSION = "0.6.5";

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function safeJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
}

export async function ensureExperimentSchema(db) {
  if (!db) return false;

  await db.prepare(`
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
    )
  `).run();

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_experiment_runs_created_at ON experiment_runs(created_at DESC)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_experiment_runs_fingerprint ON experiment_runs(fingerprint)"
  ).run();
  return true;
}

async function latestStoredResult(db) {
  const query = await db.prepare(`
    SELECT period, result
    FROM results_3d
    ORDER BY period DESC
    LIMIT 1
  `).all();
  return query.results?.[0] || null;
}

function normalizeExperiment(body = {}) {
  const snapshot = Array.isArray(body.snapshot)
    ? body.snapshot.map(normalizeNumber).filter(Boolean).slice(0, 5000)
    : [];
  if (snapshot.length < 26) throw new Error("Snapshot experiment terlalu pendek.");

  const fingerprint = String(body.fingerprint || "").trim().toLowerCase();
  const runKey = String(body.runKey || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(fingerprint)) throw new Error("Fingerprint snapshot tidak valid.");
  if (!/^[a-f0-9]{32,64}$/.test(runKey)) throw new Error("Run key tidak valid.");

  const windowCount = clampInt(body.windowCount, 0, 1, 64);
  const holdoutTargets = clampInt(body.holdoutTargets, 0, 1, 10000);
  const evaluatedTargets = clampInt(body.evaluatedTargets, 0, 1, 10000);
  if (!windowCount || !holdoutTargets || !evaluatedTargets) throw new Error("Metadata window experiment tidak valid.");

  return {
    runKey,
    fingerprint,
    snapshot,
    engineVersion: String(body.engineVersion || ENGINE_VERSION).slice(0, 32),
    drawCount: snapshot.length,
    decay: finiteOrNull(body.decay),
    minTrain: clampInt(body.minTrain, 8, 3, 1000),
    windowCount,
    evaluatedTargets,
    holdoutTargets,
    weightedTop10Hits: clampInt(body.weightedTop10Hits, 0, 0, holdoutTargets),
    weightedTop10Rate: finiteOrNull(body.weightedTop10Rate) ?? 0,
    weightedMeanRank: finiteOrNull(body.weightedMeanRank) ?? 1000,
    meanRankDelta: finiteOrNull(body.meanRankDelta) ?? -499.5,
    pTop10: finiteOrNull(body.pTop10),
    pMeanRank: finiteOrNull(body.pMeanRank),
    stableWindows: clampInt(body.stableWindows, 0, 0, windowCount),
    gateStatus: String(body.gateStatus || "locked").slice(0, 32),
    regimeVerdict: String(body.regimeVerdict || "unknown").slice(0, 64),
    currentTop3: Array.isArray(body.currentTop3)
      ? body.currentTop3.map(normalizeNumber).filter(Boolean).slice(0, 3)
      : [],
    windowSummaries: Array.isArray(body.windowSummaries) ? body.windowSummaries.slice(0, 64) : [],
    params: body.params && typeof body.params === "object" ? body.params : {},
  };
}

function mapRow(row, includeSnapshot = false) {
  if (!row) return null;
  const mapped = {
    id: Number(row.id),
    runKey: row.run_key,
    fingerprint: row.fingerprint,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    drawCount: Number(row.draw_count),
    latestPeriod: row.latest_period == null ? null : Number(row.latest_period),
    latestResult: row.latest_result,
    decay: row.decay == null ? null : Number(row.decay),
    minTrain: Number(row.min_train),
    windowCount: Number(row.window_count),
    evaluatedTargets: Number(row.evaluated_targets),
    holdoutTargets: Number(row.holdout_targets),
    weightedTop10Hits: Number(row.weighted_top10_hits),
    weightedTop10Rate: Number(row.weighted_top10_rate),
    weightedMeanRank: Number(row.weighted_mean_rank),
    meanRankDelta: Number(row.mean_rank_delta),
    pTop10: row.p_top10 == null ? null : Number(row.p_top10),
    pMeanRank: row.p_mean_rank == null ? null : Number(row.p_mean_rank),
    stableWindows: Number(row.stable_windows),
    gateStatus: row.gate_status,
    regimeVerdict: row.regime_verdict,
    currentTop3: parseJson(row.current_top3_json, []),
    windowSummaries: parseJson(row.window_summaries_json, []),
    params: parseJson(row.params_json, {}),
  };
  if (includeSnapshot) mapped.snapshot = parseJson(row.snapshot_json, []);
  return mapped;
}

export async function saveExperiment(db, body = {}) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureExperimentSchema(db);
  const data = normalizeExperiment(body);
  const latest = await latestStoredResult(db).catch(() => null);
  const createdAt = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO experiment_runs (
      run_key, fingerprint, engine_version, created_at, draw_count,
      latest_period, latest_result, decay, min_train, window_count,
      evaluated_targets, holdout_targets, weighted_top10_hits,
      weighted_top10_rate, weighted_mean_rank, mean_rank_delta,
      p_top10, p_mean_rank, stable_windows, gate_status, regime_verdict,
      current_top3_json, window_summaries_json, snapshot_json, params_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.runKey,
    data.fingerprint,
    data.engineVersion,
    createdAt,
    data.drawCount,
    latest?.period ?? null,
    latest?.result ?? data.snapshot[0] ?? null,
    data.decay,
    data.minTrain,
    data.windowCount,
    data.evaluatedTargets,
    data.holdoutTargets,
    data.weightedTop10Hits,
    data.weightedTop10Rate,
    data.weightedMeanRank,
    data.meanRankDelta,
    data.pTop10,
    data.pMeanRank,
    data.stableWindows,
    data.gateStatus,
    data.regimeVerdict,
    safeJson(data.currentTop3, []),
    safeJson(data.windowSummaries, []),
    safeJson(data.snapshot, []),
    safeJson(data.params, {}),
  ).run();

  const query = await db.prepare(`
    SELECT * FROM experiment_runs WHERE run_key = ? LIMIT 1
  `).bind(data.runKey).all();
  return mapRow(query.results?.[0], false);
}

export async function listExperiments(db, limit = 20) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureExperimentSchema(db);
  const safeLimit = clampInt(limit, 20, 1, 100);
  const query = await db.prepare(`
    SELECT * FROM experiment_runs
    ORDER BY id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return (query.results || []).map((row) => mapRow(row, false));
}

export async function readExperiment(db, id) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureExperimentSchema(db);
  const safeId = clampInt(id, 0, 1, 2147483647);
  if (!safeId) throw new Error("Experiment id tidak valid.");
  const query = await db.prepare(`
    SELECT * FROM experiment_runs WHERE id = ? LIMIT 1
  `).bind(safeId).all();
  return mapRow(query.results?.[0], true);
}
