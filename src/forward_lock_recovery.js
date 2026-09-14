export const FORWARD_LOCK_RECOVERY_VERSION = "1.0.1";

const JAKARTA_OFFSET_HOURS = 7;
const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;

function clampHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_HOURS;
  return Math.max(1, Math.min(MAX_HOURS, Math.trunc(n)));
}

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

async function firstRow(statement) {
  const result = await statement.all();
  return result.results?.[0] || null;
}

async function metaValue(db, key) {
  try {
    const row = await firstRow(db.prepare("SELECT meta_value FROM ai_v2_meta WHERE meta_key=? LIMIT 1").bind(key));
    return row?.meta_value || null;
  } catch {
    return null;
  }
}

function parseIso(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function jakartaEpoch(year, month, day, hour, minute, second = 0) {
  return Date.UTC(year, month - 1, day, hour - JAKARTA_OFFSET_HOURS, minute, second, 0);
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseUtamaDrawTime(row) {
  const dateText = String(row?.draw_date || "").trim();
  const timeText = String(row?.draw_time || "").trim();
  const dm = dateText.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/i);
  const tm = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (dm && tm) {
    const month = MONTHS[String(dm[1]).toLowerCase()];
    let hour = Number(tm[1]);
    const minute = Number(tm[2]);
    const ampm = String(tm[3]).toUpperCase();
    if (ampm === "AM") hour = hour === 12 ? 0 : hour;
    if (ampm === "PM") hour = hour === 12 ? 12 : hour + 12;
    if (month && Number.isInteger(hour) && Number.isInteger(minute)) {
      return { ms: jakartaEpoch(Number(dm[3]), month, Number(dm[2]), hour, minute), basis: "source-draw-time" };
    }
  }
  const fallback = parseIso(row?.collected_at);
  return { ms: fallback, basis: fallback == null ? "unknown" : "collector-first-seen" };
}

function parseEuropeDrawTime(row) {
  const text = String(row?.draw_datetime || "").trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = parseIso(text);
    if (parsed != null) return { ms: parsed, basis: "source-draw-time-offset" };
  }
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return {
      ms: jakartaEpoch(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)),
      basis: "source-draw-time-jakarta",
    };
  }
  return { ms: null, basis: "unknown" };
}

function byActualPeriod(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = Number(row.actual_period);
    if (!Number.isFinite(key)) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function observerMap(rows, source) {
  const map = new Map();
  for (const row of rows || []) {
    if (row.source !== source) continue;
    const actual = Number(row.actual_period);
    const target = Number(row.target_period);
    const key = Number.isFinite(actual) && actual > 0 ? actual : (Number.isFinite(target) && target > 0 ? target : null);
    if (key == null) continue;
    const current = map.get(key);
    if (!current || Number(row.id) > Number(current.id)) map.set(key, row);
  }
  return map;
}

function lockProof(lock, actualMs) {
  if (!lock) return { verified: false, reason: "NO_ORIGINAL_LOCK", createdBeforeDraw: null };
  const createdMs = parseIso(lock.created_at);
  const createdBeforeDraw = createdMs != null && actualMs != null ? createdMs < actualMs : null;
  // A settled row whose actual_period was written by the forward settlement path
  // is itself original-lock evidence: these pipelines do not generate past locks.
  return {
    verified: lock.status === "settled" && Number.isFinite(Number(lock.actual_period)),
    reason: lock.status === "settled" ? "SETTLED_ORIGINAL_FORWARD_ROW" : "LOCK_NOT_SETTLED",
    createdBeforeDraw,
    createdAt: lock.created_at || null,
    anchorPeriod: lock.anchor_period == null ? null : Number(lock.anchor_period),
  };
}

async function safeAll(db, sql) {
  try {
    const q = await db.prepare(sql).all();
    return q.results || [];
  } catch {
    return [];
  }
}

async function readData(db) {
  const [utamaResults, europeResults, keeper, arena, twoStage, europeForward, observations] = await Promise.all([
    safeAll(db, `SELECT period, result, draw_date, draw_time, collected_at FROM results_3d ORDER BY period DESC LIMIT 240`),
    safeAll(db, `SELECT period, result, draw_datetime, collected_at FROM europe_results_3d ORDER BY period DESC LIMIT 320`),
    safeAll(db, `SELECT id, created_at, status, anchor_period, actual_period, actual_result FROM keeper7_forward_runs ORDER BY id DESC LIMIT 240`),
    safeAll(db, `SELECT id, created_at, status, anchor_period, actual_period, actual_result FROM arena_forward_runs ORDER BY id DESC LIMIT 240`),
    safeAll(db, `SELECT id, created_at, status, anchor_period, actual_period, actual_result FROM two_stage_forward_runs ORDER BY id DESC LIMIT 240`),
    safeAll(db, `SELECT id, created_at, status, anchor_period, target_period, actual_period, actual_result, actual_datetime FROM europe_forward_runs ORDER BY id DESC LIMIT 320`),
    safeAll(db, `SELECT id, source, observed_at, source_lock_created_at, anchor_period, target_period, status, actual_period, actual_result FROM ai_v2_observations ORDER BY id DESC LIMIT 600`),
  ]);
  return { utamaResults, europeResults, keeper, arena, twoStage, europeForward, observations };
}

function auditUtama(data, startMs, endMs) {
  const keeperMap = byActualPeriod(data.keeper);
  const arenaMap = byActualPeriod(data.arena);
  const twoMap = byActualPeriod(data.twoStage);
  const obsMap = observerMap(data.observations, "utama");
  const rows = [];

  for (const result of data.utamaResults) {
    const time = parseUtamaDrawTime(result);
    if (time.ms == null || time.ms < startMs || time.ms >= endMs) continue;
    const period = Number(result.period);
    const keeper = keeperMap.get(period) || null;
    const arena = arenaMap.get(period) || null;
    const twoStage = twoMap.get(period) || null;
    const observation = obsMap.get(period) || null;
    const keeperProof = lockProof(keeper, time.ms);
    const arenaProof = lockProof(arena, time.ms);
    const twoProof = lockProof(twoStage, time.ms);
    const learnerVerified = keeperProof.verified;
    const modelLockVerified = arenaProof.verified || twoProof.verified;
    let classification = "TRULY_MISSING_LEARNER_LOCK";
    if (learnerVerified && observation) classification = "OBSERVER_CAPTURED";
    else if (learnerVerified) classification = "VERIFIED_LOCK_NOT_OBSERVED";
    else if (modelLockVerified) classification = "PARTIAL_MODEL_LOCK_ONLY";

    rows.push({
      period,
      result: String(result.result || "").padStart(3, "0"),
      drawAt: new Date(time.ms).toISOString(),
      timestampBasis: time.basis,
      classification,
      learnerLock: keeper ? { id: Number(keeper.id), ...keeperProof } : null,
      arenaLock: arena ? { id: Number(arena.id), ...arenaProof } : null,
      twoStageLock: twoStage ? { id: Number(twoStage.id), ...twoProof } : null,
      observer: observation ? { id: Number(observation.id), status: observation.status, observedAt: observation.observed_at } : null,
    });
  }

  rows.sort((a, b) => a.period - b.period);
  const raw = rows.length;
  const learnerLocks = rows.filter((r) => r.learnerLock?.verified).length;
  const observed = rows.filter((r) => r.classification === "OBSERVER_CAPTURED").length;
  const recoverable = rows.filter((r) => r.classification === "VERIFIED_LOCK_NOT_OBSERVED").length;
  const missing = rows.filter((r) => r.classification === "TRULY_MISSING_LEARNER_LOCK").length;
  const partial = rows.filter((r) => r.classification === "PARTIAL_MODEL_LOCK_ONLY").length;
  return {
    source: "utama",
    rawResults: raw,
    verifiedLearnerLocks: learnerLocks,
    observerCaptured: observed,
    verifiedLockNotObserved: recoverable,
    trulyMissingLearnerLocks: missing,
    partialModelLockOnly: partial,
    learnerCoveragePct: raw ? round(learnerLocks / raw * 100, 2) : null,
    observerCoverageOfVerifiedLocksPct: learnerLocks ? round(observed / learnerLocks * 100, 2) : null,
    rows,
  };
}

function auditEurope(data, startMs, endMs) {
  const forwardMap = byActualPeriod(data.europeForward);
  const obsMap = observerMap(data.observations, "europe");
  const rows = [];

  for (const result of data.europeResults) {
    const time = parseEuropeDrawTime(result);
    if (time.ms == null || time.ms < startMs || time.ms >= endMs) continue;
    const period = Number(result.period);
    const lock = forwardMap.get(period) || null;
    const observation = obsMap.get(period) || null;
    const proof = lockProof(lock, time.ms);
    let classification = "TRULY_MISSING_LEARNER_LOCK";
    if (proof.verified && observation) classification = "OBSERVER_CAPTURED";
    else if (proof.verified) classification = "VERIFIED_LOCK_NOT_OBSERVED";

    rows.push({
      period,
      result: String(result.result || "").padStart(3, "0"),
      drawAt: new Date(time.ms).toISOString(),
      timestampBasis: time.basis,
      classification,
      learnerLock: lock ? { id: Number(lock.id), ...proof, targetPeriod: lock.target_period == null ? null : Number(lock.target_period) } : null,
      observer: observation ? { id: Number(observation.id), status: observation.status, observedAt: observation.observed_at } : null,
    });
  }

  rows.sort((a, b) => a.period - b.period);
  const raw = rows.length;
  const learnerLocks = rows.filter((r) => r.learnerLock?.verified).length;
  const observed = rows.filter((r) => r.classification === "OBSERVER_CAPTURED").length;
  const recoverable = rows.filter((r) => r.classification === "VERIFIED_LOCK_NOT_OBSERVED").length;
  const missing = rows.filter((r) => r.classification === "TRULY_MISSING_LEARNER_LOCK").length;
  return {
    source: "europe",
    rawResults: raw,
    verifiedLearnerLocks: learnerLocks,
    observerCaptured: observed,
    verifiedLockNotObserved: recoverable,
    trulyMissingLearnerLocks: missing,
    partialModelLockOnly: 0,
    learnerCoveragePct: raw ? round(learnerLocks / raw * 100, 2) : null,
    observerCoverageOfVerifiedLocksPct: learnerLocks ? round(observed / learnerLocks * 100, 2) : null,
    rows,
  };
}

export async function getForwardLockRecoveryAudit(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Forward Lock Recovery Audit.");
  const db = env.DB;
  const hours = clampHours(options.hours);
  const reliableStart = await metaValue(db, "reliable_collection_started_at");
  const phaseStart = await metaValue(db, "phase0_started_at");
  const endMs = parseIso(options.endAt) ?? parseIso(reliableStart) ?? Date.now();
  const startMs = endMs - hours * 60 * 60 * 1000;
  const data = await readData(db);
  const utama = auditUtama(data, startMs, endMs);
  const europe = auditEurope(data, startMs, endMs);

  return {
    ok: true,
    version: FORWARD_LOCK_RECOVERY_VERSION,
    mode: "READ_ONLY_FORWARD_LOCK_RECOVERY_AUDIT",
    window: {
      hours,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      endBasis: reliableStart ? "reliable_collection_started_at" : "now",
      reliableCollectionStartedAt: reliableStart,
      legacyPhaseStartedAt: phaseStart,
    },
    summary: {
      rawResults: utama.rawResults + europe.rawResults,
      verifiedLearnerLocks: utama.verifiedLearnerLocks + europe.verifiedLearnerLocks,
      observerCaptured: utama.observerCaptured + europe.observerCaptured,
      verifiedLockNotObserved: utama.verifiedLockNotObserved + europe.verifiedLockNotObserved,
      trulyMissingLearnerLocks: utama.trulyMissingLearnerLocks + europe.trulyMissingLearnerLocks,
    },
    bySource: { utama, europe },
    policy: {
      readOnly: true,
      noHistoricalPredictionGeneration: true,
      noObserverBackfill: true,
      noWeightChanges: true,
      originalSettledForwardRowsCountAsEvidence: true,
      observerAbsenceDoesNotInvalidateAnOriginalForwardLock: true,
      missingOriginalLockCannotBeRecoveredAfterActual: true,
    },
    interpretation: {
      observerCaptured: "Original forward lock exists and AI V2 Observer also captured it.",
      verifiedLockNotObserved: "Original settled forward lock exists; Observer missed the snapshot. Valid as original forward evidence, but it is not retro-inserted into Observer.",
      trulyMissingLearnerLock: "No original learner lock exists for that actual result. It cannot be reconstructed after the result without hindsight.",
      partialModelLockOnly: "UTAMA has Arena/Two-Stage evidence but no Keeper7 learner lock for that actual.",
    },
    now: new Date().toISOString(),
  };
}
