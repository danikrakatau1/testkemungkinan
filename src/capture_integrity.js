import { ensureAiV2ObserverSchema } from "./ai_v2_observer.js";

export const CAPTURE_INTEGRITY_VERSION = "1.0.0";
export const RELIABLE_COLLECTION_META_KEY = "reliable_collection_started_at";

const CADENCE_MINUTES = {
  utama: 60,
  europe: 45,
};

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

async function firstRow(statement) {
  const result = await statement.all();
  return result.results?.[0] || null;
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM ai_v2_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value || null;
}

async function writeMeta(db, key, value, { replace = true } = {}) {
  const now = new Date().toISOString();
  const sql = replace
    ? "INSERT OR REPLACE INTO ai_v2_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)"
    : "INSERT OR IGNORE INTO ai_v2_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)";
  await db.prepare(sql).bind(key, String(value), now).run();
}

export async function ensureReliableCollectionStart(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Capture Integrity.");
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);
  const existing = await metaValue(db, RELIABLE_COLLECTION_META_KEY);
  if (existing) return { startedAt: existing, created: false };

  const startedAt = options.startedAt || new Date().toISOString();
  await writeMeta(db, RELIABLE_COLLECTION_META_KEY, startedAt, { replace: false });
  await writeMeta(db, "capture_integrity_version", CAPTURE_INTEGRITY_VERSION);
  await writeMeta(db, "pre_integrity_window_status", "INCOMPLETE_CAPTURE_WINDOW");
  await writeMeta(db, "pre_integrity_window_note", "Phase-0 wall-clock time before Ordered Capture Integrity is retained as legacy forward data but is not treated as continuous 24H coverage.");
  const resolved = await metaValue(db, RELIABLE_COLLECTION_META_KEY);
  return { startedAt: resolved || startedAt, created: true };
}

export async function recordOrderedCycleMeta(env, cycle) {
  if (!env?.DB) return;
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);
  const now = new Date().toISOString();
  await writeMeta(db, "capture_integrity_last_cycle_at", now);
  await writeMeta(db, "capture_integrity_last_cycle_status", cycle?.ok === false ? "ERROR" : "OK");
  await writeMeta(db, "capture_integrity_last_cycle_json", JSON.stringify(cycle || {}));
}

function periodGaps(locks) {
  if (!locks.length) return [];
  const periods = [...new Set(locks.map((row) => Number(row.anchor_period)).filter(Number.isFinite))].sort((a, b) => a - b);
  const missing = [];
  for (let i = 1; i < periods.length; i += 1) {
    const prev = periods[i - 1];
    const current = periods[i];
    for (let period = prev + 1; period < current && missing.length < 100; period += 1) missing.push(period);
  }
  return missing;
}

function latencyStats(locks, observations) {
  const obsByPeriod = new Map(observations.map((row) => [Number(row.anchor_period), row]));
  const values = [];
  for (const lock of locks) {
    const obs = obsByPeriod.get(Number(lock.anchor_period));
    if (!obs) continue;
    const lockMs = Date.parse(lock.created_at || "");
    const obsMs = Date.parse(obs.observed_at || "");
    if (Number.isFinite(lockMs) && Number.isFinite(obsMs) && obsMs >= lockMs) values.push((obsMs - lockMs) / 1000);
  }
  if (!values.length) return { n: 0, avgSeconds: null, maxSeconds: null };
  return {
    n: values.length,
    avgSeconds: round(values.reduce((a, b) => a + b, 0) / values.length, 1),
    maxSeconds: round(Math.max(...values), 1),
  };
}

async function sourceLocks(db, source, startedAt) {
  const table = source === "utama" ? "keeper7_forward_runs" : "europe_forward_runs";
  try {
    const result = await db.prepare(`
      SELECT anchor_period, created_at, status
      FROM ${table}
      WHERE created_at >= ?
      ORDER BY anchor_period ASC
    `).bind(startedAt).all();
    return result.results || [];
  } catch {
    return [];
  }
}

async function sourceObservations(db, source, startedAt) {
  const result = await db.prepare(`
    SELECT id, source, anchor_period, observed_at, source_lock_created_at,
           source_status_at_capture, status, settled_at, actual_period, actual_result
    FROM ai_v2_observations
    WHERE source=? AND source_lock_created_at >= ?
    ORDER BY anchor_period ASC, id ASC
  `).bind(source, startedAt).all();
  return result.results || [];
}

async function legacyCounts(db, startedAt) {
  const query = await db.prepare(`
    SELECT source,
           COUNT(*) AS total,
           SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled,
           SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM ai_v2_observations
    WHERE source_lock_created_at < ?
    GROUP BY source
  `).bind(startedAt).all();
  const out = {
    utama: { total: 0, settled: 0, pending: 0 },
    europe: { total: 0, settled: 0, pending: 0 },
  };
  for (const row of query.results || []) {
    if (!out[row.source]) continue;
    out[row.source] = {
      total: Number(row.total || 0),
      settled: Number(row.settled || 0),
      pending: Number(row.pending || 0),
    };
  }
  return out;
}

function sourceIntegrity(source, startedAt, nowMs, locks, observations) {
  const cadenceMinutes = CADENCE_MINUTES[source];
  const elapsedMinutes = Math.max(0, (nowMs - Date.parse(startedAt)) / 60_000);
  const lockPeriods = [...new Set(locks.map((row) => Number(row.anchor_period)).filter(Number.isFinite))];
  const observationPeriods = new Set(observations
    .filter((row) => String(row.source_status_at_capture || "") === "pending")
    .map((row) => Number(row.anchor_period))
    .filter(Number.isFinite));

  const missingObservationAnchors = lockPeriods.filter((period) => !observationPeriods.has(period));
  const gaps = periodGaps(locks);
  const invalidCaptures = observations.filter((row) => String(row.source_status_at_capture || "") !== "pending");
  const capturedLocks = lockPeriods.filter((period) => observationPeriods.has(period)).length;
  const eligibleLocks = lockPeriods.length;
  const captureRatePct = eligibleLocks ? round(capturedLocks / eligibleLocks * 100, 2) : null;
  const settled = observations.filter((row) => row.status === "settled").length;
  const pending = observations.filter((row) => row.status === "pending").length;

  // The schedule expectation is deliberately conservative by one interval so a
  // deployment that starts between draw boundaries is not falsely flagged.
  const cadenceOpportunitiesEstimate = Math.floor(elapsedMinutes / cadenceMinutes);
  const minimumExpectedLocks = Math.max(0, cadenceOpportunitiesEstimate - 1);
  const cadenceShortfallEstimate = Math.max(0, minimumExpectedLocks - eligibleLocks);

  let status = "PASS";
  if (elapsedMinutes < cadenceMinutes && eligibleLocks === 0) status = "ARMING";
  if (missingObservationAnchors.length || gaps.length || invalidCaptures.length || cadenceShortfallEstimate > 0) status = "GAP_DETECTED";

  return {
    source,
    cadenceMinutes,
    elapsedHours: round(elapsedMinutes / 60, 3),
    status,
    eligibleLocks,
    capturedLocks,
    captureRatePct,
    settled,
    pending,
    missingObservationAnchors: missingObservationAnchors.slice(0, 50),
    missingLockPeriods: gaps.slice(0, 50),
    invalidCaptureCount: invalidCaptures.length,
    cadenceOpportunitiesEstimate,
    minimumExpectedLocks,
    cadenceShortfallEstimate,
    latency: latencyStats(locks, observations),
    firstAnchorPeriod: lockPeriods[0] ?? null,
    lastAnchorPeriod: lockPeriods[lockPeriods.length - 1] ?? null,
  };
}

export async function getCaptureIntegrityStatus(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Capture Integrity.");
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);
  const startedAt = await metaValue(db, RELIABLE_COLLECTION_META_KEY);
  const oldStartedAt = await metaValue(db, "phase0_started_at");
  const lastCycleAt = await metaValue(db, "capture_integrity_last_cycle_at");
  const lastCycleStatus = await metaValue(db, "capture_integrity_last_cycle_status");

  if (!startedAt) {
    return {
      ok: true,
      version: CAPTURE_INTEGRITY_VERSION,
      mode: "ORDERED_CAPTURE_INTEGRITY",
      status: "NOT_STARTED",
      reliableCollectionStartedAt: null,
      legacyPhaseStartedAt: oldStartedAt,
      note: "Reliable timer starts on the first V1.0.0 ordered source→lock→observer cycle, not on a status GET.",
      policy: {
        noHistoricalBackfillAsForward: true,
        lockedBeforeResultOnly: true,
        reliableTimerRequiresOrderedCycle: true,
      },
    };
  }

  const nowMs = Date.now();
  const [utamaLocks, europeLocks, utamaObs, europeObs, legacy] = await Promise.all([
    sourceLocks(db, "utama", startedAt),
    sourceLocks(db, "europe", startedAt),
    sourceObservations(db, "utama", startedAt),
    sourceObservations(db, "europe", startedAt),
    legacyCounts(db, startedAt),
  ]);

  const utama = sourceIntegrity("utama", startedAt, nowMs, utamaLocks, utamaObs);
  const europe = sourceIntegrity("europe", startedAt, nowMs, europeLocks, europeObs);
  let status = "PASS";
  if ([utama.status, europe.status].includes("GAP_DETECTED")) status = "GAP_DETECTED";
  else if ([utama.status, europe.status].includes("ARMING")) status = "ARMING";

  const dueAtMs = Date.parse(startedAt) + 24 * 60 * 60 * 1000;
  return {
    ok: true,
    version: CAPTURE_INTEGRITY_VERSION,
    mode: "ORDERED_CAPTURE_INTEGRITY",
    status,
    reliableCollectionStartedAt: startedAt,
    legacyPhaseStartedAt: oldStartedAt,
    reliableElapsedHours: round((nowMs - Date.parse(startedAt)) / 3_600_000, 3),
    reliable24h: {
      dueAt: new Date(dueAtMs).toISOString(),
      remainingMs: Math.max(0, dueAtMs - nowMs),
      due: nowMs >= dueAtMs,
    },
    bySource: { utama, europe },
    legacyWindow: {
      status: "INCOMPLETE_CAPTURE_WINDOW",
      observationsBeforeReliableStart: legacy,
      retainedForForwardHistory: true,
      countsTowardReliable24hCoverage: false,
    },
    lastOrderedCycle: {
      at: lastCycleAt,
      status: lastCycleStatus || null,
    },
    policy: {
      noHistoricalBackfillAsForward: true,
      lockedBeforeResultOnly: true,
      sourceLocksAreCaptureDenominator: true,
      missingAnchorDetector: true,
      conservativeCadenceShortfallDetector: true,
      databaseWrites: "metadata only; no prediction/model/history rewrite",
    },
    now: new Date(nowMs).toISOString(),
  };
}
