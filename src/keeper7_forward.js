import { KEEPER7_VERSION, normalize3, runKeeper7Engine, sanitizeRows, walkForwardKeeper7 } from "./keeper7.js";

const HISTORY_LIMIT = 2000;
const UNIFORM_ALL3_BASELINE = 0.343;

function safeJson(value, fallback) {
  try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSnapshot(db) {
  const query = await db.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime, collected_at AS collectedAt
    FROM results_3d
    ORDER BY period DESC
    LIMIT ?
  `).bind(HISTORY_LIMIT).all();
  const rows = sanitizeRows(query.results || []);
  return { rows, latest: rows[0] || null };
}

async function totalDraws(db) {
  const query = await db.prepare("SELECT COUNT(*) AS count FROM results_3d").all();
  return Number(query.results?.[0]?.count || 0);
}

async function firstAfter(db, period) {
  const query = await db.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime
    FROM results_3d
    WHERE period > ?
    ORDER BY period ASC
    LIMIT 1
  `).bind(Number(period)).all();
  return query.results?.[0] || null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    lockKey: row.lock_key,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: row.anchor_result,
    targetHour: row.target_hour == null ? null : Number(row.target_hour),
    historyFingerprint: row.history_fingerprint,
    engineVersion: row.engine_version,
    status: row.status,
    keep7: parseJson(row.keep7_json, []),
    drop3: parseJson(row.drop3_json, []),
    digitRanking: parseJson(row.digit_ranking_json, []),
    subset: parseJson(row.subset_json, {}),
    assistedTop3: parseJson(row.assisted_top3_json, []),
    modelSources: parseJson(row.model_sources_json, []),
    validation: parseJson(row.validation_json, {}),
    settledAt: row.settled_at,
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: row.actual_result,
    coveredPositions: row.covered_positions == null ? null : Number(row.covered_positions),
    all3Covered: row.all3_covered == null ? null : Boolean(row.all3_covered),
    randomBaseline: row.random_baseline == null ? null : Number(row.random_baseline),
    assistedExactTop3: row.assisted_exact_top3 == null ? null : Boolean(row.assisted_exact_top3),
  };
}

export async function ensureKeeper7Schema(db) {
  await db.prepare(`
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
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_keeper7_status ON keeper7_forward_runs(status, id DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_keeper7_anchor ON keeper7_forward_runs(anchor_period DESC)").run();
  return true;
}

async function hasAnchor(db, period) {
  const query = await db.prepare("SELECT id FROM keeper7_forward_runs WHERE anchor_period = ? ORDER BY id DESC LIMIT 1").bind(Number(period)).all();
  return Boolean(query.results?.[0]);
}

async function readModelEvidence(db, anchorPeriod) {
  const models = [];
  try {
    const arena = await db.prepare(`
      SELECT predictions_json
      FROM arena_forward_runs
      WHERE anchor_period = ?
      ORDER BY id DESC LIMIT 1
    `).bind(Number(anchorPeriod)).all();
    const predictions = parseJson(arena.results?.[0]?.predictions_json, []);
    for (const model of predictions) {
      models.push({
        id: model.id || "arena",
        label: model.label || model.id || "Arena",
        top3: model.top3 || [],
        top10: model.top10 || [],
      });
    }
  } catch {}

  try {
    const twoStage = await db.prepare(`
      SELECT top3_json, top10_json
      FROM two_stage_forward_runs
      WHERE anchor_period = ?
      ORDER BY id DESC LIMIT 1
    `).bind(Number(anchorPeriod)).all();
    const row = twoStage.results?.[0];
    if (row) {
      models.push({
        id: "two-stage",
        label: "Two-Stage V0.9.0",
        top3: parseJson(row.top3_json, []),
        top10: parseJson(row.top10_json, []),
      });
    }
  } catch {}
  return models;
}

function conditionalRandomBaseline(result) {
  const normalized = normalize3(result);
  if (!normalized) return UNIFORM_ALL3_BASELINE;
  const unique = new Set(normalized.split("")).size;
  let numerator = 1;
  let denominator = 1;
  for (let i = 0; i < unique; i += 1) {
    numerator *= 7 - i;
    denominator *= 10 - i;
  }
  return numerator / denominator;
}

async function createLock(db, snapshot) {
  if (!snapshot.latest || snapshot.rows.length < 60) return { created: false, reason: "insufficient-history" };
  if (await hasAnchor(db, snapshot.latest.period)) return { created: false, reason: "already-locked" };

  const models = await readModelEvidence(db, snapshot.latest.period);
  const engine = runKeeper7Engine(snapshot.rows, { models });
  // Keep rolling-origin validation intentionally CPU-safe on Workers. Each target still trains on all prior rows.
  const validation = walkForwardKeeper7(snapshot.rows, { minTrain: 100, maxTargets: 24 });
  const fingerprint = await sha256(JSON.stringify(snapshot.rows.map((row) => [row.period, row.result, row.drawTime])));
  const lockKey = `${snapshot.latest.period}:${fingerprint}:keeper7:${KEEPER7_VERSION}`;
  const createdAt = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO keeper7_forward_runs (
      lock_key, created_at, anchor_period, anchor_result, target_hour,
      history_fingerprint, history_json, engine_version,
      keep7_json, drop3_json, digit_ranking_json, subset_json,
      assisted_top3_json, model_sources_json, validation_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    lockKey,
    createdAt,
    Number(snapshot.latest.period),
    normalize3(snapshot.latest.result),
    engine.targetHour,
    fingerprint,
    safeJson(snapshot.rows, []),
    KEEPER7_VERSION,
    safeJson(engine.keep7, []),
    safeJson(engine.drop3, []),
    safeJson(engine.digitRanking, []),
    safeJson(engine.subset, {}),
    safeJson(engine.assistedTop3, []),
    safeJson(engine.modelEvidenceSources, []),
    safeJson(validation, {}),
  ).run();

  const query = await db.prepare("SELECT * FROM keeper7_forward_runs WHERE lock_key = ? LIMIT 1").bind(lockKey).all();
  return { created: true, row: mapRow(query.results?.[0]) };
}

async function settleRow(db, row) {
  if (!row || row.status !== "pending") return row;
  const actualRow = await firstAfter(db, Number(row.anchor_period));
  if (!actualRow) return row;
  const actual = normalize3(actualRow.result);
  if (!actual) return row;
  const keep7 = parseJson(row.keep7_json, []).map(Number);
  const allowed = new Set(keep7);
  const covered = actual.split("").reduce((sum, digit) => sum + Number(allowed.has(Number(digit))), 0);
  const assistedTop3 = parseJson(row.assisted_top3_json, []).map((item) => normalize3(item?.number ?? item)).filter(Boolean);
  const baseline = conditionalRandomBaseline(actual);
  const settledAt = new Date().toISOString();

  await db.prepare(`
    UPDATE keeper7_forward_runs
    SET status='settled', settled_at=?, actual_period=?, actual_result=?,
        covered_positions=?, all3_covered=?, random_baseline=?, assisted_exact_top3=?
    WHERE id=? AND status='pending'
  `).bind(
    settledAt,
    Number(actualRow.period),
    actual,
    covered,
    covered === 3 ? 1 : 0,
    baseline,
    assistedTop3.includes(actual) ? 1 : 0,
    Number(row.id),
  ).run();

  const refreshed = await db.prepare("SELECT * FROM keeper7_forward_runs WHERE id = ? LIMIT 1").bind(Number(row.id)).all();
  return refreshed.results?.[0] || row;
}

export async function settleOpenKeeper7(db) {
  await ensureKeeper7Schema(db);
  const query = await db.prepare("SELECT * FROM keeper7_forward_runs WHERE status='pending' ORDER BY id ASC LIMIT 50").all();
  for (const row of query.results || []) await settleRow(db, row);
}

export async function listKeeper7Forward(db, limit = 30) {
  await ensureKeeper7Schema(db);
  await settleOpenKeeper7(db);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const query = await db.prepare("SELECT * FROM keeper7_forward_runs ORDER BY id DESC LIMIT ?").bind(safeLimit).all();
  return (query.results || []).map(mapRow);
}

function aggregate(rows) {
  const settled = rows.filter((row) => row.status === "settled");
  if (!settled.length) {
    return {
      settled: 0,
      all3RatePct: null,
      atLeast2RatePct: null,
      avgCovered: null,
      avgConditionalRandomBaselinePct: null,
      assistedExactTop3RatePct: null,
      uniformPositionBaselinePct: 34.3,
    };
  }
  const all3 = settled.filter((row) => row.all3Covered).length;
  const atLeast2 = settled.filter((row) => Number(row.coveredPositions) >= 2).length;
  const covered = settled.reduce((sum, row) => sum + Number(row.coveredPositions || 0), 0);
  const baseline = settled.reduce((sum, row) => sum + Number(row.randomBaseline || UNIFORM_ALL3_BASELINE), 0);
  const assistedExact = settled.filter((row) => row.assistedExactTop3).length;
  return {
    settled: settled.length,
    all3RatePct: Number((all3 / settled.length * 100).toFixed(2)),
    atLeast2RatePct: Number((atLeast2 / settled.length * 100).toFixed(2)),
    avgCovered: Number((covered / settled.length).toFixed(3)),
    avgConditionalRandomBaselinePct: Number((baseline / settled.length * 100).toFixed(2)),
    assistedExactTop3RatePct: Number((assistedExact / settled.length * 100).toFixed(2)),
    uniformPositionBaselinePct: 34.3,
  };
}

function compact(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    anchorPeriod: row.anchorPeriod,
    anchorResult: row.anchorResult,
    targetHour: row.targetHour,
    keep7: row.keep7,
    drop3: row.drop3,
    digitRanking: row.digitRanking,
    subset: row.subset,
    assistedTop3: row.assistedTop3,
    modelSources: row.modelSources,
    validation: row.validation,
    actualPeriod: row.actualPeriod,
    actualResult: row.actualResult,
    coveredPositions: row.coveredPositions,
    all3Covered: row.all3Covered,
    randomBaselinePct: row.randomBaseline == null ? null : Number((row.randomBaseline * 100).toFixed(2)),
    assistedExactTop3: row.assistedExactTop3,
  };
}

export async function runKeeper7Pilot(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk 7D Keeper.");
  const db = env.DB;
  await ensureKeeper7Schema(db);
  await settleOpenKeeper7(db);
  const snapshot = await readSnapshot(db);
  const creation = await createLock(db, snapshot);
  const rows = await listKeeper7Forward(db, 60);
  const pending = rows.find((row) => row.status === "pending") || null;
  const last = rows.find((row) => row.status === "settled") || null;
  const draws = await totalDraws(db);

  return {
    ok: true,
    version: KEEPER7_VERSION,
    engine: "7D Historical Keeper / 3D Eliminator",
    mode: "ONE OFFICIAL KEEP7 PER DRAW",
    latest: snapshot.latest,
    draws,
    created: creation.created,
    pending: compact(pending),
    last: compact(last),
    forward: aggregate(rows),
    baseline: {
      uniformAll3Pct: 34.3,
      note: "Primary KPI is ALL-3 coverage. Minimal 1-digit coverage is intentionally not used as the success KPI.",
    },
    now: new Date().toISOString(),
  };
}
