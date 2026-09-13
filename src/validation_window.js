import { evaluateAgainstRandom, sanitizeHistory } from "./analyzer.js";

const BASE_MODELS = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Baseline seimbang: posisi + transisi + pasangan + frekuensi global.",
    weights: { position: 0.46, transition: 0.29, pair: 0.15, global: 0.10 },
    repeatPenalty: 0.04,
  },
  {
    id: "position",
    label: "Position Focus",
    description: "Lebih berat ke pola digit per posisi ratusan, puluhan, dan satuan.",
    weights: { position: 0.67, transition: 0.12, pair: 0.13, global: 0.08 },
    repeatPenalty: 0.03,
  },
  {
    id: "transition",
    label: "Transition Focus",
    description: "Lebih berat ke transisi digit dari draw sebelumnya.",
    weights: { position: 0.25, transition: 0.50, pair: 0.15, global: 0.10 },
    repeatPenalty: 0.035,
  },
  {
    id: "pair",
    label: "Pair Focus",
    description: "Lebih berat ke pasangan digit bersebelahan 1–2 dan 2–3.",
    weights: { position: 0.28, transition: 0.15, pair: 0.47, global: 0.10 },
    repeatPenalty: 0.03,
  },
];

const RANDOM_MEAN_RANK = 500.5;
const WINDOW_TARGETS = 18;
const CALIBRATION_TARGETS = 12;
const HOLDOUT_TARGETS = 6;
const TRAINING_WINDOW = 80;
const CANDIDATE_DIGITS = Array.from({ length: 1000 }, (_, n) => [
  Math.floor(n / 100),
  Math.floor((n % 100) / 10),
  n % 10,
]);
const CANDIDATE_ORDER = Array.from({ length: 1000 }, (_, n) => n);

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

function safeProb(count, total, buckets, alpha = 0.25) {
  return (count + alpha) / (total + alpha * buckets);
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

function buildFeatures(training, decay) {
  const positionCounts = Array.from({ length: 3 }, () => new Float64Array(10));
  const positionTotals = new Float64Array(3);
  const globalCounts = new Float64Array(10);
  let globalTotal = 0;
  const pair01 = new Float64Array(100);
  const pair12 = new Float64Array(100);
  let pairTotal = 0;
  const transitionCounts = Array.from({ length: 3 }, () => Array.from({ length: 10 }, () => new Float64Array(10)));
  const transitionTotals = Array.from({ length: 3 }, () => new Float64Array(10));
  const firstOccurrence = new Int16Array(1000);
  firstOccurrence.fill(-1);
  const historyDigits = new Array(training.length);

  for (let index = 0; index < training.length; index += 1) {
    const number = Number(training[index]);
    const digits = CANDIDATE_DIGITS[number];
    historyDigits[index] = digits;
    if (firstOccurrence[number] === -1) firstOccurrence[number] = index;

    const weight = decay ** index;
    for (let pos = 0; pos < 3; pos += 1) {
      const digit = digits[pos];
      positionCounts[pos][digit] += weight;
      positionTotals[pos] += weight;
      globalCounts[digit] += weight;
      globalTotal += weight;
    }
    pair01[digits[0] * 10 + digits[1]] += weight;
    pair12[digits[1] * 10 + digits[2]] += weight;
    pairTotal += weight;
  }

  for (let index = 0; index < historyDigits.length - 1; index += 1) {
    const target = historyDigits[index];
    const source = historyDigits[index + 1];
    const weight = decay ** index;
    for (let pos = 0; pos < 3; pos += 1) {
      transitionCounts[pos][source[pos]][target[pos]] += weight;
      transitionTotals[pos][source[pos]] += weight;
    }
  }

  return {
    decay,
    latestDigits: historyDigits[0] || null,
    positionCounts,
    positionTotals,
    globalCounts,
    globalTotal,
    pair01,
    pair12,
    pairTotal,
    transitionCounts,
    transitionTotals,
    firstOccurrence,
  };
}

function candidateComponents(number, features) {
  const digits = CANDIDATE_DIGITS[number];
  let position = 0;
  let global = 0;
  let transition = 0;

  for (let pos = 0; pos < 3; pos += 1) {
    const digit = digits[pos];
    position += safeProb(features.positionCounts[pos][digit], features.positionTotals[pos], 10);
    global += safeProb(features.globalCounts[digit], features.globalTotal, 10);

    if (features.latestDigits) {
      const latestDigit = features.latestDigits[pos];
      transition += safeProb(
        features.transitionCounts[pos][latestDigit][digit],
        features.transitionTotals[pos][latestDigit],
        10,
      );
    } else {
      transition += 0.1;
    }
  }

  position /= 3;
  global /= 3;
  transition /= 3;
  const pair = (
    safeProb(features.pair01[digits[0] * 10 + digits[1]], features.pairTotal, 100, 0.05) +
    safeProb(features.pair12[digits[1] * 10 + digits[2]], features.pairTotal, 100, 0.05)
  ) / 2;

  return { position, transition, pair, global };
}

function rankArrays(training, options = {}) {
  const rawDecay = Number(options.decay);
  const decay = Number.isFinite(rawDecay) && rawDecay > 0 && rawDecay <= 1 ? rawDecay : 0.9;
  const features = buildFeatures(training, decay);
  const raws = Object.fromEntries(BASE_MODELS.map((model) => [model.id, new Float64Array(1000)]));

  for (let number = 0; number <= 999; number += 1) {
    const components = candidateComponents(number, features);
    const repeatIndex = features.firstOccurrence[number];
    const repeatFactor = repeatIndex === -1 ? 0 : decay ** repeatIndex;

    for (const model of BASE_MODELS) {
      const w = model.weights;
      raws[model.id][number] = (
        components.position * w.position +
        components.transition * w.transition +
        components.pair * w.pair +
        components.global * w.global -
        (repeatIndex === -1 ? 0 : model.repeatPenalty * repeatFactor)
      );
    }
  }

  const arrays = {};
  for (const model of BASE_MODELS) {
    const raw = raws[model.id];
    const order = CANDIDATE_ORDER.slice().sort((a, b) => raw[b] - raw[a] || a - b);
    const ranks = new Uint16Array(1000);
    for (let index = 0; index < order.length; index += 1) ranks[order[index]] = index + 1;
    arrays[model.id] = ranks;
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
  for (let n = 0; n <= 999; n += 1) rows.push({ number: String(n).padStart(3, "0"), raw: fusedScore(n, arrays, weights) });
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
  const rawDecay = Number(options.decay);
  const rankingOptions = { decay: Number.isFinite(rawDecay) && rawDecay > 0 && rawDecay <= 1 ? rawDecay : 0.9 };

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
      version: "0.6.3",
      method: "optimized-lightweight-walk-forward-window",
      sourceDraws: history.length,
      evaluatedTargets: WINDOW_TARGETS,
      calibrationTrials: CALIBRATION_TARGETS,
      holdoutTrials: HOLDOUT_TARGETS,
      trainingWindowDraws: TRAINING_WINDOW,
      minTrain,
      optimization: "single feature build per target + shared four-model scoring + O(1) repeat lookup",
      note: "12 calibration + 6 locked holdout dengan maksimum 80 draw training per target. Ranking semantik dipertahankan, tetapi perhitungan empat model memakai feature set bersama agar CPU jauh lebih ringan.",
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
