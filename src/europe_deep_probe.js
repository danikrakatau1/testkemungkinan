const SOURCE = "https://europelotto.click/";
const MAX_TEXT = 1_000_000;
const MAX_SNIPPETS = 24;

function abs(base, value) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fetchText(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/javascript,text/javascript,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 EuropeResultDeepProbe/1.0",
    },
    redirect: "follow",
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || url,
    contentType: response.headers.get("content-type") || "",
    text: text.slice(0, MAX_TEXT),
    bytesRead: text.length,
  };
}

function scriptUrls(html, base) {
  const out = [];
  const rx = /<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi;
  let m;
  while ((m = rx.exec(html))) out.push(abs(base, m[1]));
  return uniq(out).slice(0, 8);
}

function normalizeSnippet(text) {
  return String(text || "")
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function contextAround(text, needle, radius = 900) {
  const out = [];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  while (out.length < 8) {
    const index = lower.indexOf(n, from);
    if (index < 0) break;
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + needle.length + radius);
    out.push({ needle, index, context: normalizeSnippet(text.slice(start, end)) });
    from = index + Math.max(1, needle.length);
  }
  return out;
}

function extractMethodUrlPairs(text) {
  const out = [];
  const seen = new Set();
  const push = (method, url, raw) => {
    const cleanUrl = normalizeSnippet(url);
    if (!cleanUrl || cleanUrl.length > 260) return;
    const key = `${method}:${cleanUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method: String(method || "").toUpperCase(), url: cleanUrl, context: normalizeSnippet(raw).slice(0, 900) });
  };

  const direct = /\.(get|post|put|patch|delete)\s*\(\s*(["'`])([^"'`]{1,260})\2/gi;
  let m;
  while ((m = direct.exec(text)) && out.length < 80) {
    const raw = text.slice(Math.max(0, m.index - 240), Math.min(text.length, direct.lastIndex + 420));
    push(m[1], m[3], raw);
  }

  const objectCall = /(?:method\s*:\s*(["'])(get|post|put|patch|delete)\1[\s\S]{0,420}?url\s*:\s*(["'`])([^"'`]{1,260})\3)|(?:url\s*:\s*(["'`])([^"'`]{1,260})\5[\s\S]{0,420}?method\s*:\s*(["'])(get|post|put|patch|delete)\7)/gi;
  while ((m = objectCall.exec(text)) && out.length < 120) {
    const method = m[2] || m[8];
    const url = m[4] || m[6];
    const raw = text.slice(Math.max(0, m.index - 180), Math.min(text.length, objectCall.lastIndex + 240));
    push(method, url, raw);
  }

  return out;
}

function extractLikelyApiStrings(text) {
  const hits = [];
  const seen = new Set();
  const rx = /["'`]([^"'`\n\r]{1,220})["'`]/g;
  let m;
  while ((m = rx.exec(text)) && hits.length < 160) {
    const value = normalizeSnippet(m[1]);
    const low = value.toLowerCase();
    if (!(low.includes("result") || low.includes("3d") || low.includes("api") || low.includes("place") || low.includes("draw"))) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    hits.push(value);
  }
  return hits;
}

export async function deepProbeEuropeSource() {
  const started = Date.now();
  const page = await fetchText(SOURCE);
  const scripts = scriptUrls(page.text, page.url || SOURCE);
  const assets = [];
  const snippets = [];
  const calls = [];
  const strings = [];

  const targets = [
    "backend.europelotto.work/api",
    "/results/3d",
    "first place",
    "3d_result",
    "baseurl",
    "axios.create",
  ];

  for (const url of scripts) {
    try {
      const asset = await fetchText(url);
      assets.push({ url, status: asset.status, contentType: asset.contentType, bytesRead: asset.bytesRead });
      if (!asset.ok) continue;

      for (const target of targets) {
        for (const row of contextAround(asset.text, target)) {
          if (snippets.length >= MAX_SNIPPETS) break;
          snippets.push({ source: url, ...row });
        }
        if (snippets.length >= MAX_SNIPPETS) break;
      }

      for (const row of extractMethodUrlPairs(asset.text)) {
        const low = `${row.url} ${row.context}`.toLowerCase();
        if (low.includes("result") || low.includes("3d") || low.includes("backend.europelotto")) {
          calls.push({ source: url, ...row });
        }
      }

      for (const value of extractLikelyApiStrings(asset.text)) {
        strings.push({ source: url, value });
      }
    } catch (error) {
      assets.push({ url, error: error?.message || String(error) });
    }
  }

  const dedupStrings = [];
  const stringSeen = new Set();
  for (const row of strings) {
    const key = row.value;
    if (stringSeen.has(key)) continue;
    stringSeen.add(key);
    dedupStrings.push(row);
  }

  return {
    ok: true,
    mode: "passive-public-bundle-context-probe",
    source: SOURCE,
    page: { status: page.status, finalUrl: page.url, bytesRead: page.bytesRead },
    scripts: assets,
    requestCallCandidates: calls.slice(0, 60),
    contextSnippets: snippets,
    likelyStrings: dedupStrings.slice(0, 120),
    notes: [
      "Read-only inspection of the public SPA HTML and public JS bundles.",
      "This endpoint returns code context around discovered strings so the real method/path can be identified without guessing private routes.",
      "No login, mutation, brute force, or D1 writes are performed."
    ],
    elapsedMs: Date.now() - started,
  };
}
