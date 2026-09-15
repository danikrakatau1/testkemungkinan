import baseWorker from "./index_v104.js";
import { runLabReviewIfDueV100 } from "./lab_review_orchestrator_v100.js";
import {
  SEQUENTIAL_LOCK_BARRIER_VERSION,
  getSequentialLockBarrierStatus,
  runSequentialLockBarrierCycle,
} from "./sequential_lock_barrier.js";

const VERSION = "1.0.5";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleBarrierStatus(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Sequential Lock Barrier status." }, 405);
  try { return json(await getSequentialLockBarrierStatus(env)); }
  catch (error) { return json({ ok: false, version: VERSION, error: error?.message || "Sequential Lock Barrier status gagal." }, 500); }
}

async function handleBarrierRun(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk manual barrier cycle." }, 405);
  try {
    const result = await runSequentialLockBarrierCycle(env, { trigger: "http-barrier" });
    return json(result, result.ok ? 200 : 503);
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Sequential Lock Barrier manual cycle gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let barrier = null;
  try { barrier = env?.DB ? await getSequentialLockBarrierStatus(env) : null; } catch {}
  data.ok = true;
  data.version = VERSION;
  data.sequentialLockBarrier = {
    version: SEQUENTIAL_LOCK_BARRIER_VERSION,
    endpoint: "/api/sequential-barrier",
    runEndpoint: "/api/sequential-barrier/run",
    status: barrier?.status || "UNKNOWN",
    startedAt: barrier?.startedAt || null,
    drawTransitionsObserved: barrier?.drawTransitionsObserved ?? null,
    drawTransitionPassRatePct: barrier?.drawTransitionPassRatePct ?? null,
    gapCountSinceStart: barrier?.gapCountSinceStart ?? null,
    noHistoricalPredictionReconstruction: true,
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/sequential-barrier", "/api/sequential-barrier/run"]));
  data.performance = {
    ...(data.performance || {}),
    sequentialLockBarrier: "1-minute preflight source check → ordered watchdog cycle → postflight full-chain verification; source jumps are recorded, never hidden",
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV105(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v105-barrier.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v105-barrier.css">\n</head>');
  if (!html.includes("/v105-barrier.js")) html = html.replace("</body>", '  <script type="module" src="/v105-barrier.js"></script>\n</body>');
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
    if (url.pathname === "/api/sequential-barrier") return handleBarrierStatus(request, env);
    if (url.pathname === "/api/sequential-barrier/run") return handleBarrierRun(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    return injectV105(request, await baseWorker.fetch(request, env, ctx));
  },

  async scheduled(event, env, ctx) {
    // V1.0.5 becomes the single scheduled authority. It wraps the existing
    // Continuous Watchdog instead of running a second pipeline in parallel.
    ctx.waitUntil((async () => {
      try {
        await runSequentialLockBarrierCycle(env, { trigger: "scheduled", cron: event?.cron || null });
        await runLabReviewIfDueV100(env);
      } catch (error) {
        console.error("V1.0.5 Sequential Lock Barrier scheduled cycle failed", error);
      }
    })());
  },
};
