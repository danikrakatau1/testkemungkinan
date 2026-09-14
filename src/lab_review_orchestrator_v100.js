import { getEvidenceMonitor } from "./evidence_monitor.js";
import { getForwardEdgeAudit } from "./edge_audit.js";
import { getRandomnessForensics } from "./randomness_forensics.js";
import { getRandomnessMonteCarlo } from "./randomness_forensics_mc.js";
import { ensureLabReviewSchema } from "./lab_review_orchestrator.js";
import { getCaptureIntegrityStatus, RELIABLE_COLLECTION_META_KEY } from "./capture_integrity.js";

export const LAB_REVIEW_V100_VERSION = "1.0.0";
export const LAB_REVIEW_V100_DEFAULT_SIMS = 1000;
const MILESTONES = [24, 50, 100, 200];
const HOUR_MS = 60 * 60 * 1000;
const RELIABLE_24H_TRIGGER = "RELIABLE_24H_V1";

function safeJson(value, fallback = null) {
  try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); }
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function clampSims(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LAB_REVIEW_V100_DEFAULT_SIMS;
  return Math.max(100, Math.min(2500, Math.trunc(n)));
}

async function firstRow(statement) {
  const result = await statement.all();
  return result.results?.[0] || null;
}

async function metaValue(db, key) {
  const row = await firstRow(db.prepare("SELECT meta_value FROM ai_v2_meta WHERE meta_key=? LIMIT 1").bind(key));
  return row?.meta_value || null;
}

function isoMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function hoursBetween(start, end = Date.now()) {
  const ms = isoMs(start);
  return ms == null ? null : Math.max(0, (end - ms) / HOUR_MS);
}

async function reliableStartedAt(db) {
  return metaValue(db, RELIABLE_COLLECTION_META_KEY);
}

async function legacyPhaseStartedAt(db) {
  return metaValue(db, "phase0_started_at");
}

async function completedTriggerSet(db) {
  const result = await db.prepare("SELECT trigger_key FROM lab_review_completed_triggers").all();
  return new Set((result.results || []).map((row) => String(row.trigger_key)));
}

function allPotentialTriggers(startedAt, evidence, nowMs = Date.now()) {
  const triggers = [];
  const startMs = isoMs(startedAt);
  if (startMs != null && nowMs >= startMs + 24 * HOUR_MS) {
    triggers.push({ key: RELIABLE_24H_TRIGGER, kind: "time", label: "RELIABLE 24H CAPTURE COMPLETE" });
  }
  for (const source of ["utama", "europe"]) {
    const settled = Number(evidence?.bySource?.[source]?.settled || 0);
    for (const milestone of MILESTONES) {
      if (settled >= milestone) {
        triggers.push({
          key: `${source.toUpperCase()}_${milestone}`,
          kind: "milestone",
          source,
          milestone,
          label: `${source.toUpperCase()} ${milestone} SETTLED`,
        });
      }
    }
  }
  return triggers;
}

function nextMilestone(settled) {
  const current = Number(settled || 0);
  const next = MILESTONES.find((value) => current < value) || null;
  return { current, next, remaining: next == null ? 0 : Math.max(0, next - current) };
}

function extractLabel(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  return value.label || value.code || value.verdict || fallback;
}

function decideReview(evidence, edge, integrity) {
  if (integrity?.status === "GAP_DETECTED") return "CAPTURE_INTEGRITY_ALERT";
  const utamaN = Number(evidence?.bySource?.utama?.settled || 0);
  const europeN = Number(evidence?.bySource?.europe?.settled || 0);
  const edgeSignal = edge?.overallVerdict === "EDGE_SIGNAL_REQUIRES_REPLICATION" ||
    ["utama", "europe"].some((source) => (edge?.bySource?.[source]?.edgeCandidates || []).length > 0);
  if (edgeSignal) return "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED";
  if (utamaN >= 24 && europeN >= 24) return "REVIEW_READY";
  return "EXTEND_COLLECTION";
}

async function recentReports(db, limit = 10) {
  const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
  const query = await db.prepare(`
    SELECT id, review_key, created_at, phase_started_at, elapsed_hours,
           reasons_json, decision, simulations, summary_json, errors_json
    FROM lab_review_reports
    ORDER BY id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return (query.results || []).map((row) => ({
    id: Number(row.id),
    reviewKey: row.review_key,
    createdAt: row.created_at,
    phaseStartedAt: row.phase_started_at,
    elapsedHours: row.elapsed_hours == null ? null : Number(row.elapsed_hours),
    reasons: parseJson(row.reasons_json, []),
    decision: row.decision,
    simulations: Number(row.simulations || 0),
    summary: parseJson(row.summary_json, {}),
    errors: parseJson(row.errors_json, []),
  }));
}

function buildSummary({ evidence, edge, forensics, monteCarlo, integrity, startedAt, reasons, decision, simulations, errors, now }) {
  const utama = evidence?.bySource?.utama || {};
  const europe = evidence?.bySource?.europe || {};
  return {
    decision,
    reasons,
    generatedAt: now,
    phaseStartedAt: startedAt,
    elapsedHours: hoursBetween(startedAt, Date.parse(now)),
    simulations,
    counts: {
      settled: Number(evidence?.totalSettled || 0),
      pending: Number(evidence?.totalPending || 0),
      utama: { settled: Number(utama.settled || 0), pending: Number(utama.pending || 0), gate: utama.gate?.label || null },
      europe: { settled: Number(europe.settled || 0), pending: Number(europe.pending || 0), gate: europe.gate?.label || null },
    },
    nextMilestones: {
      utama: nextMilestone(utama.settled),
      europe: nextMilestone(europe.settled),
    },
    watchlist: {
      utama: utama.watchlist || [],
      europe: europe.watchlist || [],
    },
    captureIntegrity: {
      status: integrity?.status || null,
      reliableCollectionStartedAt: integrity?.reliableCollectionStartedAt || null,
      utama: integrity?.bySource?.utama || null,
      europe: integrity?.bySource?.europe || null,
    },
    audits: {
      edge: edge?.overallVerdict || null,
      randomness: extractLabel(forensics?.verdict, forensics?.verdictCode || null),
      monteCarlo: extractLabel(monteCarlo?.verdict, monteCarlo?.overallVerdict || null),
    },
    errors,
    guardrail: "Reliable 24H begins only after V1.0.0 ordered capture. Reports never change prediction weights, AI V2 phase, Keeper7, Adaptive, or historical locks.",
  };
}

export async function getLabReviewStatusV100(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Lab Review V1.0.0.");
  const db = env.DB;
  await ensureLabReviewSchema(db);
  const [evidence, integrity, startedAt, legacyStartedAt, completed] = await Promise.all([
    getEvidenceMonitor(env),
    getCaptureIntegrityStatus(env),
    reliableStartedAt(db),
    legacyPhaseStartedAt(db),
    completedTriggerSet(db),
  ]);
  const nowMs = Date.now();
  const potential = startedAt ? allPotentialTriggers(startedAt, evidence, nowMs) : [];
  const due = potential.filter((trigger) => !completed.has(trigger.key));
  const reports = await recentReports(db, options.limit || 10);
  const dueAtMs = isoMs(startedAt) == null ? null : isoMs(startedAt) + 24 * HOUR_MS;

  return {
    ok: true,
    version: LAB_REVIEW_V100_VERSION,
    mode: "RELIABLE_ORDERED_REVIEW_ORCHESTRATOR",
    phaseStartedAt: startedAt,
    reliableCollectionStartedAt: startedAt,
    legacyPhaseStartedAt: legacyStartedAt,
    elapsedHours: hoursBetween(startedAt, nowMs),
    review24h: {
      triggerKey: RELIABLE_24H_TRIGGER,
      dueAt: dueAtMs == null ? null : new Date(dueAtMs).toISOString(),
      completed: completed.has(RELIABLE_24H_TRIGGER),
      remainingMs: dueAtMs == null ? null : Math.max(0, dueAtMs - nowMs),
      reliableClock: true,
    },
    evidence,
    captureIntegrity: integrity,
    dueTriggers: due,
    latestReport: reports[0] || null,
    recentReports: reports,
    automation: {
      cronEveryMinutes: 5,
      automaticSimulations: LAB_REVIEW_V100_DEFAULT_SIMS,
      triggers: ["reliable 24H ordered-capture completion", "UTAMA 24/50/100/200 settled", "EUROPE 24/50/100/200 settled"],
      decisions: ["EXTEND_COLLECTION", "REVIEW_READY", "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED", "CAPTURE_INTEGRITY_ALERT"],
      automaticAiPhaseChange: false,
      automaticWeightChange: false,
    },
    legacyWindow: {
      status: "INCOMPLETE_CAPTURE_WINDOW",
      note: "Old Phase-0 observations remain valid forward rows, but the old wall-clock timer is not treated as continuous 24H capture coverage.",
    },
    now: new Date(nowMs).toISOString(),
  };
}

async function runAudit(label, fn, errors) {
  try { return await fn(); }
  catch (error) {
    errors.push({ audit: label, error: error?.message || String(error) });
    return null;
  }
}

export async function runLabReviewV100(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Lab Review V1.0.0.");
  const db = env.DB;
  const simulations = clampSims(options.simulations);
  const force = Boolean(options.force);
  const status = await getLabReviewStatusV100(env, { limit: 10 });
  const due = status.dueTriggers || [];
  if (!force && !due.length) return { ...status, ran: false, reason: "NO_DUE_REVIEW" };

  const reasons = due.length ? due.map((trigger) => trigger.key) : ["MANUAL_REVIEW_V100"];
  const now = new Date().toISOString();
  const errors = [];
  const evidence = status.evidence;
  const integrity = status.captureIntegrity;
  const edge = await runAudit("edge", () => getForwardEdgeAudit(env, { simulations }), errors);
  const forensics = await runAudit("forensics", () => getRandomnessForensics(env), errors);
  const monteCarlo = await runAudit("monte-carlo", () => getRandomnessMonteCarlo(env, { simulations }), errors);
  const decision = decideReview(evidence, edge, integrity);
  const summary = buildSummary({
    evidence, edge, forensics, monteCarlo, integrity,
    startedAt: status.reliableCollectionStartedAt,
    reasons, decision, simulations, errors, now,
  });
  const reviewKey = due.length ? reasons.slice().sort().join("+") : `MANUAL_V100_${now.replace(/[:.]/g, "-")}`;

  await db.prepare(`
    INSERT INTO lab_review_reports(
      review_key, created_at, phase_started_at, elapsed_hours, reasons_json,
      decision, simulations, summary_json, evidence_json, edge_json,
      forensics_json, monte_carlo_json, errors_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(review_key) DO UPDATE SET
      created_at=excluded.created_at,
      phase_started_at=excluded.phase_started_at,
      elapsed_hours=excluded.elapsed_hours,
      reasons_json=excluded.reasons_json,
      decision=excluded.decision,
      simulations=excluded.simulations,
      summary_json=excluded.summary_json,
      evidence_json=excluded.evidence_json,
      edge_json=excluded.edge_json,
      forensics_json=excluded.forensics_json,
      monte_carlo_json=excluded.monte_carlo_json,
      errors_json=excluded.errors_json
  `).bind(
    reviewKey,
    now,
    status.reliableCollectionStartedAt,
    summary.elapsedHours,
    safeJson(reasons, []),
    decision,
    simulations,
    safeJson(summary, {}),
    safeJson(evidence, {}),
    safeJson(edge, null),
    safeJson(forensics, null),
    safeJson(monteCarlo, null),
    safeJson(errors, []),
  ).run();

  const report = await firstRow(db.prepare("SELECT id FROM lab_review_reports WHERE review_key=? LIMIT 1").bind(reviewKey));
  const reportId = report ? Number(report.id) : null;
  if (due.length && reportId != null && errors.length === 0) {
    await db.batch(due.map((trigger) => db.prepare(`
      INSERT OR IGNORE INTO lab_review_completed_triggers(trigger_key, completed_at, report_id)
      VALUES(?,?,?)
    `).bind(trigger.key, now, reportId)));
  }

  const refreshed = await getLabReviewStatusV100(env, { limit: 10 });
  return {
    ...refreshed,
    ran: true,
    review: {
      reportId,
      reviewKey,
      reasons,
      decision,
      simulations,
      summary,
      edge,
      forensics,
      monteCarlo,
      captureIntegrity: integrity,
      errors,
      completedTriggers: errors.length === 0 ? due.map((trigger) => trigger.key) : [],
      retryRequired: due.length > 0 && errors.length > 0,
    },
  };
}

export async function runLabReviewIfDueV100(env) {
  return runLabReviewV100(env, { force: false, simulations: LAB_REVIEW_V100_DEFAULT_SIMS });
}
