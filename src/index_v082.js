import baseWorker from "./index_v081.js";

const VERSION = "0.8.2";
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
  data.motionUI = {
    version: VERSION,
    style: "minimal living UI",
    background: "lightweight animated aurora + grid + grain, adapted from the supplied cosmic direction without WebGL overhead",
    typography: "ChatGPT-like system sans stack; no bundled proprietary font files",
    interactions: [
      "model-card spotlight and hover lift",
      "countdown digit tick",
      "live value flash on updates",
      "table row stagger/reveal",
      "table hover focus",
      "soft status pulse",
      "button shimmer/press feedback"
    ],
    accessibility: "prefers-reduced-motion disables nonessential animation"
  };
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV082(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v082.js")) {
    const marker = '<script type="module" src="/v081.js"></script>';
    if (html.includes(marker)) html = html.replace(marker, `${marker}\n  <script type="module" src="/v082.js"></script>`);
    else html = html.replace("</body>", '  <script type="module" src="/v082.js"></script>\n</body>');
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
    return injectV082(request, response);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  }
};
