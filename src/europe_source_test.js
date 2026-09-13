const EUROPE_BASE = "https://backend.europelotto.work/api";
const PUBLIC_ROUTES = [
  "/results/3d",
  "/results/3d/",
  "/results/latest",
  "/results/latest/",
];
const MAX_BODY = 180000;

function clip(value, max = 12000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

function summarize(value, depth = 0) {
  if (depth > 3) return Array.isArray(value) ? `[array:${value.length}]` : typeof value;
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 3).map((item) => summarize(item, depth + 1)),
    };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const out = { type: "object", keys: keys.slice(0, 30) };
    for (const key of keys.slice(0, 12)) out[key] = summarize(value[key], depth + 1);
    return out;
  }
  return value;
}

function normalizeRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.results)) return value.results;
  if (value.data && typeof value.data === "object") return Object.values(value.data);
  if (value.results && typeof value.results === "object") return Object.values(value.results);
  return Object.values(value).filter((row) => row && typeof row === "object");
}

function extractExplicitFirstPlace(value) {
  const rows = normalizeRows(value);
  const found = [];
  for (const row of rows.slice(0, 80)) {
    if (!row || typeof row !== "object") continue;
    const raw = row.result;
    if (/^\d{3}$/.test(String(raw ?? "").trim())) {
      found.push({
        result: String(raw).trim(),
        period: row.period ?? null,
        datetime: row.datetime ?? null,
        id: row.id ?? null,
      });
    }
  }
  return found;
}

async function requestRoute(route) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 9000);
  const started = Date.now();
  const url = `${EUROPE_BASE}${route}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://europelotto.click/",
        origin: "https://europelotto.click",
        "user-agent": "Mozilla/5.0 EuropeResultVerifier/1.1",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const raw = (await response.text()).slice(0, MAX_BODY);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    const explicitFirstPlace = parsed != null ? extractExplicitFirstPlace(parsed) : [];

    return {
      ok: response.ok,
      request: { method: "GET", url },
      response: {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") || null,
        bytesRead: raw.length,
      },
      json: parsed != null,
      shape: parsed != null ? summarize(parsed) : null,
      explicitFirstPlace: explicitFirstPlace.slice(0, 12),
      preview: parsed != null ? clip(parsed, 5000) : clip(raw, 5000),
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      request: { method: "GET", url },
      error: error?.message || String(error),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testEurope3DSource() {
  const started = Date.now();
  const attempts = [];
  for (const route of PUBLIC_ROUTES) attempts.push(await requestRoute(route));

  const successful = attempts.find((row) => row.ok && row.explicitFirstPlace?.length);
  return {
    ok: Boolean(successful),
    mode: "read-only-public-endpoint-verification",
    confirmedFromBundle: {
      baseURL: EUROPE_BASE,
      method: "GET",
      historyRoute: "/results/3d",
      latestRoute: "/results/latest",
      firstPlaceField: "result",
      secondPlaceFieldIgnored: "result2",
      thirdPlaceFieldIgnored: "result3",
    },
    selected: successful || null,
    attempts,
    notes: [
      "All tested routes come directly from the site's public SPA bundle; no private paths are guessed.",
      "First Place is explicitly the `result` field in the published frontend code.",
      "Second Place (`result2`) and Third Place (`result3`) are intentionally ignored.",
      "Nothing is persisted to D1 and no predictor/forward lock is changed by this verifier."
    ],
    elapsedMs: Date.now() - started,
  };
}
