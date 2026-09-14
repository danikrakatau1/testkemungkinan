import baseWorker from "./index_v102.js";
import {
  PREDICTION_INTELLIGENCE_VERSION,
  getPredictionIntelligenceScore,
} from "./prediction_intelligence_score.js";

const VERSION = "1.0.3";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleIntelligence(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Prediction Intelligence Score." }, 405);
  try {
    return json(await getPredictionIntelligenceScore(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Prediction Intelligence Score gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.predictionIntelligence = {
    version: PREDICTION_INTELLIGENCE_VERSION,
    endpoint: "/api/intelligence-score",
    readOnly: true,
    scoreIsProbability: false,
    edgeClaimStillRequiresEdgeAudit: true,
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/intelligence-score"]));
  data.performance = {
    ...(data.performance || {}),
    predictionIntelligence: "read-only 0–100 descriptive evidence score from integrity + sample maturity + rolling lift + stability",
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV103(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v103-intelligence.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v103-intelligence.css">\n</head>');
  if (!html.includes("/v103-intelligence.js")) html = html.replace("</body>", '  <script type="module" src="/v103-intelligence.js"></script>\n</body>');
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
    if (url.pathname === "/api/intelligence-score") return handleIntelligence(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV103(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
