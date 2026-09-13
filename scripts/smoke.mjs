import { analyzeHistory, backtestHistory } from "../src/analyzer.js";

const history = [
  "572", "187", "900", "240", "571", "840",
  "828", "983", "236", "620", "161", "717",
];

const analysis = analyzeHistory(history, { decay: 0.9 });
const backtest = backtestHistory(history, { decay: 0.9, minTrain: 8, maxTrials: 20 });

if (analysis.top3.length !== 3 || analysis.top10.length !== 10) {
  throw new Error("Analyzer ranking length invalid.");
}

if (!analysis.top3.every((row) => /^\d{3}$/.test(row.number))) {
  throw new Error("Analyzer returned an invalid 3-digit candidate.");
}

if (backtest.summary.trials < 1) {
  throw new Error("Backtest produced no trials.");
}

console.log(JSON.stringify({
  ok: true,
  version: "0.2.0",
  newest: analysis.history.newest,
  top3: analysis.top3.map((row) => row.number),
  backtestTrials: backtest.summary.trials,
  top3HitRatePct: backtest.summary.top3HitRatePct,
  top10HitRatePct: backtest.summary.top10HitRatePct,
}, null, 2));
