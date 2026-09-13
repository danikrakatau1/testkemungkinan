import {
  DEFAULT_KEEPER7_WEIGHTS,
  buildKeeper7ComponentSnapshot,
  normalize3,
} from "./keeper7.js";

export const ADAPTIVE_VERSION = "0.9.2";

const COMPONENTS = ["recent", "global", "hour", "transition", "model"];
const MAX_KEEPER_ROWS = 24;
const MAX_MODEL_ROWS = 48;
const UNIFORM_LOG_LOSS = Math.log(10);
const MIN_PROB = 1e-6;
const WEIGHT_BOUNDS = {
  recent: [0.24, 0.46],
  global: [0.12, 0.28],
  hour: [0.08, 0.28],
  transition: [0.08, 0.28],
  model: [0.04, 0.18],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 5) {
  return Number(Number(value || 0).toFixed(digits));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function canonicalModelKey(id, label = "") {
  const text = `${id || ""} ${label || ""}`.toLowerCase();
  if (/two.?stage/.test(text)) return "two-stage";
  if (/hybrid/.test(text)) return "hybrid";
  if (/digit.?boost/.test(text)) return "digitboost";
  if (/legacy/.test(text)) return "legacy";
  return String(id || label || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";
}

function boundedNormalize(input) {
  let weights = { ...input };
  for (let pass = 0; pass < 6; pass += 1) {
    const total = COMPONENTS.reduce((sum, key) => sum + Math.max(0, Number(weights[key]) || 0), 0) || 1;
    for (const key of COMPONENTS) weights[key] = Math.max(0, Number(weights[key]) || 0) / total;
    let changed = false;
    for (const key of COMPONENTS) {
      const [min, max] = WEIGHT_BOUNDS[key];
      const next = clamp(weights[key], min, max);
      if (Math.abs(next - weights[key]) > 1e-9) changed = true;
      weights[key] = next;
    }
    if (!changed) break;
  }
  const total = COMPONENTS.reduce((sum, key) => sum + weights[key], 0) || 1;
  const normalized = Object.fromEntries(COMPONENTS.map((key) => [key, weights[key] / total]));
  return Object.fromEntries(COMPONENTS.map((key) => [key, round(normalized[key], 6)]));
}

export function deriveAdaptiveWeightsFromLosses(componentStats = {}, settledCount = 0) {
  const confidence = clamp(Number(settledCount || 0) / 24, 0, 1);
  const raw = {};

  for (const key of COMPONENTS) {
    const base = DEFAULT_KEEPER7_WEIGHTS[key];
    const stat = componentStats[key] || {};
    const avgLoss = Number(stat.avgLogLoss);
    const samples = Number(stat.samples || 0);
    if (!samples || !Number.isFinite(avgLoss)) {
      raw[key] = base;
      continue;
    }
    // Positive skill means the evidence source assigned more mass to the eventual
    // forward result than a uniform 0-9 distribution. Learning is intentionally
    // slow and bounded so one unlucky draw cannot swing the engine.
    const skill = clamp((UNIFORM_LOG_LOSS - avgLoss) / 0.28, -1, 1);
    const localConfidence = confidence * clamp(samples / 12, 0.15, 1);
    raw[key] = base * Math.exp(skill * 0.42 * localConfidence);
  }

  const normalizedRawTotal = COMPONENTS.reduce((sum, key) => sum + raw[key], 0) || 1;
  const normalizedRaw = Object.fromEntries(COMPONENTS.map((key) => [key, raw[key] / normalizedRawTotal]));
  const blend = 0.58 * confidence;
  const blended = Object.fromEntries(COMPONENTS.map((key) => [
    key,
    DEFAULT_KEEPER7_WEIGHTS[key] * (1 - blend) + normalizedRaw[key] * blend,
  ]));
  return boundedNormalize(blended);
}

function scoreComponent(component, actual) {
  const normalized = normalize3(actual);
  if (!normalized || !Array.isArray(component) || component.length !== 3) return null;
  let loss = 0;
  for (let position = 0; position < 3; position += 1) {
    const digit = Number(normalized[position]);
    const probability = Number(component[position]?.[digit]);
    if (!Number.isFinite(probability)) return null;
    loss += -Math.log(Math.max(MIN_PROB, probability));
  }
  return loss / 3;
}

function utilityFromScore(score) {
  const exact = Number(Boolean(score?.exactTop3 ?? score?.exact_top3));
  const top10 = Number(Boolean(score?.top10Hit ?? score?.top10_hit));
  const permutation = Number(Boolean(score?.permutationHit ?? score?.permutation_hit));
  const position = clamp(Number(score?.bestPositionHits ?? score?.best_position_hits ?? 0) / 3, 0, 1);
  const overlap = clamp(Number(score?.bestDigitOverlap ?? score?.best_digit_overlap ?? 0) / 3, 0, 1);
  const pool = clamp(Number(score?.poolDigitCoverage ?? score?.pool_digit_coverage ?? 0) / 3, 0, 1);
  return exact * 0.50 + top10 * 0.16 + permutation * 0.08 + position * 0.12 + overlap * 0.09 + pool * 0.05;
}

function deriveModelTrust(modelStats) {
  const entries = Object.entries(modelStats).filter(([, stat]) => Number(stat.samples || 0) > 0);
  if (!entries.length) return {};
  const grandMean = entries.reduce((sum, [, stat]) => sum + Number(stat.avgUtility || 0), 0) / entries.length;
  const raw = {};
  for (const [key, stat] of entries) {
    const confidence = clamp(Number(stat.samples || 0) / 20, 0, 1);
    raw[key] = Math.exp((Number(stat.avgUtility || 0) - grandMean) * 1.8 * confidence);
  }
  const mean = Object.values(raw).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(raw).length);
  const trust = {};
  for (const [key, value] of Object.entries(raw)) trust[key] = clamp(value / (mean || 1), 0.80, 1.20);
  const trustMean = Object.values(trust).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(trust).length);
  for (const key of Object.keys(trust)) trust[key] = round(clamp(trust[key] / (trustMean || 1), 0.80, 1.20), 4);
  return trust;
}

async function tableInfo(db, table) {
  try {
    const result = await db.prepare(`PRAGMA table_info(${table})`).all();
    return (result.results || []).map((row) => String(row.name));
  } catch {
    return [];
  }
}

async function readCounts(db) {
  const out = {
    keeperSettled: 0,
    keeperLatestPeriod: null,
    arenaSettled: 0,
    arenaLatestPeriod: null,
    twoStageSettled: 0,
    twoStageLatestPeriod: null,
  };
  try {
    const q = await db.prepare("SELECT COUNT(*) AS n, MAX(actual_period) AS p FROM keeper7_forward_runs WHERE status='settled'").all();
    out.keeperSettled = Number(q.results?.[0]?.n || 0);
    out.keeperLatestPeriod = q.results?.[0]?.p == null ? null : Number(q.results[0].p);
  } catch {}
  try {
    const q = await db.prepare("SELECT COUNT(*) AS n, MAX(actual_period) AS p FROM arena_forward_runs WHERE status='settled'").all();
    out.arenaSettled = Number(q.results?.[0]?.n || 0);
    out.arenaLatestPeriod = q.results?.[0]?.p == null ? null : Number(q.results[0].p);
  } catch {}
  try {
    const q = await db.prepare("SELECT COUNT(*) AS n, MAX(actual_period) AS p FROM two_stage_forward_runs WHERE status='settled'").all();
    out.twoStageSettled = Number(q.results?.[0]?.n || 0);
    out.twoStageLatestPeriod = q.results?.[0]?.p == null ? null : Number(q.results[0].p);
  } catch {}
  return out;
}

async function readKeeperComponentStats(db) {
  const columns = await tableInfo(db, "keeper7_forward_runs");
  if (!columns.length) return { stats: {}, usedRows: 0 };
  const hasSnapshot = columns.includes("component_snapshot_json");
  const snapshotSelect = hasSnapshot ? "component_snapshot_json" : "NULL AS component_snapshot_json";
  const query = await db.prepare(`
    SELECT id, anchor_period, target_hour, history_json, actual_period, actual_result,
           model_sources_json, ${snapshotSelect}
    FROM keeper7_forward_runs
    WHERE status='settled' AND actual_result IS NOT NULL
    ORDER BY actual_period DESC, id DESC
    LIMIT ?
  `).bind(MAX_KEEPER_ROWS).all();

  const accum = Object.fromEntries(COMPONENTS.map((key) => [key, { weightedLoss: 0, weight: 0, samples: 0 }]));
  let usedRows = 0;

  for (let index = 0; index < (query.results || []).length; index += 1) {
    const row = query.results[index];
    const actual = normalize3(row.actual_result);
    if (!actual) continue;
    let snapshot = parseJson(row.component_snapshot_json, null);
    if (!snapshot?.components) {
      const history = parseJson(row.history_json, []);
      if (!Array.isArray(history) || history.length < 40) continue;
      try {
        snapshot = buildKeeper7ComponentSnapshot(history, {
          targetHour: row.target_hour == null ? undefined : Number(row.target_hour),
          models: [],
        });
      } catch {
        continue;
      }
    }
    const recencyWeight = 0.96 ** index;
    const modelSources = parseJson(row.model_sources_json, []);
    for (const key of COMPONENTS) {
      if (key === "model" && (!row.component_snapshot_json || !Array.isArray(modelSources) || !modelSources.length)) continue;
      const loss = scoreComponent(snapshot.components?.[key], actual);
      if (!Number.isFinite(loss)) continue;
      accum[key].weightedLoss += loss * recencyWeight;
      accum[key].weight += recencyWeight;
      accum[key].samples += 1;
    }
    usedRows += 1;
  }

  const stats = {};
  for (const key of COMPONENTS) {
    const row = accum[key];
    stats[key] = {
      samples: row.samples,
      avgLogLoss: row.weight ? round(row.weightedLoss / row.weight, 5) : null,
      uniformLogLoss: round(UNIFORM_LOG_LOSS, 5),
      deltaVsUniform: row.weight ? round(UNIFORM_LOG_LOSS - row.weightedLoss / row.weight, 5) : null,
    };
  }
  return { stats, usedRows };
}

async function readModelStats(db) {
  const accum = new Map();
  const add = (key, utility, weight) => {
    const current = accum.get(key) || { weightedUtility: 0, weight: 0, samples: 0 };
    current.weightedUtility += utility * weight;
    current.weight += weight;
    current.samples += 1;
    accum.set(key, current);
  };

  try {
    const query = await db.prepare(`
      SELECT id, scores_json
      FROM arena_forward_runs
      WHERE status='settled' AND scores_json IS NOT NULL
      ORDER BY actual_period DESC, id DESC
      LIMIT ?
    `).bind(MAX_MODEL_ROWS).all();
    for (let index = 0; index < (query.results || []).length; index += 1) {
      const weight = 0.96 ** index;
      const scores = parseJson(query.results[index].scores_json, []);
      for (const score of Array.isArray(scores) ? scores : []) {
        const key = canonicalModelKey(score?.modelId, score?.label);
        add(key, utilityFromScore(score), weight);
      }
    }
  } catch {}

  try {
    const query = await db.prepare(`
      SELECT id, exact_top3, top10_hit, permutation_hit,
             best_digit_overlap, best_position_hits, pool_digit_coverage
      FROM two_stage_forward_runs
      WHERE status='settled' AND actual_result IS NOT NULL
      ORDER BY actual_period DESC, id DESC
      LIMIT ?
    `).bind(MAX_MODEL_ROWS).all();
    for (let index = 0; index < (query.results || []).length; index += 1) {
      const weight = 0.96 ** index;
      add("two-stage", utilityFromScore(query.results[index]), weight);
    }
  } catch {}

  const stats = {};
  for (const [key, row] of accum.entries()) {
    stats[key] = {
      samples: row.samples,
      avgUtility: row.weight ? round(row.weightedUtility / row.weight, 5) : 0,
    };
  }
  return stats;
}

export async function ensureAdaptiveSchema(db) {
  await db.prepare(`
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
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_adaptive_error_latest ON adaptive_error_states(id DESC)").run();
  return true;
}

function phaseFor(count) {
  if (count <= 0) return "COLD_START";
  if (count < 8) return "WARMUP";
  if (count < 24) return "LEARNING";
  return "ADAPTIVE";
}

function mapState(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    stateKey: row.state_key,
    createdAt: row.created_at,
    version: row.engine_version,
    latestActualPeriod: row.latest_actual_period == null ? null : Number(row.latest_actual_period),
    keeperSettled: Number(row.keeper_settled || 0),
    arenaSettled: Number(row.arena_settled || 0),
    twoStageSettled: Number(row.two_stage_settled || 0),
    phase: row.phase,
    weights: parseJson(row.weights_json, DEFAULT_KEEPER7_WEIGHTS),
    modelTrust: parseJson(row.model_trust_json, {}),
    componentStats: parseJson(row.component_stats_json, {}),
    modelStats: parseJson(row.model_stats_json, {}),
  };
}

export async function getAdaptiveErrorState(db) {
  if (!db) throw new Error("D1 binding DB diperlukan untuk Adaptive Error Learner.");
  await ensureAdaptiveSchema(db);
  const counts = await readCounts(db);
  const latestActualPeriod = Math.max(
    Number(counts.keeperLatestPeriod || 0),
    Number(counts.arenaLatestPeriod || 0),
    Number(counts.twoStageLatestPeriod || 0),
  ) || null;
  const stateKey = [
    ADAPTIVE_VERSION,
    latestActualPeriod ?? "none",
    counts.keeperSettled,
    counts.arenaSettled,
    counts.twoStageSettled,
  ].join(":");

  const cached = await db.prepare("SELECT * FROM adaptive_error_states WHERE state_key = ? LIMIT 1").bind(stateKey).all();
  if (cached.results?.[0]) return { ...mapState(cached.results[0]), cached: true };

  const component = await readKeeperComponentStats(db);
  const modelStats = await readModelStats(db);
  const modelTrust = deriveModelTrust(modelStats);
  const weights = deriveAdaptiveWeightsFromLosses(component.stats, counts.keeperSettled);
  const phase = phaseFor(counts.keeperSettled);
  const createdAt = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO adaptive_error_states (
      state_key, created_at, engine_version, latest_actual_period,
      keeper_settled, arena_settled, two_stage_settled, phase,
      weights_json, model_trust_json, component_stats_json, model_stats_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stateKey,
    createdAt,
    ADAPTIVE_VERSION,
    latestActualPeriod,
    counts.keeperSettled,
    counts.arenaSettled,
    counts.twoStageSettled,
    phase,
    JSON.stringify(weights),
    JSON.stringify(modelTrust),
    JSON.stringify(component.stats),
    JSON.stringify(modelStats),
  ).run();

  const stored = await db.prepare("SELECT * FROM adaptive_error_states WHERE state_key = ? LIMIT 1").bind(stateKey).all();
  const state = mapState(stored.results?.[0]);
  return {
    ...(state || {
      version: ADAPTIVE_VERSION,
      latestActualPeriod,
      keeperSettled: counts.keeperSettled,
      arenaSettled: counts.arenaSettled,
      twoStageSettled: counts.twoStageSettled,
      phase,
      weights,
      modelTrust,
      componentStats: component.stats,
      modelStats,
    }),
    cached: false,
    method: "forward-only bounded error learning; no prediction lock is rewritten after the actual result",
  };
}
