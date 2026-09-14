import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v096.js";
import { RANDOMNESS_FORENSICS_MC_VERSION, calibrateRandomnessRows } from "../src/randomness_forensics_mc.js";

assert.equal(RANDOMNESS_FORENSICS_MC_VERSION, "1.1.0");
assert.equal(typeof calibrateRandomnessRows, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const rows = [];
for (let i = 0; i < 300; i += 1) {
  rows.push({ period: 1000 + i, result: i % 2 === 0 ? "000" : "999" });
}
const report = calibrateRandomnessRows(rows, { simulations: 100 });
assert.equal(report.ok, true);
assert.equal(report.mode, "READ_ONLY_MONTE_CARLO_PERMUTATION");
assert.equal(report.simulation.count, 100);
assert.equal(report.policy.databaseWrites, false);
assert.equal(report.policy.changesPredictionWeights, false);
assert.equal(report.policy.changesAiV2, false);
assert.ok(report.calibration.maxAbsSerialLag1To24.observed >= 0.99);
assert.ok(report.calibration.maxAbsSerialLag1To24.empiricalP <= 0.02);
assert.ok(report.calibration.transitionCramersV.empiricalP <= 0.02);

const moduleText = readFileSync(new URL("../src/randomness_forensics_mc.js", import.meta.url), "utf8");
const indexText = readFileSync(new URL("../src/index_v096.js", import.meta.url), "utf8");
const uiText = readFileSync(new URL("../public/v096-forensics-mc.js", import.meta.url), "utf8");
assert.match(moduleText, /SELECT period, result/);
assert.doesNotMatch(moduleText, /\b(?:INSERT|UPDATE|DELETE)\b\s+/i);
assert.match(moduleText, /READ_ONLY_MONTE_CARLO_PERMUTATION/);
assert.match(moduleText, /Randomly permute the observed draw order/);
assert.match(indexText, /\/api\/forensics-mc/);
assert.match(indexText, /v096-forensics-mc\.js/);
assert.match(uiText, /Monte Carlo \/ Permutation Calibration/);
assert.match(uiText, /RUN MONTE CARLO/);
assert.match(uiText, /1,000 sims/);

console.log("Randomness Forensics V1.1 Monte Carlo permutation smoke PASS");
