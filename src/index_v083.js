import baseWorker from "./index_v082.js";

const VERSION = "0.8.3";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.webglBackground = {
    version: VERSION,
    engine: "WebGL2 performance-safe",
    autoCycle: true,
    holdSeconds: 12,
    transitionSeconds: 1.2,
    targetFps: 24,
    renderScale: "0.62 desktop / 0.52 compact",
    worlds: [
      "Fluid Nebula",
      "Gravitational Black Hole",
      "Meteor Storm",
      "Spiral Galaxy",
      "Orbital World",
      "Hyperspace",
      "Supernova",
      "Aurora",
      "Cosmic Storm",
      "Eclipse",
      "Wormhole"
    ],
    note: "Performance hotfix: lighter shader, capped render resolution/FPS, visibility pause, CSS fallback."
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV083(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v083-perf.js")) {
    const marker = '<script type="module" src="/v082.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v083-perf.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v083-perf.js"></script>\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV083(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};
