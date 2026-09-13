import { analyzeHistory, backtestHistory } from "./analyzer.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Body harus JSON valid.");
  }
}

async function handleAnalyze(request) {
  try {
    const body = await readJson(request);
    const result = analyzeHistory(body?.history, {
      decay: body?.decay,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Analisis gagal." }, 400);
  }
}

async function handleBacktest(request) {
  try {
    const body = await readJson(request);
    const result = backtestHistory(body?.history, {
      decay: body?.decay,
      minTrain: body?.minTrain,
      maxTrials: body?.maxTrials,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Backtest gagal." }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "testkemungkinan",
        version: "0.2.0",
        endpoints: ["/api/analyze", "/api/backtest"],
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Gunakan POST." }, 405);
      }
      return handleAnalyze(request);
    }

    if (url.pathname === "/api/backtest") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Gunakan POST." }, 405);
      }
      return handleBacktest(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "API endpoint tidak ditemukan." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
