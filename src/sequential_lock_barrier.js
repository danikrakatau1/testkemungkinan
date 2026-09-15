import { fetchResultPage } from "./collector.js";
import { fetchEuropeLatest } from "./europe_collector.js";
import { runContinuousWatchdogCycle } from "./continuous_watchdog.js";
import { armLearnerContinuityGuard } from "./learner_continuity_guard.js";

export const SEQUENTIAL_LOCK_BARRIER_VERSION = "1.0.5";
export const SEQUENTIAL_LOCK_BARRIER_MODE = "SOURCE_TO_LOCK_SEQUENTIAL_BARRIER";
const MAX_GAP_PERIODS = 200;

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

async function firstRow(statement) {
  const out = await statement.all();
  return out.results?.[0] || null;
}

async function safeAll(statement) {
  try {
    const out = await statement.all();
    return out.results || [];
  } catch {
    return [];
  }
}

async function ensureBarrierSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sequential_barrier_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sequential_barrier_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      utama_db_before INTEGER,
      utama_source_seen INTEGER,
      utama_db_after INTEGER,
      utama_lock_after INTEGER,
      utama_observer_after INTEGER,
      utama_delta INTEGER,
      europe_db_before INTEGER,
      europe_source_seen INTEGER,
      europe_db_after INTEGER,
      europe_lock_after INTEGER,
      europe_observer_after INTEGER,
      europe_delta INTEGER,
      gap_count INTEGER NOT NULL DEFAULT 0,
      transition_pass_count INTEGER NOT NULL DEFAULT 0,
      transition_fail_count INTEGER NOT NULL DEFAULT 0,
      watchdog_ok INTEGER NOT NULL DEFAULT 0,
      details_json TEXT,
      error_text TEXT
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_barrier_cycles_time ON sequential_barrier_cycles(started_at DESC)").run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sequential_barrier_gaps (
      source TEXT NOT NULL,
      anchor_period INTEGER NOT NULL,
      detected_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      db_before_period INTEGER,
      source_seen_period INTEGER,
      details_json TEXT,
      PRIMARY KEY(source, anchor_period)
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_barrier_gaps_detected ON sequential_barrier_gaps(detected_at DESC)").run();
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM sequential_barrier_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value ?? null;
}

async function writeMeta(db, key, value, replace = true) {
  const now = new Date().toISOString();
  const sql = replace
    ? "INSERT OR REPLACE INTO sequential_barrier_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)"
    : "INSERT OR IGNORE INTO sequential_barrier_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)";
  await db.prepare(sql).bind(key, String(value), now).run();
}

async function inspectState(db) {
  const [utamaResult, keeper, arena, twoStage, utamaObserver, europeResult, europeForward, europeObserver] = await Promise.all([
    firstRow(db.prepare("SELECT period FROM results_3d ORDER BY period DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM keeper7_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM arena_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM two_stage_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM ai_v2_observations WHERE source='utama' ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT period FROM europe_results_3d ORDER BY period DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM europe_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period, status FROM ai_v2_observations WHERE source='europe' ORDER BY anchor_period DESC, id DESC LIMIT 1")),
  ]);
  const num = (value) => value == null ? null : Number(value);
  return {
    utama: {
      resultPeriod: num(utamaResult?.period),
      keeperAnchor: num(keeper?.anchor_period),
      arenaAnchor: num(arena?.anchor_period),
      twoStageAnchor: num(twoStage?.anchor_period),
      observerAnchor: num(utamaObserver?.anchor_period),
    },
    europe: {
      resultPeriod: num(europeResult?.period),
      forwardAnchor: num(europeForward?.anchor_period),
      observerAnchor: num(europeObserver?.anchor_period),
    },
  };
}

function chainHealth(source, state) {
  if (!state || state.resultPeriod == null) return { ok: false, reason: "NO_STORED_RESULT" };
  if (source === "utama") {
    const missing = [];
    if (state.keeperAnchor !== state.resultPeriod) missing.push("KEEPER7");
    if (state.arenaAnchor !== state.resultPeriod) missing.push("ARENA");
    if (state.twoStageAnchor !== state.resultPeriod) missing.push("TWO_STAGE");
    if (state.observerAnchor !== state.resultPeriod) missing.push("OBSERVER");
    return missing.length
      ? { ok: false, reason: "CURRENT_CHAIN_INCOMPLETE", missing }
      : { ok: true, reason: "RESULT_KEEPER_ARENA_TWO_STAGE_OBSERVER_ALIGNED", missing: [] };
  }
  const missing = [];
  if (state.forwardAnchor !== state.resultPeriod) missing.push("FORWARD_LOCK");
  if (state.observerAnchor !== state.resultPeriod) missing.push("OBSERVER");
  return missing.length
    ? { ok: false, reason: "CURRENT_CHAIN_INCOMPLETE", missing }
    : { ok: true, reason: "RESULT_FORWARD_OBSERVER_ALIGNED", missing: [] };
}

async function fetchLiveSources() {
  const [utamaSettled, europeSettled] = await Promise.allSettled([
    fetchResultPage(1),
    fetchEuropeLatest(),
  ]);
  let utama = null;
  let europe = null;
  let utamaError = null;
  let europeError = null;
  if (utamaSettled.status === "fulfilled") {
    const rows = utamaSettled.value || [];
    utama = rows.reduce((best, row) => !best || Number(row.period) > Number(best.period) ? row : best, null);
    if (!utama) utamaError = "UTAMA source returned no parsed result";
  } else utamaError = utamaSettled.reason?.message || String(utamaSettled.reason || "UTAMA source fetch failed");
  if (europeSettled.status === "fulfilled") europe = europeSettled.value;
  else europeError = europeSettled.reason?.message || String(europeSettled.reason || "Europe source fetch failed");
  return {
    utama: utama ? { period: Number(utama.period), result: String(utama.result || "").padStart(3, "0") } : null,
    europe: europe ? { period: Number(europe.period), result: String(europe.result || "").padStart(3, "0") } : null,
    errors: { utama: utamaError, europe: europeError },
  };
}

function range(from, to) {
  const out = [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return out;
  for (let p = from; p <= to && out.length < MAX_GAP_PERIODS; p += 1) out.push(p);
  return out;
}

function preflightLane(source, state, live) {
  const dbPeriod = Number(state?.resultPeriod);
  const seen = Number(live?.period);
  const currentChain = chainHealth(source, state);
  if (!Number.isFinite(dbPeriod)) return { source, dbPeriod: null, sourceSeenPeriod: Number.isFinite(seen) ? seen : null, delta: null, currentChain, gapAnchors: [], transitionExpected: false, status: "NO_DB_RESULT" };
  if (!Number.isFinite(seen)) return { source, dbPeriod, sourceSeenPeriod: null, delta: null, currentChain, gapAnchors: [], transitionExpected: false, status: "SOURCE_UNAVAILABLE" };
  const delta = seen - dbPeriod;
  const gapAnchors = [];
  if (delta > 0 && !currentChain.ok) gapAnchors.push(dbPeriod);
  if (delta > 1) gapAnchors.push(...range(dbPeriod + 1, seen - 1));
  return {
    source,
    dbPeriod,
    sourceSeenPeriod: seen,
    delta,
    currentChain,
    gapAnchors: [...new Set(gapAnchors)].sort((a, b) => a - b),
    transitionExpected: delta === 1,
    status: delta < 0 ? "SOURCE_BEHIND_DB" : gapAnchors.length ? "GAP_DETECTED" : delta === 0 ? "NO_NEW_RESULT" : "ONE_STEP_ADVANCE",
  };
}

async function persistGaps(db, lane, detectedAt) {
  for (const period of lane.gapAnchors || []) {
    let reason = "SOURCE_JUMP";
    if (period === lane.dbPeriod && !lane.currentChain?.ok) reason = "SOURCE_ADVANCED_BEFORE_CURRENT_CHAIN_LOCKED";
    await db.prepare(`
      INSERT OR IGNORE INTO sequential_barrier_gaps(
        source, anchor_period, detected_at, reason, db_before_period, source_seen_period, details_json
      ) VALUES(?,?,?,?,?,?,?)
    `).bind(
      lane.source,
      Number(period),
      detectedAt,
      reason,
      lane.dbPeriod,
      lane.sourceSeenPeriod,
      JSON.stringify({ preflightStatus: lane.status, currentChain: lane.currentChain }),
    ).run();
  }
}

function postflightLane(source, pre, state) {
  const chain = chainHealth(source, state);
  const sourceSeen = Number(pre?.sourceSeenPeriod);
  const resultPeriod = Number(state?.resultPeriod);
  const sourceCaughtUp = !Number.isFinite(sourceSeen) || (Number.isFinite(resultPeriod) && resultPeriod >= sourceSeen);
  const transitionPass = pre?.transitionExpected === true && sourceCaughtUp && chain.ok && resultPeriod === sourceSeen;
  const transitionFail = pre?.transitionExpected === true && !transitionPass;
  return {
    source,
    resultPeriod: Number.isFinite(resultPeriod) ? resultPeriod : null,
    sourceSeenPeriod: Number.isFinite(sourceSeen) ? sourceSeen : null,
    sourceCaughtUp,
    chain,
    transitionExpected: Boolean(pre?.transitionExpected),
    transitionPass,
    transitionFail,
  };
}

async function armBarrier(db, trigger, startedAt, before) {
  const existing = await metaValue(db, "sequential_barrier_started_at");
  if (existing) return { startedAt: existing, created: false };
  if (trigger !== "scheduled") return { startedAt: null, created: false };
  await writeMeta(db, "sequential_barrier_started_at", startedAt, false);
  await writeMeta(db, "sequential_barrier_version", SEQUENTIAL_LOCK_BARRIER_VERSION, false);
  if (before?.utama?.resultPeriod != null) await writeMeta(db, "sequential_barrier_utama_start_period", before.utama.resultPeriod, false);
  if (before?.europe?.resultPeriod != null) await writeMeta(db, "sequential_barrier_europe_start_period", before.europe.resultPeriod, false);
  return { startedAt: await metaValue(db, "sequential_barrier_started_at"), created: true };
}

export async function runSequentialLockBarrierCycle(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Sequential Lock Barrier.");
  const db = env.DB;
  await ensureBarrierSchema(db);
  const trigger = String(options.trigger || "scheduled");
  const startedAt = new Date().toISOString();
  const before = await inspectState(db);
  const armed = await armBarrier(db, trigger, startedAt, before);
  try { await armLearnerContinuityGuard(env, { trigger, startedAt }); } catch {}

  const live = await fetchLiveSources();
  const preUtama = preflightLane("utama", before.utama, live.utama);
  const preEurope = preflightLane("europe", before.europe, live.europe);
  await persistGaps(db, preUtama, startedAt);
  await persistGaps(db, preEurope, startedAt);

  const insert = await db.prepare(`
    INSERT INTO sequential_barrier_cycles(
      started_at, trigger, status,
      utama_db_before, utama_source_seen, utama_delta,
      europe_db_before, europe_source_seen, europe_delta,
      gap_count
    ) VALUES(?,?, 'RUNNING', ?,?,?,?,?,?,?,?)
  `).bind(
    startedAt,
    trigger,
    preUtama.dbPeriod,
    preUtama.sourceSeenPeriod,
    preUtama.delta,
    preEurope.dbPeriod,
    preEurope.sourceSeenPeriod,
    preEurope.delta,
    (preUtama.gapAnchors?.length || 0) + (preEurope.gapAnchors?.length || 0),
  ).run();
  const cycleId = Number(insert.meta?.last_row_id || 0);

  let watchdog = null;
  let errorText = null;
  try {
    watchdog = await runContinuousWatchdogCycle(env, { trigger, cron: options.cron || null });
  } catch (error) {
    errorText = error?.message || String(error);
  }

  const after = await inspectState(db);
  const postUtama = postflightLane("utama", preUtama, after.utama);
  const postEurope = postflightLane("europe", preEurope, after.europe);
  const gapCount = (preUtama.gapAnchors?.length || 0) + (preEurope.gapAnchors?.length || 0);
  const transitionPassCount = Number(postUtama.transitionPass) + Number(postEurope.transitionPass);
  const transitionFailCount = Number(postUtama.transitionFail) + Number(postEurope.transitionFail);

  let status = "HEALTHY";
  if (errorText || !watchdog?.ok) status = "ERROR";
  else if (!postUtama.chain.ok || !postEurope.chain.ok || transitionFailCount > 0) status = "DEGRADED";
  else if (gapCount > 0) status = "RECOVERED_WITH_GAP";

  const finishedAt = new Date().toISOString();
  const details = {
    version: SEQUENTIAL_LOCK_BARRIER_VERSION,
    mode: SEQUENTIAL_LOCK_BARRIER_MODE,
    armed,
    liveErrors: live.errors,
    preflight: { utama: preUtama, europe: preEurope },
    postflight: { utama: postUtama, europe: postEurope },
    policy: {
      exactOneStepAdvanceIsRequiredForEveryDrawEvidence: true,
      sourceJumpIsRecordedNotHidden: true,
      missedHistoricalPredictionsAreNeverReconstructed: true,
      currentLatestMayBeLockedForTheNextUnknownDraw: true,
    },
  };
  await db.prepare(`
    UPDATE sequential_barrier_cycles SET
      finished_at=?, status=?,
      utama_db_after=?, utama_lock_after=?, utama_observer_after=?,
      europe_db_after=?, europe_lock_after=?, europe_observer_after=?,
      transition_pass_count=?, transition_fail_count=?, watchdog_ok=?, details_json=?, error_text=?
    WHERE id=?
  `).bind(
    finishedAt,
    status,
    after.utama.resultPeriod,
    after.utama.keeperAnchor,
    after.utama.observerAnchor,
    after.europe.resultPeriod,
    after.europe.forwardAnchor,
    after.europe.observerAnchor,
    transitionPassCount,
    transitionFailCount,
    watchdog?.ok ? 1 : 0,
    JSON.stringify(details),
    errorText,
    cycleId,
  ).run();

  if (trigger === "scheduled") {
    await writeMeta(db, "sequential_barrier_last_scheduled_at", finishedAt);
    await writeMeta(db, "sequential_barrier_last_status", status);
  }

  return {
    ok: status !== "ERROR" && status !== "DEGRADED",
    version: SEQUENTIAL_LOCK_BARRIER_VERSION,
    mode: SEQUENTIAL_LOCK_BARRIER_MODE,
    trigger,
    status,
    startedAt,
    finishedAt,
    armed,
    live,
    before,
    preflight: { utama: preUtama, europe: preEurope },
    watchdog,
    after,
    postflight: { utama: postUtama, europe: postEurope },
    gapCount,
    transitionPassCount,
    transitionFailCount,
    error: errorText,
  };
}

function summarizeLane(source, state) {
  return { ...state, chain: chainHealth(source, state) };
}

export async function getSequentialLockBarrierStatus(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Sequential Lock Barrier.");
  const db = env.DB;
  await ensureBarrierSchema(db);
  const startedAt = await metaValue(db, "sequential_barrier_started_at");
  const state = await inspectState(db);
  const [cycles, gaps] = await Promise.all([
    safeAll(db.prepare(`
      SELECT id, started_at, finished_at, trigger, status,
             utama_db_before, utama_source_seen, utama_db_after, utama_lock_after, utama_observer_after, utama_delta,
             europe_db_before, europe_source_seen, europe_db_after, europe_lock_after, europe_observer_after, europe_delta,
             gap_count, transition_pass_count, transition_fail_count, watchdog_ok, error_text
      FROM sequential_barrier_cycles
      WHERE (? IS NULL OR started_at>=?)
      ORDER BY id DESC LIMIT 120
    `).bind(startedAt, startedAt)),
    safeAll(db.prepare(`
      SELECT source, anchor_period, detected_at, reason, db_before_period, source_seen_period
      FROM sequential_barrier_gaps
      WHERE (? IS NULL OR detected_at>=?)
      ORDER BY detected_at DESC, source ASC, anchor_period DESC LIMIT 200
    `).bind(startedAt, startedAt)),
  ]);
  const scheduled = cycles.filter((row) => row.trigger === "scheduled");
  const transitions = scheduled.reduce((sum, row) => sum + Number(row.transition_pass_count || 0) + Number(row.transition_fail_count || 0), 0);
  const transitionPasses = scheduled.reduce((sum, row) => sum + Number(row.transition_pass_count || 0), 0);
  let cleanCycleStreak = 0;
  for (const row of scheduled) {
    if (row.status !== "HEALTHY") break;
    cleanCycleStreak += 1;
  }
  const current = {
    utama: summarizeLane("utama", state.utama),
    europe: summarizeLane("europe", state.europe),
  };
  let status = startedAt ? "HEALTHY" : "ARMING";
  if (!current.utama.chain.ok || !current.europe.chain.ok) status = "DEGRADED";
  if (scheduled[0]?.status === "ERROR" || scheduled[0]?.status === "DEGRADED") status = "DEGRADED";
  return {
    ok: true,
    version: SEQUENTIAL_LOCK_BARRIER_VERSION,
    mode: SEQUENTIAL_LOCK_BARRIER_MODE,
    status,
    startedAt,
    current,
    scheduledCycles: scheduled.length,
    cleanCycleStreak,
    drawTransitionsObserved: transitions,
    drawTransitionPasses: transitionPasses,
    drawTransitionPassRatePct: transitions ? round(transitionPasses / transitions * 100, 2) : null,
    gapCountSinceStart: gaps.length,
    gaps,
    recentCycles: cycles.slice(0, 40),
    policy: {
      cronPrimary: true,
      exactSequentialTransitionExpected: true,
      noHistoricalPredictionReconstruction: true,
      sourceJumpRecordedAsEvidenceGap: true,
      latestAlignedChainRequired: true,
    },
    now: new Date().toISOString(),
  };
}
