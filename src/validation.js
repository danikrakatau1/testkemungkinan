import { evaluateAgainstRandom, rankHistory, sanitizeHistory } from "./analyzer.js";

const BASE_MODELS = [
  { id: "balanced", label: "Balanced", description: "Baseline seimbang: posisi + transisi + pasangan + frekuensi global." },
  { id: "position", label: "Position Focus", description: "Lebih berat ke pola digit per posisi ratusan, puluhan, dan satuan." },
  { id: "transition", label: "Transition Focus", description: "Lebih berat ke transisi digit dari draw sebelumnya." },
  { id: "pair", label: "Pair Focus", description: "Lebih berat ke pasangan digit bersebelahan 1–2 dan 2–3." },
];

const RANDOM_MEAN_RANK = 500.5;
const CPU_SAFE_TRIAL_CAP = 36;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function pct(value, total) {
  if (!total) return 0;
  return round((value / total) * 100, 2);
}

function createStats(model = {}) {
  return {
    id: model.id,
    label: model.label,
    description: model.description,
    trials: 0,
    top3Hits: 0,
    top10Hits: 0,
    top25Hits: 0,
    rankSum: 0,
  };
}

function addRankToStats(stats, rank) {
  stats.trials += 1;
  stats.rankSum += rank;
  if (rank <= 3) stats.top3Hits += 1;
  if (rank <= 10) stats.top10Hits += 1;
  if (rank <= 25) stats.top25Hits += 1;
}

function summarizeStats(stats) {
  const trials = stats.trials || 0;
  return {
    trials,
    top3Hits: stats.top3Hits || 0,
    top10Hits: stats.top10Hits || 0,
    top25Hits: stats.top25Hits || 0,
    top3HitRatePct: pct(stats.top3Hits || 0, trials),
    top10HitRatePct: pct(stats.top10Hits || 0, trials),
    top25HitRatePct: pct(stats.top25Hits || 0, trials),
    meanTargetRank: trials ? round(stats.rankSum / trials, 2) : 1000,
  };
}

function rankBaseModels(history, options = {}) {
  const rankings = {};
  for (const model of BASE_MODELS) {
    rankings[model.id] = rankHistory(history, { ...options, modelId: model.id }).ranking;
  }
  return rankings;
}

function rankArrays(rankings) {
  const arrays = {};
  for (const model of BASE_MODELS) {
    const arr = new Uint16Array(1000);
    for (const row of rankings[model.id]) arr[Number(row.number)] = row.rank;
    arrays[model.id] = arr;
  }
  return arrays;
}

function normalizeWeights(weights = {}) {
  const total = BASE_MODELS.reduce((sum, model) => sum + Math.max(0, Number(weights[model.id] || 0)), 0) || 1;
  return Object.fromEntries(BASE_MODELS.map((model) => [model.id, Math.max(0, Number(weights[model.id] || 0)) / total]));
}

function fusedScore(number, arrays, weights) {
  let score = 0;
  for (const model of BASE_MODELS) {
    const rank = arrays[model.id][number] || 1000;
    score += ((1001 - rank) / 1000) * weights[model.id];
  }
  return score;
}

function fusedTargetRank(target, rankings, weights) {
  const arrays = rankArrays(rankings);
  const normalized = normalizeWeights(weights);
  const targetNumber = Number(target);
  const targetScore = fusedScore(targetNumber, arrays, normalized);
  let better = 0;
  const epsilon = 1e-12;

  for (let n = 0; n <= 999; n += 1) {
    if (n === targetNumber) continue;
    const score = fusedScore(n, arrays, normalized);
    if (score > targetScore + epsilon || (Math.abs(score - targetScore) <= epsilon && n < targetNumber)) better += 1;
  }
  return better + 1;
}

function fusedCurrentRanking(rankings, weights) {
  const arrays = rankArrays(rankings);
  const normalized = normalizeWeights(weights);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    rows.push({ number: String(n).padStart(3, "0"), raw: fusedScore(n, arrays, normalized) });
  }
  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));
  const max = rows[0]?.raw || 1;
  const min = rows.at(-1)?.raw || 0;
  const span = Math.max(max - min, Number.EPSILON);
  return rows.map((row, index) => ({
    rank: index + 1,
    number: row.number,
    score: round(((row.raw - min) / span) * 100, 2),
  }));
}

function calibrationSummaries(history, options, indices) {
  const stats = Object.fromEntries(BASE_MODELS.map((model) => [model.id, createStats(model)]));

  for (const targetIndex of indices) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankBaseModels(training, options);
    for (const model of BASE_MODELS) {
      const rank = rankings[model.id].find((row) => row.number === target)?.rank ?? 1000;
      addRankToStats(stats[model.id], rank);
    }
  }

  return BASE_MODELS.map((model) => {
    const summary = summarizeStats(stats[model.id]);
    return {
      id: model.id,
      label: model.label,
      description: model.description,
      ...summary,
      evidence: evaluateAgainstRandom(summary),
    };
  });
}

function deriveCalibrationWeights(rows) {
  const raw = {};
  for (const row of rows) {
    const shrink = row.trials / (row.trials + 40);
    const rankSignal = clamp((RANDOM_MEAN_RANK - row.meanTargetRank) / 250, -1, 1);
    const hit3Signal = clamp((row.top3HitRatePct - 0.3) / 3, -1, 2);
    const hit10Signal = clamp((row.top10HitRatePct - 1) / 5, -1, 2);
    const hit25Signal = clamp((row.top25HitRatePct - 2.5) / 10, -1, 2);
    const evidenceSignal = rankSignal * 0.45 + hit10Signal * 0.25 + hit25Signal * 0.15 + hit3Signal * 0.15;
    raw[row.id] = Math.max(0.25, 1 + shrink * evidenceSignal);
  }
  return normalizeWeights(raw);
}

function evaluateHoldout(history, options, indices, weights) {
  const weightedStats = createStats({ id: "weighted", label: "Validated Weighted Ensemble" });
  const bordaStats = createStats({ id: "ensemble", label: "Ensemble Borda" });
  const equal = Object.fromEntries(BASE_MODELS.map((model) => [model.id, 1 / BASE_MODELS.length]));
  const trials = [];

  for (const targetIndex of indices) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankBaseModels(training, options);
    const weightedRank = fusedTargetRank(target, rankings, weights);
    const bordaRank = fusedTargetRank(target, rankings, equal);
    addRankToStats(weightedStats, weightedRank);
    addRankToStats(bordaStats, bordaRank);
    trials.push({ target, weightedRank, bordaRank });
  }

  const weighted = summarizeStats(weightedStats);
  const borda = summarizeStats(bordaStats);
  return {
    weighted: { ...weighted, evidence: evaluateAgainstRandom(weighted) },
    borda: { ...borda, evidence: evaluateAgainstRandom(borda) },
    trials,
  };
}

export function validateWeightedEnsemble(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const minTrain = clampInteger(options.minTrain, 8, 3, 1000);
  const requestedMax = clampInteger(options.maxTrials, 60, 1, 120);
  const sourceEligible = Math.min(Math.max(0, history.length - minTrain), requestedMax);

  if (sourceEligible < 16) {
    throw new Error("Validation Gate memerlukan minimal 16 target eligible. Tambahkan histori D1 atau turunkan Min Train.");
  }

  // Keep validation below Cloudflare Worker CPU ceilings. The newest targets remain
  // locked holdout; calibration uses the immediately older targets only.
  const evaluatedTrials = Math.min(sourceEligible, CPU_SAFE_TRIAL_CAP);
  const defaultHoldout = clamp(Math.floor(evaluatedTrials * 0.28), 10, 12);
  const requestedHoldout = clampInteger(options.holdoutTrials, defaultHoldout, 8, 14);
  const holdoutTrials = Math.min(requestedHoldout, evaluatedTrials - 12);
  const calibrationTrials = evaluatedTrials - holdoutTrials;

  const holdoutIndices = Array.from({ length: holdoutTrials }, (_, index) => index);
  const calibrationIndices = Array.from({ length: calibrationTrials }, (_, index) => holdoutTrials + index);

  const calibration = calibrationSummaries(history, options, calibrationIndices);
  const weights = deriveCalibrationWeights(calibration);
  const holdout = evaluateHoldout(history, options, holdoutIndices, weights);
  const currentBaseRankings = rankBaseModels(history, options);
  const currentWeightedRanking = fusedCurrentRanking(currentBaseRankings, weights);

  const weightedEvidence = holdout.weighted.evidence;
  const passed = (
    calibrationTrials >= 20 &&
    holdoutTrials >= 10 &&
    weightedEvidence.meanRankDelta > 0 &&
    weightedEvidence.pValues.top10 <= 0.10 &&
    weightedEvidence.pValues.meanRank <= 0.20
  );

  let gateLabel = "LOCKED · belum lolos holdout";
  let gateReason = "Weighted ensemble belum boleh dipromosikan karena bukti holdout belum cukup kuat dibanding baseline random.";
  if (passed) {
    gateLabel = "VALIDATED · weighted ensemble unlocked";
    gateReason = "Calibration weights berhasil melewati holdout gate konservatif. Tetap bukan jaminan hasil berikutnya.";
  } else if (holdoutTrials < 10 || calibrationTrials < 20) {
    gateLabel = "LOCKED · data split belum cukup";
    gateReason = "Butuh setidaknya 20 calibration trials dan 10 holdout trials sebelum weighted ensemble dapat di-unlock.";
  }

  return {
    meta: {
      version: "0.5.1",
      method: "cpu-safe-chronological-calibration-plus-locked-newest-holdout",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials: requestedMax,
      sourceEligibleTrials: sourceEligible,
      eligibleTrials: evaluatedTrials,
      calibrationTrials,
      holdoutTrials,
      cpuSafeTrialCap: CPU_SAFE_TRIAL_CAP,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      randomMeanRank: RANDOM_MEAN_RANK,
      note: "Bobot ditentukan hanya dari calibration targets yang lebih lama. Holdout target terbaru tidak dipakai untuk tuning. Trial validation dibatasi agar aman pada CPU Cloudflare Worker.",
    },
    gate: {
      passed,
      status: passed ? "validated" : "locked",
      label: gateLabel,
      reason: gateReason,
      criteria: {
        minCalibrationTrials: 20,
        minHoldoutTrials: 10,
        meanRankBetterThanRandom: true,
        top10PValueAtMost: 0.10,
        meanRankPValueAtMost: 0.20,
      },
    },
    weights: BASE_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      weight: round(weights[model.id], 4),
      weightPct: round(weights[model.id] * 100, 2),
    })),
    calibration,
    holdout,
    currentWeighted: {
      experimental: !passed,
      top3: currentWeightedRanking.slice(0, 3),
      top10: currentWeightedRanking.slice(0, 10),
    },
  };
}
