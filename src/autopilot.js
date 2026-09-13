import { analyzeHistory } from "./analyzer.js";
import { collectAndPersist } from "./collector.js";
import {
  createForwardPrediction,
  ensureForwardSchema,
  listForwardPredictions,
} from "./forward.js";
import {
  createArenaForward,
  ensureArenaForwardSchema,
  listArenaForward,
} from "./arena_forward.js";

export const AUTOPILOT_VERSION = "0.8.0";
const DEFAULT_DECAY = 0.90;
const HISTORY_LIMIT = 500;

function normalizeNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readHistorySnapshot(db, limit = HISTORY_LIMIT) {
  const query = await db.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime, collected_at AS collectedAt
    FROM results_3d
    ORDER BY period DESC
    LIMIT ?
  `).bind(limit).all();
  const rows = query.results || [];
  return {
    rows,
    history: rows.map((row) => normalizeNumber(row.result)).filter(Boolean),
    latest: rows[0] || null,
  };
}

async function totalDraws(db) {
  const query = await db.prepare("SELECT COUNT(*) AS count FROM results_3d").all();
  return Number(query.results?.[0]?.count || 0);
}

async function hasForwardAnchor(db, period) {
  await ensureForwardSchema(db);
  const query = await db.prepare(`
    SELECT id FROM forward_predictions
    WHERE anchor_period = ?
    ORDER BY id DESC LIMIT 1
  `).bind(Number(period)).all();
  return Boolean(query.results?.[0]);
}

async function hasArenaAnchor(db, period) {
  await ensureArenaForwardSchema(db);
  const query = await db.prepare(`
    SELECT id FROM arena_forward_runs
    WHERE anchor_period = ?
    ORDER BY id DESC LIMIT 1
  `).bind(Number(period)).all();
  return Boolean(query.results?.[0]);
}

async function ensureLocksForLatest(db, snapshot, decay = DEFAULT_DECAY) {
  const latest = snapshot.latest;
  const history = snapshot.history;
  if (!latest || history.length < 40) {
    return { forwardCreated: false, arenaCreated: false, reason: "insufficient-history" };
  }

  const fingerprint = await sha256(JSON.stringify(history));
  let forwardCreated = false;
  let arenaCreated = false;

  if (!(await hasForwardAnchor(db, latest.period))) {
    const analysis = analyzeHistory(history, { decay, modelId: "ensemble" });
    await createForwardPrediction(db, {
      history,
      fingerprint,
      engineVersion: AUTOPILOT_VERSION,
      modelId: "ensemble",
      decay,
      top3: analysis.top3.map((row) => row.number),
      top10: analysis.top10.map((row) => row.number),
    });
    forwardCreated = true;
  }

  if (!(await hasArenaAnchor(db, latest.period))) {
    await createArenaForward(db, { history, fingerprint, decay });
    arenaCreated = true;
  }

  return { forwardCreated, arenaCreated, fingerprint };
}

function compactArena(run) {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    anchorPeriod: run.anchorPeriod,
    anchorResult: run.anchorResult,
    actualPeriod: run.actualPeriod,
    actualResult: run.actualResult,
    predictions: (run.predictions || []).map((model) => ({
      id: model.id,
      label: model.label,
      top3: model.top3 || [],
      top10: model.top10 || [],
    })),
    scores: run.scores || [],
  };
}

function compactForward(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    anchorPeriod: row.anchorPeriod,
    anchorResult: row.anchorResult,
    top3: row.top3 || [],
    top10: row.top10 || [],
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

export async function getAutoPilotStatus(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk AutoPilot.");
  const db = env.DB;
  await ensureForwardSchema(db);
  await ensureArenaForwardSchema(db);

  // Listing also settles any pending run whose first later result is already in D1.
  const [forwardRows, arenaRows, snapshot, count] = await Promise.all([
    listForwardPredictions(db, 12),
    listArenaForward(db, 12),
    readHistorySnapshot(db, HISTORY_LIMIT),
    totalDraws(db),
  ]);

  const pendingForward = forwardRows.find((row) => row.status === "pending") || null;
  const pendingArena = arenaRows.find((row) => row.status === "pending") || null;
  const lastForward = forwardRows.find((row) => row.status === "settled") || null;
  const lastArena = arenaRows.find((row) => row.status === "settled") || null;

  return {
    ok: true,
    version: AUTOPILOT_VERSION,
    mode: "AUTO",
    pollSeconds: 30,
    cron: "every 10 minutes",
    latest: snapshot.latest,
    draws: count,
    pendingForward: compactForward(pendingForward),
    pendingArena: compactArena(pendingArena),
    lastForward: compactForward(lastForward),
    lastArena: compactArena(lastArena),
    now: new Date().toISOString(),
  };
}

export async function runAutoPilot(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk AutoPilot.");
  const decay = Number(options.decay ?? DEFAULT_DECAY);
  let collection = null;
  let collectionError = null;

  if (options.collect !== false) {
    try {
      collection = await collectAndPersist(env, { pages: 1, backfillPages: 0 });
    } catch (error) {
      collectionError = error?.message || "collector failed";
    }
  }

  // First settle predictions created before the newest stored result.
  await listForwardPredictions(env.DB, 20);
  await listArenaForward(env.DB, 20);

  const snapshot = await readHistorySnapshot(env.DB, HISTORY_LIMIT);
  const locks = await ensureLocksForLatest(env.DB, snapshot, decay);
  const status = await getAutoPilotStatus(env);

  return {
    ...status,
    pipeline: {
      collection: collection ? {
        latest: collection.latest || null,
        inserted: Number(collection.storage?.recentInserted ?? collection.storage?.inserted ?? 0),
      } : null,
      collectionError,
      forwardCreated: locks.forwardCreated,
      arenaCreated: locks.arenaCreated,
      fingerprint: locks.fingerprint || null,
    },
  };
}
