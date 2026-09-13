const DIGITS = 10;
const POSITIONS = 3;
const DEFAULT_DECAY = 0.90;
const DEFAULT_MIN_TRAIN = 8;
const DEFAULT_MAX_TRIALS = 120;
const DEFAULT_MODEL_ID = "ensemble";

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

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function pct(value, total) {
  if (!total) return 0;
  return round((value / total) * 100, 2);
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
  const maps = new Map(
    BASE_MODELS.map((spec) => [
      spec.id,
      new Map((rankingsById[spec.id] || []).map((row) => [row.number, row])),
    ]),
  );

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
      percentileSum += (1001 - row.rank) / 1000;
      if (row.rank <= 3) top3Votes += 1;
      if (row.rank <= 10) top10Votes += 1;
      for (const key of Object.keys(components)) components[key] += Number(row.components?.[key] || 0);
    }

    for (const key of Object.keys(components)) components[key] /= BASE_MODELS.length;
    rows.push({
      number,
      raw: percentileSum / BASE_MODELS.length,
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
      version: "0.4.0",
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
  return { minTrain, maxTrials, newestEligibleIndex, startIndex };
}

export function backtestHistory(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const { minTrain, maxTrials, newestEligibleIndex, startIndex } = trialBounds(history, options);
  const spec = resolveModel(options.modelId);

  let top3Hits = 0;
  let top10Hits = 0;
  let top25Hits = 0;
  let rankSum = 0;
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

    if (hit3) top3Hits += 1;
    if (hit10) top10Hits += 1;
    if (hit25) top25Hits += 1;
    rankSum += rank;

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

  const total = trials.length;
  return {
    meta: {
      version: "0.4.0",
      model: spec.id,
      modelLabel: spec.label,
      method: "rolling-origin-no-future-leak",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials,
      trials: total,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      disclaimer: "Backtest historis mengukur perilaku model pada data lama; bukan jaminan performa hasil berikutnya.",
    },
    summary: {
      trials: total,
      top3Hits,
      top10Hits,
      top25Hits,
      top3HitRatePct: pct(top3Hits, total),
      top10HitRatePct: pct(top10Hits, total),
      top25HitRatePct: pct(top25Hits, total),
      meanTargetRank: round(rankSum / total, 2),
    },
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

export function compareModels(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const { minTrain, maxTrials, newestEligibleIndex, startIndex } = trialBounds(history, options);
  const stats = Object.fromEntries(
    MODEL_DEFINITIONS.map((model) => [model.id, {
      id: model.id,
      label: model.label,
      description: model.description,
      trials: 0,
      top3Hits: 0,
      top10Hits: 0,
      top25Hits: 0,
      rankSum: 0,
    }]),
  );

  for (let targetIndex = newestEligibleIndex; targetIndex >= startIndex; targetIndex -= 1) {
    const target = history[targetIndex];
    const training = history.slice(targetIndex + 1);
    const rankings = rankAllModels(training, options);

    for (const model of MODEL_DEFINITIONS) {
      const ranking = rankings[model.id];
      const row = ranking.find((item) => item.number === target);
      const rank = row?.rank ?? 1000;
      const item = stats[model.id];
      item.trials += 1;
      item.rankSum += rank;
      if (rank <= 3) item.top3Hits += 1;
      if (rank <= 10) item.top10Hits += 1;
      if (rank <= 25) item.top25Hits += 1;
    }
  }

  const currentRankings = rankAllModels(history, options);
  const leaderboard = MODEL_DEFINITIONS.map((model) => {
    const item = stats[model.id];
    const summary = {
      trials: item.trials,
      top3Hits: item.top3Hits,
      top10Hits: item.top10Hits,
      top25Hits: item.top25Hits,
      top3HitRatePct: pct(item.top3Hits, item.trials),
      top10HitRatePct: pct(item.top10Hits, item.trials),
      top25HitRatePct: pct(item.top25Hits, item.trials),
      meanTargetRank: round(item.rankSum / item.trials, 2),
    };
    return {
      id: model.id,
      label: model.label,
      description: model.description,
      ...summary,
      leaderScore: leaderboardScore(summary),
      currentTop3: currentRankings[model.id].slice(0, 3).map((row) => row.number),
    };
  }).sort((a, b) => b.leaderScore - a.leaderScore || a.meanTargetRank - b.meanTargetRank || a.id.localeCompare(b.id));

  return {
    meta: {
      version: "0.4.0",
      method: "multi-model-rolling-origin-no-future-leak",
      historyOrder: "newest-to-oldest",
      minTrain,
      maxTrials,
      trials: leaderboard[0]?.trials ?? 0,
      models: MODEL_DEFINITIONS.length,
      randomBaselinesPct: { top3: 0.3, top10: 1, top25: 2.5 },
      leaderScoreMeaning: "historical-composite-not-probability",
      disclaimer: "Leaderboard membandingkan performa historis model pada data yang sama. Skor bukan probabilitas hasil berikutnya.",
    },
    winner: leaderboard[0] || null,
    leaderboard,
  };
}
