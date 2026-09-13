import baseWorker from "./index_v083.js";
import { runAutoPilot } from "./autopilot.js";
import { runTwoStagePilot } from "./two_stage_forward.js";

const VERSION = "0.9.0";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleTwoStage(_request, env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk V0.9.0." }, 503);
  try {
    return json(await runTwoStagePilot(env));
  } catch (error) {
    return json({ ok: false, error: error?.message || "Two-Stage V0.9.0 gagal." }, 500);
  }
}

async function augmentAutoPilot(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.ok && env?.DB) {
    try {
      data.twoStage = await runTwoStagePilot(env);
      data.version = VERSION;
      if (data.pipeline) data.pipeline.twoStageCreated = Boolean(data.twoStage?.created);
    } catch (error) {
      data.twoStage = { ok: false, version: VERSION, error: error?.message || "Two-Stage unavailable" };
    }
  }
  return json(data, response.status);
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.twoStage = {
    version: VERSION,
    endpoint: "/api/two-stage",
    role: "challenger",
    stages: [
      "Pattern Flow / Recent Regime Map",
      "Stage-1 digit selection per position",
      "Stage-2 pair/order/permutation reranker",
      "Legacy percentile stabilizer",
      "automatic pre-result lock",
      "automatic post-result forward scoring"
    ],
    windows: [4, 8, 12, 20, 40],
    regimes: ["persistent", "returning", "rotating", "volatile", "transitioning"],
    promotionPolicy: "must beat current engines in forward testing; no accuracy guarantee"
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/two-stage"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV090(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v090.js")) {
    const marker = '<script type="module" src="/v083.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v090.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v090.js"></script>\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/two-stage") return handleTwoStage(request, env);
    if (url.pathname === "/api/autopilot") return augmentAutoPilot(request, env, ctx);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV090(request, response);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await runAutoPilot(env, { collect: true });
        await runTwoStagePilot(env);
      } catch (error) {
        console.error("V0.9.0 scheduled pipeline failed", error);
      }
    })());
  },
};
