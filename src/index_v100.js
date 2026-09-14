import baseWorker from "./index_v099.js";
import { runAiV2Observer } from "./ai_v2_observer.js";
import { getCaptureIntegrityStatus } from "./capture_integrity.js";
import { ORDERED_CAPTURE_VERSION, runOrderedCaptureCycle } from "./ordered_capture.js";
import {
  LAB_REVIEW_V100_DEFAULT_SIMS,
  LAB_REVIEW_V100_VERSION,
  getLabReviewStatusV100,
  runLabReviewIfDueV100,
  runLabReviewV100,
} from "./lab_review_orchestrator_v100.js";

const VERSION = "1.0.0";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleCaptureIntegrity(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Capture Integrity status." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Capture Integrity." }, 503);
  try {
    return json(await getCaptureIntegrityStatus(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Capture Integrity gagal." }, 500);
  }
}

async function handleOrderedSync(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk Ordered Capture sync." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Ordered Capture sync." }, 503);
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    return json(await runOrderedCaptureCycle(env, {
      collect: true,
      backfillEurope: body?.backfillEurope === true,
    }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Ordered Capture sync gagal." }, 500);
  }
}

async function handleEuropeSyncWithObserver(request, env, ctx) {
  // Preserve the exact Europe API response expected by V0.9.3 UI, but add an
  // observer barrier after Europe has finished settle+lock.
  const response = await baseWorker.fetch(request, env, ctx);
  if (response.ok && env?.DB) {
    try { await runAiV2Observer(env); } catch (error) {
      console.error("V1.0.0 Europe post-lock observer failed", error);
    }
  }
  return response;
}

async function handleLabStatus(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Lab Review status." }, 405);
  try { return json(await getLabReviewStatusV100(env, { limit: 10 })); }
  catch (error) { return json({ ok: false, version: VERSION, error: error?.message || "Lab Review V1.0.0 status gagal." }, 500); }
}

async function handleLabRun(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk Lab Review manual." }, 405);
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("sims") || LAB_REVIEW_V100_DEFAULT_SIMS);
  const simulations = Math.max(100, Math.min(2500, Number.isFinite(raw) ? Math.trunc(raw) : LAB_REVIEW_V100_DEFAULT_SIMS));
  try { return json(await runLabReviewV100(env, { force: true, simulations })); }
  catch (error) { return json({ ok: false, version: VERSION, error: error?.message || "Lab Review V1.0.0 manual gagal." }, 500); }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let integrity = null;
  try { integrity = env?.DB ? await getCaptureIntegrityStatus(env) : null; } catch {}

  data.ok = true;
  data.version = VERSION;
  data.orderedCaptureIntegrity = {
    version: ORDERED_CAPTURE_VERSION,
    statusEndpoint: "/api/capture-integrity",
    orderedSyncEndpoint: "/api/ordered-sync",
    legacyMainSyncAlias: "/api/main-sync now executes the ordered V1.0.0 pipeline",
    scheduledOrder: "UTAMA lane + EUROPE lane -> hard barrier -> AI V2 observer -> integrity audit -> due Lab Review",
    cron: "every 5 minutes",
    reliableCollectionStartedAt: integrity?.reliableCollectionStartedAt || null,
    integrityStatus: integrity?.status || "NOT_STARTED",
    oldWindow: "retained as valid forward rows but marked INCOMPLETE_CAPTURE_WINDOW for continuous-24H claims",
    historicalBackfillAsForward: false,
    modelWritesFromIntegrityLayer: false,
  };
  data.labReviewOrchestrator = {
    ...(data.labReviewOrchestrator || {}),
    version: LAB_REVIEW_V100_VERSION,
    clock: "reliable_collection_started_at from first ordered V1.0.0 cycle",
    reliable24hTrigger: "RELIABLE_24H_V1",
    oldPhase0WallClockRejectedAsContinuousCoverage: true,
  };
  data.performance = {
    ...(data.performance || {}),
    orderedCapture: "server-side ordered barrier; no WebGL; no browser required",
    captureIntegrity: "lightweight D1 audit; period-gap + lock-to-observer completeness + conservative cadence shortfall",
  };
  data.endpoints = Array.from(new Set([
    ...(data.endpoints || []),
    "/api/capture-integrity",
    "/api/ordered-sync",
  ]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV100(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v100-capture-integrity.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v100-capture-integrity.css">\n</head>');
  if (!html.includes("/v100-capture-integrity.js")) html = html.replace("</body>", '  <script type="module" src="/v100-capture-integrity.js"></script>\n</body>');

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/capture-integrity") return handleCaptureIntegrity(request, env);
    if (url.pathname === "/api/ordered-sync") return handleOrderedSync(request, env);
    if (url.pathname === "/api/main-sync") return handleOrderedSync(request, env);
    if (url.pathname === "/api/europe-sync") return handleEuropeSyncWithObserver(request, env, ctx);
    if (url.pathname === "/api/lab-review") return handleLabStatus(request, env);
    if (url.pathname === "/api/lab-review/run") return handleLabRun(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV100(request, response);
  },

  async scheduled(_event, env, ctx) {
    // Do NOT delegate to the legacy scheduled chain here. V1.0.0 is the single
    // cron authority so collector/lock creation and observer capture cannot race.
    ctx.waitUntil((async () => {
      try {
        await runOrderedCaptureCycle(env, { collect: true });
        await runLabReviewIfDueV100(env);
      } catch (error) {
        console.error("V1.0.0 Ordered Capture scheduled cycle failed", error);
      }
    })());
  },
};
