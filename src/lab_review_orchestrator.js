import { getEvidenceMonitor } from "./evidence_monitor.js";
import { getForwardEdgeAudit } from "./edge_audit.js";
import { getRandomnessForensics } from "./randomness_forensics.js";
import { getRandomnessMonteCarlo } from "./randomness_forensics_mc.js";

export const LAB_REVIEW_VERSION = "1.0.0";
export const LAB_REVIEW_DEFAULT_SIMS = 1000;
const MILESTONES = [24, 50, 100, 200];
const HOUR_MS = 60 * 60 * 1000;

function safeJson(value, fallback = null) {
  try { return JSON.stringify(value ?? fallback); } catch { return JSON.stringify(fallback); }
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value ?? ""); } catch { return fallback; }
}

function clampSims(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LAB_REVIEW_DEFAULT_SIMS;
  return Math.max(100, Math.min(2500, Math.trunc(n)));
}

function isoMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function hoursBetween(start, end = Date.now()) {
  const ms = isoMs(start);
  return ms == null ? null : Math.max(0, (end - ms) / HOUR_MS);
}

export async function ensureLabReviewSchema(db) {
  if (!db) throw new Error("D1 binding DB diperlukan untuk Lab Review Orchestrator.");
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS lab_review_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      phase_started_at TEXT,
      elapsed_hours REAL,
      reasons_json TEXT NOT NULL,
      decision TEXT NOT NULL,
      simulations INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      edge_json TEXT,
      forensics_json TEXT,
      monte_carlo_json TEXT,
      errors_json TEXT NOT NULL DEFAULT '[]'
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS lab_review_completed_triggers (
      trigger_key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      report_id INTEGER,
      FOREIGN KEY(report_id) REFERENCES lab_review_reports(id)
    )
  `).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_review_created ON lab_review_reports(created_at DESC)").run();
  return true;
}

async function firstRow(statement) {
  const result = await statement.all();
  return result.results?.[0] || null;
}

async function phaseStartedAt(db) {
  let row = null;
  try {
    row = await firstRow(db.prepare("SELECT meta_value FROM ai_v2_meta WHERE meta_key='phase0_started_at' LIMIT 1"));
  } catch {}
  if (isoMs(row?.meta_value) != null) return row.meta_value;
  try {
    row = await firstRow(db.prepare("SELECT observed_at FROM ai_v2_observations ORDER BY id ASC LIMIT 1"));
  } catch {}
  return isoMs(row?.observed_at) != null ? row.observed_at : null;
}

async function completedTriggerSet(db) {
  const result = await db.prepare("SELECT trigger_key FROM lab_review_completed_triggers").all();
  return new Set((result.results || []).map((row) => String(row.trigger_key)));
}

function allPotentialTriggers(startedAt, evidence, nowMs = Date.now()) {
  const triggers = [];
  const startMs = isoMs(startedAt);
  if (startMs != null && nowMs >= startMs + 24 * HOUR_MS) {
    triggers.push({ key: "PHASE0_24H", kind: "time", label: "24H OBSERVATION COMPLETE" });
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
  return {
    current,
    next,
    remaining: next == null ? 0 : Math.max(0, next - current),
  };
}

function extractLabel(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  return value.label || value.code || value.verdict || fallback;
}

function decideReview(evidence, edge) {
  const utamaN = Number(evidence?.bySource?.utama?.settled || 0);
  const europeN = Number(evidence?.bySource?.europe?.settled || 0);
  const edgeSignal = edge?.overallVerdict === "EDGE_SIGNAL_REQUIRES_REPLICATION" ||
    ["utama", "europe"].some((source) => (edge?.bySource?.[source]?.edgeCandidates || []).length > 0);
  if (edgeSignal) return "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED";
  if (utamaN >= 24 && europeN >= 24) return "REVIEW_READY";
  return "EXTEND_COLLECTION";
}

function buildSummary({ evidence, edge, forensics, monteCarlo, startedAt, reasons, decision, simulations, errors, now }) {
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
    audits: {
      edge: edge?.overallVerdict || null,
      randomness: extractLabel(forensics?.verdict, forensics?.verdictCode || null),
      monteCarlo: extractLabel(monteCarlo?.verdict, monteCarlo?.overallVerdict || null),
    },
    errors,
    guardrail: "This report never changes prediction weights, AI V2 phase, Keeper7, Adaptive, or historical locks. EDGE candidates require human review.",
  };
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

export async function getLabReviewStatus(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Lab Review Orchestrator.");
  const db = env.DB;
  await ensureLabReviewSchema(db);
  const evidence = await getEvidenceMonitor(env);
  const startedAt = await phaseStartedAt(db);
  const completed = await completedTriggerSet(db);
  const nowMs = Date.now();
  const potential = allPotentialTriggers(startedAt, evidence, nowMs);
  const due = potential.filter((trigger) => !completed.has(trigger.key));
  const reports = await recentReports(db, options.limit || 10);
  const dueAtMs = isoMs(startedAt) == null ? null : isoMs(startedAt) + 24 * HOUR_MS;
  return {
    ok: true,
    version: LAB_REVIEW_VERSION,
    mode: "AUTOMATED_REVIEW_ORCHESTRATOR",
    phaseStartedAt: startedAt,
    elapsedHours: hoursBetween(startedAt, nowMs),
    review24h: {
      dueAt: dueAtMs == null ? null : new Date(dueAtMs).toISOString(),
      completed: completed.has("PHASE0_24H"),
      remainingMs: dueAtMs == null ? null : Math.max(0, dueAtMs - nowMs),
    },
    evidence,
    dueTriggers: due,
    latestReport: reports[0] || null,
    recentReports: reports,
    automation: {
      cronEveryMinutes: 5,
      automaticSimulations: LAB_REVIEW_DEFAULT_SIMS,
      triggers: ["24H observation completion", "UTAMA 24/50/100/200 settled", "EUROPE 24/50/100/200 settled"],
      decisions: ["EXTEND_COLLECTION", "REVIEW_READY", "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED"],
      automaticAiPhaseChange: false,
      automaticWeightChange: false,
    },
    policy: {
      sourceDataWrites: false,
      predictionModelWrites: false,
      aiV2Writes: false,
      keeper7Writes: false,
      adaptiveWrites: false,
      reportTableWritesOnly: true,
      humanReviewRequiredForEdgeCandidate: true,
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

export async function runLabReview(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Lab Review Orchestrator.");
  const db = env.DB;
  const simulations = clampSims(options.simulations);
  const force = Boolean(options.force);
  const status = await getLabReviewStatus(env, { limit: 10 });
  const due = status.dueTriggers || [];
  if (!force && !due.length) {
    return { ...status, ran: false, reason: "NO_DUE_REVIEW" };
  }

  const reasons = due.length
    ? due.map((trigger) => trigger.key)
    : ["MANUAL_REVIEW"];
  const now = new Date().toISOString();
  const errors = [];
  const evidence = status.evidence || await getEvidenceMonitor(env);

  // Heavy audits run only when a milestone/time trigger is due or a human explicitly requests a review.
  const edge = await runAudit("edge", () => getForwardEdgeAudit(env, { simulations }), errors);
  const forensics = await runAudit("forensics", () => getRandomnessForensics(env), errors);
  const monteCarlo = await runAudit("monte-carlo", () => getRandomnessMonteCarlo(env, { simulations }), errors);
  const decision = decideReview(evidence, edge);
  const summary = buildSummary({
    evidence,
    edge,
    forensics,
    monteCarlo,
    startedAt: status.phaseStartedAt,
    reasons,
    decision,
    simulations,
    errors,
    now,
  });

  const reviewKey = due.length
    ? reasons.slice().sort().join("+")
    : `MANUAL_${now.replace(/[:.]/g, "-")}`;

  await db.prepare(`
    INSERT OR IGNORE INTO lab_review_reports(
      review_key, created_at, phase_started_at, elapsed_hours, reasons_json,
      decision, simulations, summary_json, evidence_json, edge_json,
      forensics_json, monte_carlo_json, errors_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    reviewKey,
    now,
    status.phaseStartedAt,
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
  if (due.length && reportId != null) {
    await db.batch(due.map((trigger) => db.prepare(`
      INSERT OR IGNORE INTO lab_review_completed_triggers(trigger_key, completed_at, report_id)
      VALUES(?,?,?)
    `).bind(trigger.key, now, reportId)));
  }

  const refreshed = await getLabReviewStatus(env, { limit: 10 });
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
      errors,
    },
  };
}

export async function runLabReviewIfDue(env) {
  return runLabReview(env, { force: false, simulations: LAB_REVIEW_DEFAULT_SIMS });
}
