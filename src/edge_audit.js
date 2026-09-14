export const FORWARD_EDGE_AUDIT_VERSION = "1.0.0";

const DEFAULT_SIMULATIONS = 1000;
const MAX_SIMULATIONS = 2500;
const MAX_ROWS = 2000;

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

function digitsSorted(value) {
  return String(value || "").split("").sort().join("");
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
  const assistedTop3 = normalizeList(keeper?.assistedTop3, 3);
  return keep7.length === 7 ? { keep7, drop3, assistedTop3 } : null;
}

function observationToRecord(row) {
  if (String(row.source_status_at_capture || "") !== "pending") return null;
  const actual = normalize3(row.actual_result);
  if (!actual) return null;
  const source = String(row.source || "").toLowerCase();
  if (source !== "utama" && source !== "europe") return null;
  const features = parseJson(row.features_json, {});
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

  const keeper = normalizeKeeper(features.keeper7 || {});
  if (keeper?.assistedTop3?.length) {
    models.push({ id: "3d-assist", label: "3D Assist", top3: keeper.assistedTop3, top10: [] });
  }

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
    anchorPeriod: Number(row.anchor_period),
    targetPeriod: row.target_period == null ? null : Number(row.target_period),
    lockedAt: row.source_lock_created_at,
    settledAt: row.settled_at,
    actual,
    models: deduped,
    keeper,
  };
}

function scoreModel(model, actual) {
  const top3 = model.top3 || [];
  const top10 = model.top10 || [];
  let bestOverlap = 0;
  let bestPosition = 0;
  let permutation = false;
  for (const candidate of top3) {
    bestOverlap = Math.max(bestOverlap, digitOverlap(candidate, actual));
    bestPosition = Math.max(bestPosition, positionHits(candidate, actual));
    if (digitsSorted(candidate) === digitsSorted(actual)) permutation = true;
  }
  return {
    exactTop3: top3.includes(actual) ? 1 : 0,
    top10Hit: top10.length ? (top10.includes(actual) ? 1 : 0) : null,
    permutationHit: permutation ? 1 : 0,
    digitOverlap: bestOverlap,
    positionHits: bestPosition,
  };
}

function scoreKeeper(keeper, actual) {
  const allowed = new Set(keeper.keep7 || []);
  const covered = [...actual].reduce((sum, ch) => sum + Number(allowed.has(Number(ch))), 0);
  return { all3: covered === 3 ? 1 : 0, coverage: covered };
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function modelMetrics(entries, actuals) {
  const exact = [];
  const top10 = [];
  const permutation = [];
  const overlap = [];
  const positions = [];
  for (const entry of entries) {
    const actual = actuals[entry.index];
    if (!actual) continue;
    const score = scoreModel(entry.model, actual);
    exact.push(score.exactTop3);
    if (score.top10Hit != null) top10.push(score.top10Hit);
    permutation.push(score.permutationHit);
    overlap.push(score.digitOverlap);
    positions.push(score.positionHits);
  }
  return {
    n: exact.length,
    exactTop3Rate: mean(exact),
    top10Rate: mean(top10),
    top10N: top10.length,
    permutationRate: mean(permutation),
    meanDigitOverlap: mean(overlap),
    meanPositionHits: mean(positions),
  };
}

function keeperMetrics(entries, actuals) {
  const all3 = [];
  const coverage = [];
  for (const entry of entries) {
    const actual = actuals[entry.index];
    if (!actual) continue;
    const score = scoreKeeper(entry.keeper, actual);
    all3.push(score.all3);
    coverage.push(score.coverage);
  }
  return { n: all3.length, all3Rate: mean(all3), meanCoverage: mean(coverage) };
}

function metricDefinitions(kind, observed) {
  if (kind === "keeper") {
    return [
      ["all3Rate", observed.all3Rate],
      ["meanCoverage", observed.meanCoverage],
    ].filter(([, value]) => value != null);
  }
  return [
    ["exactTop3Rate", observed.exactTop3Rate],
    ["top10Rate", observed.top10N > 0 ? observed.top10Rate : null],
    ["permutationRate", observed.permutationRate],
    ["meanDigitOverlap", observed.meanDigitOverlap],
    ["meanPositionHits", observed.meanPositionHits],
  ].filter(([, value]) => value != null);
}

function seedFromRecords(records) {
  let hash = 2166136261 >>> 0;
  for (const row of records) {
    const text = `${row.source}:${row.anchorPeriod}:${row.actual}|`;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash || 0x9e3779b9;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function gateForN(n) {
  if (n < 24) return { code: "COLLECT", label: "COLLECT", note: "<24 settled forward; terlalu kecil untuk edge claim." };
  if (n < 50) return { code: "EARLY", label: "EARLY", note: "24–49 settled forward; hanya screening awal." };
  if (n < 100) return { code: "PROVISIONAL", label: "PROVISIONAL", note: "50–99 settled forward; edge masih provisional." };
  if (n < 200) return { code: "EVIDENCE", label: "EVIDENCE", note: "100–199 settled forward; cukup untuk evidence awal yang lebih serius." };
  return { code: "STRONGER_TEST", label: "STRONGER TEST", note: "200+ settled forward; calibration lebih bermakna, tetap bukan jaminan prediktif." };
}

function round(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function empiricalMetric(observed, nullValues, simulations) {
  if (observed == null || !nullValues.length || !simulations) return { observed: round(observed), nullMean: null, empiricalP: null };
  let exceed = 0;
  let total = 0;
  for (const value of nullValues) {
    if (!Number.isFinite(value)) continue;
    total += value;
    if (value >= observed - 1e-12) exceed += 1;
  }
  return {
    observed: round(observed),
    nullMean: round(total / nullValues.length),
    empiricalP: round((exceed + 1) / (nullValues.length + 1), 6),
  };
}

function metricOnSlice(kind, entries, actuals, metricKey) {
  const metrics = kind === "keeper" ? keeperMetrics(entries, actuals) : modelMetrics(entries, actuals);
  return metrics[metricKey];
}

function finalizeCandidate(candidate, familySize, actuals) {
  const metricRows = candidate.metrics;
  const valid = Object.entries(metricRows).filter(([, row]) => row?.empiricalP != null);
  const strongest = valid.length ? valid.reduce((best, item) => item[1].empiricalP < best[1].empiricalP ? item : best) : null;
  const strongestKey = strongest?.[0] || null;
  const strongestP = strongest?.[1]?.empiricalP ?? null;
  const adjustedP = strongestP == null ? null : Math.min(1, strongestP * Math.max(1, familySize));

  const midpoint = Math.floor(candidate.entries.length / 2);
  const first = candidate.entries.slice(0, midpoint);
  const second = candidate.entries.slice(midpoint);
  let replicated = false;
  let replication = null;
  if (strongestKey && first.length >= 5 && second.length >= 5) {
    const nullMean = metricRows[strongestKey]?.nullMean;
    const firstValue = metricOnSlice(candidate.kind, first, actuals, strongestKey);
    const secondValue = metricOnSlice(candidate.kind, second, actuals, strongestKey);
    replicated = nullMean != null && firstValue != null && secondValue != null && firstValue > nullMean && secondValue > nullMean;
    replication = { metric: strongestKey, firstHalf: round(firstValue), secondHalf: round(secondValue), nullMean: round(nullMean), sameDirectionAboveNull: replicated };
  }

  const n = candidate.observed.n || 0;
  const gate = gateForN(n);
  let verdict = "INSUFFICIENT_FORWARD_SAMPLE";
  if (n >= 50) {
    if (adjustedP != null && adjustedP < 0.05 && replicated) verdict = n >= 100 && adjustedP < 0.01 ? "CALIBRATED_EDGE_CANDIDATE" : "POSSIBLE_EDGE_REPLICATE";
    else verdict = "NO_CALIBRATED_EDGE";
  }

  return {
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    n,
    gate,
    observed: Object.fromEntries(Object.entries(candidate.observed).map(([k, v]) => [k, round(v)])),
    metrics: metricRows,
    strongestMetric: strongestKey,
    strongestEmpiricalP: strongestP,
    familyAdjustedP: round(adjustedP, 6),
    replication,
    verdict,
  };
}

function analyzeSource(records, simulations, random) {
  const actuals = records.map((r) => r.actual);
  const modelMap = new Map();
  const keeperEntries = [];

  records.forEach((record, index) => {
    for (const model of record.models || []) {
      if (!modelMap.has(model.id)) modelMap.set(model.id, { id: model.id, label: model.label, entries: [] });
      modelMap.get(model.id).entries.push({ index, model });
    }
    if (record.keeper) keeperEntries.push({ index, keeper: record.keeper });
  });

  const candidates = [];
  for (const model of modelMap.values()) {
    const observed = modelMetrics(model.entries, actuals);
    candidates.push({ id: model.id, label: model.label, kind: "model", entries: model.entries, observed, metrics: {}, null: {} });
  }
  if (keeperEntries.length) {
    candidates.push({ id: "keeper7", label: "Keeper7", kind: "keeper", entries: keeperEntries, observed: keeperMetrics(keeperEntries, actuals), metrics: {}, null: {} });
  }

  for (const candidate of candidates) {
    for (const [key] of metricDefinitions(candidate.kind, candidate.observed)) candidate.null[key] = [];
  }

  if (simulations > 0 && actuals.length > 1) {
    for (let s = 0; s < simulations; s += 1) {
      const shuffledActuals = shuffled(actuals, random);
      for (const candidate of candidates) {
        const metrics = candidate.kind === "keeper" ? keeperMetrics(candidate.entries, shuffledActuals) : modelMetrics(candidate.entries, shuffledActuals);
        for (const key of Object.keys(candidate.null)) candidate.null[key].push(metrics[key]);
      }
    }
  }

  let familySize = 0;
  for (const candidate of candidates) {
    for (const [key, observedValue] of metricDefinitions(candidate.kind, candidate.observed)) {
      candidate.metrics[key] = empiricalMetric(observedValue, candidate.null[key] || [], simulations);
      if (candidate.metrics[key].empiricalP != null) familySize += 1;
    }
  }

  const finalized = candidates.map((candidate) => finalizeCandidate(candidate, familySize, actuals));
  const models = finalized.filter((c) => c.kind === "model");
  const keeper7 = finalized.find((c) => c.kind === "keeper") || null;
  const gate = gateForN(records.length);
  const candidatesWithEdge = finalized.filter((c) => c.verdict === "CALIBRATED_EDGE_CANDIDATE" || c.verdict === "POSSIBLE_EDGE_REPLICATE");
  let verdict = "COLLECT_MORE_FORWARD_DATA";
  if (records.length >= 50) verdict = candidatesWithEdge.length ? "EDGE_SIGNAL_REQUIRES_REPLICATION" : "NO_CALIBRATED_EDGE";

  return {
    n: records.length,
    firstAnchorPeriod: records[0]?.anchorPeriod ?? null,
    lastAnchorPeriod: records[records.length - 1]?.anchorPeriod ?? null,
    gate,
    verdict,
    familySize,
    models,
    keeper7,
    edgeCandidates: candidatesWithEdge.map((c) => ({ id: c.id, label: c.label, adjustedP: c.familyAdjustedP, verdict: c.verdict })),
  };
}

export function analyzeForwardEdge(recordsInput, options = {}) {
  const records = (Array.isArray(recordsInput) ? recordsInput : []).filter((r) => r?.source && r?.actual).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const simulations = Math.max(0, Math.min(MAX_SIMULATIONS, Number(options.simulations ?? DEFAULT_SIMULATIONS) | 0));
  const random = mulberry32(seedFromRecords(records));
  const bySource = {
    utama: analyzeSource(records.filter((r) => r.source === "utama"), simulations, random),
    europe: analyzeSource(records.filter((r) => r.source === "europe"), simulations, random),
  };
  const sourcesWithEnough = Object.values(bySource).filter((s) => s.n >= 50);
  const anyEdge = Object.values(bySource).some((s) => s.edgeCandidates.length > 0);
  const overallVerdict = !sourcesWithEnough.length ? "COLLECT_MORE_FORWARD_DATA" : anyEdge ? "EDGE_SIGNAL_REQUIRES_REPLICATION" : "NO_CALIBRATED_FORWARD_EDGE";

  return {
    ok: true,
    version: FORWARD_EDGE_AUDIT_VERSION,
    mode: "READ_ONLY_FORWARD_EDGE_AUDIT",
    simulations,
    empiricalResolution: simulations ? round(1 / (simulations + 1), 7) : null,
    overallVerdict,
    bySource,
    policy: {
      lockedBeforeResultOnly: true,
      sourceStatusAtCaptureMustBePending: true,
      databaseWrites: false,
      changesPredictionWeights: false,
      changesAiV2: false,
      changesKeeper7: false,
      changesAdaptive: false,
      nullModel: "shuffle settled actual results across original forward locks within the same source",
      multipleTesting: "Bonferroni family adjustment across all tested model/Keeper7 metrics within each source",
      replicationGuard: "strongest metric must be above its calibrated null mean in both chronological halves before an edge signal can pass",
    },
  };
}

export async function getForwardEdgeAudit(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Forward Edge Audit.");
  const query = await env.DB.prepare(`
    SELECT id, source, source_lock_created_at, anchor_period, target_period,
           settled_at, actual_result, source_status_at_capture, features_json
    FROM ai_v2_observations
    WHERE status='settled' AND source_status_at_capture='pending' AND actual_result IS NOT NULL
    ORDER BY id ASC
    LIMIT ?
  `).bind(MAX_ROWS).all();
  const records = (query.results || []).map(observationToRecord).filter(Boolean);
  const report = analyzeForwardEdge(records, options);
  return {
    ...report,
    generatedAt: new Date().toISOString(),
    dataset: {
      totalSettledLockedObservations: records.length,
      utama: records.filter((r) => r.source === "utama").length,
      europe: records.filter((r) => r.source === "europe").length,
    },
    source: "D1 ai_v2_observations · settled forward locks only",
  };
}
