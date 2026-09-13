import baseWorker from "./index_v093.js";
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
  data.performance = {
    ...(data.performance || {}),
    aiV2Ui: "SAFE · CSS/DOM only · no WebGL",
    aiV2Mode: "observer only · zero prediction authority",
    aiV2History: "actual result and original locked prediction are displayed separately",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/ai-v2", "/api/ai-v2-history", "/api/ai-v2-sync"]));
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
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV094(request, response);
  },

  async scheduled(event, env, ctx) {
    // V0.9.3 remains authoritative for both existing pipelines. AI V2 only
    // observes the resulting pending locks and never changes their weights,
    // predictions, settlement, or source data.
    baseWorker.scheduled(event, env, ctx);

    // This may race a just-created V1 lock on the same cron tick. That is safe:
    // Phase 0 refuses settled-history backfill and will capture the pending lock
    // on the next 5-minute tick or when the AI V2 tab requests SNAPSHOT NOW.
    ctx.waitUntil((async () => {
      try {
        await runAiV2Observer(env);
      } catch (error) {
        console.error("V0.9.4 AI V2 observer scheduled pipeline failed", error);
      }
    })());
  },
};
