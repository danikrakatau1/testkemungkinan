import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v095.js";
import {
  RANDOMNESS_FORENSICS_VERSION,
  analyzeRandomnessRows,
  getRandomnessForensics,
} from "../src/randomness_forensics.js";

assert.equal(RANDOMNESS_FORENSICS_VERSION, "1.0.0");
assert.equal(typeof analyzeRandomnessRows, "function");
assert.equal(typeof getRandomnessForensics, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const pathological = Array.from({ length: 300 }, (_, i) => ({
  period: 10000 + i,
  result: "000",
  drawDate: `2026-09-${String(1 + Math.floor(i / 24)).padStart(2, "0")}`,
  drawTime: `${String(i % 24).padStart(2, "0")}:00`,
}));
const bad = analyzeRandomnessRows(pathological);
assert.equal(bad.ok, true);
assert.equal(bad.dataset.draws, 300);
assert.notEqual(bad.verdict.code, "CONSISTENT_WITH_RANDOMNESS");
assert.ok(Number(bad.tests.digitUniformity.p) < 0.001);
assert.ok(Number(bad.tests.entropy.normalized) < 0.1);

const balanced = [];
for (let i = 0; i < 300; i += 1) {
  const a = i % 10;
  const b = (i * 3 + 1) % 10;
  const c = (i * 7 + 4) % 10;
  balanced.push({ period: 20000 + i, result: `${a}${b}${c}`, drawDate: "2026-09-01", drawTime: `${String(i % 24).padStart(2, "0")}:00` });
}
const report = analyzeRandomnessRows(balanced);
assert.equal(report.dataset.draws, 300);
assert.equal(report.tests.positionUniformity.length, 3);
assert.equal(report.tests.serialCorrelation.lags.length, 24);
assert.equal(report.tests.transition.matrix.length, 10);
assert.equal(report.tests.transition.matrix[0].length, 10);
assert.ok(Array.isArray(report.tests.rollingDrift.windows));
assert.ok(report.policy.databaseWrites === false);
assert.ok(report.policy.changesPredictionWeights === false);

const source = readFileSync(new URL("../src/randomness_forensics.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v095.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v095-forensics.js", import.meta.url), "utf8");

assert.match(source, /SELECT period, result, draw_date AS drawDate, draw_time AS drawTime/);
assert.doesNotMatch(source, /\bINSERT\b/i);
assert.doesNotMatch(source, /\bUPDATE\b/i);
assert.doesNotMatch(source, /\bDELETE\b/i);
assert.doesNotMatch(source, /\bCREATE\s+TABLE\b/i);
assert.match(source, /serialCorrelation/);
assert.match(source, /rollingDrift/);
assert.match(source, /mutualInformation/);
assert.match(source, /hourBias/);
assert.match(source, /weekdayBias/);
assert.match(index, /\/api\/forensics/);
assert.match(index, /Randomness Forensics bersifat read-only/);
assert.match(index, /v095-forensics\.js/);
assert.match(ui, /FORENSICS/);
assert.match(ui, /READ ONLY/);
assert.match(ui, /CONSISTENT WITH RANDOMNESS/);

console.log("Randomness Forensics read-only smoke PASS");
