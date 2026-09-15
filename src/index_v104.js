import baseWorker from "./index_v103.js";
import { LEARNER_CONTINUITY_VERSION, getLearnerContinuityGuard } from "./learner_continuity_guard.js";

const VERSION = "1.0.4";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });

async function handleContinuity(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Continuity audit bersifat read-only. Gunakan GET." }, 405);
  try { return json(await getLearnerContinuityGuard(env)); }
  catch (error) { return json({ ok: false, version: VERSION, error: error?.message || "Continuity audit gagal." }, 500); }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.learnerContinuityAudit = {
    version: LEARNER_CONTINUITY_VERSION,
    endpoint: "/api/learner-continuity",
    readOnly: true,
    noHistoricalReconstruction: true,
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/learner-continuity"]));
  return json(data, response.status);
}

async function injectV104(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v104-continuity.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v104-continuity.css">\n</head>');
  if (!html.includes("/v104-continuity.js")) html = html.replace("</body>", '  <script type="module" src="/v104-continuity.js"></script>\n</body>');
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/learner-continuity") return handleContinuity(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    return injectV104(request, await baseWorker.fetch(request, env, ctx));
  },
  async scheduled(event, env, ctx) { return baseWorker.scheduled(event, env, ctx); },
};
