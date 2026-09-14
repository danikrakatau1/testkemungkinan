import baseWorker from "./index_v096.js";
import { FORWARD_EDGE_AUDIT_VERSION, getForwardEdgeAudit } from "./edge_audit.js";

const VERSION = "0.9.7";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleEdgeAudit(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Forward Edge Audit bersifat read-only. Gunakan GET." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Forward Edge Audit." }, 503);
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("sims") ?? 0);
  const simulations = raw <= 0 ? 0 : Math.max(100, Math.min(2500, raw | 0));
  try {
    return json(await getForwardEdgeAudit(env, { simulations }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Forward Edge Audit gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.forwardEdgeAudit = {
    version: FORWARD_EDGE_AUDIT_VERSION,
    endpoint: "/api/edge-audit?sims=1000",
    previewEndpoint: "/api/edge-audit?sims=0",
    source: "D1 ai_v2_observations · settled forward locks only",
    mode: "read-only forward prediction edge calibration",
    sourcesSeparated: ["utama", "europe"],
    models: ["Legacy", "DigitBoost", "Hybrid", "Two-Stage", "3D Assist", "Keeper7"],
    metrics3d: ["Exact Top3", "Top10", "Permutation", "Mean Digit Overlap", "Mean Position Hits"],
    metricsKeeper7: ["ALL3 rate", "Mean Coverage"],
    nullModel: "shuffle settled actual results across original prediction locks within the same source",
    multipleTesting: "Bonferroni family adjustment per source",
    replicationGuard: "strongest metric must remain above calibrated null mean in both chronological halves",
    gates: ["COLLECT <24", "EARLY 24-49", "PROVISIONAL 50-99", "EVIDENCE 100-199", "STRONGER TEST 200+"],
    databaseWrites: false,
    changesPredictionWeights: false,
    changesAiV2: false,
    changesKeeper7: false,
    changesAdaptive: false,
  };
  data.performance = {
    ...(data.performance || {}),
    forwardEdgeAudit: "manual Monte Carlo calibration · no polling · no writes",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/edge-audit"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV097(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v097-edge-audit.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v097-edge-audit.css">\n</head>');
  if (!html.includes("/v097-edge-audit.js")) html = html.replace("</body>", '  <script type="module" src="/v097-edge-audit.js"></script>\n</body>');

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
    if (url.pathname === "/api/edge-audit") return handleEdgeAudit(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV097(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
