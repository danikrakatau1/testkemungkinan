import baseWorker from "./index_v070.js";
import { AUTOPILOT_VERSION, getAutoPilotStatus, runAutoPilot } from "./autopilot.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleAutoPilot(request, env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk AutoPilot." }, 503);
  try {
    if (request.method === "GET") {
      return json(await getAutoPilotStatus(env));
    }
    if (request.method === "POST") {
      return json(await runAutoPilot(env, { collect: true }));
    }
    return json({ ok: false, error: "Gunakan GET atau POST." }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "AutoPilot gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const baseResponse = await baseWorker.fetch(request, env, ctx);
  const data = await baseResponse.json().catch(() => ({}));
  data.ok = true;
  data.version = AUTOPILOT_VERSION;
  data.autoPilot = {
    version: AUTOPILOT_VERSION,
    endpoint: "/api/autopilot",
    cron: "*/10 * * * *",
    pipeline: [
      "collect newest result",
      "persist to D1",
      "settle previous Forward + Arena locks",
      "generate new Legacy prediction",
      "generate DigitBoost + Hybrid Arena",
      "lock next-period predictions",
      "dashboard polls status automatically",
    ],
    tuningPolicy: "prediction/scoring auto; model tuning remains manual and validation-gated",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/autopilot"]));
  data.now = new Date().toISOString();
  return json(data, baseResponse.status);
}

async function injectV080(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v080.js")) {
    const marker = '<script type="module" src="/v070.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v080.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v080.js"></script>\n</body>');
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/autopilot") return handleAutoPilot(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV080(request, response);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runAutoPilot(env, { collect: true }).catch((error) => {
        console.error("autopilot pipeline failed", error);
      }),
    );
  },
};
