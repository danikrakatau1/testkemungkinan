import { scoreForwardOutcome } from "./forward.js";
import { runTwoStageEngine, TWO_STAGE_VERSION } from "./two_stage.js";

const HISTORY_LIMIT = 500;

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
  const rows = query.results || [];
  return {
    rows,
    latest: rows[0] || null,
    history: rows.map((row) => normalizeNumber(row.result)).filter(Boolean),
  };
}

async function firstResultAfter(db, period) {
  const query = await db.prepare(`
    SELECT period, result
    FROM results_3d
    WHERE period > ?
    ORDER BY period ASC
    LIMIT 1
  `).bind(Number(period)).all();
  return query.results?.[0] || null;
}

function mapRow(row, includeHistory = false) {
  if (!row) return null;
  const mapped = {
    id: Number(row.id),
    lockKey: row.lock_key,
    createdAt: row.created_at,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: row.anchor_result,
    fingerprint: row.history_fingerprint,
    engineVersion: row.engine_version,
    status: row.status,
    top3: parseJson(row.top3_json, []),
    top10: parseJson(row.top10_json, []),
    flows: parseJson(row.flows_json, []),
    stage1: parseJson(row.stage1_json, []),
    explanations: parseJson(row.explanations_json, []),
    settledAt: row.settled_at,
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: row.actual_result,
    actualRank: row.actual_rank == null ? null : Number(row.actual_rank),
    exactTop3: row.exact_top3 == null ? null : Boolean(row.exact_top3),
    top10Hit: row.top10_hit == null ? null : Boolean(row.top10_hit),
    permutationHit: row.permutation_hit == null ? null : Boolean(row.permutation_hit),
    bestDigitOverlap: row.best_digit_overlap == null ? null : Number(row.best_digit_overlap),
    bestPositionHits: row.best_position_hits == null ? null : Number(row.best_position_hits),
    poolDigitCoverage: row.pool_digit_coverage == null ? null : Number(row.pool_digit_coverage),
    bestCandidate: row.best_candidate,
  };
  if (includeHistory) mapped.history = parseJson(row.history_json, []);
  return mapped;
}

export async function ensureTwoStageSchema(db) {
  if (!db) return false;
  await db.prepare(`
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
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_two_stage_status ON two_stage_forward_runs(status, id DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_two_stage_anchor ON two_stage_forward_runs(anchor_period DESC)").run();
  return true;
}

async function hasAnchor(db, period) {
  const query = await db.prepare(`
    SELECT id FROM two_stage_forward_runs
    WHERE anchor_period = ?
    ORDER BY id DESC LIMIT 1
  `).bind(Number(period)).all();
  return Boolean(query.results?.[0]);
}

async function createLock(db, snapshot) {
  if (!snapshot.latest || snapshot.history.length < 40) return { created: false, reason: "insufficient-history" };
  if (await hasAnchor(db, snapshot.latest.period)) return { created: false, reason: "already-locked" };

  const engine = runTwoStageEngine(snapshot.history);
  const fingerprint = await sha256(JSON.stringify(snapshot.history));
  const top3 = engine.top3.map((row) => row.number);
  const top10 = engine.top10.map((row) => row.number);
  const lockKey = `${snapshot.latest.period}:${fingerprint}:two-stage:${TWO_STAGE_VERSION}`;
  const createdAt = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO two_stage_forward_runs (
      lock_key, created_at, anchor_period, anchor_result, history_fingerprint,
      history_json, engine_version, top3_json, top10_json,
      flows_json, stage1_json, explanations_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    lockKey,
    createdAt,
    Number(snapshot.latest.period),
    normalizeNumber(snapshot.latest.result),
    fingerprint,
    safeJson(snapshot.history, []),
    TWO_STAGE_VERSION,
    safeJson(top3, []),
    safeJson(top10, []),
    safeJson(engine.flows, []),
    safeJson(engine.stage1, []),
    safeJson(engine.explanations, []),
  ).run();

  const query = await db.prepare("SELECT * FROM two_stage_forward_runs WHERE lock_key = ? LIMIT 1").bind(lockKey).all();
  return { created: true, row: mapRow(query.results?.[0]) };
}

async function settleRow(db, row) {
  if (!row || row.status !== "pending") return row;
  const actual = await firstResultAfter(db, Number(row.anchor_period));
  if (!actual) return row;

  const history = parseJson(row.history_json, []);
  const engine = runTwoStageEngine(history);
  const normalizedActual = normalizeNumber(actual.result);
  const actualRow = engine.ranking.find((candidate) => candidate.number === normalizedActual);
  const metrics = scoreForwardOutcome({
    top3: parseJson(row.top3_json, []),
    top10: parseJson(row.top10_json, []),
    actual: normalizedActual,
    actualRank: actualRow?.rank ?? 1000,
  });
  const settledAt = new Date().toISOString();

  await db.prepare(`
    UPDATE two_stage_forward_runs
    SET status = 'settled', settled_at = ?, actual_period = ?, actual_result = ?, actual_rank = ?,
        exact_top3 = ?, top10_hit = ?, permutation_hit = ?, best_digit_overlap = ?,
        best_position_hits = ?, pool_digit_coverage = ?, best_candidate = ?
    WHERE id = ? AND status = 'pending'
  `).bind(
    settledAt,
    Number(actual.period),
    normalizedActual,
    metrics.actualRank,
    metrics.exactTop3 ? 1 : 0,
    metrics.top10Hit ? 1 : 0,
    metrics.permutationHit ? 1 : 0,
    metrics.bestDigitOverlap,
    metrics.bestPositionHits,
    metrics.poolDigitCoverage,
    metrics.bestCandidate,
    Number(row.id),
  ).run();

  const refreshed = await db.prepare("SELECT * FROM two_stage_forward_runs WHERE id = ? LIMIT 1").bind(Number(row.id)).all();
  return refreshed.results?.[0] || row;
}

export async function settleOpenTwoStage(db) {
  await ensureTwoStageSchema(db);
  const query = await db.prepare(`
    SELECT * FROM two_stage_forward_runs
    WHERE status = 'pending'
    ORDER BY id ASC
    LIMIT 50
  `).all();
  for (const row of query.results || []) await settleRow(db, row);
}

export async function listTwoStageForward(db, limit = 20) {
  await ensureTwoStageSchema(db);
  await settleOpenTwoStage(db);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const query = await db.prepare(`
    SELECT * FROM two_stage_forward_runs
    ORDER BY id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return (query.results || []).map((row) => mapRow(row));
}

function compact(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    anchorPeriod: row.anchorPeriod,
    anchorResult: row.anchorResult,
    top3: row.top3,
    top10: row.top10,
    flows: row.flows,
    stage1: row.stage1,
    explanations: row.explanations,
    actualPeriod: row.actualPeriod,
    actualResult: row.actualResult,
    actualRank: row.actualRank,
    exactTop3: row.exactTop3,
    top10Hit: row.top10Hit,
    permutationHit: row.permutationHit,
    bestDigitOverlap: row.bestDigitOverlap,
    bestPositionHits: row.bestPositionHits,
    poolDigitCoverage: row.poolDigitCoverage,
    bestCandidate: row.bestCandidate,
  };
}

export async function runTwoStagePilot(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Two-Stage V0.9.0.");
  const db = env.DB;
  await ensureTwoStageSchema(db);
  await settleOpenTwoStage(db);
  const snapshot = await readSnapshot(db);
  const creation = await createLock(db, snapshot);
  const rows = await listTwoStageForward(db, 20);
  const pending = rows.find((row) => row.status === "pending") || null;
  const last = rows.find((row) => row.status === "settled") || null;

  return {
    ok: true,
    version: TWO_STAGE_VERSION,
    engine: "Two-Stage Pattern Flow + Permutation Reranker",
    validationStatus: "challenger · belum dipromosikan sampai forward test cukup",
    latest: snapshot.latest,
    created: creation.created,
    pending: compact(pending),
    last: compact(last),
    historyCount: snapshot.history.length,
    now: new Date().toISOString(),
  };
}
