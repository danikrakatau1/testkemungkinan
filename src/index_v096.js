import baseWorker from "./index_v095.js";
import { RANDOMNESS_FORENSICS_MC_VERSION, getRandomnessMonteCarlo } from "./randomness_forensics_mc.js";

const VERSION = "0.9.6";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleForensicsMonteCarlo(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Monte Carlo Forensics bersifat read-only. Gunakan GET." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Monte Carlo Forensics." }, 503);
  const url = new URL(request.url);
  const simulations = Math.max(100, Math.min(2500, Number(url.searchParams.get("sims") || 1000) | 0));
  try {
    return json(await getRandomnessMonteCarlo(env, { simulations }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Monte Carlo Forensics gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.randomnessForensicsMonteCarlo = {
    version: RANDOMNESS_FORENSICS_MC_VERSION,
    endpoint: "/api/forensics-mc?sims=1000",
    mode: "read-only Monte Carlo permutation calibration",
    source: "D1 results_3d · UTAMA only",
    defaultSimulations: 1000,
    maxSimulations: 2500,
    nullModel: "shuffle the observed draw order while preserving the exact observed draw multiset and marginals",
    calibratedStatistics: [
      "transition Cramer's V",
      "maximum absolute serial correlation across lag 1-24",
      "maximum rolling 50-draw Jensen-Shannon divergence",
      "absolute Wald-Wolfowitz runs z"
    ],
    databaseWrites: false,
    changesPredictionWeights: false,
    changesAiV2: false,
    changesKeeper7: false,
    changesAdaptive: false,
    reproducibleSeed: true,
    caveat: "Permutation calibration tests temporal structure/drift. It still cannot prove the upstream generator is a true RNG or CSPRNG."
  };
  data.performance = {
    ...(data.performance || {}),
    forensicsMonteCarlo: "manual heavy audit only · no polling · no model writes",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/forensics-mc"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV096(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v096-forensics-mc.js")) html = html.replace("</body>", '  <script type="module" src="/v096-forensics-mc.js"></script>\n</body>');

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
    if (url.pathname === "/api/forensics-mc") return handleForensicsMonteCarlo(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV096(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
