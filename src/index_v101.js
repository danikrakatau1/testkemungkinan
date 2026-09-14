import baseWorker from "./index_v100.js";
import { FORWARD_LOCK_RECOVERY_VERSION, getForwardLockRecoveryAudit } from "./forward_lock_recovery.js";

const VERSION = "1.0.1";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleRecovery(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Forward Lock Recovery Audit." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Forward Lock Recovery Audit." }, 503);
  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") || 24);
  try {
    return json(await getForwardLockRecoveryAudit(env, { hours }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Forward Lock Recovery Audit gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.forwardLockRecoveryAudit = {
    version: FORWARD_LOCK_RECOVERY_VERSION,
    endpoint: "/api/lock-recovery?hours=24",
    mode: "READ ONLY",
    defaultWindow: "24 hours immediately before reliable_collection_started_at",
    sources: ["UTAMA keeper7/arena/two-stage", "EUROPE forward runs", "AI V2 observer snapshots", "raw source results"],
    rules: [
      "never generate a historical prediction after actual is known",
      "original settled forward rows remain valid evidence even if Observer missed them",
      "missing original learner locks stay missing and are not reconstructed",
      "audit does not change model weights, learning phase, Observer rows, or historical locks"
    ],
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/lock-recovery"]));
  data.performance = {
    ...(data.performance || {}),
    lockRecoveryAudit: "read-only D1 reconciliation; manual/on-demand; no heavy client loop",
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV101(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v101-recovery.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v101-recovery.css">\n</head>');
  if (!html.includes("/v101-recovery.js")) html = html.replace("</body>", '  <script type="module" src="/v101-recovery.js"></script>\n</body>');
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
    if (url.pathname === "/api/lock-recovery") return handleRecovery(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV101(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
