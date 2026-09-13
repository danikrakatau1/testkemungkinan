import {
  analyzeHistory,
  backtestHistory,
  compareModels,
  listModels,
  validateWeightedEnsemble,
} from "./analyzer.js";
import { collectAndPersist, fetchRecentResults, readStoredResults } from "./collector.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Body harus JSON valid.");
  }
}

function analysisOptions(body = {}) {
  return {
    decay: body?.decay,
    minTrain: body?.minTrain,
    maxTrials: body?.maxTrials,
    modelId: body?.modelId,
    holdoutTrials: body?.holdoutTrials,
  };
}

async function handleAnalyze(request) {
  try {
    const body = await readJson(request);
    return json({ ok: true, ...analyzeHistory(body?.history, analysisOptions(body)) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Analisis gagal." }, 400);
  }
}

async function handleBacktest(request) {
  try {
    const body = await readJson(request);
    return json({ ok: true, ...backtestHistory(body?.history, analysisOptions(body)) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Backtest gagal." }, 400);
  }
}

async function handleLeaderboard(request) {
  try {
    const body = await readJson(request);
    return json({ ok: true, ...compareModels(body?.history, analysisOptions(body)) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Perbandingan model gagal." }, 400);
  }
}

async function handleValidation(request) {
  try {
    const body = await readJson(request);
    return json({ ok: true, ...validateWeightedEnsemble(body?.history, analysisOptions(body)) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Validation Gate gagal." }, 400);
  }
}

function pagesFromUrl(url, fallback = 5) {
  const raw = Number(url.searchParams.get("pages") ?? fallback);
  if (!Number.isInteger(raw)) return fallback;
  return Math.min(20, Math.max(1, raw));
}

async function handleLiveSource(url) {
  try {
    const data = await fetchRecentResults({ pages: pagesFromUrl(url) });
    return json({ ok: true, mode: "live-source", ...data, history: data.results.map((row) => row.result) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Collector source gagal." }, 502);
  }
}

async function handleCollect(request, env) {
  try {
    const body = await readJson(request).catch(() => ({}));
    const pages = Math.min(20, Math.max(1, Number(body?.pages) || 2));
    const data = await collectAndPersist(env, { pages });
    return json({ ok: true, mode: "collect-and-persist", ...data, history: data.results.map((row) => row.result) });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Collector gagal." }, 502);
  }
}

async function handleStoredHistory(url, env) {
  if (!env?.DB) {
    return json({
      ok: false,
      storageConfigured: false,
      error: "D1 binding DB belum dikonfigurasi. Gunakan /api/source untuk live collector sementara.",
    }, 503);
  }

  try {
    const limit = Number(url.searchParams.get("limit") || 500);
    const results = await readStoredResults(env.DB, limit);
    return json({
      ok: true,
      storageConfigured: true,
      count: results.length,
      latest: results[0] || null,
      results,
      history: results.map((row) => row.result),
    });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Gagal membaca D1." }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "testkemungkinan",
        version: "0.5.0",
        storageConfigured: Boolean(env?.DB),
        models: listModels(),
        validation: "chronological calibration + locked newest holdout",
        endpoints: [
          "/api/models",
          "/api/analyze",
          "/api/backtest",
          "/api/leaderboard",
          "/api/validate",
          "/api/source?pages=5",
          "/api/collect",
          "/api/history?limit=500",
        ],
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/models") {
      if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET." }, 405);
      return json({ ok: true, version: "0.5.0", models: listModels() });
    }

    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
      return handleAnalyze(request);
    }

    if (url.pathname === "/api/backtest") {
      if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
      return handleBacktest(request);
    }

    if (url.pathname === "/api/leaderboard") {
      if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
      return handleLeaderboard(request);
    }

    if (url.pathname === "/api/validate") {
      if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
      return handleValidation(request);
    }

    if (url.pathname === "/api/source") {
      if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET." }, 405);
      return handleLiveSource(url);
    }

    if (url.pathname === "/api/collect") {
      if (request.method !== "POST") return json({ ok: false, error: "Gunakan POST." }, 405);
      return handleCollect(request, env);
    }

    if (url.pathname === "/api/history") {
      if (request.method !== "GET") return json({ ok: false, error: "Gunakan GET." }, 405);
      return handleStoredHistory(url, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "API endpoint tidak ditemukan." }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      collectAndPersist(env, { pages: 2 }).catch((error) => {
        console.error("scheduled collector failed", error);
      }),
    );
  },
};
