const EUROPE_API = "https://backend.europelotto.work/api/results/3d";
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

function scanFirstPlace(value, path = "$", out = [], depth = 0) {
  if (depth > 7 || out.length >= 40 || value == null) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 80) && out.length < 40; i += 1) {
      scanFirstPlace(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return out;
  }
  if (typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value)) {
    const keyText = String(key).toLowerCase();
    const childText = typeof child === "string" || typeof child === "number" ? String(child) : "";
    if (
      /first.?place|first_prize|firstprize|prize1|place1|rank1|rank_1|no1|no_1|winner|result1|result_1/.test(keyText) ||
      /first place/i.test(childText)
    ) {
      out.push({ path: `${path}.${key}`, key, value: child });
      if (out.length >= 40) break;
    }
    scanFirstPlace(child, `${path}.${key}`, out, depth + 1);
    if (out.length >= 40) break;
  }
  return out;
}

function findThreeDigitValues(value, path = "$", out = [], depth = 0) {
  if (depth > 6 || out.length >= 60 || value == null) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 60) && out.length < 60; i += 1) {
      findThreeDigitValues(value[i], `${path}[${i}]`, out, depth + 1);
    }
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if ((typeof child === "string" || typeof child === "number") && /^\d{3}$/.test(String(child).trim())) {
      out.push({ path: `${path}.${key}`, key, value: String(child).trim() });
    }
    findThreeDigitValues(child, `${path}.${key}`, out, depth + 1);
    if (out.length >= 60) break;
  }
  return out;
}

export async function testEurope3DSource() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 9000);
  const started = Date.now();
  try {
    const response = await fetch(EUROPE_API, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        referer: "https://europelotto.click/",
        origin: "https://europelotto.click",
        "user-agent": "Mozilla/5.0 EuropeResultVerifier/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const raw = (await response.text()).slice(0, MAX_BODY);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}

    return {
      ok: response.ok,
      mode: "read-only-public-endpoint-verification",
      request: {
        method: "GET",
        url: EUROPE_API,
      },
      response: {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") || null,
        bytesRead: raw.length,
      },
      json: parsed != null,
      shape: parsed != null ? summarize(parsed) : null,
      firstPlaceCandidates: parsed != null ? scanFirstPlace(parsed) : [],
      threeDigitCandidates: parsed != null ? findThreeDigitValues(parsed).slice(0, 30) : [],
      preview: parsed != null ? clip(parsed) : clip(raw),
      notes: [
        "Read-only GET to the public endpoint discovered in the site's public SPA bundle.",
        "Nothing is saved to D1 and no prediction/collector state is changed.",
        "We still verify the response shape before building the First Place-only collector."
      ],
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
