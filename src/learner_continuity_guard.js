export const LEARNER_CONTINUITY_VERSION = "1.0.4";
export const LEARNER_CONTINUITY_GRACE_SECONDS = 180;

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

async function safeAll(statement) {
  try {
    const out = await statement.all();
    return out.results || [];
  } catch {
    return [];
  }
}

async function firstRow(statement) {
  const rows = await safeAll(statement);
  return rows[0] || null;
}

async function ensureMeta(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS watchdog_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM watchdog_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value ?? null;
}

async function writeMetaOnce(db, key, value) {
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO watchdog_meta(meta_key, meta_value, updated_at) VALUES(?,?,?)")
    .bind(key, String(value), now).run();
}

async function latestPeriod(db, table) {
  const row = await firstRow(db.prepare(`SELECT period FROM ${table} ORDER BY period DESC LIMIT 1`));
  return row?.period == null ? null : Number(row.period);
}

export async function armLearnerContinuityGuard(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Learner Continuity Guard.");
  const db = env.DB;
  await ensureMeta(db);
  const existing = await metaValue(db, "learner_continuity_started_at");
  if (existing) {
    return {
      armed: true,
      created: false,
      startedAt: existing,
      utamaStartPeriod: Number(await metaValue(db, "learner_continuity_utama_start_period")) || null,
      europeStartPeriod: Number(await metaValue(db, "learner_continuity_europe_start_period")) || null,
    };
  }
  if (String(options.trigger || "") !== "scheduled") return { armed: false, created: false, reason: "scheduled-only" };

  const startedAt = options.startedAt || new Date().toISOString();
  const [utamaStartPeriod, europeStartPeriod] = await Promise.all([
    latestPeriod(db, "results_3d"),
    latestPeriod(db, "europe_results_3d"),
  ]);
  await writeMetaOnce(db, "learner_continuity_started_at", startedAt);
  await writeMetaOnce(db, "learner_continuity_version", LEARNER_CONTINUITY_VERSION);
  if (utamaStartPeriod != null) await writeMetaOnce(db, "learner_continuity_utama_start_period", utamaStartPeriod);
  if (europeStartPeriod != null) await writeMetaOnce(db, "learner_continuity_europe_start_period", europeStartPeriod);
  return { armed: true, created: true, startedAt, utamaStartPeriod, europeStartPeriod };
}

function toMap(rows, key = "anchor_period") {
  const map = new Map();
  for (const row of rows || []) {
    const period = Number(row?.[key]);
    if (!Number.isFinite(period)) continue;
    if (!map.has(period)) map.set(period, row);
  }
  return map;
}

function numericGaps(rows) {
  const periods = [...new Set((rows || []).map((row) => Number(row.period)).filter(Number.isFinite))].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < periods.length; i += 1) {
    for (let p = periods[i - 1] + 1; p < periods[i] && gaps.length < 200; p += 1) gaps.push(p);
  }
  return gaps;
}

function rowAgeSeconds(row, nowMs) {
  const parsed = Date.parse(row?.collected_at || row?.collectedAt || "");
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 1000) : null;
}

function classifyUtama({ raw, isLatest, hasNext, keeper, arena, twoStage, observer, nowMs }) {
  const age = rowAgeSeconds(raw, nowMs);
  if (!keeper) {
    if (isLatest && age != null && age < LEARNER_CONTINUITY_GRACE_SECONDS) return "PROCESSING";
    return "MISSING_KEEPER_LOCK";
  }
  if (!arena || !twoStage) return "PARTIAL_MODEL_LOCK";
  if (!observer) return "MISSING_OBSERVER";
  if (hasNext && String(keeper.status) !== "settled") return "UNSETTLED_KEEPER";
  if (hasNext && String(arena.status) !== "settled") return "UNSETTLED_ARENA";
  if (hasNext && String(twoStage.status) !== "settled") return "UNSETTLED_TWO_STAGE";
  if (hasNext && String(observer.status) !== "settled") return "UNSETTLED_OBSERVER";
  return isLatest ? "CURRENT_LOCKED" : "COMPLETE";
}

function classifyEurope({ raw, isLatest, hasNext, lock, observer, nowMs }) {
  const age = rowAgeSeconds(raw, nowMs);
  if (!lock) {
    if (isLatest && age != null && age < LEARNER_CONTINUITY_GRACE_SECONDS) return "PROCESSING";
    return "MISSING_FORWARD_LOCK";
  }
  if (!observer) return "MISSING_OBSERVER";
  if (hasNext && String(lock.status) !== "settled") return "UNSETTLED_FORWARD";
  if (hasNext && String(observer.status) !== "settled") return "UNSETTLED_OBSERVER";
  return isLatest ? "CURRENT_LOCKED" : "COMPLETE";
}

async function totalsUtama(db) {
  const [keeper, arena, twoStage, observer] = await Promise.all([
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM keeper7_forward_runs")),
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM arena_forward_runs")),
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM two_stage_forward_runs")),
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM ai_v2_observations WHERE source='utama'")),
  ]);
  const norm = (row) => ({ total: Number(row?.n || 0), settled: Number(row?.settled || 0), pending: Number(row?.pending || 0) });
  return { keeper7: norm(keeper), arena: norm(arena), twoStage: norm(twoStage), observer: norm(observer) };
}

async function totalsEurope(db) {
  const [forward, observer] = await Promise.all([
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM europe_forward_runs")),
    firstRow(db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) settled, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending FROM ai_v2_observations WHERE source='europe'")),
  ]);
  const norm = (row) => ({ total: Number(row?.n || 0), settled: Number(row?.settled || 0), pending: Number(row?.pending || 0) });
  return { forward: norm(forward), observer: norm(observer) };
}

async function auditUtama(db, startPeriod, nowMs) {
  if (!Number.isFinite(Number(startPeriod))) return { source: "utama", status: "NOT_STARTED", startPeriod: null };
  const p = Number(startPeriod);
  const [rawRows, keepers, arenas, twoStages, observers, totals] = await Promise.all([
    safeAll(db.prepare("SELECT period, result, collected_at FROM results_3d WHERE period>=? ORDER BY period ASC LIMIT 5000").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, created_at, status, settled_at, actual_period FROM keeper7_forward_runs WHERE anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, created_at, status, settled_at, actual_period FROM arena_forward_runs WHERE anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, created_at, status, settled_at, actual_period FROM two_stage_forward_runs WHERE anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, observed_at, status, settled_at, actual_period FROM ai_v2_observations WHERE source='utama' AND anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    totalsUtama(db),
  ]);
  const keeperMap = toMap(keepers); const arenaMap = toMap(arenas); const twoMap = toMap(twoStages); const obsMap = toMap(observers);
  const details = rawRows.map((raw, index) => {
    const period = Number(raw.period); const isLatest = index === rawRows.length - 1; const hasNext = !isLatest;
    const keeper = keeperMap.get(period) || null; const arena = arenaMap.get(period) || null; const twoStage = twoMap.get(period) || null; const observer = obsMap.get(period) || null;
    return {
      period, result: String(raw.result).padStart(3, "0"), isLatest,
      status: classifyUtama({ raw, isLatest, hasNext, keeper, arena, twoStage, observer, nowMs }),
      keeper: keeper ? { status: keeper.status, createdAt: keeper.created_at, actualPeriod: keeper.actual_period == null ? null : Number(keeper.actual_period) } : null,
      arena: arena ? { status: arena.status, createdAt: arena.created_at } : null,
      twoStage: twoStage ? { status: twoStage.status, createdAt: twoStage.created_at } : null,
      observer: observer ? { status: observer.status, observedAt: observer.observed_at } : null,
    };
  });
  const expected = rawRows.length;
  const expectedSettled = Math.max(0, expected - 1);
  const locked = details.filter((row) => row.keeper).length;
  const settled = details.filter((row) => row.keeper?.status === "settled").length;
  const full = details.filter((row) => row.status === "COMPLETE" || row.status === "CURRENT_LOCKED").length;
  const definiteGaps = details.filter((row) => !["COMPLETE", "CURRENT_LOCKED", "PROCESSING"].includes(row.status));
  return {
    source: "utama", startPeriod: p, latestPeriod: rawRows.at(-1)?.period == null ? null : Number(rawRows.at(-1).period),
    status: definiteGaps.length || numericGaps(rawRows).length ? "GAP" : details.some((row) => row.status === "PROCESSING") ? "PROCESSING" : "HEALTHY",
    rawResults: expected, expectedLearnerLocks: expected, expectedSettled,
    locked, settled, pending: details.filter((row) => row.keeper?.status === "pending").length,
    observed: details.filter((row) => row.observer).length,
    continuityPct: expected ? round(locked / expected * 100, 2) : null,
    fullChainPct: expected ? round(full / expected * 100, 2) : null,
    learnerShortfall: Math.max(0, expectedSettled - settled),
    missingRawPeriods: numericGaps(rawRows),
    missingKeeperPeriods: details.filter((row) => row.status === "MISSING_KEEPER_LOCK").map((row) => row.period),
    missingArenaPeriods: details.filter((row) => !row.arena && row.keeper).map((row) => row.period),
    missingTwoStagePeriods: details.filter((row) => !row.twoStage && row.keeper).map((row) => row.period),
    missingObserverPeriods: details.filter((row) => !row.observer && row.keeper).map((row) => row.period),
    unsettledPeriods: details.filter((row) => row.status.startsWith("UNSETTLED_")).map((row) => row.period),
    totals,
    recent: details.slice(-72).reverse(),
  };
}

async function auditEurope(db, startPeriod, nowMs) {
  if (!Number.isFinite(Number(startPeriod))) return { source: "europe", status: "NOT_STARTED", startPeriod: null };
  const p = Number(startPeriod);
  const [rawRows, locks, observers, totals] = await Promise.all([
    safeAll(db.prepare("SELECT period, result, collected_at FROM europe_results_3d WHERE period>=? ORDER BY period ASC LIMIT 5000").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, created_at, status, settled_at, actual_period FROM europe_forward_runs WHERE anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    safeAll(db.prepare("SELECT anchor_period, observed_at, status, settled_at, actual_period FROM ai_v2_observations WHERE source='europe' AND anchor_period>=? ORDER BY anchor_period ASC").bind(p)),
    totalsEurope(db),
  ]);
  const lockMap = toMap(locks); const obsMap = toMap(observers);
  const details = rawRows.map((raw, index) => {
    const period = Number(raw.period); const isLatest = index === rawRows.length - 1; const hasNext = !isLatest;
    const lock = lockMap.get(period) || null; const observer = obsMap.get(period) || null;
    return {
      period, result: String(raw.result).padStart(3, "0"), isLatest,
      status: classifyEurope({ raw, isLatest, hasNext, lock, observer, nowMs }),
      forward: lock ? { status: lock.status, createdAt: lock.created_at, actualPeriod: lock.actual_period == null ? null : Number(lock.actual_period) } : null,
      observer: observer ? { status: observer.status, observedAt: observer.observed_at } : null,
    };
  });
  const expected = rawRows.length;
  const expectedSettled = Math.max(0, expected - 1);
  const locked = details.filter((row) => row.forward).length;
  const settled = details.filter((row) => row.forward?.status === "settled").length;
  const full = details.filter((row) => row.status === "COMPLETE" || row.status === "CURRENT_LOCKED").length;
  const definiteGaps = details.filter((row) => !["COMPLETE", "CURRENT_LOCKED", "PROCESSING"].includes(row.status));
  return {
    source: "europe", startPeriod: p, latestPeriod: rawRows.at(-1)?.period == null ? null : Number(rawRows.at(-1).period),
    status: definiteGaps.length || numericGaps(rawRows).length ? "GAP" : details.some((row) => row.status === "PROCESSING") ? "PROCESSING" : "HEALTHY",
    rawResults: expected, expectedLearnerLocks: expected, expectedSettled,
    locked, settled, pending: details.filter((row) => row.forward?.status === "pending").length,
    observed: details.filter((row) => row.observer).length,
    continuityPct: expected ? round(locked / expected * 100, 2) : null,
    fullChainPct: expected ? round(full / expected * 100, 2) : null,
    learnerShortfall: Math.max(0, expectedSettled - settled),
    missingRawPeriods: numericGaps(rawRows),
    missingForwardPeriods: details.filter((row) => row.status === "MISSING_FORWARD_LOCK").map((row) => row.period),
    missingObserverPeriods: details.filter((row) => !row.observer && row.forward).map((row) => row.period),
    unsettledPeriods: details.filter((row) => row.status.startsWith("UNSETTLED_")).map((row) => row.period),
    totals,
    recent: details.slice(-96).reverse(),
  };
}

async function earliestWatchdogPeriods(db) {
  const row = await firstRow(db.prepare(`
    SELECT utama_result_period, europe_result_period, started_at
    FROM watchdog_cycles
    WHERE trigger='scheduled' AND utama_result_period IS NOT NULL AND europe_result_period IS NOT NULL
    ORDER BY id ASC LIMIT 1
  `));
  return {
    startedAt: row?.started_at || null,
    utama: row?.utama_result_period == null ? null : Number(row.utama_result_period),
    europe: row?.europe_result_period == null ? null : Number(row.europe_result_period),
  };
}

function overallStatus(utama, europe) {
  if (utama?.status === "GAP" || europe?.status === "GAP") return "GAP";
  if (utama?.status === "PROCESSING" || europe?.status === "PROCESSING") return "PROCESSING";
  if (utama?.status === "NOT_STARTED" || europe?.status === "NOT_STARTED") return "ARMING";
  return "HEALTHY";
}

export async function getLearnerContinuityGuard(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Learner Continuity Guard.");
  const db = env.DB;
  await ensureMeta(db);
  const nowMs = Date.now();
  const historicalStart = await earliestWatchdogPeriods(db);
  const guardStartedAt = await metaValue(db, "learner_continuity_started_at");
  const guardUtama = Number(await metaValue(db, "learner_continuity_utama_start_period")) || null;
  const guardEurope = Number(await metaValue(db, "learner_continuity_europe_start_period")) || null;

  const [historyUtama, historyEurope, protectedUtama, protectedEurope] = await Promise.all([
    auditUtama(db, historicalStart.utama, nowMs),
    auditEurope(db, historicalStart.europe, nowMs),
    auditUtama(db, guardUtama, nowMs),
    auditEurope(db, guardEurope, nowMs),
  ]);
  const protectedStatus = guardStartedAt ? overallStatus(protectedUtama, protectedEurope) : "ARMING";
  return {
    ok: true,
    version: LEARNER_CONTINUITY_VERSION,
    mode: "FORWARD_LOCK_CONTINUITY_GUARD",
    status: protectedStatus,
    guardStartedAt,
    graceSeconds: LEARNER_CONTINUITY_GRACE_SECONDS,
    protected: {
      status: protectedStatus,
      bySource: { utama: protectedUtama, europe: protectedEurope },
      note: "Clean V1.0.4 window. Gap di sini boleh menurunkan Watchdog; tidak ada hindsight reconstruction.",
    },
    historical: {
      status: overallStatus(historyUtama, historyEurope),
      startedAt: historicalStart.startedAt,
      bySource: { utama: historyUtama, europe: historyEurope },
      note: "Audit sejak scheduled Watchdog pertama. Gap lama tetap ditampilkan sebagai bukti, tetapi tidak direkonstruksi.",
    },
    policy: {
      noHistoricalPredictionReconstruction: true,
      noModelWrites: true,
      noWeightChanges: true,
      rawResultIsDenominator: true,
      everyRawResultShouldHaveForwardLock: true,
      latestResultHasGraceSeconds: LEARNER_CONTINUITY_GRACE_SECONDS,
      protectedWindowControlsFutureHealth: true,
    },
    now: new Date().toISOString(),
  };
}
