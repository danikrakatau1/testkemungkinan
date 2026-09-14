import { runAutoPilot } from "./autopilot.js";
import { runTwoStagePilot } from "./two_stage_forward.js";
import { runKeeper7Pilot } from "./keeper7_forward.js";
import { runEuropePilot } from "./europe_pilot.js";
import { runAiV2Observer } from "./ai_v2_observer.js";
import {
  CAPTURE_INTEGRITY_VERSION,
  ensureReliableCollectionStart,
  getCaptureIntegrityStatus,
  recordOrderedCycleMeta,
} from "./capture_integrity.js";

export const ORDERED_CAPTURE_VERSION = "1.0.0";

async function safeStage(label, fn) {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, label, elapsedMs: Date.now() - started, value };
  } catch (error) {
    return {
      ok: false,
      label,
      elapsedMs: Date.now() - started,
      error: error?.message || String(error),
      value: null,
    };
  }
}

async function runUtamaLane(env, options = {}) {
  const stages = [];
  const autopilot = await safeStage("utama.autopilot", () => runAutoPilot(env, { collect: options.collect !== false }));
  stages.push(autopilot);

  const twoStage = await safeStage("utama.two-stage", () => runTwoStagePilot(env));
  stages.push(twoStage);

  const keeper7 = await safeStage("utama.keeper7", () => runKeeper7Pilot(env));
  stages.push(keeper7);

  return {
    ok: stages.every((row) => row.ok),
    stages,
    latestPeriod: autopilot.value?.latest?.period ?? keeper7.value?.latest?.period ?? null,
    pendingKeeperAnchor: keeper7.value?.pending?.anchorPeriod ?? null,
  };
}

async function runEuropeLane(env, options = {}) {
  const europe = await safeStage("europe.pipeline", () => runEuropePilot(env, {
    collect: options.collect !== false,
    backfill: options.backfillEurope === true,
  }));
  return {
    ok: europe.ok,
    stages: [europe],
    latestPeriod: europe.value?.latest?.period ?? null,
    pendingAnchor: europe.value?.pending?.anchorPeriod ?? null,
  };
}

export async function runOrderedCaptureCycle(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Ordered Capture Integrity.");
  const cycleStartedAt = new Date().toISOString();
  const reliable = await ensureReliableCollectionStart(env, { startedAt: cycleStartedAt });

  // Source lanes may run in parallel, but each lane is internally ordered.
  // The observer is behind a hard Promise.all barrier and cannot run until both
  // lanes have finished creating/settling their current forward locks.
  const [utama, europe] = await Promise.all([
    runUtamaLane(env, options),
    runEuropeLane(env, options),
  ]);

  const observer = await safeStage("observer.capture-after-lock-barrier", () => runAiV2Observer(env));
  const cycle = {
    ok: utama.ok && europe.ok && observer.ok,
    version: ORDERED_CAPTURE_VERSION,
    captureIntegrityVersion: CAPTURE_INTEGRITY_VERSION,
    cycleStartedAt,
    reliableCollectionStartedAt: reliable.startedAt,
    reliableMarkerCreated: reliable.created,
    ordering: [
      "UTAMA collect/settle/Arena",
      "UTAMA Two-Stage",
      "UTAMA Keeper7",
      "EUROPE collect/settle/model+Keeper7",
      "BARRIER: both source lanes complete",
      "AI V2 observer settle + capture pending locks",
      "Capture Integrity audit",
    ],
    lanes: { utama, europe },
    observer,
  };

  await recordOrderedCycleMeta(env, {
    ok: cycle.ok,
    cycleStartedAt,
    reliableCollectionStartedAt: reliable.startedAt,
    utamaOk: utama.ok,
    europeOk: europe.ok,
    observerOk: observer.ok,
    utamaLatestPeriod: utama.latestPeriod,
    europeLatestPeriod: europe.latestPeriod,
    observerCaptures: observer.value?.pipeline?.captures || [],
  });

  let integrity = null;
  try { integrity = await getCaptureIntegrityStatus(env); } catch (error) {
    integrity = { ok: false, error: error?.message || String(error) };
  }

  return {
    ...cycle,
    integrity,
    now: new Date().toISOString(),
  };
}
