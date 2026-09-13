import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v094.js";
import {
  AI_V2_FEATURE_VERSION,
  AI_V2_PHASE,
  AI_V2_PHASE0_VERSION,
  ensureAiV2ObserverSchema,
  getAiV2ObserverStatus,
  runAiV2Observer,
} from "../src/ai_v2_observer.js";
import { AI_V2_HISTORY_VERSION, getAiV2History } from "../src/ai_v2_history.js";

assert.equal(AI_V2_PHASE, "OBSERVER");
assert.equal(AI_V2_PHASE0_VERSION, "0.1.0-observer");
assert.equal(AI_V2_FEATURE_VERSION, "phase0.features.v1");
assert.equal(AI_V2_HISTORY_VERSION, "0.1.0-history");
assert.equal(typeof ensureAiV2ObserverSchema, "function");
assert.equal(typeof getAiV2ObserverStatus, "function");
assert.equal(typeof runAiV2Observer, "function");
assert.equal(typeof getAiV2History, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const observer = readFileSync(new URL("../src/ai_v2_observer.js", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/ai_v2_history.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v094.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v094-ai-v2.js", import.meta.url), "utf8");
const clarity = readFileSync(new URL("../public/v094-ai-v2-clarity.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0009_ai_v2_phase0.sql", import.meta.url), "utf8");

assert.match(observer, /WHERE status='pending'/);
assert.match(observer, /predictionEnabled:\s*false/);
assert.match(observer, /noHistoricalBackfillAsTraining:\s*true/);
assert.match(observer, /writesToV1:\s*false/);
assert.match(observer, /ai_v2_observations/);
assert.match(observer, /source_lock_created_at/);
assert.match(history, /LOCKED_HISTORY_ONLY/);
assert.match(history, /regenerateOldPrediction:\s*false/);
assert.match(history, /source_status_at_capture === "pending"/);
assert.match(history, /predictionHistory/);
assert.match(history, /resultHistory/);
assert.match(index, /\/api\/ai-v2/);
assert.match(index, /\/api\/ai-v2-history/);
assert.match(index, /\/api\/ai-v2-sync/);
assert.match(index, /v094-ai-v2-clarity\.js/);
assert.match(index, /baseWorker\.scheduled/);
assert.match(ui, /AI V2/);
assert.match(ui, /NO AI PREDICTION/);
assert.match(ui, /SNAPSHOT NOW/);
assert.match(ui, /Histori Result & Histori Tebakan/);
assert.match(ui, /LOCKED BEFORE RESULT/);
assert.match(ui, /3D UTAMA · KEEP7/);
assert.match(ui, /EUROPE · KEEP7/);
assert.match(clarity, /TEBAKAN UNTUK PERIOD/);
assert.match(clarity, /LOCK ASLI/);
assert.match(clarity, /ai2Utama3dHistory/);
assert.match(clarity, /ai2EuropeKeeperHistory/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_v2_observations/);
assert.doesNotMatch(observer, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+europe_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+europe_forward_runs/i);

console.log("AI V2 Phase 0 observer + locked history + clarity smoke PASS");
