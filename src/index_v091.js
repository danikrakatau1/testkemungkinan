import baseWorker from "./index_v090.js";
import { runAutoPilot } from "./autopilot.js";
import { runTwoStagePilot } from "./two_stage_forward.js";
import { runKeeper7Pilot } from "./keeper7_forward.js";

const VERSION = "0.9.1";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleKeeper7(env) {
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk 7D Keeper." }, 503);
  try {
    return json(await runKeeper7Pilot(env));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "7D Keeper gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.keeper7 = {
    version: VERSION,
    endpoint: "/api/keeper7",
    mode: "one official KEEP7 / DROP3 per draw",
    primaryKpi: "ALL-3 coverage",
    inputs: [
      "global history up to 2000 draws",
      "recent windows 8/20/50/120",
      "same-hour historical context with shrinkage",
      "position transition evidence",
      "Legacy/DigitBoost/Hybrid arena evidence when locked",
      "Two-Stage V0.9.0 evidence when locked"
    ],
    searchSpace: "all 120 combinations of 7 digits from 0-9",
    outputs: ["KEEP7", "DROP3", "digit ranking", "7D-assisted 3D challenger", "historical rolling-origin validation", "forward settlement"],
    baseline: "uniform 3-position ALL-3 coverage = 34.3%; sample-matched conditional baseline is also stored",
    note: "KEEP7/DROP3 is a statistical challenger, not a guaranteed prediction. Existing 3D model locks are not overwritten."
  };
  data.performance = {
    ...(data.performance || {}),
    visualMode: "SAFE",
    keeper7Endpoint: "separate from core /api/autopilot",
    scheduledOrder: "collector/core locks -> Two-Stage lock -> Keeper7 lock",
    note: "V0.9.1 keeps heavy visual layers disabled and computes Keeper7 independently so the dashboard stays responsive."
  };
  data.endpoints = Array.from(new Set([...(data.endpoints || []), "/api/keeper7"]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV091(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v091.js")) {
    const marker = '<script type="module" src="/v090.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v091.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v091.js"></script>\n</body>');
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
    if (url.pathname === "/api/keeper7") return handleKeeper7(env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);

    const response = await baseWorker.fetch(request, env, ctx);
    return injectV091(request, response);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await runAutoPilot(env, { collect: true });
        await runTwoStagePilot(env);
        await runKeeper7Pilot(env);
      } catch (error) {
        console.error("V0.9.1 scheduled pipeline failed", error);
      }
    })());
  },
};
