const ENGINE_VERSION = "0.6.5";
const WINDOW_TARGETS = 18;
const WINDOW_HOLDOUT = 6;
const WINDOWS_DEFAULT = 8;
const RANDOM_MEAN_RANK = 500.5;
const RANDOM_RANK_VARIANCE = (1000 ** 2 - 1) / 12;
const RANDOM_TOP10 = 0.01;

const nativeFetch = window.fetch.bind(window);
let activeCapture = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function binomialTail(n, atLeast, probability) {
  if (!n || atLeast <= 0) return 1;
  if (atLeast > n) return 0;
  const p = Number(probability);
  const q = 1 - p;
  let term = q ** n;
  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    if (k >= atLeast) total += term;
    if (k === n) break;
    term *= ((n - k) / (k + 1)) * (p / q);
  }
  return clamp(total, 0, 1);
}

function parseHistory() {
  const input = document.querySelector("#historyInput");
  return String(input?.value || "")
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter((item) => /^\d{1,3}$/.test(item) && Number(item) <= 999)
    .map((item) => item.padStart(3, "0"));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function summarizeRanks(ranks = []) {
  const trials = ranks.length;
  const top10Hits = ranks.filter((rank) => rank <= 10).length;
  const meanTargetRank = trials ? ranks.reduce((sum, rank) => sum + rank, 0) / trials : 1000;
  const meanRankDelta = RANDOM_MEAN_RANK - meanTargetRank;
  const se = trials ? Math.sqrt(RANDOM_RANK_VARIANCE / trials) : Infinity;
  const pMeanRank = trials ? 1 - normalCdf(meanRankDelta / se) : 1;
  const pTop10 = binomialTail(trials, top10Hits, RANDOM_TOP10);
  return {
    trials,
    top10Hits,
    top10HitRatePct: trials ? (top10Hits / trials) * 100 : 0,
    meanTargetRank,
    meanRankDelta,
    pMeanRank,
    pTop10,
  };
}

function regimeVerdict(windows) {
  const deltas = windows.map((window) => Number(window.holdout?.weighted?.evidence?.meanRankDelta || 0));
  const recentCount = Math.min(2, deltas.length);
  const recent = mean(deltas.slice(0, recentCount));
  const older = mean(deltas.slice(recentCount));
  const positive = deltas.filter((delta) => delta > 0).length;

  if (recent > 50 && older <= 0) return "RECENT-ONLY EDGE";
  if (positive >= Math.ceil(windows.length * 0.75) && mean(deltas) > 25) return "BROAD POSITIVE REGIME";
  if (positive <= Math.floor(windows.length * 0.25)) return "MOSTLY NEGATIVE REGIME";
  return "MIXED REGIME";
}

function ensureCapture() {
  if (activeCapture && !activeCapture.done) return activeCapture;
  const snapshot = parseHistory();
  const minTrain = Number(document.querySelector("#minTrain")?.value || 8);
  const decay = Number(document.querySelector("#decay")?.value || 0.9);
  const available = Math.floor((snapshot.length - minTrain) / WINDOW_TARGETS);
  const expectedWindows = Math.min(WINDOWS_DEFAULT, available);

  activeCapture = {
    snapshot,
    minTrain,
    decay,
    expectedWindows,
    windows: new Map(),
    done: false,
    startedAt: new Date().toISOString(),
    fingerprintPromise: sha256(JSON.stringify(snapshot)),
  };
  setExperimentStatus(`Merekam run baru · menunggu ${expectedWindows} window…`, "running");
  return activeCapture;
}

function requestInfo(input, init = {}) {
  try {
    const url = typeof input === "string" ? new URL(input, location.href) : new URL(input.url, location.href);
    const method = String(init.method || (typeof input === "object" ? input.method : "GET") || "GET").toUpperCase();
    return { url, method };
  } catch {
    return { url: null, method: "GET" };
  }
}

function bodyJson(init = {}) {
  try {
    if (typeof init.body !== "string") return null;
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

window.fetch = async function experimentAwareFetch(input, init = {}) {
  const info = requestInfo(input, init);
  const isWindow = info.url?.pathname === "/api/validate-window" && info.method === "POST";
  const payload = isWindow ? bodyJson(init) : null;
  const capture = isWindow ? ensureCapture() : null;
  const response = await nativeFetch(input, init);

  if (isWindow && response.ok && capture && !capture.done) {
    response.clone().json().then(async (data) => {
      if (!data?.ok) return;
      const requestHistory = Array.isArray(payload?.history) ? payload.history : [];
      const offset = Math.max(0, capture.snapshot.length - requestHistory.length);
      capture.windows.set(offset, data);
      setExperimentStatus(`Merekam window ${capture.windows.size}/${capture.expectedWindows}…`, "running");
      if (capture.windows.size >= capture.expectedWindows) {
        await finalizeCapture(capture);
      }
    }).catch(() => {});
  }

  return response;
};

async function finalizeCapture(capture) {
  if (capture.done) return;
  capture.done = true;
  const ordered = [...capture.windows.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, capture.expectedWindows)
    .map(([offset, data]) => ({ offset, data }));

  if (ordered.length < capture.expectedWindows) {
    setExperimentStatus("Run selesai tetapi window capture tidak lengkap; experiment tidak disimpan.", "error");
    return;
  }

  const windows = ordered.map((item) => item.data);
  const weightedRanks = windows.flatMap((window) => (window.holdout?.trials || []).map((row) => Number(row.weightedRank || 1000)));
  const aggregate = summarizeRanks(weightedRanks);
  const stableWindows = windows.filter((window) => Number(window.holdout?.weighted?.evidence?.meanRankDelta || 0) > 0).length;
  const minStable = Math.ceil(windows.length * 0.6);
  const gatePassed = (
    aggregate.trials >= 42 &&
    aggregate.meanRankDelta > 0 &&
    aggregate.pTop10 <= 0.10 &&
    aggregate.pMeanRank <= 0.20 &&
    stableWindows >= minStable
  );
  const fingerprint = await capture.fingerprintPromise;
  const runKey = await sha256(JSON.stringify({
    fingerprint,
    engineVersion: ENGINE_VERSION,
    decay: capture.decay,
    minTrain: capture.minTrain,
    windows: windows.length,
  }));

  const currentTop3 = (windows[0]?.currentWeighted?.top3 || []).map((row) => row.number).slice(0, 3);
  const summaries = ordered.map(({ offset, data }, index) => ({
    window: index + 1,
    offset,
    holdout: Number(data.holdout?.weighted?.trials || WINDOW_HOLDOUT),
    top10Hits: Number(data.holdout?.weighted?.top10Hits || 0),
    top10HitRatePct: Number(data.holdout?.weighted?.top10HitRatePct || 0),
    meanTargetRank: Number(data.holdout?.weighted?.meanTargetRank || 1000),
    meanRankDelta: Number(data.holdout?.weighted?.evidence?.meanRankDelta || 0),
    gate: data.gate?.status || "locked",
    top3: (data.currentWeighted?.top3 || []).map((row) => row.number).slice(0, 3),
  }));

  const payload = {
    runKey,
    fingerprint,
    engineVersion: ENGINE_VERSION,
    snapshot: capture.snapshot,
    decay: capture.decay,
    minTrain: capture.minTrain,
    windowCount: windows.length,
    evaluatedTargets: windows.length * WINDOW_TARGETS,
    holdoutTargets: aggregate.trials,
    weightedTop10Hits: aggregate.top10Hits,
    weightedTop10Rate: aggregate.top10HitRatePct,
    weightedMeanRank: aggregate.meanTargetRank,
    meanRankDelta: aggregate.meanRankDelta,
    pTop10: aggregate.pTop10,
    pMeanRank: aggregate.pMeanRank,
    stableWindows,
    gateStatus: gatePassed ? "validated" : "locked",
    regimeVerdict: regimeVerdict(windows),
    currentTop3,
    windowSummaries: summaries,
    params: {
      historyOrder: "newest-to-oldest",
      targetsPerWindow: WINDOW_TARGETS,
      holdoutPerWindow: WINDOW_HOLDOUT,
      trainingDrawsPerTarget: 80,
      startedAt: capture.startedAt,
    },
  };

  try {
    const response = await nativeFetch("/api/experiments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok || !saved.ok) throw new Error(saved.error || `Save gagal (${response.status})`);
    setExperimentStatus(`Experiment #${saved.experiment.id} terkunci · ${fingerprint.slice(0, 12)}…`, "success");
    await loadExperiments();
  } catch (error) {
    setExperimentStatus(`Experiment belum tersimpan: ${error.message || "unknown error"}`, "error");
  }
}

function injectStyles() {
  if (document.querySelector("#v065Styles")) return;
  const style = document.createElement("style");
  style.id = "v065Styles";
  style.textContent = `
    .experiment-panel{position:relative;overflow:hidden}
    .experiment-panel::before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(52,211,153,.7),transparent)}
    .experiment-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:12px 0}
    .experiment-status{font-size:12px;color:#94a3b8}.experiment-status.success{color:#6ee7b7}.experiment-status.error{color:#fda4af}.experiment-status.running{color:#93c5fd}
    .experiment-refresh{border:1px solid rgba(148,163,184,.22);background:#0b1221;color:#cbd5e1;border-radius:10px;padding:8px 11px;font-weight:700;cursor:pointer}
    .experiment-table{min-width:1120px}.experiment-table td,.experiment-table th{white-space:nowrap}
    .exp-fingerprint{font-family:"SFMono-Regular",Consolas,monospace;color:#a5b4fc}
    .exp-gate{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid rgba(248,113,113,.28);color:#fda4af;background:rgba(248,113,113,.07)}
    .exp-gate.validated{border-color:rgba(52,211,153,.32);color:#6ee7b7;background:rgba(52,211,153,.07)}
    .exp-load{border:1px solid rgba(99,102,241,.32);background:rgba(79,70,229,.08);color:#c7d2fe;border-radius:9px;padding:6px 9px;font-size:11px;font-weight:800;cursor:pointer}
    .exp-empty{padding:14px;border:1px dashed rgba(148,163,184,.18);border-radius:12px;color:#7f8da8;font-size:12px}
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  if (document.querySelector("#experimentPanel")) return;
  const results = document.querySelector(".results");
  if (!results) return;
  const panel = document.createElement("section");
  panel.className = "panel experiment-panel";
  panel.id = "experimentPanel";
  panel.innerHTML = `
    <div class="panel-title-row">
      <div>
        <h2>Experiment History & Snapshot Lock</h2>
        <p class="panel-subtitle">V0.6.5 otomatis mem-fingerprint dan menyimpan setiap Multi-Window yang selesai. Run dengan snapshot + parameter sama didedup, dan snapshot lama dapat dimuat ulang untuk reproduksi.</p>
      </div>
      <span class="small-badge">V0.6.5</span>
    </div>
    <div class="experiment-toolbar">
      <div id="experimentStatus" class="experiment-status">Menunggu Multi-Window berikutnya.</div>
      <button id="experimentRefresh" class="experiment-refresh" type="button">Refresh history</button>
    </div>
    <div class="table-wrap model-table-wrap">
      <table class="model-table experiment-table">
        <thead><tr><th>Run</th><th>Time</th><th>Fingerprint</th><th>Draws</th><th>Latest</th><th>Top10</th><th>Mean rank</th><th>Δ random</th><th>Stable</th><th>Gate</th><th>Regime</th><th>Top 3 snapshot</th><th>Replay</th></tr></thead>
        <tbody id="experimentBody"></tbody>
      </table>
    </div>
    <div id="experimentEmpty" class="exp-empty" hidden>Belum ada experiment tersimpan. Jalankan Run Multi-Window sekali setelah V0.6.5 aktif.</div>
  `;

  const regime = document.querySelector(".regime-panel");
  if (regime) regime.insertAdjacentElement("afterend", panel);
  else results.appendChild(panel);
  document.querySelector("#experimentRefresh")?.addEventListener("click", loadExperiments);
  document.querySelector("#experimentBody")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-experiment-id]");
    if (!button) return;
    await replayExperiment(Number(button.dataset.experimentId));
  });
}

function setExperimentStatus(message, state = "") {
  const node = document.querySelector("#experimentStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `experiment-status ${state}`.trim();
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  } catch {
    return value || "—";
  }
}

function renderExperiments(rows = []) {
  const body = document.querySelector("#experimentBody");
  const empty = document.querySelector("#experimentEmpty");
  if (!body || !empty) return;
  empty.hidden = rows.length > 0;
  body.innerHTML = rows.map((row) => `
    <tr>
      <td class="mono">#${row.id}</td>
      <td>${formatTime(row.createdAt)}</td>
      <td class="exp-fingerprint" title="${row.fingerprint}">${row.fingerprint.slice(0, 12)}…</td>
      <td class="mono">${row.drawCount}</td>
      <td class="mono">${row.latestPeriod ?? "—"} · ${row.latestResult ?? "—"}</td>
      <td class="mono">${Number(row.weightedTop10Rate).toFixed(2)}% (${row.weightedTop10Hits})</td>
      <td class="mono">#${Number(row.weightedMeanRank).toFixed(1)}</td>
      <td class="mono ${Number(row.meanRankDelta) > 0 ? "hit" : "miss"}">${Number(row.meanRankDelta) > 0 ? "+" : ""}${Number(row.meanRankDelta).toFixed(1)}</td>
      <td class="mono">${row.stableWindows}/${row.windowCount}</td>
      <td><span class="exp-gate ${row.gateStatus === "validated" ? "validated" : ""}">${String(row.gateStatus || "locked").toUpperCase()}</span></td>
      <td>${row.regimeVerdict || "—"}</td>
      <td class="mono">${(row.currentTop3 || []).join(" · ") || "—"}</td>
      <td><button class="exp-load" type="button" data-experiment-id="${row.id}">Muat snapshot</button></td>
    </tr>
  `).join("");
}

async function loadExperiments() {
  try {
    const response = await nativeFetch("/api/experiments?limit=20", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Request gagal (${response.status})`);
    renderExperiments(data.experiments || []);
  } catch (error) {
    setExperimentStatus(`History gagal dimuat: ${error.message || "unknown error"}`, "error");
  }
}

async function replayExperiment(id) {
  try {
    setExperimentStatus(`Memuat frozen snapshot experiment #${id}…`, "running");
    const response = await nativeFetch(`/api/experiments?id=${id}`, { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.experiment) throw new Error(data.error || "Experiment tidak ditemukan.");
    const experiment = data.experiment;
    const input = document.querySelector("#historyInput");
    const decay = document.querySelector("#decay");
    const minTrain = document.querySelector("#minTrain");
    if (input) input.value = (experiment.snapshot || []).join("\n");
    if (decay && experiment.decay != null) decay.value = String(experiment.decay);
    if (minTrain && experiment.minTrain != null) minTrain.value = String(experiment.minTrain);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    setExperimentStatus(`Snapshot #${id} dimuat · ${experiment.fingerprint.slice(0, 12)}… · klik Run Multi-Window untuk replay.`, "success");
    document.querySelector(".input-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setExperimentStatus(`Replay gagal: ${error.message || "unknown error"}`, "error");
  }
}

function init() {
  injectStyles();
  injectPanel();
  loadExperiments();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
