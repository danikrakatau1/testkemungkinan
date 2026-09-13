import {
  analyzeHistory,
  backtestHistory,
  compareModels,
  listModels,
} from "../src/analyzer.js";
import { validateWeightedEnsemble } from "../src/validation.js";
import { validateWalkForwardWindow } from "../src/validation_window.js";
import { validateWalkForwardWindowReference } from "../src/validation_window_reference.js";
import { parseResultPage } from "../src/collector.js";
import { scoreForwardOutcome } from "../src/forward.js";

const history = [
  "226", "572", "187", "900", "240", "571", "840",
  "828", "983", "236", "620", "161", "717",
];

const validationHistory = Array.from(
  { length: 180 },
  (_, index) => String((226 + index * 137 + index * index * 11) % 1000).padStart(3, "0"),
);

const analysis = analyzeHistory(history, { decay: 0.9, modelId: "ensemble" });
const backtest = backtestHistory(history, { decay: 0.9, modelId: "balanced", minTrain: 8, maxTrials: 20 });
const comparison = compareModels(history, { decay: 0.9, minTrain: 8, maxTrials: 20 });
const validation = validateWeightedEnsemble(validationHistory, { decay: 0.9, minTrain: 8, maxTrials: 30, holdoutTrials: 10 });
const windowValidation = validateWalkForwardWindow(validationHistory, { decay: 0.9, minTrain: 8 });
const referenceValidation = validateWalkForwardWindowReference(validationHistory, { decay: 0.9, minTrain: 8 });
const models = listModels();

if (analysis.top3.length !== 3 || analysis.top10.length !== 10) throw new Error("Analyzer ranking length invalid.");
if (!analysis.top3.every((row) => /^\d{3}$/.test(row.number))) throw new Error("Analyzer returned an invalid 3-digit candidate.");
if (!analysis.top3.every((row) => row.consensus && row.consensus.models === 4)) throw new Error("Ensemble consensus metadata missing.");
if (backtest.summary.trials < 1 || !backtest.evidence?.pValues) throw new Error("Backtest evidence invalid.");
if (models.length !== 5 || comparison.leaderboard.length !== 5 || !comparison.winner) throw new Error("Model leaderboard invalid.");
if (!comparison.leaderboard.every((row) => row.evidence && Number.isFinite(row.evidence.meanRankDelta))) throw new Error("Leaderboard baseline evidence missing.");

const validationWeightSum = validation.weights.reduce((total, row) => total + row.weight, 0);
if (
  validation.meta.calibrationTrials !== 20 ||
  validation.meta.holdoutTrials !== 10 ||
  Math.abs(validationWeightSum - 1) > 0.01 ||
  validation.currentWeighted.top3.length !== 3 ||
  validation.holdout.trials.length !== 10
) throw new Error("Single-window Validation Gate output invalid.");

const windowWeightSum = windowValidation.weights.reduce((total, row) => total + row.weight, 0);
if (
  windowValidation.meta.calibrationTrials !== 12 ||
  windowValidation.meta.holdoutTrials !== 6 ||
  windowValidation.meta.trainingWindowDraws !== 80 ||
  Math.abs(windowWeightSum - 1) > 0.01 ||
  windowValidation.currentWeighted.top3.length !== 3 ||
  windowValidation.holdout.trials.length !== 6
) throw new Error("Walk-forward window output invalid.");

function parityShape(result) {
  return {
    gate: { passed: result.gate?.passed, status: result.gate?.status },
    weights: (result.weights || []).map((row) => ({ id: row.id, weight: row.weight, weightPct: row.weightPct })),
    calibration: (result.calibration || []).map((row) => ({
      id: row.id,
      trials: row.trials,
      top3Hits: row.top3Hits,
      top10Hits: row.top10Hits,
      top25Hits: row.top25Hits,
      meanTargetRank: row.meanTargetRank,
    })),
    holdoutWeighted: {
      trials: result.holdout?.weighted?.trials,
      top3Hits: result.holdout?.weighted?.top3Hits,
      top10Hits: result.holdout?.weighted?.top10Hits,
      top25Hits: result.holdout?.weighted?.top25Hits,
      meanTargetRank: result.holdout?.weighted?.meanTargetRank,
      meanRankDelta: result.holdout?.weighted?.evidence?.meanRankDelta,
      pValues: result.holdout?.weighted?.evidence?.pValues,
    },
    holdoutBorda: {
      trials: result.holdout?.borda?.trials,
      top3Hits: result.holdout?.borda?.top3Hits,
      top10Hits: result.holdout?.borda?.top10Hits,
      top25Hits: result.holdout?.borda?.top25Hits,
      meanTargetRank: result.holdout?.borda?.meanTargetRank,
    },
    trials: (result.holdout?.trials || []).map((row) => ({
      target: row.target,
      weightedRank: row.weightedRank,
      bordaRank: row.bordaRank,
      trainingDraws: row.trainingDraws,
    })),
    top3: (result.currentWeighted?.top3 || []).map((row) => ({ rank: row.rank, number: row.number, score: row.score })),
  };
}

const parityPass = JSON.stringify(parityShape(windowValidation)) === JSON.stringify(parityShape(referenceValidation));
if (!parityPass) throw new Error("Walk-forward production/reference parity drift detected.");

const forwardFixture = scoreForwardOutcome({
  top3: ["940", "920", "926"],
  top10: ["940", "920", "926", "980", "946", "906", "970", "986", "246", "540"],
  actual: "429",
  actualRank: 77,
});
if (
  forwardFixture.exactTop3 ||
  forwardFixture.permutationHit ||
  forwardFixture.bestDigitOverlap !== 2 ||
  forwardFixture.bestPositionHits !== 1 ||
  forwardFixture.poolDigitCoverage !== 3 ||
  forwardFixture.actualRank !== 77
) throw new Error("Forward scorecard fixture failed.");

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
if (parsed.length !== 2 || parsed[0].period !== 25532 || parsed[0].result !== "572") throw new Error("Collector parser fixture failed.");

console.log(JSON.stringify({
  ok: true,
  version: "0.6.7",
  newest: analysis.history.newest,
  top3: analysis.top3.map((row) => row.number),
  backtestTrials: backtest.summary.trials,
  modelWinner: comparison.winner.id,
  validationSplit: `${validation.meta.calibrationTrials}+${validation.meta.holdoutTrials}`,
  walkForwardSplit: `${windowValidation.meta.calibrationTrials}+${windowValidation.meta.holdoutTrials}`,
  walkForwardTrainingWindow: windowValidation.meta.trainingWindowDraws,
  engineParity: parityPass ? "PASS" : "FAIL",
  parityAuditPage: "/parity.html",
  experimentLock: "D1-backed snapshot persistence is exercised after deploy via /api/experiments",
  driftTracker: "V0.6.6 client-side comparisons over persisted experiment runs",
  forwardScorecard: forwardFixture,
  models: models.map((model) => model.id),
  collectorFixture: parsed.map((row) => `${row.period}:${row.result}`),
}, null, 2));
