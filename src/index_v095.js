import baseWorker from "./index_v094.js";
import { RANDOMNESS_FORENSICS_VERSION, getRandomnessForensics } from "./randomness_forensics.js";

const VERSION = "0.9.5";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleForensics(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Randomness Forensics bersifat read-only. Gunakan GET." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Randomness Forensics." }, 503);
  try {
    return json(await getRandomnessForensics(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Randomness Forensics gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.randomnessForensics = {
    version: RANDOMNESS_FORENSICS_VERSION,
    endpoint: "/api/forensics",
    source: "D1 results_3d · UTAMA only",
    mode: "SELECT-only statistical audit",
    databaseWrites: false,
    changesPredictionWeights: false,
    changesAiV2: false,
    tests: [
      "digit uniformity",
      "position uniformity",
      "10x10 same-position transition matrix",
      "serial correlation lag 1-24 with Bonferroni correction",
      "Wald-Wolfowitz runs test",
      "digit gap distribution",
      "Shannon entropy",
      "repeated-digit structure",
      "consecutive exact-repeat rate",
      "hour-of-day bias",
      "weekday bias",
      "bias-corrected mutual information",
      "consecutive permutation rate",
      "rolling 50-draw drift"
    ],
    verdicts: [
      "CONSISTENT WITH RANDOMNESS",
      "ANOMALY DETECTED — INVESTIGATION NEEDED",
      "STRONG SERIAL DEPENDENCE — POSSIBLY NON-IID",
      "INCONCLUSIVE — MORE DATA NEEDED"
    ],
    caveat: "Passing output-only tests does not prove a true RNG, CSPRNG, seed, or provably-fair mechanism."
  };
  data.performance = {
    ...(data.performance || {}),
    forensicsUi: "SAFE · CSS/DOM only · no WebGL",
    forensicsDb: "read-only SELECT from results_3d",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/forensics"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV095(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v095-forensics.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v095-forensics.css">\n</head>');
  if (!html.includes("/v095-forensics.js")) html = html.replace("</body>", '  <script type="module" src="/v095-forensics.js"></script>\n</body>');

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
    if (url.pathname === "/api/forensics") return handleForensics(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV095(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
