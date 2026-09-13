import { rankHistory, sanitizeHistory } from "./analyzer.js";

export const ARENA_VERSION = "0.7.0";

const POSITIONS = 3;
const DIGITS = 10;
const FEATURE_NAMES = [
  "latest-match",
  "freq-5",
  "freq-15",
  "freq-40",
  "global-15",
  "transition",
  "gap-inverse",
  "latest-anywhere",
];
const TRAIN_CONTEXT = 60;
const MIN_CONTEXT = 15;
const MAX_TARGETS = 180;
const BOOST_ROUNDS = 12;
const LEARNING_RATE = 0.55;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function sigmoid(value) {
  const x = clamp(Number(value) || 0, -30, 30);
  return 1 / (1 + Math.exp(-x));
}

function safeDecay(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.9;
}

function digitAt(value, position) {
  return Number(String(value || "000")[position] || 0);
}

function positionFrequency(context, position, candidate, limit) {
  const rows = context.slice(0, limit);
  if (!rows.length) return 0.1;
  let hits = 0;
  for (const row of rows) if (digitAt(row, position) === candidate) hits += 1;
  return (hits + 0.35) / (rows.length + 3.5);
}

function globalFrequency(context, candidate, limit) {
  const rows = context.slice(0, limit);
  if (!rows.length) return 0.1;
  let hits = 0;
  for (const row of rows) {
    for (let pos = 0; pos < POSITIONS; pos += 1) {
      if (digitAt(row, pos) === candidate) hits += 1;
    }
  }
  return (hits + 0.35) / (rows.length * POSITIONS + 3.5);
}

function transitionProbability(context, position, candidate) {
  if (context.length < 2) return 0.1;
  const sourceDigit = digitAt(context[0], position);
  let total = 0;
  let hits = 0;
  for (let i = 0; i < context.length - 1; i += 1) {
    const newer = context[i];
    const older = context[i + 1];
    if (digitAt(older, position) !== sourceDigit) continue;
    total += 1;
    if (digitAt(newer, position) === candidate) hits += 1;
  }
  return (hits + 0.3) / (total + 3);
}

function inverseGap(context, position, candidate) {
  for (let i = 0; i < context.length; i += 1) {
    if (digitAt(context[i], position) === candidate) return 1 / (1 + i);
  }
  return 0;
}

function candidateFeatures(context, position, candidate) {
  const latest = context[0] || "000";
  return [
    digitAt(latest, position) === candidate ? 1 : 0,
    positionFrequency(context, position, candidate, 5),
    positionFrequency(context, position, candidate, 15),
    positionFrequency(context, position, candidate, 40),
    globalFrequency(context, candidate, 15),
    transitionProbability(context, position, candidate),
    inverseGap(context, position, candidate),
    String(latest).includes(String(candidate)) ? 1 : 0,
  ];
}

function weightedMean(values, weights) {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = Number(weights[i] || 0);
    sum += Number(values[i] || 0) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

function thresholdsForFeature(rows, featureIndex) {
  const values = rows.map((row) => row.x[featureIndex]).sort((a, b) => a - b);
  if (!values.length) return [0.5];
  const picks = [0.15, 0.3, 0.5, 0.7, 0.85]
    .map((q) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))]);
  return [...new Set(picks)].sort((a, b) => a - b);
}

function fitBoostedStumps(rows, rounds = BOOST_ROUNDS) {
  if (!rows.length) return { base: 0, stumps: [], importance: Array(FEATURE_NAMES.length).fill(0) };

  const labels = rows.map((row) => row.y);
  const sampleWeights = rows.map((row) => row.w);
  const positiveRate = clamp(weightedMean(labels, sampleWeights), 0.02, 0.98);
  const base = Math.log(positiveRate / (1 - positiveRate));
  const scores = Array(rows.length).fill(base);
  const thresholds = FEATURE_NAMES.map((_, featureIndex) => thresholdsForFeature(rows, featureIndex));
  const stumps = [];
  const importance = Array(FEATURE_NAMES.length).fill(0);

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const residuals = rows.map((row, index) => row.y - sigmoid(scores[index]));
    let best = null;

    for (let featureIndex = 0; featureIndex < FEATURE_NAMES.length; featureIndex += 1) {
      for (const threshold of thresholds[featureIndex]) {
        let leftWeight = 0;
        let rightWeight = 0;
        let leftResidual = 0;
        let rightResidual = 0;

        for (let i = 0; i < rows.length; i += 1) {
          const weight = sampleWeights[i];
          if (rows[i].x[featureIndex] <= threshold) {
            leftWeight += weight;
            leftResidual += residuals[i] * weight;
          } else {
            rightWeight += weight;
            rightResidual += residuals[i] * weight;
          }
        }
        if (leftWeight < 1e-6 || rightWeight < 1e-6) continue;
        const leftValue = leftResidual / leftWeight;
        const rightValue = rightResidual / rightWeight;
        let loss = 0;
        for (let i = 0; i < rows.length; i += 1) {
          const predictedResidual = rows[i].x[featureIndex] <= threshold ? leftValue : rightValue;
          const error = residuals[i] - predictedResidual;
          loss += error * error * sampleWeights[i];
        }
        if (!best || loss < best.loss) {
          best = { featureIndex, threshold, leftValue, rightValue, loss };
        }
      }
    }

    if (!best) break;
    best.leftValue *= LEARNING_RATE;
    best.rightValue *= LEARNING_RATE;
    stumps.push(best);
    importance[best.featureIndex] += Math.abs(best.leftValue - best.rightValue);
    for (let i = 0; i < rows.length; i += 1) {
      scores[i] += rows[i].x[best.featureIndex] <= best.threshold ? best.leftValue : best.rightValue;
    }
  }

  return { base, stumps, importance };
}

function predictBoosted(model, features) {
  let score = model.base;
  for (const stump of model.stumps) {
    score += features[stump.featureIndex] <= stump.threshold ? stump.leftValue : stump.rightValue;
  }
  return sigmoid(score);
}

function buildTrainingRows(history, position) {
  const maxEligible = Math.min(MAX_TARGETS, Math.max(0, history.length - MIN_CONTEXT));
  const rows = [];
  for (let targetIndex = 0; targetIndex < maxEligible; targetIndex += 1) {
    const target = history[targetIndex];
    const context = history.slice(targetIndex + 1, targetIndex + 1 + TRAIN_CONTEXT);
    if (context.length < MIN_CONTEXT) continue;
    const targetDigit = digitAt(target, position);
    const recencyWeight = 0.994 ** targetIndex;
    for (let candidate = 0; candidate < DIGITS; candidate += 1) {
      rows.push({
        x: candidateFeatures(context, position, candidate),
        y: candidate === targetDigit ? 1 : 0,
        w: recencyWeight,
      });
    }
  }
  return rows;
}

function trainDigitBoost(history) {
  const models = [];
  let trainingRows = 0;
  for (let position = 0; position < POSITIONS; position += 1) {
    const rows = buildTrainingRows(history, position);
    trainingRows += rows.length;
    models.push(fitBoostedStumps(rows));
  }
  return { models, trainingRows };
}

function normalizeDistribution(values) {
  const clean = values.map((value) => Math.max(1e-9, Number(value) || 0));
  const total = clean.reduce((sum, value) => sum + value, 0) || 1;
  return clean.map((value) => value / total);
}

function currentDigitDistributions(history, trained) {
  const context = history.slice(0, TRAIN_CONTEXT);
  return trained.models.map((model, position) => normalizeDistribution(
    Array.from({ length: DIGITS }, (_, candidate) => predictBoosted(
      model,
      candidateFeatures(context, position, candidate),
    )),
  ));
}

function buildPairProbabilities(history, decay) {
  const pair01 = Array(100).fill(0);
  const pair12 = Array(100).fill(0);
  let total = 0;
  const d = Math.max(0.965, safeDecay(decay));
  history.slice(0, 100).forEach((value, index) => {
    const weight = d ** index;
    const a = digitAt(value, 0);
    const b = digitAt(value, 1);
    const c = digitAt(value, 2);
    pair01[a * 10 + b] += weight;
    pair12[b * 10 + c] += weight;
    total += weight;
  });
  const alpha = 0.08;
  const denominator = total + alpha * 100;
  return {
    p01: pair01.map((count) => (count + alpha) / denominator),
    p12: pair12.map((count) => (count + alpha) / denominator),
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
    raw: round(row.raw, 8),
  }));
}

function buildDigitBoostRanking(history, digitDistributions, decay) {
  const pairs = buildPairProbabilities(history, decay);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    const a = digitAt(number, 0);
    const b = digitAt(number, 1);
    const c = digitAt(number, 2);
    const digitLog = (
      Math.log(digitDistributions[0][a] + 1e-12) +
      Math.log(digitDistributions[1][b] + 1e-12) +
      Math.log(digitDistributions[2][c] + 1e-12)
    );
    const pairLog = Math.log(pairs.p01[a * 10 + b] + 1e-12) + Math.log(pairs.p12[b * 10 + c] + 1e-12);
    rows.push({ number, raw: digitLog + pairLog * 0.22 });
  }
  return normalizeRanking(rows);
}

function buildHybridRanking(legacyRanking, digitBoostRanking) {
  const legacyRank = new Map(legacyRanking.map((row) => [row.number, row.rank]));
  const boostRank = new Map(digitBoostRanking.map((row) => [row.number, row.rank]));
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    const legacyPct = (1001 - Number(legacyRank.get(number) || 1000)) / 1000;
    const boostPct = (1001 - Number(boostRank.get(number) || 1000)) / 1000;
    rows.push({ number, raw: legacyPct * 0.45 + boostPct * 0.55 });
  }
  return normalizeRanking(rows);
}

function topDigits(distributions) {
  const labels = ["Ratusan", "Puluhan", "Satuan"];
  return distributions.map((distribution, position) => ({
    position,
    label: labels[position],
    digits: distribution
      .map((probability, digit) => ({ digit, probability: round(probability, 6), pct: round(probability * 100, 2) }))
      .sort((a, b) => b.probability - a.probability || a.digit - b.digit)
      .slice(0, 5),
  }));
}

function featureImportance(trained) {
  const aggregate = Array(FEATURE_NAMES.length).fill(0);
  for (const model of trained.models) {
    model.importance.forEach((value, index) => { aggregate[index] += value; });
  }
  const total = aggregate.reduce((sum, value) => sum + value, 0) || 1;
  return aggregate
    .map((value, index) => ({ feature: FEATURE_NAMES[index], importance: round(value / total, 6), pct: round((value / total) * 100, 2) }))
    .sort((a, b) => b.importance - a.importance);
}

function modelSummary(id, label, description, ranking) {
  return {
    id,
    label,
    description,
    top3: ranking.slice(0, 3),
    top10: ranking.slice(0, 10),
  };
}

function overlapCount(left, right) {
  const set = new Set(right.map((row) => row.number));
  return left.filter((row) => set.has(row.number)).length;
}

export function runModelArena(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  if (history.length < 40) throw new Error("Model Arena V0.7 memerlukan minimal 40 draw.");
  const decay = safeDecay(options.decay);
  const { ranking: legacyRanking } = rankHistory(history, { decay, modelId: "ensemble" });
  const trained = trainDigitBoost(history);
  const distributions = currentDigitDistributions(history, trained);
  const digitBoostRanking = buildDigitBoostRanking(history, distributions, decay);
  const hybridRanking = buildHybridRanking(legacyRanking, digitBoostRanking);

  const models = [
    modelSummary(
      "legacy",
      "Legacy Ensemble",
      "Baseline V0.6: posisi + transisi + pair + global melalui Borda ensemble.",
      legacyRanking,
    ),
    modelSummary(
      "digitboost",
      "DigitBoost GBS",
      "Worker-native gradient-boosted decision stumps: Stage-1 digit selection + pair/order reranker.",
      digitBoostRanking,
    ),
    modelSummary(
      "hybrid",
      "Hybrid Reranker",
      "45% percentile Legacy + 55% percentile DigitBoost untuk menjaga baseline sambil menguji engine baru.",
      hybridRanking,
    ),
  ];

  return {
    meta: {
      version: ARENA_VERSION,
      method: "worker-native-gradient-boosted-stumps + pair-reranker",
      officialXGBoost: false,
      note: "DigitBoost GBS bukan library resmi XGBoost/CatBoost. Ini baseline boosting Worker-native yang dibuat agar dapat diuji forward tanpa dependency native/WASM.",
      draws: history.length,
      decay,
      trainingRows: trained.trainingRows,
      boostRoundsPerPosition: BOOST_ROUNDS,
      features: FEATURE_NAMES,
    },
    models,
    digitDistributions: topDigits(distributions),
    featureImportance: featureImportance(trained),
    agreement: {
      legacyVsDigitBoostTop3: overlapCount(models[0].top3, models[1].top3),
      legacyVsHybridTop3: overlapCount(models[0].top3, models[2].top3),
      digitBoostVsHybridTop3: overlapCount(models[1].top3, models[2].top3),
    },
  };
}
