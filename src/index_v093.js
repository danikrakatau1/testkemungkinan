import baseWorker from "./index_v092.js";
import { getEuropeStatus, runEuropePilot } from "./europe_pilot.js";

const VERSION = "0.9.3";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleEuropeStatus(env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Europe V1." }, 503);
  try {
    return json(await getEuropeStatus(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Europe status gagal." }, 500);
  }
}

async function handleEuropeSync(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk Europe sync." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Europe V1." }, 503);
  let body = {};
  try { body = await request.json(); } catch {}
  try {
    return json(await runEuropePilot(env, { collect: true, backfill: body?.backfill === true }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Europe sync gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let europe = null;
  try { europe = env?.DB ? await getEuropeStatus(env) : null; } catch {}
  data.ok = true;
  data.version = VERSION;
  data.europeV1 = {
    version: "1.0.0",
    statusEndpoint: "/api/europe",
    syncEndpoint: "/api/europe-sync",
    source: "https://backend.europelotto.work/api/results/latest",
    historySource: "https://backend.europelotto.work/api/results/3d",
    field: "result",
    ignoredFields: ["result2", "result3"],
    cadence: "45 minutes",
    collectorCron: "every 5 minutes",
    isolatedDataset: true,
    forwardOnly: true,
    draws: europe?.draws ?? null,
    latest: europe?.latest ?? null,
    adaptivePhase: europe?.adaptive?.phase ?? null,
    adaptiveSettled: europe?.adaptive?.settledCount ?? 0,
  };
  data.performance = {
    ...(data.performance || {}),
    visualMode: "SAFE · Premium Clean",
    europeUi: "CSS/DOM only · no WebGL",
    mainCronPreserved: "main pipeline still executes on 10-minute boundaries",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/europe", "/api/europe-sync"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV093(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v093-europe.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v093-europe.css">\n</head>');
  if (!html.includes("/v093-europe.js")) html = html.replace("</body>", '  <script type="module" src="/v093-europe.js"></script>\n</body>');

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
    if (url.pathname === "/api/europe") return handleEuropeStatus(env);
    if (url.pathname === "/api/europe-sync") return handleEuropeSync(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV093(request, response);
  },

  async scheduled(event, env, ctx) {
    const scheduledAt = Number(event?.scheduledTime || Date.now());
    const minute = new Date(scheduledAt).getUTCMinutes();

    // Preserve the existing main pipeline's 10-minute rhythm even though the
    // Worker cron is now 5 minutes for Europe.
    if (minute % 10 === 0) baseWorker.scheduled(event, env, ctx);

    ctx.waitUntil((async () => {
      try {
        await runEuropePilot(env, { collect: true });
      } catch (error) {
        console.error("V0.9.3 Europe scheduled pipeline failed", error);
      }
    })());
  },
};
