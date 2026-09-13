import { analyzeHistory, backtestHistory } from "../src/analyzer.js";
import { parseResultPage } from "../src/collector.js";

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
  version: "0.3.0",
  newest: analysis.history.newest,
  top3: analysis.top3.map((row) => row.number),
  backtestTrials: backtest.summary.trials,
  top3HitRatePct: backtest.summary.top3HitRatePct,
  top10HitRatePct: backtest.summary.top10HitRatePct,
  collectorFixture: parsed.map((row) => `${row.period}:${row.result}`),
}, null, 2));
