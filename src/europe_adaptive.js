import { EUROPE_DEFAULT_WEIGHTS, normalizeEurope3 } from "./europe_engine.js";

export const EUROPE_ADAPTIVE_VERSION = "1.0.0";

const COMPONENTS = ["recent", "global", "slot", "transition", "model"];
const UNIFORM_LOG_LOSS = Math.log(10);
const MIN_PROB = 1e-6;
const MAX_ROWS = 24;
const WEIGHT_BOUNDS = {
  recent: [0.24, 0.46],
  global: [0.12, 0.28],
  slot: [0.08, 0.28],
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

function phaseFor(count) {
  if (count <= 0) return "COLD_START";
  if (count < 8) return "WARMUP";
  if (count < 24) return "LEARNING";
  return "ADAPTIVE";
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
  return Object.fromEntries(COMPONENTS.map((key) => [key, round(weights[key] / total, 6)]));
}

function deriveWeights(stats, settledCount) {
  const confidence = clamp(settledCount / 24, 0, 1);
  const raw = {};
  for (const key of COMPONENTS) {
    const base = EUROPE_DEFAULT_WEIGHTS[key];
    const stat = stats[key] || {};
    const loss = Number(stat.avgLogLoss);
    const samples = Number(stat.samples || 0);
    if (!samples || !Number.isFinite(loss)) {
      raw[key] = base;
      continue;
    }
    const skill = clamp((UNIFORM_LOG_LOSS - loss) / 0.28, -1, 1);
    const localConfidence = confidence * clamp(samples / 12, 0.15, 1);
    raw[key] = base * Math.exp(skill * 0.42 * localConfidence);
  }
  const rawTotal = COMPONENTS.reduce((sum, key) => sum + raw[key], 0) || 1;
  const normalized = Object.fromEntries(COMPONENTS.map((key) => [key, raw[key] / rawTotal]));
  const blend = 0.58 * confidence;
  return boundedNormalize(Object.fromEntries(COMPONENTS.map((key) => [
    key,
    EUROPE_DEFAULT_WEIGHTS[key] * (1 - blend) + normalized[key] * blend,
  ])));
}

function scoreComponent(component, actualInput) {
  const actual = normalizeEurope3(actualInput);
  if (!actual || !Array.isArray(component) || component.length !== 3) return null;
  let loss = 0;
  for (let pos = 0; pos < 3; pos += 1) {
    const digit = Number(actual[pos]);
    const probability = Number(component[pos]?.[digit]);
    if (!Number.isFinite(probability)) return null;
    loss += -Math.log(Math.max(MIN_PROB, probability));
  }
  return loss / 3;
}

function utility(score) {
  const exact = Number(Boolean(score?.exactTop3));
  const top10 = Number(Boolean(score?.top10Hit));
  const permutation = Number(Boolean(score?.permutationHit));
  const position = clamp(Number(score?.bestPositionHits || 0) / 3, 0, 1);
  const overlap = clamp(Number(score?.bestDigitOverlap || 0) / 3, 0, 1);
  const pool = clamp(Number(score?.poolDigitCoverage || 0) / 3, 0, 1);
  return exact * 0.50 + top10 * 0.16 + permutation * 0.08 + position * 0.12 + overlap * 0.09 + pool * 0.05;
}

function deriveModelTrust(stats) {
  const entries = Object.entries(stats).filter(([, stat]) => Number(stat.samples || 0) > 0);
  if (!entries.length) return {};
  const grand = entries.reduce((sum, [, stat]) => sum + Number(stat.avgUtility || 0), 0) / entries.length;
  const raw = {};
  for (const [key, stat] of entries) {
    const confidence = clamp(Number(stat.samples || 0) / 20, 0, 1);
    raw[key] = Math.exp((Number(stat.avgUtility || 0) - grand) * 1.8 * confidence);
  }
  const mean = Object.values(raw).reduce((sum, value) => sum + value, 0) / Object.keys(raw).length;
  const bounded = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, clamp(value / (mean || 1), 0.80, 1.20)]));
  const mean2 = Object.values(bounded).reduce((sum, value) => sum + value, 0) / Object.keys(bounded).length;
  return Object.fromEntries(Object.entries(bounded).map(([key, value]) => [key, round(clamp(value / (mean2 || 1), 0.80, 1.20), 4)]));
}

export async function ensureEuropeAdaptiveSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS europe_adaptive_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      latest_actual_period INTEGER,
      settled_count INTEGER NOT NULL,
      phase TEXT NOT NULL,
      weights_json TEXT NOT NULL,
      model_trust_json TEXT NOT NULL,
      component_stats_json TEXT NOT NULL,
      model_stats_json TEXT NOT NULL
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_europe_adaptive_latest ON europe_adaptive_states(id DESC)").run();
}

async function readSettledRows(db) {
  try {
    const query = await db.prepare(`
      SELECT id, actual_period, actual_result, component_snapshot_json, model_scores_json
      FROM europe_forward_runs
      WHERE status='settled' AND actual_result IS NOT NULL
      ORDER BY actual_period DESC, id DESC
      LIMIT ?
    `).bind(MAX_ROWS).all();
    return query.results || [];
  } catch {
    return [];
  }
}

function componentStats(rows) {
  const accum = Object.fromEntries(COMPONENTS.map((key) => [key, { loss: 0, weight: 0, samples: 0 }]));
  rows.forEach((row, index) => {
    const snapshot = parseJson(row.component_snapshot_json, null);
    const actual = normalizeEurope3(row.actual_result);
    if (!snapshot?.components || !actual) return;
    const recency = 0.96 ** index;
    for (const key of COMPONENTS) {
      const loss = scoreComponent(snapshot.components[key], actual);
      if (!Number.isFinite(loss)) continue;
      accum[key].loss += loss * recency;
      accum[key].weight += recency;
      accum[key].samples += 1;
    }
  });
  return Object.fromEntries(COMPONENTS.map((key) => {
    const row = accum[key];
    const avg = row.weight ? row.loss / row.weight : null;
    return [key, {
      samples: row.samples,
      avgLogLoss: avg == null ? null : round(avg, 5),
      uniformLogLoss: round(UNIFORM_LOG_LOSS, 5),
      deltaVsUniform: avg == null ? null : round(UNIFORM_LOG_LOSS - avg, 5),
    }];
  }));
}

function modelStats(rows) {
  const accum = new Map();
  const add = (key, value, weight) => {
    const row = accum.get(key) || { total: 0, weight: 0, samples: 0 };
    row.total += value * weight;
    row.weight += weight;
    row.samples += 1;
    accum.set(key, row);
  };
  rows.forEach((row, index) => {
    const weight = 0.96 ** index;
    const scores = parseJson(row.model_scores_json, []);
    for (const score of Array.isArray(scores) ? scores : []) add(String(score.modelId || "model"), utility(score), weight);
  });
  return Object.fromEntries([...accum.entries()].map(([key, row]) => [key, {
    samples: row.samples,
    avgUtility: row.weight ? round(row.total / row.weight, 5) : 0,
  }]));
}

export async function getEuropeAdaptiveState(db) {
  await ensureEuropeAdaptiveSchema(db);
  const rows = await readSettledRows(db);
  const settledCount = rows.length ? Number((await db.prepare("SELECT COUNT(*) AS n FROM europe_forward_runs WHERE status='settled'").all()).results?.[0]?.n || 0) : 0;
  const latestActualPeriod = rows[0]?.actual_period == null ? null : Number(rows[0].actual_period);
  const stateKey = `${EUROPE_ADAPTIVE_VERSION}:${latestActualPeriod ?? 0}:${settledCount}`;

  const cached = await db.prepare("SELECT * FROM europe_adaptive_states WHERE state_key=? LIMIT 1").bind(stateKey).all();
  if (cached.results?.[0]) {
    const row = cached.results[0];
    return {
      version: EUROPE_ADAPTIVE_VERSION,
      stateKey,
      latestActualPeriod,
      settledCount,
      phase: row.phase,
      weights: parseJson(row.weights_json, EUROPE_DEFAULT_WEIGHTS),
      modelTrust: parseJson(row.model_trust_json, {}),
      componentStats: parseJson(row.component_stats_json, {}),
      modelStats: parseJson(row.model_stats_json, {}),
      cached: true,
    };
  }

  const components = componentStats(rows);
  const models = modelStats(rows);
  const weights = deriveWeights(components, settledCount);
  const modelTrust = deriveModelTrust(models);
  const phase = phaseFor(settledCount);
  await db.prepare(`
    INSERT OR IGNORE INTO europe_adaptive_states(
      state_key, created_at, latest_actual_period, settled_count, phase,
      weights_json, model_trust_json, component_stats_json, model_stats_json
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(
    stateKey,
    new Date().toISOString(),
    latestActualPeriod,
    settledCount,
    phase,
    JSON.stringify(weights),
    JSON.stringify(modelTrust),
    JSON.stringify(components),
    JSON.stringify(models),
  ).run();

  return {
    version: EUROPE_ADAPTIVE_VERSION,
    stateKey,
    latestActualPeriod,
    settledCount,
    phase,
    weights,
    modelTrust,
    componentStats: components,
    modelStats: models,
    cached: false,
  };
}
