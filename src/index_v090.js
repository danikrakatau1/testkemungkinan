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
  data.performance = {
    autopilotStatus: "fast-path",
    twoStage: "separate endpoint",
    visualMode: "SAFE",
    disabledScripts: ["v082.js", "v082-bgfix.js", "v083.js", "v083-perf.js"],
    note: "Emergency production safe mode disables animated visual layers to guarantee dashboard responsiveness."
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/two-stage"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

function stripFreezeRiskScripts(html) {
  return html
    .replace(/\s*<script[^>]+src=["']\/v082\.js["'][^>]*><\/script>/gi, "")
    .replace(/\s*<script[^>]+src=["']\/v082-bgfix\.js["'][^>]*><\/script>/gi, "")
    .replace(/\s*<script[^>]+src=["']\/v083\.js["'][^>]*><\/script>/gi, "")
    .replace(/\s*<script[^>]+src=["']\/v083-perf\.js["'][^>]*><\/script>/gi, "")
    .replace(/\s*<script[^>]+src=["']\/v090\.js["'][^>]*><\/script>/gi, "");
}

async function injectV090(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = stripFreezeRiskScripts(await response.text());

  const safeStyle = `<style id="v090SafeModeStyle">
    html,body{min-height:100%;background:#040813!important}
    body{background:
      radial-gradient(900px 560px at 12% -8%,rgba(37,99,235,.18),transparent 64%),
      radial-gradient(760px 520px at 92% 2%,rgba(124,58,237,.14),transparent 66%),
      linear-gradient(180deg,#08101f 0%,#050914 48%,#030711 100%)!important}
    .autopilot-panel{background:linear-gradient(155deg,rgba(10,18,34,.91),rgba(5,11,23,.88))!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    .topbar .status::after{content:" · SAFE";opacity:.72}
  </style>`;

  if (!html.includes("v090SafeModeStyle")) html = html.replace("</head>", `${safeStyle}\n</head>`);
  html = html.replace("</body>", '  <script type="module" src="/v090.js"></script>\n</body>');

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
    if (url.pathname === "/api/two-stage") return handleTwoStage(request, env);
    if (url.pathname === "/api/autopilot") return baseWorker.fetch(request, env, ctx);
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
