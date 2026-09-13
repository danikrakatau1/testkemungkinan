const SOURCE = "https://europelotto.click/";
const MAX_SCRIPTS = 8;
const MAX_TEXT = 1_800_000;

function abs(base, value) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function clip(value, max = 220) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractScriptUrls(html, base) {
  const out = [];
  const rx = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = rx.exec(html)) && out.length < MAX_SCRIPTS) out.push(abs(base, match[1]));
  const preload = /<link\b[^>]*\b(?:rel=["'][^"']*(?:modulepreload|preload)[^"']*["'])[^>]*\bhref=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi;
  while ((match = preload.exec(html)) && out.length < MAX_SCRIPTS) out.push(abs(base, match[1]));
  return uniq(out).slice(0, MAX_SCRIPTS);
}

function extractCandidates(text, sourceUrl) {
  const rows = [];
  const push = (kind, value) => {
    const raw = String(value || "").replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    if (!raw || raw.length > 500) return;
    rows.push({ kind, value: clip(raw), source: sourceUrl });
  };

  const absolute = text.match(/https?:\\?\/\\?\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g) || [];
  for (const value of absolute) push("absolute-url", value);

  const quoted = /["'`]([^"'`\n\r]{1,260})["'`]/g;
  let match;
  while ((match = quoted.exec(text))) {
    const value = match[1];
    const low = value.toLowerCase();
    if (
      low.includes("3d_result") || low.includes("3d-result") || low.includes("first place") ||
      low.includes("first_place") || low.includes("firstplace") || low.includes("result3d") ||
      low.includes("result_3d") || low.includes("/api/") || low.includes("result") && (value.includes("/") || value.includes("http"))
    ) push("string", value);
  }

  const baseUrlRx = /(?:baseURL|baseUrl|apiUrl|apiURL|API_URL)\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
  while ((match = baseUrlRx.exec(text))) push("base-url", match[1]);

  return rows;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/javascript,text/javascript,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 EuropeResultPassiveProbe/1.0",
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

export async function probeEuropeSource() {
  const started = Date.now();
  const page = await fetchText(SOURCE);
  const scripts = extractScriptUrls(page.text, page.url || SOURCE);
  const candidates = extractCandidates(page.text, page.url || SOURCE);
  const inspected = [];

  for (const url of scripts) {
    try {
      const asset = await fetchText(url);
      inspected.push({ url, status: asset.status, contentType: asset.contentType, bytesRead: asset.bytesRead });
      candidates.push(...extractCandidates(asset.text, url));
    } catch (error) {
      inspected.push({ url, error: error?.message || String(error) });
    }
  }

  const dedup = [];
  const seen = new Set();
  for (const row of candidates) {
    const key = `${row.kind}:${row.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(row);
  }

  const ranked = dedup.sort((a, b) => {
    const score = (row) => {
      const s = row.value.toLowerCase();
      let n = 0;
      if (s.includes("3d_result") || s.includes("3d-result")) n += 8;
      if (s.includes("first place") || s.includes("first_place") || s.includes("firstplace")) n += 8;
      if (s.includes("api")) n += 5;
      if (s.includes("result")) n += 4;
      if (row.kind === "base-url") n += 4;
      if (row.kind === "absolute-url") n += 2;
      return n;
    };
    return score(b) - score(a);
  }).slice(0, 120);

  return {
    ok: true,
    mode: "passive-public-asset-probe",
    source: SOURCE,
    page: { status: page.status, finalUrl: page.url, contentType: page.contentType, bytesRead: page.bytesRead },
    scriptUrls: scripts,
    inspectedScripts: inspected,
    candidates: ranked,
    notes: [
      "Read-only: fetches the public SPA HTML and public JS assets only.",
      "No login, form submission, mutation, brute force, or guessed private paths.",
      "Candidate strings still need verification against the browser request/response before building the collector.",
    ],
    elapsedMs: Date.now() - started,
  };
}
