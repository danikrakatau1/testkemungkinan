import baseWorker from "./index_v098.js";
import {
  LAB_REVIEW_DEFAULT_SIMS,
  LAB_REVIEW_VERSION,
  getLabReviewStatus,
  runLabReview,
  runLabReviewIfDue,
} from "./lab_review_orchestrator.js";

const VERSION = "0.9.9";
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function handleLabReviewStatus(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET untuk Lab Review status." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Lab Review." }, 503);
  try {
    return json(await getLabReviewStatus(env, { limit: 10 }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Lab Review status gagal." }, 500);
  }
}

async function handleLabReviewRun(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST untuk menjalankan Lab Review manual." }, 405);
  if (!env?.DB) return json({ ok: false, error: "D1 binding DB diperlukan untuk Lab Review." }, 503);
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("sims") || LAB_REVIEW_DEFAULT_SIMS);
  const simulations = Math.max(100, Math.min(2500, Number.isFinite(raw) ? Math.trunc(raw) : LAB_REVIEW_DEFAULT_SIMS));
  try {
    return json(await runLabReview(env, { force: true, simulations }));
  } catch (error) {
    return json({ ok: false, version: VERSION, error: error?.message || "Lab Review manual gagal." }, 500);
  }
}

async function upgradedHealth(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  const data = await response.json().catch(() => ({}));
  data.ok = true;
  data.version = VERSION;
  data.labReviewOrchestrator = {
    version: LAB_REVIEW_VERSION,
    statusEndpoint: "/api/lab-review",
    manualRunEndpoint: "/api/lab-review/run?sims=1000",
    schedule: "evaluated on existing 5-minute cron",
    automaticSimulations: LAB_REVIEW_DEFAULT_SIMS,
    triggers: [
      "24H observation completion",
      "UTAMA 24/50/100/200 settled",
      "EUROPE 24/50/100/200 settled"
    ],
    auditBundle: ["Evidence Monitor", "Forward Edge Audit", "Randomness Forensics", "Monte Carlo Forensics"],
    decisions: ["EXTEND_COLLECTION", "REVIEW_READY", "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED"],
    modelWrites: false,
    aiPhaseChanges: false,
    weightChanges: false,
    reportWritesOnly: true,
    humanReviewRequiredForEdgeCandidate: true,
  };
  data.performance = {
    ...(data.performance || {}),
    labReview: "milestone/time-triggered only; heavy calibration does not run every cron tick",
  };
  data.endpoints = Array.from(new Set([
    ...(data.endpoints || []),
    "/api/lab-review",
    "/api/lab-review/run",
  ]));
  data.now = new Date().toISOString();
  return json(data, response.status);
}

async function injectV099(request, response) {
  if (request.method !== "GET" || !response.ok) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/" && url.pathname !== "/index.html") return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("/v099-lab-review.css")) html = html.replace("</head>", '  <link rel="stylesheet" href="/v099-lab-review.css">\n</head>');
  if (!html.includes("/v099-lab-review.js")) html = html.replace("</body>", '  <script type="module" src="/v099-lab-review.js"></script>\n</body>');

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
    if (url.pathname === "/api/lab-review") return handleLabReviewStatus(request, env);
    if (url.pathname === "/api/lab-review/run") return handleLabReviewRun(request, env);
    if (url.pathname === "/api/health") return upgradedHealth(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return injectV099(request, response);
  },

  async scheduled(event, env, ctx) {
    baseWorker.scheduled(event, env, ctx);
    ctx.waitUntil((async () => {
      try {
        await runLabReviewIfDue(env);
      } catch (error) {
        console.error("V0.9.9 Lab Review scheduled check failed", error);
      }
    })());
  },
};
