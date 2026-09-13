export const AI_V2_PHASE0_VERSION = "0.1.0-observer";
export const AI_V2_PHASE = "OBSERVER";
export const AI_V2_FEATURE_VERSION = "phase0.features.v1";

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function safeJson(value, fallback = null) {
  try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); }
}

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function clampLimit(value, fallback = 20, max = 100) {
  return Math.max(1, Math.min(max, Number(value) || fallback));
}

async function firstRow(statement) {
  const query = await statement.all();
  return query.results?.[0] || null;
}

export async function ensureAiV2ObserverSchema(db) {
  if (!db) throw new Error("D1 binding DB diperlukan untuk AI V2 Phase 0.");

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_v2_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'OBSERVER',
      feature_version TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      source_lock_created_at TEXT NOT NULL,
      anchor_period INTEGER NOT NULL,
      anchor_result TEXT NOT NULL,
      target_period INTEGER,
      target_time TEXT,
      source_status_at_capture TEXT NOT NULL,
      features_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      settled_at TEXT,
      actual_period INTEGER,
      actual_result TEXT,
      settlement_json TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_v2_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_v2_source_status ON ai_v2_observations(source, status, anchor_period DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_v2_observed_at ON ai_v2_observations(observed_at DESC)").run();

  const now = new Date().toISOString();
  await db.prepare(`
    INSERT OR IGNORE INTO ai_v2_meta(meta_key, meta_value, updated_at)
    VALUES('phase0_started_at', ?, ?)
  `).bind(now, now).run();
  await db.prepare(`
    INSERT OR REPLACE INTO ai_v2_meta(meta_key, meta_value, updated_at)
    VALUES('phase', 'OBSERVER', ?)
  `).bind(now).run();
  await db.prepare(`
    INSERT OR REPLACE INTO ai_v2_meta(meta_key, meta_value, updated_at)
    VALUES('feature_version', ?, ?)
  `).bind(AI_V2_FEATURE_VERSION, now).run();

  return true;
}

async function observationExists(db, key) {
  const row = await firstRow(db.prepare("SELECT id FROM ai_v2_observations WHERE observation_key=? LIMIT 1").bind(key));
  return Boolean(row);
}

async function latestPendingKeeper(db) {
  return firstRow(db.prepare(`
    SELECT id, created_at, anchor_period, anchor_result, target_hour,
           keep7_json, drop3_json, digit_ranking_json, subset_json,
           assisted_top3_json, model_sources_json, validation_json,
           component_snapshot_json, adaptive_state_json, engine_version, status
    FROM keeper7_forward_runs
    WHERE status='pending'
    ORDER BY anchor_period DESC, id DESC
    LIMIT 1
  `));
}

async function arenaAtAnchor(db, anchorPeriod) {
  return firstRow(db.prepare(`
    SELECT id, created_at, anchor_period, anchor_result, fingerprint, decay,
           engine_version, predictions_json, status
    FROM arena_forward_runs
    WHERE anchor_period=?
    ORDER BY id DESC
    LIMIT 1
  `).bind(Number(anchorPeriod)));
}

async function twoStageAtAnchor(db, anchorPeriod) {
  return firstRow(db.prepare(`
    SELECT id, created_at, anchor_period, anchor_result, engine_version,
           top3_json, top10_json, flows_json, stage1_json, explanations_json, status
    FROM two_stage_forward_runs
    WHERE anchor_period=?
    ORDER BY id DESC
    LIMIT 1
  `).bind(Number(anchorPeriod)));
}

async function captureUtama(db) {
  const keeper = await latestPendingKeeper(db);
  if (!keeper) return { source: "utama", captured: false, reason: "no-pending-lock" };

  const anchorPeriod = Number(keeper.anchor_period);
  const anchorResult = normalize3(keeper.anchor_result);
  if (!anchorResult) return { source: "utama", captured: false, reason: "invalid-anchor" };

  const key = `utama:${anchorPeriod}`;
  if (await observationExists(db, key)) return { source: "utama", captured: false, reason: "already-observed", anchorPeriod };

  const [arena, twoStage] = await Promise.all([
    arenaAtAnchor(db, anchorPeriod),
    twoStageAtAnchor(db, anchorPeriod),
  ]);

  // Phase 0 is strict observer mode. We only snapshot source locks that are
  // still pending. Settled locks are never imported later as pseudo-forward data.
  if (keeper.status !== "pending") return { source: "utama", captured: false, reason: "source-already-settled" };

  const features = {
    mode: AI_V2_PHASE,
    predictionEnabled: false,
    source: "utama",
    anchor: {
      period: anchorPeriod,
      result: anchorResult,
      keeperLockCreatedAt: keeper.created_at,
    },
    arena: arena ? {
      lockId: Number(arena.id),
      lockCreatedAt: arena.created_at,
      statusAtCapture: arena.status,
      engineVersion: arena.engine_version,
      fingerprint: arena.fingerprint,
      decay: Number(arena.decay),
      predictions: parseJson(arena.predictions_json, []),
    } : null,
    twoStage: twoStage ? {
      lockId: Number(twoStage.id),
      lockCreatedAt: twoStage.created_at,
      statusAtCapture: twoStage.status,
      engineVersion: twoStage.engine_version,
      top3: parseJson(twoStage.top3_json, []),
      top10: parseJson(twoStage.top10_json, []),
      flows: parseJson(twoStage.flows_json, []),
      stage1: parseJson(twoStage.stage1_json, []),
      explanations: parseJson(twoStage.explanations_json, []),
    } : null,
    keeper7: {
      lockId: Number(keeper.id),
      lockCreatedAt: keeper.created_at,
      engineVersion: keeper.engine_version,
      targetHour: keeper.target_hour == null ? null : Number(keeper.target_hour),
      keep7: parseJson(keeper.keep7_json, []),
      drop3: parseJson(keeper.drop3_json, []),
      digitRanking: parseJson(keeper.digit_ranking_json, []),
      subset: parseJson(keeper.subset_json, {}),
      assistedTop3: parseJson(keeper.assisted_top3_json, []),
      modelSources: parseJson(keeper.model_sources_json, []),
      validation: parseJson(keeper.validation_json, {}),
      componentSnapshot: parseJson(keeper.component_snapshot_json, null),
      adaptiveState: parseJson(keeper.adaptive_state_json, null),
    },
  };

  const refs = {
    keeperId: Number(keeper.id),
    arenaId: arena ? Number(arena.id) : null,
    twoStageId: twoStage ? Number(twoStage.id) : null,
  };
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO ai_v2_observations(
      observation_key, source, phase, feature_version, observed_at,
      source_lock_created_at, anchor_period, anchor_result, target_period,
      target_time, source_status_at_capture, features_json, source_refs_json, status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
  `).bind(
    key,
    "utama",
    AI_V2_PHASE,
    AI_V2_FEATURE_VERSION,
    now,
    keeper.created_at || now,
    anchorPeriod,
    anchorResult,
    anchorPeriod + 1,
    keeper.target_hour == null ? null : `${String(Number(keeper.target_hour)).padStart(2, "0")}:00`,
    "pending",
    safeJson(features, {}),
    safeJson(refs, {}),
  ).run();

  return { source: "utama", captured: true, anchorPeriod, observationKey: key };
}

async function latestPendingEurope(db) {
  return firstRow(db.prepare(`
    SELECT id, created_at, status, anchor_period, anchor_result,
           target_period, target_draw_time, history_size,
           models_json, two_stage_json, keeper_json, adaptive_state_json,
           component_snapshot_json
    FROM europe_forward_runs
    WHERE status='pending'
    ORDER BY anchor_period DESC, id DESC
    LIMIT 1
  `));
}

async function captureEurope(db) {
  const lock = await latestPendingEurope(db);
  if (!lock) return { source: "europe", captured: false, reason: "no-pending-lock" };

  const anchorPeriod = Number(lock.anchor_period);
  const anchorResult = normalize3(lock.anchor_result);
  if (!anchorResult) return { source: "europe", captured: false, reason: "invalid-anchor" };

  const key = `europe:${anchorPeriod}`;
  if (await observationExists(db, key)) return { source: "europe", captured: false, reason: "already-observed", anchorPeriod };
  if (lock.status !== "pending") return { source: "europe", captured: false, reason: "source-already-settled" };

  const features = {
    mode: AI_V2_PHASE,
    predictionEnabled: false,
    source: "europe",
    firstPlaceOnly: true,
    anchor: {
      period: anchorPeriod,
      result: anchorResult,
      lockCreatedAt: lock.created_at,
      targetPeriod: lock.target_period == null ? null : Number(lock.target_period),
      targetDrawTime: lock.target_draw_time,
      historySize: Number(lock.history_size || 0),
    },
    models: parseJson(lock.models_json, []),
    twoStage: parseJson(lock.two_stage_json, {}),
    keeper7: parseJson(lock.keeper_json, {}),
    adaptiveState: parseJson(lock.adaptive_state_json, {}),
    componentSnapshot: parseJson(lock.component_snapshot_json, {}),
  };

  const refs = { europeForwardId: Number(lock.id) };
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT OR IGNORE INTO ai_v2_observations(
      observation_key, source, phase, feature_version, observed_at,
      source_lock_created_at, anchor_period, anchor_result, target_period,
      target_time, source_status_at_capture, features_json, source_refs_json, status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
  `).bind(
    key,
    "europe",
    AI_V2_PHASE,
    AI_V2_FEATURE_VERSION,
    now,
    lock.created_at || now,
    anchorPeriod,
    anchorResult,
    lock.target_period == null ? anchorPeriod + 1 : Number(lock.target_period),
    lock.target_draw_time || null,
    "pending",
    safeJson(features, {}),
    safeJson(refs, {}),
  ).run();

  return { source: "europe", captured: true, anchorPeriod, observationKey: key };
}

async function settleUtamaObservation(db, observation) {
  const refs = parseJson(observation.source_refs_json, {});
  const keeper = refs.keeperId
    ? await firstRow(db.prepare("SELECT * FROM keeper7_forward_runs WHERE id=? LIMIT 1").bind(Number(refs.keeperId)))
    : await firstRow(db.prepare("SELECT * FROM keeper7_forward_runs WHERE anchor_period=? ORDER BY id DESC LIMIT 1").bind(Number(observation.anchor_period)));

  if (!keeper || keeper.status !== "settled") return null;

  let arena = null;
  let twoStage = null;
  if (refs.arenaId) {
    arena = await firstRow(db.prepare("SELECT * FROM arena_forward_runs WHERE id=? LIMIT 1").bind(Number(refs.arenaId)));
    if (!arena || arena.status !== "settled") return null;
  }
  if (refs.twoStageId) {
    twoStage = await firstRow(db.prepare("SELECT * FROM two_stage_forward_runs WHERE id=? LIMIT 1").bind(Number(refs.twoStageId)));
    if (!twoStage || twoStage.status !== "settled") return null;
  }

  const actual = normalize3(keeper.actual_result);
  if (!actual) return null;

  const settlement = {
    source: "utama",
    actual: {
      period: keeper.actual_period == null ? null : Number(keeper.actual_period),
      result: actual,
    },
    arena: arena ? {
      settledAt: arena.settled_at,
      scores: parseJson(arena.scores_json, []),
    } : null,
    twoStage: twoStage ? {
      settledAt: twoStage.settled_at,
      actualRank: twoStage.actual_rank == null ? null : Number(twoStage.actual_rank),
      exactTop3: Boolean(twoStage.exact_top3),
      top10Hit: Boolean(twoStage.top10_hit),
      permutationHit: Boolean(twoStage.permutation_hit),
      bestDigitOverlap: Number(twoStage.best_digit_overlap || 0),
      bestPositionHits: Number(twoStage.best_position_hits || 0),
      poolDigitCoverage: Number(twoStage.pool_digit_coverage || 0),
      bestCandidate: twoStage.best_candidate,
    } : null,
    keeper7: {
      settledAt: keeper.settled_at,
      coveredPositions: Number(keeper.covered_positions || 0),
      all3Covered: Boolean(keeper.all3_covered),
      randomBaseline: keeper.random_baseline == null ? null : Number(keeper.random_baseline),
      assistedExactTop3: Boolean(keeper.assisted_exact_top3),
    },
  };

  return {
    settledAt: keeper.settled_at || new Date().toISOString(),
    actualPeriod: keeper.actual_period == null ? null : Number(keeper.actual_period),
    actualResult: actual,
    settlement,
  };
}

async function settleEuropeObservation(db, observation) {
  const refs = parseJson(observation.source_refs_json, {});
  const lock = refs.europeForwardId
    ? await firstRow(db.prepare("SELECT * FROM europe_forward_runs WHERE id=? LIMIT 1").bind(Number(refs.europeForwardId)))
    : await firstRow(db.prepare("SELECT * FROM europe_forward_runs WHERE anchor_period=? ORDER BY id DESC LIMIT 1").bind(Number(observation.anchor_period)));

  if (!lock || lock.status !== "settled") return null;
  const actual = normalize3(lock.actual_result);
  if (!actual) return null;

  return {
    settledAt: lock.settled_at || new Date().toISOString(),
    actualPeriod: lock.actual_period == null ? null : Number(lock.actual_period),
    actualResult: actual,
    settlement: {
      source: "europe",
      firstPlaceOnly: true,
      actual: {
        period: lock.actual_period == null ? null : Number(lock.actual_period),
        result: actual,
        datetime: lock.actual_datetime,
      },
      modelScores: parseJson(lock.model_scores_json, []),
      keeperScore: parseJson(lock.keeper_score_json, null),
    },
  };
}

async function settleObservedRows(db) {
  const query = await db.prepare(`
    SELECT * FROM ai_v2_observations
    WHERE status='pending'
    ORDER BY id ASC
    LIMIT 100
  `).all();

  let settled = 0;
  const rows = [];
  for (const observation of query.results || []) {
    let outcome = null;
    try {
      outcome = observation.source === "europe"
        ? await settleEuropeObservation(db, observation)
        : await settleUtamaObservation(db, observation);
    } catch {
      outcome = null;
    }
    if (!outcome) continue;

    await db.prepare(`
      UPDATE ai_v2_observations
      SET status='settled', settled_at=?, actual_period=?, actual_result=?, settlement_json=?
      WHERE id=? AND status='pending'
    `).bind(
      outcome.settledAt,
      outcome.actualPeriod,
      outcome.actualResult,
      safeJson(outcome.settlement, {}),
      Number(observation.id),
    ).run();
    settled += 1;
    rows.push({ id: Number(observation.id), source: observation.source, actualResult: outcome.actualResult });
  }
  return { settled, rows };
}

function compactObservation(row) {
  const features = parseJson(row.features_json, {});
  const settlement = parseJson(row.settlement_json, null);
  return {
    id: Number(row.id),
    key: row.observation_key,
    source: row.source,
    phase: row.phase,
    featureVersion: row.feature_version,
    observedAt: row.observed_at,
    sourceLockCreatedAt: row.source_lock_created_at,
    anchorPeriod: Number(row.anchor_period),
    anchorResult: row.anchor_result,
    targetPeriod: row.target_period == null ? null : Number(row.target_period),
    targetTime: row.target_time,
    status: row.status,
    settledAt: row.settled_at,
    actualPeriod: row.actual_period == null ? null : Number(row.actual_period),
    actualResult: row.actual_result,
    captured: {
      arena: Boolean(features.arena || features.models),
      twoStage: Boolean(features.twoStage),
      keeper7: Boolean(features.keeper7),
      adaptive: Boolean(features.adaptiveState || features.keeper7?.adaptiveState),
      componentSnapshot: Boolean(features.componentSnapshot || features.keeper7?.componentSnapshot),
    },
    resultSummary: settlement ? {
      keeperCovered: settlement.keeper7?.coveredPositions ?? settlement.keeperScore?.covered ?? null,
      keeperAll3: settlement.keeper7?.all3Covered ?? settlement.keeperScore?.all3 ?? null,
      twoStageOverlap: settlement.twoStage?.bestDigitOverlap ?? null,
      twoStagePositions: settlement.twoStage?.bestPositionHits ?? null,
    } : null,
  };
}

async function sourceCounts(db) {
  const query = await db.prepare(`
    SELECT source,
           COUNT(*) AS total,
           SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) AS settled
    FROM ai_v2_observations
    GROUP BY source
  `).all();
  const result = {
    utama: { total: 0, pending: 0, settled: 0 },
    europe: { total: 0, pending: 0, settled: 0 },
  };
  for (const row of query.results || []) {
    if (!result[row.source]) result[row.source] = { total: 0, pending: 0, settled: 0 };
    result[row.source] = {
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      settled: Number(row.settled || 0),
    };
  }
  return result;
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM ai_v2_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value || null;
}

export async function getAiV2ObserverStatus(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk AI V2 Phase 0.");
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);

  const limit = clampLimit(options.limit, 20, 50);
  const [counts, recentQuery, startedAt] = await Promise.all([
    sourceCounts(db),
    db.prepare("SELECT * FROM ai_v2_observations ORDER BY id DESC LIMIT ?").bind(limit).all(),
    metaValue(db, "phase0_started_at"),
  ]);

  const recent = (recentQuery.results || []).map(compactObservation);
  const total = counts.utama.total + counts.europe.total;
  const settled = counts.utama.settled + counts.europe.settled;
  const pending = counts.utama.pending + counts.europe.pending;

  return {
    ok: true,
    version: AI_V2_PHASE0_VERSION,
    phase: AI_V2_PHASE,
    featureVersion: AI_V2_FEATURE_VERSION,
    predictionEnabled: false,
    writesToV1: false,
    startedAt,
    counts: { total, settled, pending, bySource: counts },
    gates: {
      surveyHours: 24,
      initialMetaLearnerForward: 50,
      strongerEvaluationForward: 100,
      currentGate: "COLLECT_FORWARD_EVIDENCE",
    },
    policy: {
      forwardOnly: true,
      capturePendingLocksOnly: true,
      noHistoricalBackfillAsTraining: true,
      noHindsightRewrite: true,
      v1ControlFrozen: true,
      aiPredictionDisabled: true,
    },
    recent,
    now: new Date().toISOString(),
  };
}

async function safeCapture(label, fn) {
  try { return await fn(); }
  catch (error) {
    return { source: label, captured: false, reason: "capture-error", error: error?.message || String(error) };
  }
}

export async function runAiV2Observer(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk AI V2 Phase 0.");
  const db = env.DB;
  await ensureAiV2ObserverSchema(db);

  // First settle observations that were captured while their source locks were
  // pending. Then snapshot only the currently pending next locks.
  const settlement = await settleObservedRows(db);
  const captures = await Promise.all([
    safeCapture("utama", () => captureUtama(db)),
    safeCapture("europe", () => captureEurope(db)),
  ]);
  const status = await getAiV2ObserverStatus(env);

  return {
    ...status,
    pipeline: {
      settlement,
      captures,
    },
  };
}
