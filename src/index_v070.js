import baseWorker from "./index.js";
import { runModelArena, ARENA_VERSION } from "./arena.js";
import { createArenaForward, listArenaForward } from "./arena_forward.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error("Body harus JSON valid."); }
}

async function handleArena(request) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
  try {
    const body = await readJson(request);
    return json({ ok: true, ...runModelArena(body?.history, { decay: body?.decay }) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Model Arena gagal." }, 400);
  }
}

async function handleArenaForward(request, url, env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Arena Forward." }, 503);
  try {
    if (request.method === "POST") {
      const body = await readJson(request);
      const run = await createArenaForward(env.DB, body);
      return json({ ok: true, run });
    }
    if (request.method === "GET") {
      const limit = Number(url.searchParams.get("limit") || 20);
      const runs = await listArenaForward(env.DB, limit);
      return json({ ok: true, count: runs.length, runs });
    }
    return json({ ok: false, error: "Gunakan GET atau POST." }, 405);
  } catch (error) {
    return json({ ok: false, error: error?.message || "Arena Forward gagal." }, 400);
  }
}

async function upgradedHealth(request, env) {
  const baseResponse = await baseWorker.fetch(request, env);
  const data = await baseResponse.json().catch(() => ({}));
  data.ok = true;
  data.version = ARENA_VERSION;
  data.validation = `${data.validation || ""} + V0.7.0 Model Arena`.replace(/^ \+ /, "");
  data.modelArena = {
    version: ARENA_VERSION,
    endpoint: "/api/arena",
    forwardEndpoint: "/api/arena-forward",
    challengers: ["Legacy Ensemble", "DigitBoost GBS", "Hybrid Reranker"],
    method: "Worker-native gradient-boosted decision stumps + Stage-2 pair/order reranker",
    officialXGBoost: false,
    note: "DigitBoost GBS is a deterministic Worker-native challenger, not the official XGBoost/CatBoost library. It must earn promotion through forward tests.",
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/arena", "/api/arena-forward"]));
  data.now = new Date().toISOString();
  return json(data, baseResponse.status);
}

async function injectV070(request, env, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  let html = await response.text();
  if (!html.includes("/v070.js")) {
    const marker = '<script type="module" src="/v067.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v070.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v070.js"></script>\n</body>');
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/arena") return handleArena(request);
    if (url.pathname === "/api/arena-forward") return handleArenaForward(request, url, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV070(request, env, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
