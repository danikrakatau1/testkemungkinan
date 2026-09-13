import baseWorker from "./index_v091.js";
import { ADAPTIVE_VERSION, getAdaptiveErrorState } from "./adaptive_learner.js";

const VERSION = "0.9.2";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleAdaptive(env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Adaptive Error Learner." }, 503);
  try {
    const state = await getAdaptiveErrorState(env.DB);
    return json({
      ok: true,
      version: ADAPTIVE_VERSION,
      engine: "Adaptive Error Learner",
      policy: "forward-only · bounded · no hindsight rewrite",
      ...state,
      now: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Adaptive Error Learner gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  let adaptive = null;
  try { adaptive = env?.DB ? await getAdaptiveErrorState(env.DB) : null; } catch {}
  data.ok = true;
  data.version = VERSION;
  data.adaptiveErrorLearner = {
    version: ADAPTIVE_VERSION,
    endpoint: "/api/adaptive",
    mode: "forward-only bounded learning",
    phase: adaptive?.phase || "UNKNOWN",
    keeperSettled: adaptive?.keeperSettled ?? 0,
    weights: adaptive?.weights || null,
    modelTrust: adaptive?.modelTrust || null,
    rules: [
      "learn only after a locked prediction has a real subsequent result",
      "never rewrite or rescore an old prediction lock using hindsight",
      "move weights slowly and keep every evidence source inside safe bounds",
      "learn model trust from settled Arena and Two-Stage forward scores",
      "keep historical OOS baseline separate from adaptive live state"
    ],
    note: "Adaptive learning can improve calibration if stable signal exists, but it does not create predictability when the source process is random."
  };
  data.performance = {
    ...(data.performance || {}),
    visualMode: "SAFE",
    adaptiveLearner: "server-side only; no WebGL or heavy client loop",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/adaptive"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV092(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v092.js")) {
    const marker = '<script type="module" src="/v091.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v092.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v092.js"></script>\n</body>');
  }

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
    if (url.pathname === "/api/adaptive") return handleAdaptive(env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV092(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
