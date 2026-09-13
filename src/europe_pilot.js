import { collectEurope, ensureEuropeSchema, readEuropeHistory, europeDrawCount } from "./europe_collector.js";
import {
  buildEuropeModelStack,
  europeSlotKey,
  runEuropeKeeper7,
  scoreEuropeKeeper,
  scoreEuropeModels,
} from "./europe_engine.js";
import { getEuropeAdaptiveState, ensureEuropeAdaptiveSchema } from "./europe_adaptive.js";

export const EUROPE_PILOT_VERSION = "1.0.0";
const HISTORY_LIMIT = 600;

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

export async function ensureEuropeForwardSchema(db) {
  await ensureEuropeSchema(db);
  await ensureEuropeAdaptiveSchema(db);
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS europe_forward_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      settled_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      anchor_period INTEGER NOT NULL UNIQUE,
      anchor_result TEXT NOT NULL,
      target_period INTEGER,
      target_draw_time TEXT,
      history_size INTEGER NOT NULL,
      models_json TEXT NOT NULL,
      two_stage_json TEXT NOT NULL,
      keeper_json TEXT NOT NULL,
      adaptive_state_json TEXT NOT NULL,
      component_snapshot_json TEXT NOT NULL,
      actual_period INTEGER,
      actual_result TEXT,
      actual_datetime TEXT,
      model_scores_json TEXT,
      keeper_score_json TEXT
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_europe_forward_status ON europe_forward_runs(status, anchor_period DESC)").run();
}

async function settleEuropePending(db) {
  await ensureEuropeForwardSchema(db);
  const pending = await db.prepare(`
    SELECT id, anchor_period, models_json, keeper_json
    FROM europe_forward_runs
    WHERE status='pending'
    ORDER BY anchor_period ASC
  `).all();
  let settled = 0;
  const settledRows = [];

  for (const lock of pending.results || []) {
    const actualQuery = await db.prepare(`
      SELECT period, result, draw_datetime AS datetime
      FROM europe_results_3d
      WHERE period > ?
      ORDER BY period ASC
      LIMIT 1
    `).bind(Number(lock.anchor_period)).all();
    const actual = actualQuery.results?.[0];
    if (!actual) continue;

    const models = parseJson(lock.models_json, []);
    const keeper = parseJson(lock.keeper_json, null);
    const modelScores = scoreEuropeModels(actual.result, models);
    const keeperScore = scoreEuropeKeeper(actual.result, keeper);
    await db.prepare(`
      UPDATE europe_forward_runs
      SET status='settled', settled_at=?, actual_period=?, actual_result=?, actual_datetime=?,
          model_scores_json=?, keeper_score_json=?
      WHERE id=? AND status='pending'
    `).bind(
      new Date().toISOString(),
      Number(actual.period),
      String(actual.result),
      actual.datetime || null,
      JSON.stringify(modelScores),
      JSON.stringify(keeperScore),
      Number(lock.id),
    ).run();
    settled += 1;
    settledRows.push({
      id: Number(lock.id),
      anchorPeriod: Number(lock.anchor_period),
      actualPeriod: Number(actual.period),
      actualResult: String(actual.result),
      modelScores,
      keeperScore,
    });
  }
  return { settled, rows: settledRows };
}

function compactModel(model) {
  return {
    id: model?.id,
    label: model?.label,
    top3: (model?.top3 || []).map((row) => row?.number ?? row),
    top10: (model?.top10 || []).map((row) => row?.number ?? row),
  };
}

function compactForward(row) {
  if (!row) return null;
  const models = parseJson(row.models_json, []);
  const twoStage = parseJson(row.two_stage_json, {});
  const keeper = parseJson(row.keeper_json, {});
  const adaptive = parseJson(row.adaptive_state_json, {});
  return {
    id: Number(row.id),
    status: row.status,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: row.anchor_result,
    targetPeriod: row.target_period == null ? null : Number(row.target_period),
    targetDrawTime: row.target_draw_time,
    historySize: Number(row.history_size || 0),
    models: models.map(compactModel),
    twoStage: {
      top3: (twoStage.top3 || []).map((item) => item?.number ?? item),
      top10: (twoStage.top10 || []).map((item) => item?.number ?? item),
      flows: twoStage.flows || [],
      stage1: twoStage.stage1 || [],
    },
    keeper: {
      keep7: keeper.keep7 || [],
      drop3: keeper.drop3 || [],
      coverageMassPct: keeper.coverageMassPct ?? null,
      recentCoveragePct: keeper.recentCoveragePct ?? null,
      slotCoveragePct: keeper.slotCoveragePct ?? null,
      slotSamples: keeper.slotSamples ?? 0,
      assistedTop3: (keeper.assistedTop3 || []).map((item) => item?.number ?? item),
      targetSlot: keeper.targetSlot ?? null,
      weights: keeper.weights || {},
    },
    adaptive: {
      phase: adaptive.phase || "COLD_START",
      settledCount: Number(adaptive.settledCount || 0),
      weights: adaptive.weights || {},
      modelTrust: adaptive.modelTrust || {},
    },
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: row.actual_result,
    actualDatetime: row.actual_datetime,
    modelScores: parseJson(row.model_scores_json, []),
    keeperScore: parseJson(row.keeper_score_json, null),
  };
}

async function hasLock(db, period) {
  const query = await db.prepare("SELECT id FROM europe_forward_runs WHERE anchor_period=? LIMIT 1").bind(Number(period)).all();
  return Boolean(query.results?.[0]);
}

async function createLockForLatest(db, rows, adaptive) {
  const latest = rows[0];
  if (!latest || rows.length < 40) return { created: false, reason: "insufficient-history" };
  if (await hasLock(db, latest.period)) return { created: false, reason: "already-locked" };

  const stack = buildEuropeModelStack(rows, { decay: 0.90 });
  const targetSlot = europeSlotKey(latest.nextDrawTime);
  const keeper = runEuropeKeeper7(rows, {
    targetSlot,
    models: stack.models,
    weights: adaptive.weights,
    modelTrust: adaptive.modelTrust,
  });
  const twoStageSnapshot = {
    version: stack.twoStage.version,
    top3: stack.twoStage.top3 || [],
    top10: stack.twoStage.top10 || [],
    flows: stack.twoStage.flows || [],
    stage1: stack.twoStage.stage1 || [],
  };

  await db.prepare(`
    INSERT INTO europe_forward_runs(
      created_at, status, anchor_period, anchor_result, target_period, target_draw_time,
      history_size, models_json, two_stage_json, keeper_json, adaptive_state_json, component_snapshot_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    new Date().toISOString(),
    "pending",
    Number(latest.period),
    String(latest.result),
    Number(latest.period) + 1,
    latest.nextDrawTime || null,
    rows.length,
    JSON.stringify(stack.models.map(compactModel)),
    JSON.stringify(twoStageSnapshot),
    JSON.stringify(keeper),
    JSON.stringify(adaptive),
    JSON.stringify(keeper.componentSnapshot),
  ).run();

  return {
    created: true,
    anchorPeriod: Number(latest.period),
    targetPeriod: Number(latest.period) + 1,
    targetDrawTime: latest.nextDrawTime || null,
    keep7: keeper.keep7,
  };
}

async function latestRuns(db, limit = 12) {
  const query = await db.prepare(`
    SELECT * FROM europe_forward_runs
    ORDER BY anchor_period DESC, id DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(50, Number(limit) || 12))).all();
  return (query.results || []).map(compactForward);
}

export async function getEuropeStatus(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Europe AutoPilot.");
  const db = env.DB;
  await ensureEuropeForwardSchema(db);
  const settlement = await settleEuropePending(db);
  const adaptive = await getEuropeAdaptiveState(db);
  const [history, draws, runs] = await Promise.all([
    readEuropeHistory(db, 20),
    europeDrawCount(db),
    latestRuns(db, 12),
  ]);
  const pending = runs.find((row) => row.status === "pending") || null;
  const lastSettled = runs.find((row) => row.status === "settled") || null;
  return {
    ok: true,
    version: EUROPE_PILOT_VERSION,
    source: "Europe Lotto · 3D First Place only",
    sourceEndpoint: "https://backend.europelotto.work/api/results/latest",
    intervalMinutes: 45,
    pollSeconds: 30,
    collectorCron: "every 5 minutes",
    latest: history[0] || null,
    previous: history[1] || null,
    draws,
    pending,
    lastSettled,
    adaptive,
    recentHistory: history.slice(0, 10),
    settlement,
    policy: "forward-only · isolated dataset · no hindsight rewrite",
    now: new Date().toISOString(),
  };
}

export async function runEuropePilot(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Europe AutoPilot.");
  const db = env.DB;
  await ensureEuropeForwardSchema(db);
  let collection = null;
  let collectionError = null;
  if (options.collect !== false) {
    try {
      collection = await collectEurope(env, {
        backfill: options.backfill === true,
        backfillThreshold: 120,
        backfillLimit: 1200,
      });
    } catch (error) {
      collectionError = error?.message || String(error);
    }
  }

  const settlement = await settleEuropePending(db);
  const adaptive = await getEuropeAdaptiveState(db);
  const rows = await readEuropeHistory(db, HISTORY_LIMIT);
  const lock = await createLockForLatest(db, rows, adaptive);
  const status = await getEuropeStatus(env);
  return {
    ...status,
    pipeline: {
      collection,
      collectionError,
      settled: settlement.settled,
      lock,
    },
  };
}
