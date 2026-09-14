import { getEvidenceMonitor } from "./evidence_monitor.js";
import { getContinuousWatchdogStatus } from "./continuous_watchdog.js";

export const PREDICTION_INTELLIGENCE_VERSION = "1.0.3";

const WINDOW_WEIGHTS = { 10: 0.5, 25: 0.3, 50: 0.2 };
const MODEL_SCALES = {
  exactTop3Rate: 0.05,
  top10Rate: 0.08,
  permutationRate: 0.05,
  meanDigitOverlap: 0.25,
  meanPositionHits: 0.2,
};
const KEEPER_SCALES = {
  all3Rate: 0.1,
  meanCoverage: 0.25,
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function mean(values) {
  const finite = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function maturityPoints(nInput) {
  const n = Math.max(0, Number(nInput) || 0);
  if (n < 24) return 8 * (n / 24);
  if (n < 50) return 8 + 6 * ((n - 24) / 26);
  if (n < 100) return 14 + 5 * ((n - 50) / 50);
  if (n < 200) return 19 + 4 * ((n - 100) / 100);
  return 25;
}

function integrityPoints(watchdog, source) {
  const lane = watchdog?.bySource?.[source] || {};
  const chain = watchdog?.currentChain?.[source] || {};
  const missingObserver = Array.isArray(lane.missingObserverAnchors) ? lane.missingObserverAnchors.length : 0;
  const missingLocks = Array.isArray(lane.missingLockPeriods) ? lane.missingLockPeriods.length : 0;
  const shortfall = Number(lane.cadenceShortfallEstimate || 0);
  const rate = lane.captureRatePct == null ? null : Number(lane.captureRatePct);

  if (!chain.healthy) return 0;
  if (missingObserver || missingLocks || shortfall > 0) return 4;
  if (lane.status === "HEALTHY" && (rate == null || rate >= 99.5)) return 20;
  if (lane.status === "ARMING") return 15;
  if (lane.status === "DEGRADED") return 8;
  return 12;
}

function windowComposite(windowData, scales) {
  if (!windowData) return null;
  const requested = Number(windowData.requested || 0);
  const n = Number(windowData.n || 0);
  if (!requested || n < requested) return null;
  const observed = windowData.observed || {};
  const nullMean = windowData.nullMean || {};
  const ratios = [];
  for (const [metric, scale] of Object.entries(scales)) {
    const obs = Number(observed[metric]);
    const nul = Number(nullMean[metric]);
    if (!Number.isFinite(obs) || !Number.isFinite(nul)) continue;
    const lift = obs - nul;
    ratios.push(clamp(lift / scale, 0, 1));
  }
  return ratios.length ? mean(ratios) : null;
}

function rollingAnalysis(candidate, kind) {
  const scales = kind === "keeper" ? KEEPER_SCALES : MODEL_SCALES;
  const windows = candidate?.rolling || {};
  const composites = {};
  let weighted = 0;
  let stability = 0;

  for (const size of [10, 25, 50]) {
    const value = windowComposite(windows[size], scales);
    composites[size] = value == null ? null : round(value, 4);
    if (value == null) continue;
    weighted += WINDOW_WEIGHTS[size] * value;
    if (value >= 0.2) stability += size === 10 ? 5 : size === 25 ? 7 : 8;
  }

  const c10 = composites[10];
  const c25 = composites[25];
  const c50 = composites[50];
  let trend = "COLLECTING";
  let trendIndex = null;
  if (c10 != null && c25 != null && c50 != null) {
    trendIndex = (c10 - c25) * 0.6 + (c25 - c50) * 0.4;
    trend = trendIndex > 0.08 ? "IMPROVING" : trendIndex < -0.08 ? "COOLING" : "STABLE";
  } else if (c10 != null && c25 != null) {
    trendIndex = c10 - c25;
    trend = trendIndex > 0.08 ? "IMPROVING" : trendIndex < -0.08 ? "COOLING" : "STABLE";
  } else if (c10 != null) {
    trend = "EARLY";
  }

  return {
    composites,
    liftPoints: 35 * clamp(weighted, 0, 1),
    stabilityPoints: clamp(stability, 0, 20),
    trend,
    trendIndex: round(trendIndex, 4),
  };
}

function scoreLabel(score) {
  if (score < 25) return "COLLECT";
  if (score < 40) return "EARLY";
  if (score < 55) return "DEVELOPING";
  if (score < 70) return "INTERESTING";
  if (score < 85) return "PROMISING · NEED CALIBRATION";
  return "STRONG DESCRIPTIVE · VERIFY EDGE AUDIT";
}

function candidateScore(candidate, kind, source, watchdog) {
  const n = Number(candidate?.n || 0);
  const integrity = integrityPoints(watchdog, source);
  const maturity = maturityPoints(n);
  const rolling = rollingAnalysis(candidate, kind);
  const total = clamp(integrity + maturity + rolling.liftPoints + rolling.stabilityPoints, 0, 100);
  return {
    id: kind === "keeper" ? "keeper7" : String(candidate?.id || "model"),
    label: kind === "keeper" ? "Keeper7" : String(candidate?.label || candidate?.id || "Model"),
    kind,
    n,
    score: round(total, 1),
    labelCode: scoreLabel(total),
    trend: rolling.trend,
    trendIndex: rolling.trendIndex,
    components: {
      integrity: round(integrity, 1),
      maturity: round(maturity, 1),
      rollingLift: round(rolling.liftPoints, 1),
      rollingStability: round(rolling.stabilityPoints, 1),
    },
    rollingComposite: rolling.composites,
  };
}

function analyzeSource(source, evidence, watchdog) {
  const lane = evidence?.bySource?.[source] || {};
  const candidates = [];
  for (const model of lane.models || []) candidates.push(candidateScore(model, "model", source, watchdog));
  if (lane.keeper7) candidates.push(candidateScore(lane.keeper7, "keeper", source, watchdog));
  candidates.sort((a, b) => b.score - a.score || b.n - a.n || a.label.localeCompare(b.label));
  const fleetScore = mean(candidates.map((candidate) => candidate.score));
  return {
    source,
    settled: Number(lane.settled || 0),
    pending: Number(lane.pending || 0),
    gate: lane.gate || null,
    progress: lane.progress || null,
    watchdogStatus: watchdog?.bySource?.[source]?.status || "UNKNOWN",
    chainHealthy: Boolean(watchdog?.currentChain?.[source]?.healthy),
    captureRatePct: watchdog?.bySource?.[source]?.captureRatePct ?? null,
    fleetScore: round(fleetScore, 1),
    fleetLabel: fleetScore == null ? "NO DATA" : scoreLabel(fleetScore),
    leader: candidates[0] || null,
    candidates,
  };
}

export async function getPredictionIntelligenceScore(env) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Prediction Intelligence Score.");
  const [evidence, watchdog] = await Promise.all([
    getEvidenceMonitor(env),
    getContinuousWatchdogStatus(env),
  ]);

  const utama = analyzeSource("utama", evidence, watchdog);
  const europe = analyzeSource("europe", evidence, watchdog);
  const globalFleetScore = mean([utama.fleetScore, europe.fleetScore]);

  return {
    ok: true,
    version: PREDICTION_INTELLIGENCE_VERSION,
    mode: "READ_ONLY_PREDICTION_INTELLIGENCE_SCORE",
    global: {
      score: round(globalFleetScore, 1),
      label: globalFleetScore == null ? "NO DATA" : scoreLabel(globalFleetScore),
      bestCandidate: [utama.leader, europe.leader].filter(Boolean).sort((a, b) => b.score - a.score)[0] || null,
    },
    bySource: { utama, europe },
    watchdog: {
      status: watchdog?.status || "UNKNOWN",
      cronStatus: watchdog?.cron?.status || "UNKNOWN",
      scheduledCyclesLast60m: watchdog?.cron?.scheduledCyclesLast60m ?? null,
      maxHeartbeatGapSecondsLast60m: watchdog?.cron?.maxHeartbeatGapSecondsLast60m ?? null,
    },
    policy: {
      scoreIsProbability: false,
      scoreIsWinChance: false,
      scoreIsDescriptiveEvidenceIndex: true,
      noDatabaseWrites: true,
      lockedForwardEvidenceOnly: true,
      highScoreRequiresMaturityAndRollingLift: true,
      calibratedEdgeClaimStillRequiresEdgeAudit: true,
      interpretation: "0–100 merangkum integrity + sample maturity + rolling lift vs finite-sample null + multi-window stability. Bukan probabilitas menang dan bukan bukti edge statistik.",
    },
    weights: {
      integrityMax: 20,
      maturityMax: 25,
      rollingLiftMax: 35,
      rollingStabilityMax: 20,
    },
    generatedAt: new Date().toISOString(),
  };
}
