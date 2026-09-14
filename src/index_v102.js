import baseWorker from "./index_v101.js";
import { runLabReviewIfDueV100 } from "./lab_review_orchestrator_v100.js";
import {
  CONTINUOUS_WATCHDOG_VERSION,
  WATCHDOG_CRON_MINUTES,
  getContinuousWatchdogStatus,
  runContinuousWatchdogCycle,
} from "./continuous_watchdog.js";

const VERSION = "1.0.2";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleWatchdogStatus(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Watchdog status." }, 405);
  try { return json(await getContinuousWatchdogStatus(env)); }
  catch (error) { return json({ ok: false, version: VERSION, error: error?.message || "Watchdog status gagal." }, 500); }
}

async function handleWatchedSync(request, env, trigger) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk ordered sync." }, 405);
  try {
    const result = await runContinuousWatchdogCycle(env, { trigger });
    return json(result, result.ok ? 200 : 503);
  } catch (error) {
    return json({ ok: false, version: VERSION, trigger, error: error?.message || "Continuous Watchdog sync gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let watchdog = null;
  try { watchdog = env?.DB ? await getContinuousWatchdogStatus(env) : null; } catch {}
  data.ok = true;
  data.version = VERSION;
  data.continuousDrawWatchdog = {
    version: CONTINUOUS_WATCHDOG_VERSION,
    endpoint: "/api/watchdog",
    runEndpoint: "/api/watchdog/run",
    cronEveryMinutes: WATCHDOG_CRON_MINUTES,
    status: watchdog?.status || "UNKNOWN",
    watchdogStartedAt: watchdog?.watchdogStartedAt || null,
    lastScheduledAt: watchdog?.cron?.lastScheduledAt || null,
    scheduledCyclesLast60m: watchdog?.cron?.scheduledCyclesLast60m ?? null,
    serverPrimary: true,
    browserFallbackOnly: true,
    heartbeatPersisted: true,
    dailyRollup: true,
    historicalLockReconstruction: false,
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/watchdog", "/api/watchdog/run"]));
  data.performance = {
    ...(data.performance || {}),
    continuousWatchdog: "1-minute server heartbeat + ordered source→lock→observer cycle; 7-day raw heartbeat retention + long-term daily rollup",
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV102(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v102-watchdog.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v102-watchdog.css">\n</head>');
  if (!html.includes("/v102-watchdog.js")) html = html.replace("</body>", '  <script type="module" src="/v102-watchdog.js"></script>\n</body>');
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
    if (url.pathname === "/api/watchdog") return handleWatchdogStatus(request, env);
    if (url.pathname === "/api/watchdog/run") return handleWatchedSync(request, env, "http-watchdog");
    if (url.pathname === "/api/main-sync") return handleWatchedSync(request, env, "http-main");
    if (url.pathname === "/api/ordered-sync") return handleWatchedSync(request, env, "http-ordered");
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV102(request, response);
  },

  async scheduled(event, env, ctx) {
    // V1.0.2 is the single scheduled authority. Every cron invocation is persisted
    // before running the ordered pipeline so browser-close behavior is auditable.
    ctx.waitUntil((async () => {
      try {
        await runContinuousWatchdogCycle(env, { trigger: "scheduled", cron: event?.cron || null });
        await runLabReviewIfDueV100(env);
      } catch (error) {
        console.error("V1.0.2 Continuous Draw Watchdog scheduled cycle failed", error);
      }
    })());
  },
};
