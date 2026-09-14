import baseWorker from "./index_v093.js";
import { runAutoPilot } from "./autopilot.js";
import { runTwoStagePilot } from "./two_stage_forward.js";
import { runKeeper7Pilot } from "./keeper7_forward.js";
import { getAiV2ObserverStatus, runAiV2Observer } from "./ai_v2_observer.js";
import { getAiV2History } from "./ai_v2_history.js";

const VERSION = "0.9.4";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleAiV2Status(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk AI V2 status." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk AI V2 Phase 0." }, 503);
  try {
    return json(await getAiV2ObserverStatus(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "AI V2 status gagal." }, 500);
  }
}

async function handleAiV2History(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk AI V2 history." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk AI V2 history." }, 503);
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit") || "50";
  const sourceRaw = url.searchParams.get("source");
  try {
    return json(await getAiV2History(env, {
      limit: limitRaw,
      source: sourceRaw === "utama" || sourceRaw === "europe" ? sourceRaw : null,
      settledOnly: true,
    }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "AI V2 history gagal." }, 500);
  }
}

async function handleAiV2Sync(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk AI V2 snapshot." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk AI V2 Phase 0." }, 503);
  try {
    return json(await runAiV2Observer(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "AI V2 observer gagal." }, 500);
  }
}

async function handleMainSync(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk main auto-sync." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk main auto-sync." }, 503);

  try {
    // One ordered pipeline for the draw window. Every stage keeps its own
    // forward-lock/idempotency rules, so repeated source checks are safe.
    const autopilot = await runAutoPilot(env, { collect: true });
    const twoStage = await runTwoStagePilot(env);
    const keeper7 = await runKeeper7Pilot(env);
    const aiV2 = await runAiV2Observer(env);

    return json({
      ok: true,
      version: VERSION,
      mode: "DRAW_WINDOW_AUTO_SYNC",
      autopilot: {
        latest: autopilot.latest || null,
        draws: autopilot.draws ?? null,
        pendingArena: autopilot.pendingArena || null,
        collectionError: autopilot.pipeline?.collectionError || null,
      },
      twoStage: {
        pending: twoStage?.pending || null,
        last: twoStage?.last || null,
      },
      keeper7: {
        pending: keeper7?.pending || null,
        last: keeper7?.last || null,
        forward: keeper7?.forward || null,
      },
      aiV2: {
        counts: aiV2?.counts || null,
        captures: aiV2?.pipeline?.captures || [],
        settlement: aiV2?.pipeline?.settlement || null,
      },
      policy: {
        collectLatest: true,
        settleOldLocksFirst: true,
        createNewLocksAfterActual: true,
        aiV2ForwardOnly: true,
        noHindsightRewrite: true,
      },
      now: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Main auto-sync gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let aiV2 = null;
  try { aiV2 = env?.DB ? await getAiV2ObserverStatus(env, { limit: 5 }) : null; } catch {}

  data.ok = true;
  data.version = VERSION;
  data.aiV2 = {
    version: "0.1.0-observer",
    phase: "OBSERVER",
    statusEndpoint: "/api/ai-v2",
    historyEndpoint: "/api/ai-v2-history",
    syncEndpoint: "/api/ai-v2-sync",
    predictionEnabled: false,
    writesToV1: false,
    forwardOnly: true,
    capturePendingLocksOnly: true,
    noHistoricalBackfillAsTraining: true,
    lockedHistoryRegeneration: false,
    observations: aiV2?.counts ?? null,
    gate: aiV2?.gates?.currentGate ?? "COLLECT_FORWARD_EVIDENCE",
  };
  data.mainAutoSync = {
    endpoint: "/api/main-sync",
    mode: "draw-window source check + ordered full main pipeline",
    browserWindow: "minute 00 through 05 Asia/Jakarta",
    retrySeconds: 20,
    serverFallback: "main pipeline also runs on every 5-minute cron tick",
    stages: ["collect", "settle", "Arena", "Two-Stage", "Keeper7", "AI V2 observer snapshot"],
  };
  data.performance = {
    ...(data.performance || {}),
    aiV2Ui: "SAFE · CSS/DOM only · no WebGL",
    aiV2Mode: "observer only · zero prediction authority",
    aiV2History: "actual result and original locked prediction are displayed separately",
    mainAutoSync: "lightweight draw-window polling; no WebGL and no page reload",
  };
  data.endpoints = Array.from(new Set([
    ...(data.endpoints || []),
    "/api/ai-v2",
    "/api/ai-v2-history",
    "/api/ai-v2-sync",
    "/api/main-sync",
  ]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV094(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v094-ai-v2.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v094-ai-v2.css">\n</head>');
  if (!html.includes("/v094-ai-v2.js")) html = html.replace("</body>", '  <script type="module" src="/v094-ai-v2.js"></script>\n</body>');
  if (!html.includes("/v094-ai-v2-clarity.js")) html = html.replace("</body>", '  <script type="module" src="/v094-ai-v2-clarity.js"></script>\n</body>');
  if (!html.includes("/v094-autosync.js")) html = html.replace("</body>", '  <script type="module" src="/v094-autosync.js"></script>\n</body>');

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
    if (url.pathname === "/api/ai-v2") return handleAiV2Status(request, env);
    if (url.pathname === "/api/ai-v2-history") return handleAiV2History(request, env);
    if (url.pathname === "/api/ai-v2-sync") return handleAiV2Sync(request, env);
    if (url.pathname === "/api/main-sync") return handleMainSync(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV094(request, response);
  },

  async scheduled(event, env, ctx) {
    // V0.9.3 remains authoritative for the existing UTAMA + EUROPE pipelines.
    baseWorker.scheduled(event, env, ctx);

    // AI V2 remains observer-only. If this races a just-created source lock,
    // the next cron tick/client draw-window sync captures it while still pending.
    ctx.waitUntil((async () => {
      try {
        await runAiV2Observer(env);
      } catch (error) {
        console.error("V0.9.4 AI V2 observer scheduled pipeline failed", error);
      }
    })());
  },
};
