import { rankHistory, sanitizeHistory } from "./analyzer.js";

const ENGINE_VERSION = "0.6.7";

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function digitCounts(value) {
  const counts = Array(10).fill(0);
  for (const char of String(value || "")) {
    const digit = Number(char);
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9) counts[digit] += 1;
  }
  return counts;
}

function overlapDigits(a, b) {
  const left = digitCounts(a);
  const right = digitCounts(b);
  return left.reduce((sum, count, digit) => sum + Math.min(count, right[digit]), 0);
}

function positionHits(candidate, actual) {
  let hits = 0;
  for (let i = 0; i < 3; i += 1) {
    if (candidate?.[i] === actual?.[i]) hits += 1;
  }
  return hits;
}

function sameDigitMultiset(a, b) {
  return String(a || "").split("").sort().join("") === String(b || "").split("").sort().join("");
}

function poolCoverage(top3, actual) {
  const pool = Array(10).fill(0);
  for (const candidate of top3 || []) {
    const counts = digitCounts(candidate);
    counts.forEach((count, digit) => { pool[digit] += count; });
  }
  const wanted = digitCounts(actual);
  return wanted.reduce((sum, count, digit) => sum + Math.min(count, pool[digit]), 0);
}

export function scoreForwardOutcome({ top3 = [], top10 = [], actual, actualRank = 1000 } = {}) {
  const normalizedActual = normalizeNumber(actual);
  const cleanTop3 = (top3 || []).map(normalizeNumber).filter(Boolean).slice(0, 3);
  const cleanTop10 = (top10 || []).map(normalizeNumber).filter(Boolean).slice(0, 10);
  if (!normalizedActual) throw new Error("Actual result tidak valid.");

  const candidates = cleanTop3.map((candidate) => ({
    candidate,
    digitOverlap: overlapDigits(candidate, normalizedActual),
    positionHits: positionHits(candidate, normalizedActual),
    permutation: sameDigitMultiset(candidate, normalizedActual),
    exact: candidate === normalizedActual,
  }));

  candidates.sort((a, b) => (
    Number(b.exact) - Number(a.exact) ||
    Number(b.permutation) - Number(a.permutation) ||
    b.digitOverlap - a.digitOverlap ||
    b.positionHits - a.positionHits ||
    a.candidate.localeCompare(b.candidate)
  ));

  const best = candidates[0] || { candidate: null, digitOverlap: 0, positionHits: 0 };
  return {
    exactTop3: cleanTop3.includes(normalizedActual),
    top10Hit: cleanTop10.includes(normalizedActual),
    permutationHit: cleanTop3.some((candidate) => sameDigitMultiset(candidate, normalizedActual)),
    bestDigitOverlap: best.digitOverlap,
    bestPositionHits: best.positionHits,
    poolDigitCoverage: poolCoverage(cleanTop3, normalizedActual),
    bestCandidate: best.candidate,
    actualRank: clampInt(actualRank, 1000, 1, 1000),
  };
}

export async function ensureForwardSchema(db) {
  if (!db) return false;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS forward_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      anchor_period INTEGER NOT NULL,
      anchor_result TEXT NOT NULL,
      history_fingerprint TEXT NOT NULL,
      history_json TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      model_id TEXT NOT NULL,
      decay REAL NOT NULL,
      top3_json TEXT NOT NULL,
      top10_json TEXT NOT NULL,
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
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_forward_status ON forward_predictions(status, id DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_forward_anchor ON forward_predictions(anchor_period DESC)").run();
  return true;
}

async function latestStored(db) {
  const query = await db.prepare(`
    SELECT period, result
    FROM results_3d
    ORDER BY period DESC
    LIMIT 1
  `).all();
  return query.results?.[0] || null;
}

async function firstResultAfter(db, period) {
  const query = await db.prepare(`
    SELECT period, result
    FROM results_3d
    WHERE period > ?
    ORDER BY period ASC
    LIMIT 1
  `).bind(period).all();
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
    modelId: row.model_id,
    decay: Number(row.decay),
    top3: parseJson(row.top3_json, []),
    top10: parseJson(row.top10_json, []),
    status: row.status,
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

function normalizeLock(body = {}) {
  const history = sanitizeHistory(body.history).slice(0, 5000);
  if (history.length < 3) throw new Error("Forward lock memerlukan minimal 3 draw.");

  const fingerprint = String(body.fingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(fingerprint)) throw new Error("Fingerprint snapshot tidak valid.");

  const top3 = (body.top3 || []).map(normalizeNumber).filter(Boolean).slice(0, 3);
  const top10 = (body.top10 || []).map(normalizeNumber).filter(Boolean).slice(0, 10);
  if (top3.length !== 3 || top10.length < 3) throw new Error("Top 3 / Top 10 prediction belum siap.");

  const decay = finite(body.decay, 0.9);
  if (!(decay > 0 && decay <= 1)) throw new Error("Decay tidak valid.");
  const modelId = String(body.modelId || "ensemble").toLowerCase().slice(0, 32);

  return {
    history,
    fingerprint,
    top3,
    top10,
    decay,
    modelId,
    engineVersion: String(body.engineVersion || ENGINE_VERSION).slice(0, 32),
  };
}

export async function createForwardPrediction(db, body = {}) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureForwardSchema(db);
  const data = normalizeLock(body);
  const latest = await latestStored(db);
  if (!latest) throw new Error("D1 belum memiliki result untuk anchor forward test.");

  const anchorResult = normalizeNumber(latest.result);
  if (data.history[0] !== anchorResult) {
    throw new Error(`Snapshot stale. Latest D1 ${latest.period} = ${anchorResult}; klik Muat D1 lalu Analisis sebelum Lock Forward.`);
  }

  const lockKey = `${latest.period}:${data.fingerprint}:${data.modelId}:${data.decay.toFixed(6)}`;
  const createdAt = new Date().toISOString();
  await db.prepare(`
    INSERT OR IGNORE INTO forward_predictions (
      lock_key, created_at, anchor_period, anchor_result, history_fingerprint,
      history_json, engine_version, model_id, decay, top3_json, top10_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    lockKey,
    createdAt,
    Number(latest.period),
    anchorResult,
    data.fingerprint,
    safeJson(data.history, []),
    data.engineVersion,
    data.modelId,
    data.decay,
    safeJson(data.top3, []),
    safeJson(data.top10, []),
  ).run();

  const query = await db.prepare("SELECT * FROM forward_predictions WHERE lock_key = ? LIMIT 1").bind(lockKey).all();
  return mapRow(query.results?.[0], false);
}

async function settleRow(db, row) {
  if (!row || row.status !== "pending") return row;
  const actual = await firstResultAfter(db, Number(row.anchor_period));
  if (!actual) return row;

  const history = parseJson(row.history_json, []);
  const { ranking } = rankHistory(history, { modelId: row.model_id, decay: Number(row.decay) });
  const normalizedActual = normalizeNumber(actual.result);
  const actualRow = ranking.find((candidate) => candidate.number === normalizedActual);
  const metrics = scoreForwardOutcome({
    top3: parseJson(row.top3_json, []),
    top10: parseJson(row.top10_json, []),
    actual: normalizedActual,
    actualRank: actualRow?.rank ?? 1000,
  });

  const settledAt = new Date().toISOString();
  await db.prepare(`
    UPDATE forward_predictions
    SET status = 'settled', settled_at = ?, actual_period = ?, actual_result = ?,
        actual_rank = ?, exact_top3 = ?, top10_hit = ?, permutation_hit = ?,
        best_digit_overlap = ?, best_position_hits = ?, pool_digit_coverage = ?, best_candidate = ?
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

  const refreshed = await db.prepare("SELECT * FROM forward_predictions WHERE id = ? LIMIT 1").bind(Number(row.id)).all();
  return refreshed.results?.[0] || row;
}

export async function settleOpenForwardPredictions(db) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureForwardSchema(db);
  const query = await db.prepare(`
    SELECT * FROM forward_predictions
    WHERE status = 'pending'
    ORDER BY id ASC
    LIMIT 50
  `).all();
  const settled = [];
  for (const row of query.results || []) {
    settled.push(await settleRow(db, row));
  }
  return settled;
}

export async function listForwardPredictions(db, limit = 30) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureForwardSchema(db);
  await settleOpenForwardPredictions(db);
  const safeLimit = clampInt(limit, 30, 1, 100);
  const query = await db.prepare(`
    SELECT * FROM forward_predictions
    ORDER BY id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return (query.results || []).map((row) => mapRow(row, false));
}
