import { evaluateAgainstRandom, rankHistory, sanitizeHistory } from "./analyzer.js";

const BASE_MODELS = [
  { id: "balanced", label: "Balanced", description: "Baseline seimbang: posisi + transisi + pasangan + frekuensi global." },
  { id: "position", label: "Position Focus", description: "Lebih berat ke pola digit per posisi ratusan, puluhan, dan satuan." },
  { id: "transition", label: "Transition Focus", description: "Lebih berat ke transisi digit dari draw sebelumnya." },
  { id: "pair", label: "Pair Focus", description: "Lebih berat ke pasangan digit bersebelahan 1–2 dan 2–3." },
];

const RANDOM_MEAN_RANK = 500.5;
const WINDOW_TARGETS = 18;
const CALIBRATION_TARGETS = 12;
const HOLDOUT_TARGETS = 6;
const TRAINING_WINDOW = 80;

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
  return total ? round((value / total) * 100, 2) : 0;
}

function stats() {
  return { trials: 0, top3Hits: 0, top10Hits: 0, top25Hits: 0, rankSum: 0 };
}

function add(statsRow, rank) {
  statsRow.trials += 1;
  statsRow.rankSum += rank;
  if (rank <= 3) statsRow.top3Hits += 1;
  if (rank <= 10) statsRow.top10Hits += 1;
  if (rank <= 25) statsRow.top25Hits += 1;
}

function summarize(statsRow) {
  const trials = statsRow.trials || 0;
  return {
    trials,
    top3Hits: statsRow.top3Hits || 0,
    top10Hits: statsRow.top10Hits || 0,
    top25Hits: statsRow.top25Hits || 0,
    top3HitRatePct: pct(statsRow.top3Hits || 0, trials),
    top10HitRatePct: pct(statsRow.top10Hits || 0, trials),
    top25HitRatePct: pct(statsRow.top25Hits || 0, trials),
    meanTargetRank: trials ? round(statsRow.rankSum / trials, 2) : 1000,
  };
}

function normalizeWeights(weights = {}) {
  const total = BASE_MODELS.reduce((sum, model) => sum + Math.max(0, Number(weights[model.id] || 0)), 0) || 1;
  return Object.fromEntries(BASE_MODELS.map((model) => [model.id, Math.max(0, Number(weights[model.id] || 0)) / total]));
}

function trainingSlice(history, targetIndex) {
  const start = targetIndex + 1;
  return history.slice(start, Math.min(history.length, start + TRAINING_WINDOW));
}

function rankArrays(training, options = {}) {
  const arrays = {};
  for (const model of BASE_MODELS) {
    const arr = new Uint16Array(1000);
    const ranking = rankHistory(training, { ...options, modelId: model.id }).ranking;
    for (const row of ranking) arr[Number(row.number)] = row.rank;
    arrays[model.id] = arr;
  }
  return arrays;
}

function fusedScore(number, arrays, weights) {
  let score = 0;
  for (const model of BASE_MODELS) {
    const rank = arrays[model.id][number] || 1000;
    score += ((1001 - rank) / 1000) * weights[model.id];
  }
  return score;
}

function fusedRanks(target, arrays, weights, equalWeights) {
  const targetNumber = Number(target);
  const weightedTarget = fusedScore(targetNumber, arrays, weights);
  const bordaTarget = fusedScore(targetNumber, arrays, equalWeights);
  let weightedBetter = 0;
  let bordaBetter = 0;
  const epsilon = 1e-12;

  for (let n = 0; n <= 999; n += 1) {
    if (n === targetNumber) continue;
    const weighted = fusedScore(n, arrays, weights);
    const borda = fusedScore(n, arrays, equalWeights);
    if (weighted > weightedTarget + epsilon || (Math.abs(weighted - weightedTarget) <= epsilon && n < targetNumber)) weightedBetter += 1;
    if (borda > bordaTarget + epsilon || (Math.abs(borda - bordaTarget) <= epsilon && n < targetNumber)) bordaBetter += 1;
  }

  return { weightedRank: weightedBetter + 1, bordaRank: bordaBetter + 1 };
}

function deriveWeights(calibrationRows) {
  const raw = {};
  for (const row of calibrationRows) {
    const shrink = row.trials / (row.trials + 40);
    const rankSignal = clamp((RANDOM_MEAN_RANK - row.meanTargetRank) / 250, -1, 1);
    const hit3Signal = clamp((row.top3HitRatePct - 0.3) / 3, -1, 2);
    const hit10Signal = clamp((row.top10HitRatePct - 1) / 5, -1, 2);
    const hit25Signal = clamp((row.top25HitRatePct - 2.5) / 10, -1, 2);
    const signal = rankSignal * 0.45 + hit10Signal * 0.25 + hit25Signal * 0.15 + hit3Signal * 0.15;
    raw[row.id] = Math.max(0.25, 1 + shrink * signal);
  }
  return normalizeWeights(raw);
}

function currentTop3(history, options, weights) {
  const arrays = rankArrays(history.slice(0, TRAINING_WINDOW), options);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    rows.push({ number: String(n).padStart(3, "0"), raw: fusedScore(n, arrays, weights) });
  }
  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));
  const max = rows[0]?.raw || 1;
  const min = rows.at(-1)?.raw || 0;
  const span = Math.max(max - min, Number.EPSILON);
  return rows.slice(0, 3).map((row, index) => ({
    rank: index + 1,
    number: row.number,
    score: round(((row.raw - min) / span) * 100, 2),
  }));
}

export function validateWalkForwardWindow(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const minTrain = clampInteger(options.minTrain, 8, 3, 80);
  const decay = Number(options.decay);
  const rankingOptions = { decay: Number.isFinite(decay) ? decay : 0.9 };

  if (history.length < WINDOW_TARGETS + minTrain) {
    throw new Error(`Window validation membutuhkan minimal ${WINDOW_TARGETS + minTrain} draw pada slice ini.`);
  }

  const calibrationStats = Object.fromEntries(BASE_MODELS.map((model) => [model.id, stats()]));
  const calibrationIndices = Array.from({ length: CALIBRATION_TARGETS }, (_, i) => HOLDOUT_TARGETS + i);

  for (const targetIndex of calibrationIndices) {
    const target = history[targetIndex];
    const training = trainingSlice(history, targetIndex);
    if (training.length < minTrain) throw new Error("Training window terlalu pendek untuk calibration.");
    const arrays = rankArrays(training, rankingOptions);
    const targetNumber = Number(target);
    for (const model of BASE_MODELS) add(calibrationStats[model.id], arrays[model.id][targetNumber] || 1000);
  }

  const calibration = BASE_MODELS.map((model) => {
    const summary = summarize(calibrationStats[model.id]);
    return {
      id: model.id,
      label: model.label,
      description: model.description,
      ...summary,
      evidence: evaluateAgainstRandom(summary),
    };
  });

  const weights = deriveWeights(calibration);
  const equalWeights = Object.fromEntries(BASE_MODELS.map((model) => [model.id, 1 / BASE_MODELS.length]));
  const weightedStats = stats();
  const bordaStats = stats();
  const trials = [];

  for (let targetIndex = 0; targetIndex < HOLDOUT_TARGETS; targetIndex += 1) {
    const target = history[targetIndex];
    const training = trainingSlice(history, targetIndex);
    if (training.length < minTrain) throw new Error("Training window terlalu pendek untuk holdout.");
    const arrays = rankArrays(training, rankingOptions);
    const ranks = fusedRanks(target, arrays, weights, equalWeights);
    add(weightedStats, ranks.weightedRank);
    add(bordaStats, ranks.bordaRank);
    trials.push({ target, ...ranks, trainingDraws: training.length });
  }

  const weightedSummary = summarize(weightedStats);
  const bordaSummary = summarize(bordaStats);
  const weightedEvidence = evaluateAgainstRandom(weightedSummary);
  const bordaEvidence = evaluateAgainstRandom(bordaSummary);

  const passed = (
    weightedEvidence.meanRankDelta > 0 &&
    weightedEvidence.pValues.top10 <= 0.20 &&
    weightedEvidence.pValues.meanRank <= 0.25
  );

  return {
    meta: {
      version: "0.6.1",
      method: "lightweight-walk-forward-window",
      sourceDraws: history.length,
      evaluatedTargets: WINDOW_TARGETS,
      calibrationTrials: CALIBRATION_TARGETS,
      holdoutTrials: HOLDOUT_TARGETS,
      trainingWindowDraws: TRAINING_WINDOW,
      minTrain,
      note: "Mode multi-window ringan: 12 calibration + 6 locked holdout dengan maksimum 80 draw training per target. Aggregate lintas window adalah evaluator utama.",
    },
    gate: {
      passed,
      status: passed ? "validated" : "locked",
      label: passed ? "WINDOW PASS" : "WINDOW LOCKED",
      reason: "Gate per-window hanya diagnostik; keputusan utama memakai aggregate multi-window.",
    },
    weights: BASE_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      weight: round(weights[model.id], 4),
      weightPct: round(weights[model.id] * 100, 2),
    })),
    calibration,
    holdout: {
      weighted: { ...weightedSummary, evidence: weightedEvidence },
      borda: { ...bordaSummary, evidence: bordaEvidence },
      trials,
    },
    currentWeighted: {
      experimental: true,
      trainingDraws: Math.min(history.length, TRAINING_WINDOW),
      top3: currentTop3(history, rankingOptions, weights),
    },
  };
}
