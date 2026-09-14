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
const index093 = readFileSync(new URL("../src/index_v093.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v094-ai-v2.js", import.meta.url), "utf8");
const clarity = readFileSync(new URL("../public/v094-ai-v2-clarity.js", import.meta.url), "utf8");
const autoSync = readFileSync(new URL("../public/v094-autosync.js", import.meta.url), "utf8");
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
assert.match(index, /\/api\/main-sync/);
assert.match(index, /runAutoPilot\(env, \{ collect: true \}\)/);
assert.match(index, /runTwoStagePilot\(env\)/);
assert.match(index, /runKeeper7Pilot\(env\)/);
assert.match(index, /v094-ai-v2-clarity\.js/);
assert.match(index, /v094-autosync\.js/);
assert.match(index, /baseWorker\.scheduled/);
assert.match(index093, /main pipeline executes on every 5-minute cron tick/);
assert.doesNotMatch(index093, /minute % 10 === 0/);
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
assert.match(autoSync, /Asia\/Jakarta/);
assert.match(autoSync, /MAIN_AUTOSYNC_WINDOW_MINUTES = 5/);
assert.match(autoSync, /\/api\/main-sync/);
assert.match(autoSync, /AUTO-SYNC WAITING SOURCE/);
assert.match(autoSync, /AUTO-SYNC SYNCED/);
assert.match(autoSync, /EUROPE_AUTOSYNC_RETRY_MS = 20_000/);
assert.match(autoSync, /EUROPE_AUTOSYNC_MAX_WINDOW_MS = 8 \* 60_000/);
assert.match(autoSync, /europeCountdownZero/);
assert.match(autoSync, /#europeSyncBtn/);
assert.match(autoSync, /AUTO-SYNC Europe/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_v2_observations/);
assert.doesNotMatch(observer, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(observer, /UPDATE\s+europe_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(history, /UPDATE\s+europe_forward_runs/i);

console.log("AI V2 Phase 0 + locked history + main/Europe draw-window auto-sync smoke PASS");
