import {
  analyzeHistory,
  backtestHistory,
  compareModels,
  listModels,
  validateWeightedEnsemble,
} from "../src/analyzer.js";
import { parseResultPage } from "../src/collector.js";

const history = [
  "226", "572", "187", "900", "240", "571", "840",
  "828", "983", "236", "620", "161", "717",
];

const validationHistory = Array.from(
  { length: 48 },
  (_, index) => String((226 + index * 137 + index * index * 11) % 1000).padStart(3, "0"),
);

const analysis = analyzeHistory(history, { decay: 0.9, modelId: "ensemble" });
const backtest = backtestHistory(history, { decay: 0.9, modelId: "balanced", minTrain: 8, maxTrials: 20 });
const comparison = compareModels(history, { decay: 0.9, minTrain: 8, maxTrials: 20 });
const validation = validateWeightedEnsemble(validationHistory, { decay: 0.9, minTrain: 8, maxTrials: 40 });
const models = listModels();

if (analysis.top3.length !== 3 || analysis.top10.length !== 10) {
  throw new Error("Analyzer ranking length invalid.");
}

if (!analysis.top3.every((row) => /^\d{3}$/.test(row.number))) {
  throw new Error("Analyzer returned an invalid 3-digit candidate.");
}

if (!analysis.top3.every((row) => row.consensus && row.consensus.models === 4)) {
  throw new Error("Ensemble consensus metadata missing.");
}

if (backtest.summary.trials < 1 || !backtest.evidence?.pValues) {
  throw new Error("Backtest evidence invalid.");
}

if (models.length !== 5 || comparison.leaderboard.length !== 5 || !comparison.winner) {
  throw new Error("Model leaderboard invalid.");
}

if (!comparison.leaderboard.every((row) => row.evidence && Number.isFinite(row.evidence.meanRankDelta))) {
  throw new Error("Leaderboard baseline evidence missing.");
}

const weightSum = validation.weights.reduce((total, row) => total + row.weight, 0);
if (
  validation.meta.calibrationTrials < 20 ||
  validation.meta.holdoutTrials < 10 ||
  Math.abs(weightSum - 1) > 0.01 ||
  validation.currentWeighted.top3.length !== 3
) {
  throw new Error("Validation Gate output invalid.");
}

const collectorFixture = `
  <div>Sunday, September 13, 2026</div>
  <div>07:00 AM</div>
  <div>Period: <b>25532</b></div>
  <img src="/img/Ball/orange/ball_5.webp">
  <img src="/img/Ball/orange/ball_7.webp">
  <img src="/img/Ball/orange/ball_2.webp">
  <div>Sunday, September 13, 2026</div>
  <div>06:00 AM</div>
  <div>Period: 25531</div>
  <img src="/img/Ball/orange/ball_1.webp">
  <img src="/img/Ball/orange/ball_8.webp">
  <img src="/img/Ball/orange/ball_7.webp">
`;

const parsed = parseResultPage(collectorFixture, 1);
if (parsed.length !== 2 || parsed[0].period !== 25532 || parsed[0].result !== "572") {
  throw new Error("Collector parser fixture failed.");
}

console.log(JSON.stringify({
  ok: true,
  version: "0.5.0",
  newest: analysis.history.newest,
  activeModel: analysis.meta.model,
  top3: analysis.top3.map((row) => row.number),
  backtestTrials: backtest.summary.trials,
  backtestEvidence: backtest.evidence.status,
  modelWinner: comparison.winner.id,
  modelWinnerBaseline: comparison.winner.evidence.status,
  validationGate: validation.gate.status,
  validationSplit: `${validation.meta.calibrationTrials}+${validation.meta.holdoutTrials}`,
  models: models.map((model) => model.id),
  collectorFixture: parsed.map((row) => `${row.period}:${row.result}`),
}, null, 2));
