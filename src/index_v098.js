import baseWorker from "./index_v097.js";
import { EVIDENCE_MONITOR_VERSION, getEvidenceMonitor } from "./evidence_monitor.js";

const VERSION = "0.9.8";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleEvidenceMonitor(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Evidence Monitor bersifat read-only. Gunakan GET." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Evidence Monitor." }, 503);
  try {
    return json(await getEvidenceMonitor(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Evidence Monitor gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.evidenceMonitor = {
    version: EVIDENCE_MONITOR_VERSION,
    endpoint: "/api/evidence-monitor",
    source: "D1 ai_v2_observations · locked-before-result rows",
    mode: "read-only forward evidence progress monitor",
    sourcesSeparated: ["utama", "europe"],
    rollingWindows: [10, 25, 50],
    gates: ["COLLECT <24", "EARLY 24-49", "PROVISIONAL 50-99", "EVIDENCE 100-199", "STRONGER TEST 200+"],
    watchlist: "descriptive only; not an edge claim",
    rollingNull: "exact finite-sample permutation mean inside each rolling window",
    databaseWrites: false,
    changesPredictionWeights: false,
    changesAiV2: false,
    changesKeeper7: false,
    changesAdaptive: false,
  };
  data.performance = {
    ...(data.performance || {}),
    evidenceMonitor: "lightweight GET while tab active · no model writes · no WebGL",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/evidence-monitor"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV098(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v098-evidence.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v098-evidence.css">\n</head>');
  if (!html.includes("/v098-evidence.js")) html = html.replace("</body>", '  <script type="module" src="/v098-evidence.js"></script>\n</body>');

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
    if (url.pathname === "/api/evidence-monitor") return handleEvidenceMonitor(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV098(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
