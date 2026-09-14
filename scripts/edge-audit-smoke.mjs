import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v097.js";
import { FORWARD_EDGE_AUDIT_VERSION, analyzeForwardEdge } from "../src/edge_audit.js";

assert.equal(FORWARD_EDGE_AUDIT_VERSION, "1.0.0");
assert.equal(typeof analyzeForwardEdge, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const records = Array.from({ length: 120 }, (_, i) => {
  const actual = String((i * 137 + 41) % 1000).padStart(3, "0");
  const actualDigits = [...new Set(actual.split("").map(Number))];
  const keep = [...actualDigits];
  for (let d = 0; d <= 9 && keep.length < 7; d += 1) if (!keep.includes(d)) keep.push(d);
  return {
    id: i + 1,
    source: "utama",
    anchorPeriod: 25000 + i,
    actual,
    models: [{ id: "synthetic", label: "Synthetic", top3: [actual, "000", "999"], top10: [actual] }],
    keeper: { keep7: keep.slice(0, 7), drop3: Array.from({ length: 10 }, (_, d) => d).filter((d) => !keep.includes(d)).slice(0, 3), assistedTop3: [actual] },
  };
});

const calibrated = analyzeForwardEdge(records, { simulations: 300 });
assert.equal(calibrated.ok, true);
assert.equal(calibrated.bySource.utama.n, 120);
assert.equal(calibrated.bySource.utama.gate.code, "EVIDENCE");
const synthetic = calibrated.bySource.utama.models.find((model) => model.id === "synthetic");
assert.ok(synthetic);
assert.equal(synthetic.observed.exactTop3Rate, 1);
assert.ok(synthetic.metrics.exactTop3Rate.empiricalP < 0.01);
assert.equal(synthetic.replication.sameDirectionAboveNull, true);
assert.ok(["CALIBRATED_EDGE_CANDIDATE", "POSSIBLE_EDGE_REPLICATE"].includes(synthetic.verdict));

const tiny = analyzeForwardEdge(records.slice(0, 10), { simulations: 100 });
assert.equal(tiny.bySource.utama.gate.code, "COLLECT");
assert.equal(tiny.bySource.utama.models[0].verdict, "INSUFFICIENT_FORWARD_SAMPLE");

const engine = readFileSync(new URL("../src/edge_audit.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v097.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v097-edge-audit.js", import.meta.url), "utf8");
assert.match(engine, /FROM ai_v2_observations/);
assert.match(engine, /status='settled'/);
assert.match(engine, /source_status_at_capture='pending'/);
assert.doesNotMatch(engine, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
assert.match(engine, /Bonferroni family adjustment/);
assert.match(engine, /sameDirectionAboveNull/);
assert.match(index, /\/api\/edge-audit/);
assert.match(index, /READ-ONLY|read-only/i);
assert.match(ui, /EDGE AUDIT/);
assert.match(ui, /RUN CALIBRATION/);
assert.match(ui, /LOCKED BEFORE RESULT/);
assert.match(ui, /UTAMA/);
assert.match(ui, /EUROPE/);

console.log("Forward Edge Audit read-only + calibration smoke PASS");
