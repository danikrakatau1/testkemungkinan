import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_V2_FEATURE_VERSION,
  AI_V2_PHASE,
  AI_V2_PHASE0_VERSION,
  ensureAiV2ObserverSchema,
  getAiV2ObserverStatus,
  runAiV2Observer,
} from "../src/ai_v2_observer.js";

assert.equal(AI_V2_PHASE, "OBSERVER");
assert.equal(AI_V2_PHASE0_VERSION, "0.1.0-observer");
assert.equal(AI_V2_FEATURE_VERSION, "phase0.features.v1");
assert.equal(typeof ensureAiV2ObserverSchema, "function");
assert.equal(typeof getAiV2ObserverStatus, "function");
assert.equal(typeof runAiV2Observer, "function");

const observer = readFileSync(new URL("../src/ai_v2_observer.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v094.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v094-ai-v2.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0009_ai_v2_phase0.sql", import.meta.url), "utf8");

assert.match(observer, /WHERE status='pending'/);
assert.match(observer, /predictionEnabled:\s*false/);
assert.match(observer, /noHistoricalBackfillAsTraining:\s*true/);
assert.match(observer, /writesToV1:\s*false/);
assert.match(observer, /ai_v2_observations/);
assert.match(observer, /source_lock_created_at/);
assert.match(index, /\/api\/ai-v2/);
assert.match(index, /\/api\/ai-v2-sync/);
assert.match(index, /baseWorker\.scheduled/);
assert.match(ui, /AI V2/);
assert.match(ui, /NO AI PREDICTION/);
assert.match(ui, /SNAPSHOT NOW/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_v2_observations/);
assert.doesNotMatch(observer, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+europe_forward_runs/i);

console.log("AI V2 Phase 0 observer smoke PASS");
