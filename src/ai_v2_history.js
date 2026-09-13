import { ensureAiV2ObserverSchema } from "./ai_v2_observer.js";

export const AI_V2_HISTORY_VERSION = "0.1.0-history";

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function predictionNumber(value) {
  if (typeof value === "string" || typeof value === "number") return normalize3(value);
  return normalize3(value?.number);
}

function normalizeList(values, max = 10) {
  return (Array.isArray(values) ? values : [])
    .map(predictionNumber)
    .filter(Boolean)
    .slice(0, max);
}

function digitCounts(value) {
  const counts = Array(10).fill(0);
  for (const char of String(value || "")) {
    const d = Number(char);
    if (Number.isInteger(d)) counts[d] += 1;
  }
  return counts;
}

function digitOverlap(candidate, actual) {
  const left = digitCounts(candidate);
  const right = digitCounts(actual);
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

function scoreLockedPrediction(top3Input, top10Input, actualInput) {
  const actual = normalize3(actualInput);
  const top3 = normalizeList(top3Input, 3);
  const top10 = normalizeList(top10Input, 10);
  if (!actual) return null;

  const ranked = top3.map((candidate) => ({
    candidate,
    exact: candidate === actual,
    permutation: permutation(candidate, actual),
    digitOverlap: digitOverlap(candidate, actual),
    positionHits: positionHits(candidate, actual),
  })).sort((a, b) => (
    Number(b.exact) - Number(a.exact) ||
    Number(b.permutation) - Number(a.permutation) ||
    b.digitOverlap - a.digitOverlap ||
    b.positionHits - a.positionHits ||
    a.candidate.localeCompare(b.candidate)
  ));

  const best = ranked[0] || { candidate: null, digitOverlap: 0, positionHits: 0, exact: false, permutation: false };
  return {
    exactTop3: top3.includes(actual),
    top10Hit: top10.includes(actual),
    permutationHit: top3.some((candidate) => permutation(candidate, actual)),
    bestDigitOverlap: best.digitOverlap,
    bestPositionHits: best.positionHits,
    bestCandidate: best.candidate,
  };
}

function compactModel(model, actual) {
  if (!model) return null;
  const top3 = normalizeList(model.top3, 3);
  const top10 = normalizeList(model.top10, 10);
  return {
    id: String(model.id || model.modelId || "model"),
    label: String(model.label || model.id || model.modelId || "Model"),
    top3,
    top10,
    score: scoreLockedPrediction(top3, top10, actual),
  };
}

function distinctModels(models) {
  const seen = new Set();
  const out = [];
  for (const model of models.filter(Boolean)) {
    const key = String(model.id || model.label || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

function keeperSummary(keeper, actual) {
  const keep7 = (keeper?.keep7 || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9).slice(0, 7);
  const drop3 = (keeper?.drop3 || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9).slice(0, 3);
  const normalized = normalize3(actual);
  let covered = null;
  let all3 = null;
  if (normalized) {
    const allowed = new Set(keep7);
    covered = normalized.split("").reduce((sum, digit) => sum + Number(allowed.has(Number(digit))), 0);
    all3 = covered === 3;
  }
  return {
    keep7,
    drop3,
    coverageMassPct: keeper?.coverageMassPct ?? keeper?.subset?.positionMassProductPct ?? null,
    assistedTop3: normalizeList(keeper?.assistedTop3, 3),
    score: normalized ? { covered, all3 } : null,
  };
}

function historyRecord(row) {
  const features = parseJson(row.features_json, {});
  const actual = normalize3(row.actual_result);
  const source = String(row.source || "utama");

  let models = [];
  let twoStage = null;
  let keeper = null;

  if (source === "europe") {
    models = (features.models || []).map((model) => compactModel(model, actual));
    if (features.twoStage) {
      twoStage = compactModel({
        id: "two-stage",
        label: "Two-Stage",
        top3: features.twoStage.top3 || [],
        top10: features.twoStage.top10 || [],
      }, actual);
    }
    keeper = keeperSummary(features.keeper7 || {}, actual);
  } else {
    models = (features.arena?.predictions || []).map((model) => compactModel(model, actual));
    if (features.twoStage) {
      twoStage = compactModel({
        id: "two-stage",
        label: "Two-Stage",
        top3: features.twoStage.top3 || [],
        top10: features.twoStage.top10 || [],
      }, actual);
    }
    keeper = keeperSummary(features.keeper7 || {}, actual);
  }

  models = distinctModels(models.filter((model) => String(model?.id || "").toLowerCase() !== "two-stage"));
  const assist = {
    id: "3d-assist",
    label: "3D Assist",
    top3: keeper.assistedTop3,
    top10: [],
    score: scoreLockedPrediction(keeper.assistedTop3, [], actual),
  };

  return {
    id: Number(row.id),
    source,
    observationKey: row.observation_key,
    status: row.status,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: normalize3(row.anchor_result),
    targetPeriod: row.target_period == null ? null : Number(row.target_period),
    targetTime: row.target_time,
    lockedAt: row.source_lock_created_at,
    observedAt: row.observed_at,
    settledAt: row.settled_at,
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: actual,
    lockProof: {
      sourceStatusAtCapture: row.source_status_at_capture,
      lockedBeforeResult: row.source_status_at_capture === "pending",
      note: "Prediksi berasal dari source lock yang sudah ada saat masih pending; angka lama tidak diregenerate dari model sekarang.",
    },
    predictionHistory: {
      models,
      twoStage,
      assist,
      keeper7: keeper,
    },
    resultHistory: actual ? {
      period: row.actual_period == null ? null : Number(row.actual_period),
      result: actual,
      targetTime: row.target_time,
      settledAt: row.settled_at,
    } : null,
  };
}

function parseLimit(value) {
  if (String(value || "").toLowerCase() === "all") return 1000;
  return Math.max(1, Math.min(1000, Number(value) || 50));
}

export async function getAiV2History(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk AI V2 history.");
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);

  const limit = parseLimit(options.limit);
  const source = options.source === "utama" || options.source === "europe" ? options.source : null;
  const settledOnly = options.settledOnly !== false;

  const where = [];
  const binds = [];
  if (source) {
    where.push("source=?");
    binds.push(source);
  }
  if (settledOnly) where.push("status='settled'");

  const sql = `SELECT * FROM ai_v2_observations${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
  binds.push(limit);
  const query = await db.prepare(sql).bind(...binds).all();
  const rows = (query.results || []).map(historyRecord);

  return {
    ok: true,
    version: AI_V2_HISTORY_VERSION,
    mode: "LOCKED_HISTORY_ONLY",
    settledOnly,
    source: source || "all",
    limit: String(options.limit || 50).toLowerCase() === "all" ? "all" : limit,
    count: rows.length,
    policy: {
      resultHistorySeparateFromPredictionHistory: true,
      lockedBeforeResultRequired: true,
      regenerateOldPrediction: false,
      forwardOnly: true,
    },
    rows,
    bySource: {
      utama: rows.filter((row) => row.source === "utama"),
      europe: rows.filter((row) => row.source === "europe"),
    },
    now: new Date().toISOString(),
  };
}
