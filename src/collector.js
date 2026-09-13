const SOURCE_URL = "https://latolatolotto.com/result3d.php";
const MAX_BATCH_PAGES = 20;
const MAX_SOURCE_PAGE = 5000;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function lastMatch(text, regex) {
  const matches = [...String(text).matchAll(regex)];
  return matches.at(-1)?.[0]?.trim() || null;
}

export function parseResultPage(html, page = 1) {
  const source = String(html || "");
  const periodRegex = /Period\s*:\s*(?:<[^>]*>\s*)*(\d{3,})/gi;
  const periodMatches = [...source.matchAll(periodRegex)];
  const rows = [];

  for (let i = 0; i < periodMatches.length; i += 1) {
    const match = periodMatches[i];
    const period = Number(match[1]);
    if (!Number.isInteger(period)) continue;

    const start = match.index ?? 0;
    const end = periodMatches[i + 1]?.index ?? source.length;
    const resultChunk = source.slice(start, end);
    const balls = [...resultChunk.matchAll(/ball[_-]?([0-9])\.webp/gi)]
      .slice(0, 3)
      .map((item) => item[1]);

    if (balls.length !== 3) continue;

    const previousEnd = i === 0 ? Math.max(0, start - 1800) : (periodMatches[i - 1].index ?? 0) + periodMatches[i - 1][0].length;
    const metaText = stripTags(source.slice(previousEnd, start));
    const drawDate = lastMatch(
      metaText,
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/gi,
    );
    const drawTime = lastMatch(metaText, /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi);

    rows.push({
      period,
      result: balls.join(""),
      drawDate,
      drawTime,
      page,
      sourceUrl: page > 1 ? `${SOURCE_URL}?page=${page}` : SOURCE_URL,
    });
  }

  return rows;
}

export async function fetchResultPage(page = 1) {
  const safePage = clampInt(page, 1, 1, MAX_SOURCE_PAGE);
  const url = safePage > 1 ? `${SOURCE_URL}?page=${safePage}` : SOURCE_URL;
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "cache-control": "no-cache",
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!response.ok) {
    throw new Error(`Source LatoLato gagal diambil (${response.status}) pada page ${safePage}.`);
  }

  const html = await response.text();
  const rows = parseResultPage(html, safePage);
  if (!rows.length) {
    throw new Error(`Parser tidak menemukan hasil 3D pada source page ${safePage}.`);
  }
  return rows;
}

export async function fetchResultRange(options = {}) {
  const startPage = clampInt(options.startPage, 1, 1, MAX_SOURCE_PAGE);
  const requestedPages = clampInt(options.pages, 5, 1, MAX_BATCH_PAGES);
  const endPage = Math.min(MAX_SOURCE_PAGE, startPage + requestedPages - 1);
  const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  const settled = await Promise.allSettled(pageNumbers.map((page) => fetchResultPage(page)));

  const rows = [];
  const failedPages = [];
  settled.forEach((item, index) => {
    if (item.status === "fulfilled") rows.push(...item.value);
    else failedPages.push({ page: pageNumbers[index], error: item.reason?.message || "fetch failed" });
  });

  const byPeriod = new Map();
  rows.forEach((row) => {
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, row);
  });

  const results = [...byPeriod.values()].sort((a, b) => b.period - a.period);
  if (!results.length) {
    throw new Error(`Tidak ada hasil 3D yang berhasil dikumpulkan dari source page ${startPage}-${endPage}.`);
  }

  return {
    source: SOURCE_URL,
    startPage,
    endPage,
    requestedPages: pageNumbers.length,
    successfulPages: pageNumbers.length - failedPages.length,
    failedPages,
    count: results.length,
    latest: results[0],
    oldest: results.at(-1) || null,
    results,
  };
}

export async function fetchRecentResults(options = {}) {
  return fetchResultRange({ startPage: 1, pages: options.pages });
}

export async function ensureSchema(db) {
  if (!db) return false;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS results_3d (
      period INTEGER PRIMARY KEY,
      result TEXT NOT NULL CHECK (length(result) = 3),
      draw_date TEXT,
      draw_time TEXT,
      source_url TEXT NOT NULL,
      collected_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_results_3d_period_desc ON results_3d(period DESC)"
  ).run();

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_results_3d_collected_at ON results_3d(collected_at)"
  ).run();

  return true;
}

export async function persistResults(db, results = []) {
  if (!db) {
    return {
      configured: false,
      inserted: 0,
      message: "D1 binding DB belum dikonfigurasi. Collector live tetap bisa digunakan tanpa storage.",
    };
  }

  await ensureSchema(db);

  if (!Array.isArray(results) || results.length === 0) {
    return { configured: true, inserted: 0 };
  }

  const collectedAt = new Date().toISOString();
  const statements = results.map((row) => db.prepare(`
    INSERT OR IGNORE INTO results_3d
      (period, result, draw_date, draw_time, source_url, collected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    row.period,
    row.result,
    row.drawDate,
    row.drawTime,
    row.sourceUrl,
    collectedAt,
  ));

  const responses = await db.batch(statements);
  const inserted = responses.reduce((total, item) => total + Number(item?.meta?.changes || 0), 0);
  return { configured: true, inserted };
}

export async function readStoredResults(db, limit = 500) {
  if (!db) {
    throw new Error("D1 binding DB belum dikonfigurasi.");
  }

  await ensureSchema(db);
  const safeLimit = clampInt(limit, 500, 1, 5000);
  const query = await db.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime,
           source_url AS sourceUrl, collected_at AS collectedAt
    FROM results_3d
    ORDER BY period DESC
    LIMIT ?
  `).bind(safeLimit).all();

  return query.results || [];
}

async function maxStoredSourcePage(db) {
  if (!db) return 0;
  await ensureSchema(db);
  const query = await db.prepare(`
    SELECT MAX(
      CASE
        WHEN instr(source_url, 'page=') > 0
          THEN CAST(substr(source_url, instr(source_url, 'page=') + 5) AS INTEGER)
        ELSE 1
      END
    ) AS maxPage
    FROM results_3d
  `).all();
  return Number(query.results?.[0]?.maxPage || 0);
}

export async function backfillOlderResults(env, options = {}) {
  if (!env?.DB) {
    return {
      configured: false,
      inserted: 0,
      count: 0,
      message: "D1 binding DB diperlukan untuk incremental backfill.",
    };
  }

  const pages = clampInt(options.pages, 5, 1, MAX_BATCH_PAGES);
  const storedMaxPage = await maxStoredSourcePage(env.DB);
  const startPage = clampInt(options.startPage, Math.max(1, storedMaxPage + 1), 1, MAX_SOURCE_PAGE);
  const collected = await fetchResultRange({ startPage, pages });
  const storage = await persistResults(env.DB, collected.results);

  return {
    ...collected,
    storage,
    nextStartPage: collected.endPage + 1,
  };
}

export async function collectAndPersist(env, options = {}) {
  const collected = await fetchRecentResults(options);
  const recentStorage = await persistResults(env?.DB, collected.results);

  const requestedBackfillPages = clampInt(options.backfillPages, 0, 0, MAX_BATCH_PAGES);
  let backfill = null;
  let storage = recentStorage;
  let results = collected.results;

  if (env?.DB && requestedBackfillPages > 0) {
    try {
      backfill = await backfillOlderResults(env, { pages: requestedBackfillPages });
      const byPeriod = new Map();
      [...collected.results, ...(backfill.results || [])].forEach((row) => {
        if (!byPeriod.has(row.period)) byPeriod.set(row.period, row);
      });
      results = [...byPeriod.values()].sort((a, b) => b.period - a.period);
      storage = {
        configured: true,
        inserted: Number(recentStorage.inserted || 0) + Number(backfill.storage?.inserted || 0),
        recentInserted: Number(recentStorage.inserted || 0),
        backfillInserted: Number(backfill.storage?.inserted || 0),
      };
    } catch (error) {
      backfill = {
        ok: false,
        error: error?.message || "Backfill gagal.",
      };
      storage = {
        ...recentStorage,
        recentInserted: Number(recentStorage.inserted || 0),
        backfillInserted: 0,
      };
    }
  }

  return {
    ...collected,
    count: results.length,
    results,
    storage,
    backfill,
  };
}
