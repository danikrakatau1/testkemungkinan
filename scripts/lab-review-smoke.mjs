import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index_v099.js";
import {
  LAB_REVIEW_DEFAULT_SIMS,
  LAB_REVIEW_VERSION,
  ensureLabReviewSchema,
  getLabReviewStatus,
  runLabReview,
  runLabReviewIfDue,
} from "../src/lab_review_orchestrator.js";

assert.equal(LAB_REVIEW_VERSION, "1.0.0");
assert.equal(LAB_REVIEW_DEFAULT_SIMS, 1000);
assert.equal(typeof ensureLabReviewSchema, "function");
assert.equal(typeof getLabReviewStatus, "function");
assert.equal(typeof runLabReview, "function");
assert.equal(typeof runLabReviewIfDue, "function");
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");

const orchestrator = readFileSync(new URL("../src/lab_review_orchestrator.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index_v099.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../public/v099-lab-review.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0010_lab_review_orchestrator.sql", import.meta.url), "utf8");

assert.match(orchestrator, /PHASE0_24H/);
assert.match(orchestrator, /UTAMA_\$\{milestone\}/);
assert.match(orchestrator, /EUROPE/);
assert.match(orchestrator, /EXTEND_COLLECTION/);
assert.match(orchestrator, /REVIEW_READY/);
assert.match(orchestrator, /EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED/);
assert.match(orchestrator, /getForwardEdgeAudit/);
assert.match(orchestrator, /getRandomnessForensics/);
assert.match(orchestrator, /getRandomnessMonteCarlo/);
assert.match(orchestrator, /reportTableWritesOnly:\s*true/);
assert.match(orchestrator, /automaticAiPhaseChange:\s*false/);
assert.match(orchestrator, /automaticWeightChange:\s*false/);
assert.doesNotMatch(orchestrator, /UPDATE\s+arena_forward_runs/i);
assert.doesNotMatch(orchestrator, /UPDATE\s+keeper7_forward_runs/i);
assert.doesNotMatch(orchestrator, /UPDATE\s+two_stage_forward_runs/i);
assert.doesNotMatch(orchestrator, /UPDATE\s+europe_forward_runs/i);
assert.doesNotMatch(orchestrator, /UPDATE\s+ai_v2_observations/i);

assert.match(index, /\/api\/lab-review/);
assert.match(index, /\/api\/lab-review\/run/);
assert.match(index, /runLabReviewIfDue/);
assert.match(index, /v099-lab-review\.js/);
assert.match(index, /v099-lab-review\.css/);

assert.match(ui, /LAB REVIEW/);
assert.match(ui, /24H countdown/);
assert.match(ui, /RUN REVIEW NOW/);
assert.match(ui, /HUMAN REVIEW REQUIRED/);
assert.match(ui, /percentToNext/);
assert.match(ui, /AUTO armed/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_review_reports/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS lab_review_completed_triggers/);

console.log("Lab Review Orchestrator V0.9.9 smoke PASS");
