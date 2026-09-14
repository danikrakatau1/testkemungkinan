import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v098.js";
import { EVIDENCE_MONITOR_VERSION, analyzeEvidenceRecords } from "../src/evidence_monitor.js";

assert.equal(EVIDENCE_MONITOR_VERSION, "1.0.0");
assert.equal(typeof analyzeEvidenceRecords, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const records = [];
for (let i = 0; i < 12; i += 1) {
  const actual = String(100 + i).padStart(3, "0");
  records.push({
    id: i + 1,
    source: "utama",
    status: "settled",
    lockedBeforeResult: true,
    anchorPeriod: 30000 + i,
    targetPeriod: 30001 + i,
    actual,
    models: [{ id: "legacy", label: "Legacy", top3: i === 11 ? [actual, "999", "998"] : ["999", "998", "997"], top10: [] }],
    keeper: { keep7: [0, 1, 2, 3, 4, 5, 6], drop3: [7, 8, 9] },
  });
}
records.push({
  id: 20,
  source: "utama",
  status: "pending",
  lockedBeforeResult: true,
  anchorPeriod: 30012,
  targetPeriod: 30013,
  actual: null,
  models: [],
  keeper: null,
});
for (let i = 0; i < 25; i += 1) {
  const actual = String(400 + i).padStart(3, "0");
  records.push({
    id: 100 + i,
    source: "europe",
    status: "settled",
    lockedBeforeResult: true,
    anchorPeriod: 17000 + i,
    targetPeriod: 17001 + i,
    actual,
    models: [{ id: "two-stage", label: "Two-Stage", top3: ["111", "222", "333"], top10: [] }],
    keeper: { keep7: [0, 1, 2, 3, 4, 5, 6], drop3: [7, 8, 9] },
  });
}

const report = analyzeEvidenceRecords(records);
assert.equal(report.ok, true);
assert.equal(report.mode, "READ_ONLY_EVIDENCE_MONITOR");
assert.equal(report.bySource.utama.settled, 12);
assert.equal(report.bySource.utama.pending, 1);
assert.equal(report.bySource.utama.gate.code, "COLLECT");
assert.equal(report.bySource.utama.progress.nextMilestone, 24);
assert.equal(report.bySource.utama.progress.remaining, 12);
assert.equal(report.bySource.europe.settled, 25);
assert.equal(report.bySource.europe.gate.code, "EARLY");
assert.equal(report.bySource.europe.progress.nextMilestone, 50);
assert.equal(report.bySource.europe.progress.remaining, 25);
assert.ok(report.bySource.utama.models[0].rolling[10]);
assert.ok(report.bySource.europe.keeper7.rolling[25]);
assert.equal(report.policy.databaseWrites, false);
assert.equal(report.policy.changesPredictionWeights, false);

const engine = readFileSync(new URL("../src/evidence_monitor.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v098.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v098-evidence.js", import.meta.url), "utf8");
assert.match(engine, /SELECT id, source, status/);
assert.doesNotMatch(engine, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b\s+(?:INTO\s+)?ai_v2_observations/i);
assert.match(engine, /rollingWindows:\s*WINDOWS/);
assert.match(engine, /watchlistMeaning/);
assert.match(index, /\/api\/evidence-monitor/);
assert.match(index, /v098-evidence\.js/);
assert.match(ui, /EVIDENCE 📊/);
assert.match(ui, /AUTO REFRESH 60S/);
assert.match(ui, /EDGE AUDIT/);

console.log("Evidence Monitor V0.9.8 smoke PASS");
