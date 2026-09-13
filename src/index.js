import { analyzeHistory } from "./analyzer.js";

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

async function handleAnalyze(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Body harus JSON valid." }, 400);
  }

  try {
    const result = analyzeHistory(body?.history, {
      decay: body?.decay,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error?.message || "Analisis gagal." }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "testkemungkinan",
        version: "0.1.0",
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/analyze") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "Gunakan POST." }, 405);
      }
      return handleAnalyze(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "API endpoint tidak ditemukan." }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
