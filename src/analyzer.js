const DIGITS = 10;
const POSITIONS = 3;
const DEFAULT_DECAY = 0.90;
const DEFAULT_MIN_TRAIN = 8;
const DEFAULT_MAX_TRIALS = 120;
const DEFAULT_MODEL_ID = "ensemble";
const RANDOM_MEAN_RANK = 500.5;
const RANDOM_RANK_VARIANCE = (1000 ** 2 - 1) / 12;
const RANDOM_BASELINES = { top3: 0.003, top10: 0.01, top25: 0.025 };

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

const ENSEMBLE_MODEL = {
  id: "ensemble",
  label: "Ensemble Borda",
  description: "Menggabungkan ranking empat model dasar dengan rata-rata percentile rank.",
  ensemble: true,
};

export const MODEL_DEFINITIONS = [...BASE_MODELS, ENSEMBLE_MODEL].map((model) => ({
  id: model.id,
  label: model.label,
  description: model.description,
  ensemble: Boolean(model.ensemble),
}));

function normalizeNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function matrix(rows, cols, initial = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(initial));
}

function cube(a, b, c, initial = 0) {
  return Array.from({ length: a }, () => matrix(b, c, initial));
}

function safeProb(count, total, buckets, alpha = 0.25) {
  return (count + alpha) / (total + alpha * buckets);
}

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function pct(value, total) {
  if (!total) return 0;
  return round((value / total) * 100, 2);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function binomialTail(n, atLeast, probability) {
  if (!n || atLeast <= 0) return 1;
  if (atLeast > n) return 0;
  const p = Number(probability);
  const q = 1 - p;
  let term = q ** n;
  let total = 0;

  for (let k = 0; k <= n; k += 1) {
    if (k >= atLeast) total += term;
    if (k === n) break;
    term *= ((n - k) / (k + 1)) * (p / q);
  }
  return clamp(total, 0, 1);
}

function resolveModel(modelId) {
  const id = String(modelId || DEFAULT_MODEL_ID).toLowerCase();
  if (id === ENSEMBLE_MODEL.id) return ENSEMBLE_MODEL;
  return BASE_MODELS.find((model) => model.id === id) || BASE_MODELS[0];
}

export function listModels() {
  return MODEL_DEFINITIONS;
}

export function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeNumber).filter(Boolean);
}

export function buildModel(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const decay = Number(options.decay ?? DEFAULT_DECAY);
  const safeDecay = Number.isFinite(decay) && decay > 0 && decay <= 1 ? decay : DEFAULT_DECAY;

  const positionCounts = matrix(POSITIONS, DIGITS);
  const positionTotals = Array(POSITIONS).fill(0);
  const globalCounts = Array(DIGITS).fill(0);
  let globalTotal = 0;

  const pair01 = Array(100).fill(0);
  const pair12 = Array(100).fill(0);
  let pairTotal = 0;

  const transitionCounts = cube(POSITIONS, DIGITS, DIGITS);
  const transitionTotals = matrix(POSITIONS, DIGITS);

  history.forEach((value, index) => {
    const weight = safeDecay ** index;
    const digits = value.split("").map(Number);

    digits.forEach((digit, pos) => {
      positionCounts[pos][digit] += weight;
      positionTotals[pos] += weight;
      globalCounts[digit] += weight;
      globalTotal += weight;
    });

    pair01[digits[0] * 10 + digits[1]] += weight;
    pair12[digits[1] * 10 + digits[2]] += weight;
    pairTotal += weight;
  });

  for (let i = 0; i < history.length - 1; i += 1) {
    const target = history[i].split("").map(Number);
    const source = history[i + 1].split("").map(Number);
    const weight = safeDecay ** i;

    for (let pos = 0; pos < POSITIONS; pos += 1) {
      transitionCounts[pos][source[pos]][target[pos]] += weight;
      transitionTotals[pos][source[pos]] += weight;
    }
  }

  return {
    history,
    decay: safeDecay,
    positionCounts,
    positionTotals,
    globalCounts,
    globalTotal,
    pair01,
    pair12,
    pairTotal,
    transitionCounts,
    transitionTotals,
  };
}

function candidateComponents(candidate, model) {
  const digits = candidate.split("").map(Number);
  let position = 0;
  let global = 0;
  let transition = 0;

  for (let pos = 0; pos < POSITIONS; pos += 1) {
    const digit = digits[pos];
    position += safeProb(model.positionCounts[pos][digit], model.positionTotals[pos], DIGITS);
    global += safeProb(model.globalCounts[digit], model.globalTotal, DIGITS);

    if (model.history.length > 0) {
      const latestDigit = Number(model.history[0][pos]);
      transition += safeProb(
        model.transitionCounts[pos][latestDigit][digit],
        model.transitionTotals[pos][latestDigit],
        DIGITS,
      );
    } else {
      transition += 1 / DIGITS;
    }
  }

  position /= POSITIONS;
  global /= POSITIONS;
  transition /= POSITIONS;

  const p01 = digits[0] * 10 + digits[1];
  const p12 = digits[1] * 10 + digits[2];
  const pair = (
    safeProb(model.pair01[p01], model.pairTotal, 100, 0.05) +
    safeProb(model.pair12[p12], model.pairTotal, 100, 0.05)
  ) / 2;

  return { position, transition, pair, global };
}

function scoreCandidate(candidate, model, spec) {
  const components = candidateComponents(candidate, model);
  const repeatIndex = model.history.indexOf(candidate);
  const repeatPenalty = repeatIndex === -1 ? 0 : spec.repeatPenalty * (model.decay ** repeatIndex);
  const raw = (
    components.position * spec.weights.position +
    components.transition * spec.weights.transition +
    components.pair * spec.weights.pair +
    components.global * spec.weights.global -
    repeatPenalty
  );

  return {
    number: candidate,
    raw,
    components: { ...components, repeatPenalty },
    consensus: null,
  };
}

function normalizeRanking(rows) {
  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));
  const max = rows[0]?.raw ?? 1;
  const min = rows.at(-1)?.raw ?? 0;
  const span = Math.max(max - min, Number.EPSILON);

  return rows.map((row, index) => ({
    rank: index + 1,
    number: row.number,
    score: round(((row.raw - min) / span) * 100, 2),
    components: Object.fromEntries(
      Object.entries(row.components || {}).map(([key, value]) => [key, round(value, 6)]),
    ),
    consensus: row.consensus || null,
  }));
}

function rankBaseModel(historyInput, options, spec) {
  const model = buildModel(historyInput, options);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    rows.push(scoreCandidate(String(n).padStart(3, "0"), model, spec));
  }
  return normalizeRanking(rows);
}

function buildEnsembleFromRankings(rankingsById) {
  const equalWeights = Object.fromEntries(BASE_MODELS.map((model) => [model.id, 1 / BASE_MODELS.length]));
  return buildWeightedEnsembleFromRankings(rankingsById, equalWeights);
}

function buildWeightedEnsembleFromRankings(rankingsById, weights) {
  const maps = new Map(
    BASE_MODELS.map((spec) => [
      spec.id,
      new Map((rankingsById[spec.id] || []).map((row) => [row.number, row])),
    ]),
  );

  const normalizedWeights = {};
  const weightTotal = BASE_MODELS.reduce((total, spec) => total + Math.max(0, Number(weights?.[spec.id] || 0)), 0) || 1;
  BASE_MODELS.forEach((spec) => {
    normalizedWeights[spec.id] = Math.max(0, Number(weights?.[spec.id] || 0)) / weightTotal;
  });

  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    let percentileSum = 0;
    let top3Votes = 0;
    let top10Votes = 0;
    const components = { position: 0, transition: 0, pair: 0, global: 0, repeatPenalty: 0 };

    for (const spec of BASE_MODELS) {
      const row = maps.get(spec.id)?.get(number);
      if (!row) continue;
      const modelWeight = normalizedWeights[spec.id];
      percentileSum += ((1001 - row.rank) / 1000) * modelWeight;
      if (row.rank <= 3) top3Votes += 1;
      if (row.rank <= 10) top10Votes += 1;
      for (const key of Object.keys(components)) {
        components[key] += Number(row.components?.[key] || 0) * modelWeight;
      }
    }

    rows.push({
      number,
      raw: percentileSum,
      components,
      consensus: { top3Votes, top10Votes, models: BASE_MODELS.length },
    });
  }

  return normalizeRanking(rows);
}

function rankAllModels(historyInput, options = {}) {
  const rankings = {};
  for (const spec of BASE_MODELS) {
    rankings[spec.id] = rankBaseModel(historyInput, options, spec);
  }
  rankings.ensemble = buildEnsembleFromRankings(rankings);
  return rankings;
}

export function rankHistory(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const spec = resolveModel(options.modelId);
  if (spec.ensemble) {
    return { spec, ranking: rankAllModels(history, options).ensemble };
  }
  return { spec, ranking: rankBaseModel(history, options, spec) };
}

export function summarizeHistory(historyInput) {
  const history = sanitizeHistory(historyInput);
  const byPosition = matrix(POSITIONS, DIGITS);
  const overall = Array(DIGITS).fill(0);

  history.forEach((value) => {
    value.split("").forEach((char, pos) => {
      const digit = Number(char);
      byPosition[pos][digit] += 1;
      overall[digit] += 1;
    });
  });

  return {
    draws: history.length,
    newest: history[0] ?? null,
    oldest: history.at(-1) ?? null,
    byPosition,
    overall,
  };
}

export function analyzeHistory(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  if (history.length < 3) throw new Error("Minimal 3 hasil valid diperlukan untuk analisis awal.");

  const { spec, ranking } = rankHistory(history, options);
  const built = buildModel(history, options);

  return {
    meta: {
      version: "0.5.0",
      model: spec.id,
      modelLabel: spec.label,
      historyOrder: "newest-to-oldest",
      draws: history.length,
      decay: built.decay,
      scoreMeaning: "relative-ranking-not-probability",
      disclaimer: "Ranking adalah skor statistik eksploratif dan tidak menjamin hasil berikutnya jika proses sumber bersifat acak.",
    },
    history: summarizeHistory(history),
    top10: ranking.slice(0, 10),
    top3: ranking.slice(0, 3),
  };
}

function trialBounds(history, options = {}) {
  const minTrain = clampInteger(options.minTrain, DEFAULT_MIN_TRAIN, 3, 1000);
  const maxTrials = clampInteger(options.maxTrials, DEFAULT_MAX_TRIALS, 1, 120);
  if (history.length < minTrain + 1) {
    throw new Error(`Backtest memerlukan minimal ${minTrain + 1} hasil valid.`);
  }
  const newestEligibleIndex = history.length - minTrain - 1;
  const trialCount = Math.min(newestEligibleIndex + 1, maxTrials);
  const startIndex = Math.max(0, newestEligibleIndex - trialCount + 1);
  return { minTrain, maxTrials, newestEligibleIndex, startIndex, trialCount };
}

function summarizeTrialStats(stats) {
  const total = stats.trials || 0;
  return {
    trials: total,
    top3Hits: stats.top3Hits || 0,
    top10Hits: stats.top10Hits || 0,
    top25Hits: stats.top25Hits || 0,
    top3HitRatePct: pct(stats.top3Hits || 0, total),
    top10HitRatePct: pct(stats.top10Hits || 0, total),
    top25HitRatePct: pct(stats.top25Hits || 0, total),
    meanTargetRank: total ? round(stats.rankSum / total, 2) : 1000,
  };
}

export function evaluateAgainstRandom(summary) {
  const n = Number(summary?.trials || 0);
  const meanRank = Number(summary?.meanTargetRank || 1000);
  const meanRankDelta = round(RANDOM_MEAN_RANK - meanRank, 2);
  const standardError = n ? Math.sqrt(RANDOM_RANK_VARIANCE / n) : Infinity;
  const zMeanRank = n ? meanRankDelta / standardError : 0;
  const pMeanRank = n ? 1 - normalCdf(zMeanRank) : 1;
  const pTop3 = binomialTail(n, Number(summary?.top3Hits || 0), RANDOM_BASELINES.top3);
  const pTop10 = binomialTail(n, Number(summary?.top10Hits || 0), RANDOM_BASELINES.top10);
  const pTop25 = binomialTail(n, Number(summary?.top25Hits || 0), RANDOM_BASELINES.top25);
  const strongestHitP = Math.min(pTop3, pTop10, pTop25);
  const jointP = Math.max(pMeanRank, strongestHitP);

  let status = "no-clear-edge";
  let label = "Belum mengalahkan baseline secara meyakinkan";
  if (n < 30) {
    status = "insufficient-data";
    label = "Data belum cukup untuk klaim edge";
  } else if (meanRankDelta <= 0) {
    status = "below-random-rank";
    label = "Best among models, tetapi mean rank masih di bawah baseline random";
  } else if (strongestHitP <= 0.05 && pMeanRank <= 0.10) {
    status = "validated-edge";
    label = "Sinyal historis melewati gate baseline";
  } else if (strongestHitP <= 0.15 && pMeanRank <= 0.25) {
    status = "promising";
    label = "Sinyal menjanjikan, belum tervalidasi kuat";
  }

  return {
    status,
    label,
    randomMeanRank: RANDOM_MEAN_RANK,
    meanRankDelta,
    betterMeanRankThanRandom: meanRankDelta > 0,
    expectedHits: {
      top3: round(n * RANDOM_BASELINES.top3, 2),
      top10: round(n * RANDOM_BASELINES.top10, 2),
      top25: round(n * RANDOM_BASELINES.top25, 2),
    },
    pValues: {
      meanRank: round(pMeanRank, 6),
      top3: round(pTop3, 6),
      top10: round(pTop10, 6),
      top25: round(pTop25, 6),
    },
    confidenceScore: round(clamp((1 - jointP) * 100, 0, 100), 1),
    note: "Confidence score adalah indikator evidence-vs-random konservatif, bukan probabilitas hasil berikutnya.",
  };
}

export function backtestHistory(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const { minTrain, maxTrials, newestEligibleIndex, startIndex } = trialBounds(history, options);
  const spec = resolveModel(options.modelId);

  const stats = { trials: 0, top3Hits: 0, top10Hits: 0, top25Hits: 0, rankSum: 0 };
  const trials = [];

  for (let targetIndex = newestEligibleIndex; targetIndex >= startIndex; targetIndex -= 1) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const { ranking } = rankHistory(training, { ...options, modelId: spec.id });
    const targetRow = ranking.find((row) => row.number === target);
    const rank = targetRow?.rank ?? 1000;
    const hit3 = rank <= 3;
    const hit10 = rank <= 10;
    const hit25 = rank <= 25;

    stats.trials += 1;
    stats.rankSum += rank;
    if (hit3) stats.top3Hits += 1;
    if (hit10) stats.top10Hits += 1;
    if (hit25) stats.top25Hits += 1;

    trials.push({
      target,
      rank,
      hit3,
      hit10,
      hit25,
      trainingDraws: training.length,
      predictedTop3: ranking.slice(0, 3).map((row) => row.number),
      predictedTop10: ranking.slice(0, 10).map((row) => row.number),
    });
  }

  const summary = summarizeTrialStats(stats);
  return {
    meta: {
      version: "0.5.0",
      model: spec.id,
      modelLabel: spec.label,
      method: "rolling-origin-no-future-leak",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials,
      trials: summary.trials,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      randomMeanRank: RANDOM_MEAN_RANK,
      disclaimer: "Backtest historis mengukur perilaku model pada data lama; bukan jaminan performa hasil berikutnya.",
    },
    summary,
    evidence: evaluateAgainstRandom(summary),
    trials: trials.reverse().slice(0, 30),
  };
}

function leaderboardScore(summary) {
  const rankQuality = Math.max(0, Math.min(100, ((1000 - summary.meanTargetRank) / 999) * 100));
  return round(
    summary.top3HitRatePct * 0.35 +
    summary.top10HitRatePct * 0.25 +
    summary.top25HitRatePct * 0.15 +
    rankQuality * 0.25,
    2,
  );
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

export function compareModels(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const { minTrain, maxTrials, newestEligibleIndex, startIndex } = trialBounds(history, options);
  const stats = Object.fromEntries(MODEL_DEFINITIONS.map((model) => [model.id, createStats(model)]));

  for (let targetIndex = newestEligibleIndex; targetIndex >= startIndex; targetIndex -= 1) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankAllModels(training, options);

    for (const model of MODEL_DEFINITIONS) {
      const row = rankings[model.id].find((item) => item.number === target);
      addRankToStats(stats[model.id], row?.rank ?? 1000);
    }
  }

  const currentRankings = rankAllModels(history, options);
  const leaderboard = MODEL_DEFINITIONS.map((model) => {
    const summary = summarizeTrialStats(stats[model.id]);
    return {
      id: model.id,
      label: model.label,
      description: model.description,
      ...summary,
      leaderScore: leaderboardScore(summary),
      evidence: evaluateAgainstRandom(summary),
      currentTop3: currentRankings[model.id].slice(0, 3).map((row) => row.number),
    };
  }).sort((a, b) => b.leaderScore - a.leaderScore || a.meanTargetRank - b.meanTargetRank || a.id.localeCompare(b.id));

  return {
    meta: {
      version: "0.5.0",
      method: "multi-model-rolling-origin-no-future-leak",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials,
      trials: leaderboard[0]?.trials ?? 0,
      models: MODEL_DEFINITIONS.length,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      randomMeanRank: RANDOM_MEAN_RANK,
      leaderScoreMeaning: "historical-composite-not-probability",
      disclaimer: "Leaderboard membandingkan performa historis model pada data yang sama. Status baseline menunjukkan apakah hasil juga terlihat lebih baik daripada referensi random.",
    },
    winner: leaderboard[0] || null,
    leaderboard,
  };
}

function calibrationSummaries(history, options, targetIndices) {
  const stats = Object.fromEntries(BASE_MODELS.map((model) => [model.id, createStats(model)]));

  for (const targetIndex of targetIndices) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankAllModels(training, options);
    for (const model of BASE_MODELS) {
      const row = rankings[model.id].find((item) => item.number === target);
      addRankToStats(stats[model.id], row?.rank ?? 1000);
    }
  }

  return BASE_MODELS.map((model) => {
    const summary = summarizeTrialStats(stats[model.id]);
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
  const rawWeights = {};
  for (const row of rows) {
    const shrink = row.trials / (row.trials + 40);
    const rankSignal = clamp((RANDOM_MEAN_RANK - row.meanTargetRank) / 250, -1, 1);
    const hit3Signal = clamp((row.top3HitRatePct - 0.3) / 3, -1, 2);
    const hit10Signal = clamp((row.top10HitRatePct - 1) / 5, -1, 2);
    const hit25Signal = clamp((row.top25HitRatePct - 2.5) / 10, -1, 2);
    const evidenceSignal = (
      rankSignal * 0.45 +
      hit10Signal * 0.25 +
      hit25Signal * 0.15 +
      hit3Signal * 0.15
    );
    rawWeights[row.id] = Math.max(0.25, 1 + shrink * evidenceSignal);
  }

  const total = Object.values(rawWeights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(
    BASE_MODELS.map((model) => [model.id, round(rawWeights[model.id] / total, 4)]),
  );
}

function evaluateWeightedHoldout(history, options, targetIndices, weights) {
  const weightedStats = createStats({ id: "weighted", label: "Validated Weighted Ensemble" });
  const bordaStats = createStats({ id: "ensemble", label: "Ensemble Borda" });
  const trials = [];

  for (const targetIndex of targetIndices) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankAllModels(training, options);
    const weighted = buildWeightedEnsembleFromRankings(rankings, weights);
    const weightedRank = weighted.find((row) => row.number === target)?.rank ?? 1000;
    const bordaRank = rankings.ensemble.find((row) => row.number === target)?.rank ?? 1000;
    addRankToStats(weightedStats, weightedRank);
    addRankToStats(bordaStats, bordaRank);
    trials.push({ target, weightedRank, bordaRank });
  }

  const weightedSummary = summarizeTrialStats(weightedStats);
  const bordaSummary = summarizeTrialStats(bordaStats);
  return {
    weighted: { ...weightedSummary, evidence: evaluateAgainstRandom(weightedSummary) },
    borda: { ...bordaSummary, evidence: evaluateAgainstRandom(bordaSummary) },
    trials,
  };
}

export function validateWeightedEnsemble(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const minTrain = clampInteger(options.minTrain, DEFAULT_MIN_TRAIN, 3, 1000);
  const maxTrials = clampInteger(options.maxTrials, DEFAULT_MAX_TRIALS, 1, 120);
  const eligible = Math.min(Math.max(0, history.length - minTrain), maxTrials);

  if (eligible < 16) {
    throw new Error("Validation Gate memerlukan minimal 16 target eligible. Tambahkan histori D1 atau turunkan Min Train.");
  }

  const defaultHoldout = clamp(Math.floor(eligible * 0.25), 8, 20);
  const requestedHoldout = clampInteger(options.holdoutTrials, defaultHoldout, 5, 30);
  const holdoutTrials = Math.min(requestedHoldout, eligible - 8);
  const calibrationTrials = eligible - holdoutTrials;

  const holdoutIndices = Array.from({ length: holdoutTrials }, (_, index) => index);
  const calibrationIndices = Array.from({ length: calibrationTrials }, (_, index) => holdoutTrials + index);
  const calibration = calibrationSummaries(history, options, calibrationIndices);
  const weights = deriveCalibrationWeights(calibration);
  const holdout = evaluateWeightedHoldout(history, options, holdoutIndices, weights);
  const currentBaseRankings = rankAllModels(history, options);
  const currentWeightedRanking = buildWeightedEnsembleFromRankings(currentBaseRankings, weights);

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
      version: "0.5.0",
      method: "chronological-calibration-plus-locked-newest-holdout",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials,
      eligibleTrials: eligible,
      calibrationTrials,
      holdoutTrials,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      randomMeanRank: RANDOM_MEAN_RANK,
      note: "Bobot ditentukan hanya dari target calibration yang lebih lama. Holdout memakai target terbaru dan tidak dipakai saat tuning bobot.",
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
      weight: weights[model.id],
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
