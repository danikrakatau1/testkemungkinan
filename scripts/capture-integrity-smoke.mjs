import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v100.js";
import { CAPTURE_INTEGRITY_VERSION, getCaptureIntegrityStatus } from "../src/capture_integrity.js";
import { ORDERED_CAPTURE_VERSION, runOrderedCaptureCycle } from "../src/ordered_capture.js";
import { LAB_REVIEW_V100_VERSION } from "../src/lab_review_orchestrator_v100.js";

assert.equal(CAPTURE_INTEGRITY_VERSION, "1.0.0");
assert.equal(ORDERED_CAPTURE_VERSION, "1.0.0");
assert.equal(LAB_REVIEW_V100_VERSION, "1.0.0");
assert.equal(typeof getCaptureIntegrityStatus, "function");
assert.equal(typeof runOrderedCaptureCycle, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const integrity = readFileSync(new URL("../src/capture_integrity.js", import.meta.url), "utf8");
const ordered = readFileSync(new URL("../src/ordered_capture.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v100.js", import.meta.url), "utf8");
const review = readFileSync(new URL("../src/lab_review_orchestrator_v100.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v100-capture-integrity.js", import.meta.url), "utf8");

assert.match(integrity, /reliable_collection_started_at/);
assert.match(integrity, /INCOMPLETE_CAPTURE_WINDOW/);
assert.match(integrity, /missingObservationAnchors/);
assert.match(integrity, /missingLockPeriods/);
assert.match(integrity, /cadenceShortfallEstimate/);
assert.match(integrity, /noHistoricalBackfillAsForward:\s*true/);

assert.match(ordered, /runAutoPilot/);
assert.match(ordered, /runTwoStagePilot/);
assert.match(ordered, /runKeeper7Pilot/);
assert.match(ordered, /runEuropePilot/);
assert.match(ordered, /Promise\.all/);
assert.match(ordered, /observer\.capture-after-lock-barrier/);
assert.match(ordered, /runAiV2Observer/);

assert.match(index, /\/api\/capture-integrity/);
assert.match(index, /\/api\/ordered-sync/);
assert.match(index, /url\.pathname === "\/api\/main-sync"/);
assert.match(index, /runOrderedCaptureCycle/);
assert.match(index, /runLabReviewIfDueV100/);
assert.doesNotMatch(index, /baseWorker\.scheduled\(/);
assert.match(index, /single\s*\n\s*\/\/ cron authority|single\s+cron authority/i);

assert.match(review, /RELIABLE_24H_V1/);
assert.match(review, /reliable_collection_started_at|RELIABLE_COLLECTION_META_KEY/);
assert.match(review, /CAPTURE_INTEGRITY_ALERT/);
assert.match(review, /old wall-clock timer is not treated as continuous 24H capture coverage/);

assert.match(ui, /CAPTURE 🛡️/);
assert.match(ui, /RUN ORDERED SYNC/);
assert.match(ui, /INCOMPLETE CAPTURE WINDOW/);
assert.match(ui, /source → settlement → semua lock → observer/);

console.log("Ordered Capture Integrity V1.0.0 smoke PASS");
