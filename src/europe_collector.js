export const EUROPE_COLLECTOR_VERSION = "1.0.5";

const BASE_API = "https://backend.europelotto.work/api";
const LATEST_URL = `${BASE_API}/results/latest`;
const HISTORY_URL = `${BASE_API}/results/3d`;
const DEFAULT_BACKFILL_LIMIT = 1200;
const BATCH_SIZE = 80;

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function normalizeRow(row) {
  if (!row || String(row.type || "").toLowerCase() !== "3d") return null;
  const result = normalize3(row.result);
  const period = Number(row.period);
  if (!result || !Number.isInteger(period) || period <= 0) return null;
  return {
    sourceId: Number.isFinite(Number(row.id)) ? Number(row.id) : null,
    period,
    result,
    datetime: row.datetime ? String(row.datetime) : null,
    nextDrawTime: row.nextDrawTime ? String(row.nextDrawTime) : null,
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        referer: "https://europelotto.click/",
        origin: "https://europelotto.click",
        "user-agent": "Mozilla/5.0 EuropeFirstPlaceCollector/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Europe source HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureEuropeSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS europe_results_3d (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      period INTEGER NOT NULL UNIQUE,
      result TEXT NOT NULL,
      draw_datetime TEXT,
      next_draw_time TEXT,
      collected_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_europe_results_period ON europe_results_3d(period DESC)`).run();
}

async function tableCount(db) {
  const query = await db.prepare("SELECT COUNT(*) AS n FROM europe_results_3d").all();
  return Number(query.results?.[0]?.n || 0);
}

async function latestStoredPeriod(db) {
  const query = await db.prepare("SELECT period FROM europe_results_3d ORDER BY period DESC LIMIT 1").all();
  const value = query.results?.[0]?.period;
  return value == null ? null : Number(value);
}

async function upsertRows(db, rows) {
  const unique = [...new Map((rows || []).map((row) => [row.period, row])).values()];
  if (!unique.length) return { inserted: 0, updated: 0 };
  const before = await tableCount(db);
  const now = new Date().toISOString();
  const sql = `
    INSERT INTO europe_results_3d(source_id, period, result, draw_datetime, next_draw_time, collected_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(period) DO UPDATE SET
      source_id=COALESCE(excluded.source_id, europe_results_3d.source_id),
      result=excluded.result,
      draw_datetime=COALESCE(excluded.draw_datetime, europe_results_3d.draw_datetime),
      next_draw_time=COALESCE(excluded.next_draw_time, europe_results_3d.next_draw_time),
      collected_at=excluded.collected_at
  `;
  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    const chunk = unique.slice(start, start + BATCH_SIZE);
    await db.batch(chunk.map((row) => db.prepare(sql).bind(
      row.sourceId,
      row.period,
      row.result,
      row.datetime,
      row.nextDrawTime,
      now,
    )));
  }
  const after = await tableCount(db);
  const inserted = Math.max(0, after - before);
  return { inserted, updated: Math.max(0, unique.length - inserted) };
}

export async function fetchEuropeLatest() {
  const payload = await fetchJson(LATEST_URL);
  const rows = Array.isArray(payload) ? payload : Object.values(payload || {});
  const row = rows.map(normalizeRow).find(Boolean);
  if (!row) throw new Error("Europe latest 3D First Place tidak ditemukan.");
  return row;
}

export async function fetchEuropeHistory(limit = DEFAULT_BACKFILL_LIMIT) {
  const payload = await fetchJson(HISTORY_URL);
  const rawRows = Array.isArray(payload) ? payload : Object.values(payload || {});
  const rows = rawRows.map(normalizeRow).filter(Boolean);
  rows.sort((a, b) => b.period - a.period);
  return rows.slice(0, Math.max(40, Math.min(3000, Number(limit) || DEFAULT_BACKFILL_LIMIT)));
}

export async function readEuropeHistory(db, limit = 500) {
  await ensureEuropeSchema(db);
  const query = await db.prepare(`
    SELECT source_id AS sourceId, period, result, draw_datetime AS datetime,
           next_draw_time AS nextDrawTime, collected_at AS collectedAt
    FROM europe_results_3d
    ORDER BY period DESC
    LIMIT ?
  `).bind(Math.max(1, Math.min(3000, Number(limit) || 500))).all();
  return query.results || [];
}

export async function europeDrawCount(db) {
  await ensureEuropeSchema(db);
  return tableCount(db);
}

export async function collectEurope(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Europe collector.");
  const db = env.DB;
  await ensureEuropeSchema(db);

  const before = await tableCount(db);
  const storedBefore = await latestStoredPeriod(db);
  const latest = await fetchEuropeLatest();

  // V1.0.5: preserve the raw-result denominator when the source moved by more
  // than one period. This is ACTUAL-only history recovery, never prediction
  // recovery. Forward locks for already-known results remain permanently missing.
  let gapFill = null;
  if (storedBefore != null && Number(latest.period) > storedBefore + 1) {
    const history = await fetchEuropeHistory(options.gapFillLimit || DEFAULT_BACKFILL_LIMIT);
    const missingActuals = history
      .filter((row) => Number(row.period) > storedBefore && Number(row.period) < Number(latest.period))
      .sort((a, b) => a.period - b.period);
    const write = await upsertRows(db, missingActuals);
    gapFill = {
      detected: true,
      fromPeriod: storedBefore,
      sourceLatestPeriod: Number(latest.period),
      expectedMissing: Math.max(0, Number(latest.period) - storedBefore - 1),
      fetchedActualRows: missingActuals.length,
      ...write,
      predictionBackfill: false,
    };
  }

  const liveWrite = await upsertRows(db, [latest]);

  let backfill = null;
  const threshold = Math.max(40, Number(options.backfillThreshold || 120));
  if (options.backfill === true || before < threshold) {
    const history = await fetchEuropeHistory(options.backfillLimit || DEFAULT_BACKFILL_LIMIT);
    const write = await upsertRows(db, history);
    backfill = { fetched: history.length, ...write };
  }

  const count = await tableCount(db);
  const rows = await readEuropeHistory(db, 2);
  return {
    ok: true,
    version: EUROPE_COLLECTOR_VERSION,
    source: "Europe Lotto public API",
    mode: "First Place only",
    field: "result",
    ignored: ["result2", "result3"],
    intervalMinutes: 45,
    latest: rows[0] || latest,
    previous: rows[1] || null,
    draws: count,
    liveWrite,
    gapFill,
    backfill,
    now: new Date().toISOString(),
  };
}
