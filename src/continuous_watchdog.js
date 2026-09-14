import { runOrderedCaptureCycle } from "./ordered_capture.js";
import { getCaptureIntegrityStatus } from "./capture_integrity.js";

export const CONTINUOUS_WATCHDOG_VERSION = "1.0.2";
export const WATCHDOG_CRON_MINUTES = 1;
export const WATCHDOG_HEARTBEAT_STALE_SECONDS = 180;
export const WATCHDOG_RETENTION_DAYS = 7;

const CADENCE_MINUTES = { utama: 60, europe: 45 };

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

async function firstRow(statement) {
  const result = await statement.all();
  return result.results?.[0] || null;
}

async function safeAll(statement) {
  try {
    const result = await statement.all();
    return result.results || [];
  } catch {
    return [];
  }
}

function jakartaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export async function ensureContinuousWatchdogSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS watchdog_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS watchdog_cycles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      ordered_ok INTEGER NOT NULL DEFAULT 0,
      ordered_elapsed_ms INTEGER,
      heartbeat_gap_seconds REAL,
      utama_result_period INTEGER,
      utama_lock_anchor INTEGER,
      utama_observer_anchor INTEGER,
      europe_result_period INTEGER,
      europe_lock_anchor INTEGER,
      europe_observer_anchor INTEGER,
      details_json TEXT,
      error_text TEXT
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_watchdog_cycles_trigger_time ON watchdog_cycles(trigger, started_at DESC)").run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS watchdog_daily (
      date_key TEXT PRIMARY KEY,
      scheduled_count INTEGER NOT NULL DEFAULT 0,
      healthy_count INTEGER NOT NULL DEFAULT 0,
      degraded_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      max_gap_seconds REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM watchdog_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value || null;
}

async function writeMeta(db, key, value, replace = true) {
  const now = new Date().toISOString();
  const sql = replace
    ? "INSERT OR REPLACE INTO watchdog_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)"
    : "INSERT OR IGNORE INTO watchdog_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)";
  await db.prepare(sql).bind(key, String(value), now).run();
}

async function ensureWatchdogStart(db, trigger, startedAt) {
  const existing = await metaValue(db, "watchdog_started_at");
  if (existing) return existing;
  if (trigger !== "scheduled") return null;
  await writeMeta(db, "watchdog_started_at", startedAt, false);
  await writeMeta(db, "watchdog_version", CONTINUOUS_WATCHDOG_VERSION);
  return (await metaValue(db, "watchdog_started_at")) || startedAt;
}

async function currentState(db) {
  const [utamaResult, utamaLock, utamaObserver, europeResult, europeLock, europeObserver] = await Promise.all([
    firstRow(db.prepare("SELECT period FROM results_3d ORDER BY period DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period FROM keeper7_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period FROM ai_v2_observations WHERE source='utama' ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT period FROM europe_results_3d ORDER BY period DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period FROM europe_forward_runs ORDER BY anchor_period DESC, id DESC LIMIT 1")),
    firstRow(db.prepare("SELECT anchor_period FROM ai_v2_observations WHERE source='europe' ORDER BY anchor_period DESC, id DESC LIMIT 1")),
  ]);
  return {
    utama: {
      resultPeriod: utamaResult?.period == null ? null : Number(utamaResult.period),
      lockAnchor: utamaLock?.anchor_period == null ? null : Number(utamaLock.anchor_period),
      observerAnchor: utamaObserver?.anchor_period == null ? null : Number(utamaObserver.anchor_period),
    },
    europe: {
      resultPeriod: europeResult?.period == null ? null : Number(europeResult.period),
      lockAnchor: europeLock?.anchor_period == null ? null : Number(europeLock.anchor_period),
      observerAnchor: europeObserver?.anchor_period == null ? null : Number(europeObserver.anchor_period),
    },
  };
}

function periodGaps(values) {
  const periods = [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < periods.length; i += 1) {
    for (let p = periods[i - 1] + 1; p < periods[i] && out.length < 100; p += 1) out.push(p);
  }
  return out;
}

async function windowSourceHealth(db, source, startedAt, nowMs) {
  if (!startedAt) {
    return {
      source,
      status: "NOT_STARTED",
      cadenceMinutes: CADENCE_MINUTES[source],
      eligibleLocks: 0,
      capturedLocks: 0,
      captureRatePct: null,
      missingObserverAnchors: [],
      missingLockPeriods: [],
      cadenceShortfallEstimate: 0,
    };
  }
  const table = source === "utama" ? "keeper7_forward_runs" : "europe_forward_runs";
  const locks = await safeAll(db.prepare(`SELECT anchor_period, created_at, status FROM ${table} WHERE created_at >= ? ORDER BY anchor_period ASC`).bind(startedAt));
  const observations = await safeAll(db.prepare(`
    SELECT anchor_period, source_status_at_capture, observed_at, status
    FROM ai_v2_observations
    WHERE source=? AND source_lock_created_at >= ?
    ORDER BY anchor_period ASC, id ASC
  `).bind(source, startedAt));
  const lockPeriods = [...new Set(locks.map((row) => Number(row.anchor_period)).filter(Number.isFinite))];
  const obsPeriods = new Set(observations
    .filter((row) => String(row.source_status_at_capture || "") === "pending")
    .map((row) => Number(row.anchor_period))
    .filter(Number.isFinite));
  const missingObserverAnchors = lockPeriods.filter((period) => !obsPeriods.has(period));
  const missingLockPeriods = periodGaps(lockPeriods);
  const elapsedMinutes = Math.max(0, (nowMs - Date.parse(startedAt)) / 60_000);
  const opportunities = Math.floor(elapsedMinutes / CADENCE_MINUTES[source]);
  const minimumExpectedLocks = Math.max(0, opportunities - 1);
  const cadenceShortfallEstimate = Math.max(0, minimumExpectedLocks - lockPeriods.length);
  const capturedLocks = lockPeriods.filter((period) => obsPeriods.has(period)).length;
  const captureRatePct = lockPeriods.length ? round(capturedLocks / lockPeriods.length * 100, 2) : null;
  let status = "HEALTHY";
  if (elapsedMinutes < CADENCE_MINUTES[source] && lockPeriods.length === 0) status = "ARMING";
  if (missingObserverAnchors.length || missingLockPeriods.length || cadenceShortfallEstimate > 0) status = "DEGRADED";
  return {
    source,
    status,
    cadenceMinutes: CADENCE_MINUTES[source],
    elapsedHours: round(elapsedMinutes / 60, 3),
    eligibleLocks: lockPeriods.length,
    capturedLocks,
    captureRatePct,
    settled: observations.filter((row) => row.status === "settled").length,
    pending: observations.filter((row) => row.status === "pending").length,
    missingObserverAnchors: missingObserverAnchors.slice(0, 50),
    missingLockPeriods: missingLockPeriods.slice(0, 50),
    cadenceOpportunitiesEstimate: opportunities,
    minimumExpectedLocks,
    cadenceShortfallEstimate,
    firstAnchorPeriod: lockPeriods[0] ?? null,
    lastAnchorPeriod: lockPeriods.at(-1) ?? null,
  };
}

function chainStatus(state) {
  if (!state || state.resultPeriod == null) return { healthy: false, reason: "NO_RESULT" };
  if (state.lockAnchor !== state.resultPeriod) return { healthy: false, reason: "LATEST_RESULT_HAS_NO_CURRENT_LOCK" };
  if (state.observerAnchor !== state.resultPeriod) return { healthy: false, reason: "CURRENT_LOCK_NOT_OBSERVED" };
  return { healthy: true, reason: "RESULT_LOCK_OBSERVER_ALIGNED" };
}

async function rollupDaily(db, status, heartbeatGapSeconds) {
  const dateKey = jakartaDateKey();
  const healthy = status === "HEALTHY" ? 1 : 0;
  const degraded = status === "DEGRADED" ? 1 : 0;
  const error = status === "ERROR" ? 1 : 0;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO watchdog_daily(date_key, scheduled_count, healthy_count, degraded_count, error_count, max_gap_seconds, updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(date_key) DO UPDATE SET
      scheduled_count=watchdog_daily.scheduled_count+1,
      healthy_count=watchdog_daily.healthy_count+excluded.healthy_count,
      degraded_count=watchdog_daily.degraded_count+excluded.degraded_count,
      error_count=watchdog_daily.error_count+excluded.error_count,
      max_gap_seconds=MAX(watchdog_daily.max_gap_seconds, excluded.max_gap_seconds),
      updated_at=excluded.updated_at
  `).bind(dateKey, 1, healthy, degraded, error, Number(heartbeatGapSeconds || 0), now).run();
}

async function maybePrune(db, now = new Date()) {
  if (now.getUTCMinutes() !== 0) return;
  const cutoff = new Date(now.getTime() - WATCHDOG_RETENTION_DAYS * 86400_000).toISOString();
  try { await db.prepare("DELETE FROM watchdog_cycles WHERE started_at < ?").bind(cutoff).run(); } catch {}
}

async function previousScheduled(db) {
  return firstRow(db.prepare("SELECT started_at FROM watchdog_cycles WHERE trigger='scheduled' ORDER BY id DESC LIMIT 1"));
}

export async function runContinuousWatchdogCycle(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Continuous Draw Watchdog.");
  const db = env.DB;
  await ensureContinuousWatchdogSchema(db);
  const trigger = String(options.trigger || "scheduled");
  const startedAt = new Date().toISOString();
  const previous = trigger === "scheduled" ? await previousScheduled(db) : null;
  const heartbeatGapSeconds = previous?.started_at ? Math.max(0, (Date.parse(startedAt) - Date.parse(previous.started_at)) / 1000) : null;
  const watchdogStartedAt = await ensureWatchdogStart(db, trigger, startedAt);
  const insert = await db.prepare(`
    INSERT INTO watchdog_cycles(started_at, trigger, status, ordered_ok, heartbeat_gap_seconds)
    VALUES(?,?, 'RUNNING', 0, ?)
  `).bind(startedAt, trigger, heartbeatGapSeconds).run();
  const cycleId = Number(insert.meta?.last_row_id || 0);
  const began = Date.now();
  let ordered = null;
  let errorText = null;
  try {
    ordered = await runOrderedCaptureCycle(env, { collect: true });
  } catch (error) {
    errorText = error?.message || String(error);
  }
  const elapsedMs = Date.now() - began;
  const state = await currentState(db);
  const utamaChain = chainStatus(state.utama);
  const europeChain = chainStatus(state.europe);
  const orderedOk = Boolean(ordered?.ok) && !errorText;
  let status = "HEALTHY";
  if (!orderedOk) status = "ERROR";
  else if (!utamaChain.healthy || !europeChain.healthy) status = "DEGRADED";
  const finishedAt = new Date().toISOString();
  const details = {
    version: CONTINUOUS_WATCHDOG_VERSION,
    watchdogStartedAt,
    chain: { utama: utamaChain, europe: europeChain },
    orderedVersion: ordered?.version || null,
    observerOk: ordered?.observer?.ok ?? null,
  };
  await db.prepare(`
    UPDATE watchdog_cycles SET finished_at=?, status=?, ordered_ok=?, ordered_elapsed_ms=?,
      utama_result_period=?, utama_lock_anchor=?, utama_observer_anchor=?,
      europe_result_period=?, europe_lock_anchor=?, europe_observer_anchor=?,
      details_json=?, error_text=? WHERE id=?
  `).bind(
    finishedAt,
    status,
    orderedOk ? 1 : 0,
    elapsedMs,
    state.utama.resultPeriod,
    state.utama.lockAnchor,
    state.utama.observerAnchor,
    state.europe.resultPeriod,
    state.europe.lockAnchor,
    state.europe.observerAnchor,
    JSON.stringify(details),
    errorText,
    cycleId,
  ).run();
  if (trigger === "scheduled") {
    await rollupDaily(db, status, heartbeatGapSeconds);
    await maybePrune(db);
    await writeMeta(db, "watchdog_last_scheduled_at", finishedAt);
    await writeMeta(db, "watchdog_last_scheduled_status", status);
  }
  return {
    ok: orderedOk,
    version: CONTINUOUS_WATCHDOG_VERSION,
    trigger,
    status,
    heartbeatGapSeconds: round(heartbeatGapSeconds, 1),
    watchdogStartedAt,
    current: state,
    chain: { utama: utamaChain, europe: europeChain },
    ordered,
    error: errorText,
    now: finishedAt,
  };
}

async function cronHealth(db, startedAt) {
  const nowMs = Date.now();
  const rows = await safeAll(db.prepare(`
    SELECT id, started_at, finished_at, status, ordered_ok, heartbeat_gap_seconds,
           utama_result_period, utama_lock_anchor, utama_observer_anchor,
           europe_result_period, europe_lock_anchor, europe_observer_anchor, error_text
    FROM watchdog_cycles
    WHERE trigger='scheduled' AND (? IS NULL OR started_at >= ?)
    ORDER BY id DESC LIMIT 120
  `).bind(startedAt, startedAt));
  const last = rows[0] || null;
  const lastMs = last?.started_at ? Date.parse(last.started_at) : null;
  const secondsSinceLast = lastMs == null ? null : Math.max(0, (nowMs - lastMs) / 1000);
  const recent60 = rows.filter((row) => nowMs - Date.parse(row.started_at) <= 60 * 60_000);
  const maxGap = recent60.reduce((max, row) => Math.max(max, Number(row.heartbeat_gap_seconds || 0)), 0);
  let status = "ARMING";
  if (rows.length >= 3) status = "HEALTHY";
  if (secondsSinceLast != null && secondsSinceLast > WATCHDOG_HEARTBEAT_STALE_SECONDS) status = "DEGRADED";
  if (maxGap > WATCHDOG_HEARTBEAT_STALE_SECONDS) status = "DEGRADED";
  if (recent60.some((row) => row.status === "ERROR")) status = "DEGRADED";
  return {
    status,
    expectedEveryMinutes: WATCHDOG_CRON_MINUTES,
    lastScheduledAt: last?.started_at || null,
    lastScheduledStatus: last?.status || null,
    secondsSinceLast: round(secondsSinceLast, 1),
    scheduledCyclesObserved: rows.length,
    scheduledCyclesLast60m: recent60.length,
    maxHeartbeatGapSecondsLast60m: round(maxGap, 1),
    staleAfterSeconds: WATCHDOG_HEARTBEAT_STALE_SECONDS,
    recent: rows.slice(0, 30),
  };
}

export async function getContinuousWatchdogStatus(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Continuous Draw Watchdog.");
  const db = env.DB;
  await ensureContinuousWatchdogSchema(db);
  const startedAt = await metaValue(db, "watchdog_started_at");
  const nowMs = Date.now();
  const [cron, state, utama, europe, legacyIntegrity, daily] = await Promise.all([
    cronHealth(db, startedAt),
    currentState(db),
    windowSourceHealth(db, "utama", startedAt, nowMs),
    windowSourceHealth(db, "europe", startedAt, nowMs),
    getCaptureIntegrityStatus(env).catch(() => null),
    safeAll(db.prepare("SELECT * FROM watchdog_daily ORDER BY date_key DESC LIMIT 30")),
  ]);
  const currentChain = { utama: chainStatus(state.utama), europe: chainStatus(state.europe) };
  let status = startedAt ? "HEALTHY" : "NOT_STARTED";
  if (startedAt && (cron.status === "ARMING" || utama.status === "ARMING" || europe.status === "ARMING")) status = "ARMING";
  if (startedAt && (cron.status === "DEGRADED" || utama.status === "DEGRADED" || europe.status === "DEGRADED" || !currentChain.utama.healthy || !currentChain.europe.healthy)) status = "DEGRADED";
  return {
    ok: true,
    version: CONTINUOUS_WATCHDOG_VERSION,
    mode: "CONTINUOUS_DRAW_WATCHDOG",
    status,
    watchdogStartedAt: startedAt,
    elapsedHours: startedAt ? round((nowMs - Date.parse(startedAt)) / 3_600_000, 3) : null,
    cron,
    current: state,
    currentChain,
    bySource: { utama, europe },
    legacyCaptureIntegrity: legacyIntegrity ? {
      status: legacyIntegrity.status,
      reliableCollectionStartedAt: legacyIntegrity.reliableCollectionStartedAt,
      note: "Legacy Capture Integrity tetap menyimpan gap sebelum V1.0.2; Watchdog V1.0.2 memiliki clean monitoring window sendiri.",
    } : null,
    daily,
    policy: {
      browserNotRequired: true,
      cronIsPrimaryAuthority: true,
      browserSyncIsFallbackOnly: true,
      noHistoricalLockReconstruction: true,
      noModelWeightChanges: true,
      noObserverBackfill: true,
      everyScheduledInvocationIsPersisted: true,
      longTermDailyRollup: true,
      rawHeartbeatRetentionDays: WATCHDOG_RETENTION_DAYS,
    },
    now: new Date().toISOString(),
  };
}
