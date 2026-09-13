import { runModelArena, ARENA_VERSION } from "./arena.js";
import { sanitizeHistory } from "./analyzer.js";

function normalizeNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function predictionNumber(row) {
  if (typeof row === "string" || typeof row === "number") return normalizeNumber(row);
  return normalizeNumber(row?.number);
}

function digitCounts(value) {
  const counts = Array(10).fill(0);
  for (const char of String(value || "")) {
    const digit = Number(char);
    if (Number.isInteger(digit)) counts[digit] += 1;
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
  for (let i = 0; i < 3; i += 1) if (candidate?.[i] === actual?.[i]) hits += 1;
  return hits;
}

function permutation(candidate, actual) {
  return String(candidate || "").split("").sort().join("") === String(actual || "").split("").sort().join("");
}

function poolCoverage(top3, actual) {
  const pool = Array(10).fill(0);
  for (const candidate of top3) {
    const counts = digitCounts(candidate);
    counts.forEach((count, digit) => { pool[digit] += count; });
  }
  const target = digitCounts(actual);
  return target.reduce((sum, count, digit) => sum + Math.min(count, pool[digit]), 0);
}

function scoreModel(model, actual) {
  const top3 = (model.top3 || []).map(predictionNumber).filter(Boolean).slice(0, 3);
  const top10 = (model.top10 || []).map(predictionNumber).filter(Boolean).slice(0, 10);
  const candidates = top3.map((candidate) => ({
    candidate,
    exact: candidate === actual,
    permutation: permutation(candidate, actual),
    digitOverlap: overlapDigits(candidate, actual),
    positionHits: positionHits(candidate, actual),
  })).sort((a, b) => (
    Number(b.exact) - Number(a.exact) ||
    Number(b.permutation) - Number(a.permutation) ||
    b.digitOverlap - a.digitOverlap ||
    b.positionHits - a.positionHits ||
    a.candidate.localeCompare(b.candidate)
  ));
  const best = candidates[0] || { candidate: null, digitOverlap: 0, positionHits: 0 };
  return {
    modelId: model.id,
    label: model.label,
    top3,
    top10,
    exactTop3: top3.includes(actual),
    top10Hit: top10.includes(actual),
    permutationHit: top3.some((candidate) => permutation(candidate, actual)),
    bestDigitOverlap: best.digitOverlap,
    bestPositionHits: best.positionHits,
    poolDigitCoverage: poolCoverage(top3, actual),
    bestCandidate: best.candidate,
  };
}

export async function ensureArenaForwardSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS arena_forward_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      anchor_period INTEGER NOT NULL,
      anchor_result TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      history_json TEXT NOT NULL,
      decay REAL NOT NULL,
      engine_version TEXT NOT NULL,
      predictions_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      settled_at TEXT,
      actual_period INTEGER,
      actual_result TEXT,
      scores_json TEXT
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_arena_forward_status ON arena_forward_runs(status, id DESC)").run();
  return true;
}

async function latestStored(db) {
  const query = await db.prepare("SELECT period, result FROM results_3d ORDER BY period DESC LIMIT 1").all();
  return query.results?.[0] || null;
}

async function firstAfter(db, period) {
  const query = await db.prepare(`
    SELECT period, result FROM results_3d
    WHERE period > ? ORDER BY period ASC LIMIT 1
  `).bind(period).all();
  return query.results?.[0] || null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: row.anchor_result,
    fingerprint: row.fingerprint,
    decay: Number(row.decay),
    engineVersion: row.engine_version,
    predictions: parseJson(row.predictions_json, []),
    status: row.status,
    settledAt: row.settled_at,
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: row.actual_result,
    scores: parseJson(row.scores_json, []),
  };
}

export async function createArenaForward(db, body = {}) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureArenaForwardSchema(db);
  const history = sanitizeHistory(body.history).slice(0, 5000);
  if (history.length < 40) throw new Error("Arena Forward memerlukan minimal 40 draw.");
  const fingerprint = String(body.fingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(fingerprint)) throw new Error("Fingerprint snapshot tidak valid.");
  const decay = Number(body.decay ?? 0.9);
  if (!(decay > 0 && decay <= 1)) throw new Error("Decay tidak valid.");
  const latest = await latestStored(db);
  if (!latest) throw new Error("D1 belum memiliki result anchor.");
  const anchorResult = normalizeNumber(latest.result);
  if (history[0] !== anchorResult) {
    throw new Error(`Snapshot stale. Latest D1 ${latest.period} = ${anchorResult}; Muat D1 dulu.`);
  }

  const arena = runModelArena(history, { decay });
  const predictions = arena.models.map((model) => ({
    id: model.id,
    label: model.label,
    top3: model.top3.map((row) => row.number),
    top10: model.top10.map((row) => row.number),
  }));
  const lockKey = `${latest.period}:${fingerprint}:${decay.toFixed(6)}:${ARENA_VERSION}`;
  await db.prepare(`
    INSERT OR IGNORE INTO arena_forward_runs (
      lock_key, created_at, anchor_period, anchor_result, fingerprint,
      history_json, decay, engine_version, predictions_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    lockKey,
    new Date().toISOString(),
    Number(latest.period),
    anchorResult,
    fingerprint,
    JSON.stringify(history),
    decay,
    ARENA_VERSION,
    JSON.stringify(predictions),
  ).run();
  const query = await db.prepare("SELECT * FROM arena_forward_runs WHERE lock_key = ? LIMIT 1").bind(lockKey).all();
  return mapRow(query.results?.[0]);
}

async function settleRow(db, row) {
  if (row.status !== "pending") return row;
  const actualRow = await firstAfter(db, Number(row.anchor_period));
  if (!actualRow) return row;
  const actual = normalizeNumber(actualRow.result);
  if (!actual) return row;
  const predictions = parseJson(row.predictions_json, []);
  const scores = predictions.map((model) => scoreModel(model, actual));
  await db.prepare(`
    UPDATE arena_forward_runs
    SET status='settled', settled_at=?, actual_period=?, actual_result=?, scores_json=?
    WHERE id=? AND status='pending'
  `).bind(
    new Date().toISOString(),
    Number(actualRow.period),
    actual,
    JSON.stringify(scores),
    Number(row.id),
  ).run();
  const updated = await db.prepare("SELECT * FROM arena_forward_runs WHERE id = ? LIMIT 1").bind(Number(row.id)).all();
  return updated.results?.[0] || row;
}

async function repairSettledRow(db, row) {
  if (!row || row.status !== "settled") return row;
  const actual = normalizeNumber(row.actual_result);
  if (!actual) return row;
  const predictions = parseJson(row.predictions_json, []);
  if (!predictions.length) return row;
  const repairedScores = predictions.map((model) => scoreModel(model, actual));
  const nextJson = JSON.stringify(repairedScores);
  const currentJson = String(row.scores_json || "");
  if (currentJson === nextJson) return row;
  await db.prepare("UPDATE arena_forward_runs SET scores_json = ? WHERE id = ?").bind(nextJson, Number(row.id)).run();
  return { ...row, scores_json: nextJson };
}

export async function listArenaForward(db, limit = 30) {
  if (!db) throw new Error("D1 binding DB belum dikonfigurasi.");
  await ensureArenaForwardSchema(db);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const query = await db.prepare("SELECT * FROM arena_forward_runs ORDER BY id DESC LIMIT ?").bind(safeLimit).all();
  const rows = [];
  for (const row of query.results || []) {
    const settled = await settleRow(db, row);
    rows.push(await repairSettledRow(db, settled));
  }
  return rows.map(mapRow);
}
