export const EVIDENCE_MONITOR_VERSION = "1.0.0";

const MAX_ROWS = 2000;
const WINDOWS = [10, 25, 50];
const MILESTONES = [24, 50, 100, 200];

function parseJson(value, fallback) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function predictionNumber(value) {
  if (typeof value === "string" || typeof value === "number") return normalize3(value);
  return normalize3(value?.number);
}

function normalizeList(values, max = 10) {
  return (Array.isArray(values) ? values : []).map(predictionNumber).filter(Boolean).slice(0, max);
}

function normalizeModel(model, fallbackId = "model", fallbackLabel = "Model") {
  if (!model) return null;
  const top3 = normalizeList(model.top3, 3);
  const top10 = normalizeList(model.top10, 10);
  if (!top3.length && !top10.length) return null;
  return {
    id: String(model.id || model.modelId || fallbackId).toLowerCase(),
    label: String(model.label || model.name || fallbackLabel),
    top3,
    top10,
  };
}

function normalizeKeeper(keeper) {
  const keep7 = (keeper?.keep7 || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 9).slice(0, 7);
  const drop3 = (keeper?.drop3 || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 9).slice(0, 3);
  return keep7.length === 7 ? { keep7, drop3 } : null;
}

function recordFromRow(row) {
  const source = String(row.source || "").toLowerCase();
  if (source !== "utama" && source !== "europe") return null;
  const features = parseJson(row.features_json, {});
  const actual = normalize3(row.actual_result);
  const models = [];

  if (source === "europe") {
    for (const model of features.models || []) {
      const normalized = normalizeModel(model);
      if (normalized && normalized.id !== "two-stage") models.push(normalized);
    }
    const twoStage = normalizeModel({
      id: "two-stage",
      label: "Two-Stage",
      top3: features.twoStage?.top3 || [],
      top10: features.twoStage?.top10 || [],
    }, "two-stage", "Two-Stage");
    if (twoStage) models.push(twoStage);
  } else {
    for (const model of features.arena?.predictions || []) {
      const normalized = normalizeModel(model);
      if (normalized && normalized.id !== "two-stage") models.push(normalized);
    }
    const twoStage = normalizeModel({
      id: "two-stage",
      label: "Two-Stage",
      top3: features.twoStage?.top3 || [],
      top10: features.twoStage?.top10 || [],
    }, "two-stage", "Two-Stage");
    if (twoStage) models.push(twoStage);
  }

  const keeperRaw = features.keeper7 || {};
  const keeper = normalizeKeeper(keeperRaw);
  const assistedTop3 = normalizeList(keeperRaw.assistedTop3, 3);
  if (assistedTop3.length) models.push({ id: "3d-assist", label: "3D Assist", top3: assistedTop3, top10: [] });

  const deduped = [];
  const seen = new Set();
  for (const model of models) {
    if (!model?.id || seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }

  return {
    id: Number(row.id),
    source,
    status: String(row.status || ""),
    lockedBeforeResult: String(row.source_status_at_capture || "") === "pending",
    anchorPeriod: Number(row.anchor_period),
    targetPeriod: row.target_period == null ? null : Number(row.target_period),
    lockedAt: row.source_lock_created_at,
    settledAt: row.settled_at,
    actual,
    models: deduped,
    keeper,
  };
}

function digitCounts(value) {
  const counts = Array(10).fill(0);
  for (const ch of String(value || "")) {
    const d = Number(ch);
    if (Number.isInteger(d)) counts[d] += 1;
  }
  return counts;
}

function digitOverlap(candidate, actual) {
  const a = digitCounts(candidate);
  const b = digitCounts(actual);
  return a.reduce((sum, count, d) => sum + Math.min(count, b[d]), 0);
}

function positionHits(candidate, actual) {
  let hits = 0;
  for (let i = 0; i < 3; i += 1) if (candidate?.[i] === actual?.[i]) hits += 1;
  return hits;
}

function permutation(candidate, actual) {
  return String(candidate || "").split("").sort().join("") === String(actual || "").split("").sort().join("");
}

function scoreModel(model, actual) {
  const top3 = model.top3 || [];
  const top10 = model.top10 || [];
  let bestOverlap = 0;
  let bestPosition = 0;
  let permutationHit = 0;
  for (const candidate of top3) {
    bestOverlap = Math.max(bestOverlap, digitOverlap(candidate, actual));
    bestPosition = Math.max(bestPosition, positionHits(candidate, actual));
    if (permutation(candidate, actual)) permutationHit = 1;
  }
  return {
    exactTop3: top3.includes(actual) ? 1 : 0,
    top10Hit: top10.length ? (top10.includes(actual) ? 1 : 0) : null,
    permutationHit,
    digitOverlap: bestOverlap,
    positionHits: bestPosition,
  };
}

function scoreKeeper(keeper, actual) {
  const allowed = new Set(keeper?.keep7 || []);
  const coverage = [...actual].reduce((sum, ch) => sum + Number(allowed.has(Number(ch))), 0);
  return { all3: coverage === 3 ? 1 : 0, coverage };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let out = 1;
  const m = Math.min(k, n - k);
  for (let i = 1; i <= m; i += 1) out = out * (n - m + i) / i;
  return out;
}

function keeperAll3Baseline(actual) {
  const k = new Set([...actual]).size;
  if (k > 7) return 0;
  return choose(10 - k, 7 - k) / choose(10, 7);
}

function mean(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

function round(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function gateForN(n) {
  if (n < 24) return { code: "COLLECT", label: "COLLECT", floor: 0, ceiling: 24, note: "Belum 24 settled forward." };
  if (n < 50) return { code: "EARLY", label: "EARLY", floor: 24, ceiling: 50, note: "24–49 settled forward; screening awal." };
  if (n < 100) return { code: "PROVISIONAL", label: "PROVISIONAL", floor: 50, ceiling: 100, note: "50–99 settled forward; evidence masih provisional." };
  if (n < 200) return { code: "EVIDENCE", label: "EVIDENCE", floor: 100, ceiling: 200, note: "100–199 settled forward; evidence lebih serius." };
  return { code: "STRONGER_TEST", label: "STRONGER TEST", floor: 200, ceiling: null, note: "200+ settled forward; calibration lebih bermakna." };
}

function progressForN(n) {
  const next = MILESTONES.find((m) => n < m) ?? null;
  return {
    settled: n,
    nextMilestone: next,
    remaining: next == null ? 0 : Math.max(0, next - n),
    percentToNext: next == null ? 100 : round((n / next) * 100, 1),
    milestones: MILESTONES.map((m) => ({ target: m, reached: n >= m, remaining: Math.max(0, m - n) })),
  };
}

function modelMetrics(entries) {
  const scores = entries.map((entry) => scoreModel(entry.model, entry.record.actual));
  return {
    n: scores.length,
    exactTop3Rate: mean(scores.map((s) => s.exactTop3)),
    top10Rate: mean(scores.filter((s) => s.top10Hit != null).map((s) => s.top10Hit)),
    top10N: scores.filter((s) => s.top10Hit != null).length,
    permutationRate: mean(scores.map((s) => s.permutationHit)),
    meanDigitOverlap: mean(scores.map((s) => s.digitOverlap)),
    meanPositionHits: mean(scores.map((s) => s.positionHits)),
  };
}

function modelNullMeans(entries) {
  if (!entries.length) return {};
  const scores = [];
  for (const entry of entries) {
    for (const target of entries) scores.push(scoreModel(entry.model, target.record.actual));
  }
  return {
    exactTop3Rate: mean(scores.map((s) => s.exactTop3)),
    top10Rate: mean(scores.filter((s) => s.top10Hit != null).map((s) => s.top10Hit)),
    permutationRate: mean(scores.map((s) => s.permutationHit)),
    meanDigitOverlap: mean(scores.map((s) => s.digitOverlap)),
    meanPositionHits: mean(scores.map((s) => s.positionHits)),
  };
}

function keeperMetrics(entries) {
  const scores = entries.map((entry) => scoreKeeper(entry.record.keeper, entry.record.actual));
  const baselines = entries.map((entry) => keeperAll3Baseline(entry.record.actual));
  return {
    n: scores.length,
    all3Rate: mean(scores.map((s) => s.all3)),
    meanCoverage: mean(scores.map((s) => s.coverage)),
    sampleMatchedAll3Baseline: mean(baselines),
  };
}

function keeperNullMeans(entries) {
  if (!entries.length) return {};
  const scores = [];
  for (const entry of entries) {
    for (const target of entries) scores.push(scoreKeeper(entry.record.keeper, target.record.actual));
  }
  return {
    all3Rate: mean(scores.map((s) => s.all3)),
    meanCoverage: mean(scores.map((s) => s.coverage)),
  };
}

function compactMetric(value) {
  const out = {};
  for (const [key, val] of Object.entries(value || {})) out[key] = typeof val === "number" ? round(val) : val;
  return out;
}

function modelWindow(entries, size) {
  const slice = entries.slice(-size);
  return {
    requested: size,
    n: slice.length,
    observed: compactMetric(modelMetrics(slice)),
    nullMean: compactMetric(modelNullMeans(slice)),
  };
}

function keeperWindow(entries, size) {
  const slice = entries.slice(-size);
  return {
    requested: size,
    n: slice.length,
    observed: compactMetric(keeperMetrics(slice)),
    nullMean: compactMetric(keeperNullMeans(slice)),
  };
}

function watchModel(model) {
  const recent = model.rolling?.[10];
  if (!recent || recent.n < 10) return null;
  const obs = recent.observed || {};
  const nul = recent.nullMean || {};
  const exactLift = Number(obs.exactTop3Rate || 0) - Number(nul.exactTop3Rate || 0);
  const overlapLift = Number(obs.meanDigitOverlap || 0) - Number(nul.meanDigitOverlap || 0);
  const positionLift = Number(obs.meanPositionHits || 0) - Number(nul.meanPositionHits || 0);
  if (exactLift >= 0.02 || overlapLift >= 0.15 || positionLift >= 0.10) {
    const reasons = [];
    if (exactLift >= 0.02) reasons.push(`Exact +${(exactLift * 100).toFixed(1)}pp vs rolling null`);
    if (overlapLift >= 0.15) reasons.push(`Overlap +${overlapLift.toFixed(2)} vs rolling null`);
    if (positionLift >= 0.10) reasons.push(`Position +${positionLift.toFixed(2)} vs rolling null`);
    return { id: model.id, label: model.label, kind: "model", status: "WATCH", window: 10, reasons };
  }
  return null;
}

function watchKeeper(keeper) {
  const recent = keeper?.rolling?.[10];
  if (!recent || recent.n < 10) return null;
  const obs = recent.observed || {};
  const nul = recent.nullMean || {};
  const all3Lift = Number(obs.all3Rate || 0) - Number(nul.all3Rate || 0);
  const coverageLift = Number(obs.meanCoverage || 0) - Number(nul.meanCoverage || 0);
  if (all3Lift >= 0.05 || coverageLift >= 0.15) {
    const reasons = [];
    if (all3Lift >= 0.05) reasons.push(`ALL3 +${(all3Lift * 100).toFixed(1)}pp vs rolling null`);
    if (coverageLift >= 0.15) reasons.push(`Coverage +${coverageLift.toFixed(2)} vs rolling null`);
    return { id: "keeper7", label: "Keeper7", kind: "keeper", status: "WATCH", window: 10, reasons };
  }
  return null;
}

function analyzeSource(records, pendingCount) {
  const settled = records.filter((r) => r.status === "settled" && r.actual && r.lockedBeforeResult);
  const modelMap = new Map();
  const keeperEntries = [];

  settled.forEach((record) => {
    for (const model of record.models || []) {
      if (!modelMap.has(model.id)) modelMap.set(model.id, { id: model.id, label: model.label, entries: [] });
      modelMap.get(model.id).entries.push({ record, model });
    }
    if (record.keeper) keeperEntries.push({ record });
  });

  const models = [...modelMap.values()].map((model) => {
    const rolling = Object.fromEntries(WINDOWS.map((w) => [w, modelWindow(model.entries, w)]));
    return {
      id: model.id,
      label: model.label,
      n: model.entries.length,
      lifetime: compactMetric(modelMetrics(model.entries)),
      rolling,
    };
  });

  const keeper7 = keeperEntries.length ? {
    n: keeperEntries.length,
    lifetime: compactMetric(keeperMetrics(keeperEntries)),
    rolling: Object.fromEntries(WINDOWS.map((w) => [w, keeperWindow(keeperEntries, w)])),
  } : null;

  const watchlist = models.map(watchModel).filter(Boolean);
  const keeperWatch = watchKeeper(keeper7);
  if (keeperWatch) watchlist.push(keeperWatch);

  const n = settled.length;
  return {
    settled: n,
    pending: pendingCount,
    gate: gateForN(n),
    progress: progressForN(n),
    firstAnchorPeriod: settled[0]?.anchorPeriod ?? null,
    lastAnchorPeriod: settled[settled.length - 1]?.anchorPeriod ?? null,
    models,
    keeper7,
    watchlist,
    status: watchlist.length ? "WATCH · DESCRIPTIVE ONLY" : "NO CLAIM",
  };
}

export function analyzeEvidenceRecords(recordsInput) {
  const records = (Array.isArray(recordsInput) ? recordsInput : []).filter(Boolean).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const pending = {
    utama: records.filter((r) => r.source === "utama" && r.status === "pending" && r.lockedBeforeResult).length,
    europe: records.filter((r) => r.source === "europe" && r.status === "pending" && r.lockedBeforeResult).length,
  };
  const bySource = {
    utama: analyzeSource(records.filter((r) => r.source === "utama"), pending.utama),
    europe: analyzeSource(records.filter((r) => r.source === "europe"), pending.europe),
  };
  const totalSettled = bySource.utama.settled + bySource.europe.settled;
  const totalPending = pending.utama + pending.europe;
  const nextReady = ["utama", "europe"].map((source) => ({ source, remaining: bySource[source].progress.remaining, next: bySource[source].progress.nextMilestone })).sort((a, b) => a.remaining - b.remaining)[0];

  return {
    ok: true,
    version: EVIDENCE_MONITOR_VERSION,
    mode: "READ_ONLY_EVIDENCE_MONITOR",
    totalSettled,
    totalPending,
    bySource,
    nextReady,
    policy: {
      lockedBeforeResultOnly: true,
      settledMetricsOnly: true,
      pendingCountOnly: true,
      databaseWrites: false,
      changesPredictionWeights: false,
      changesAiV2: false,
      changesKeeper7: false,
      changesAdaptive: false,
      rollingWindows: WINDOWS,
      gates: ["COLLECT <24", "EARLY 24-49", "PROVISIONAL 50-99", "EVIDENCE 100-199", "STRONGER TEST 200+"],
      watchlistMeaning: "Descriptive monitoring only; WATCH is not a statistical edge claim. Edge claims belong to Forward Edge Audit calibration.",
      rollingNull: "Exact finite-sample permutation mean within each rolling window; no p-value is produced here.",
    },
  };
}

export async function getEvidenceMonitor(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Evidence Monitor.");
  const query = await env.DB.prepare(`
    SELECT id, source, status, source_lock_created_at, source_status_at_capture,
           anchor_period, target_period, settled_at, actual_result, features_json
    FROM ai_v2_observations
    WHERE source_status_at_capture='pending'
    ORDER BY id ASC
    LIMIT ?
  `).bind(MAX_ROWS).all();
  const records = (query.results || []).map(recordFromRow).filter(Boolean);
  return {
    ...analyzeEvidenceRecords(records),
    generatedAt: new Date().toISOString(),
    dataset: {
      rows: records.length,
      source: "D1 ai_v2_observations",
    },
  };
}
