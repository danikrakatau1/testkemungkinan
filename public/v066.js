const DRIFT_VERSION = "0.6.6";

const originalFetch = window.fetch.bind(window);
let driftRefreshTimer = null;
let lastDriftSignature = "";

function fmt(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function signed(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${n.toFixed(digits)}`;
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sameParams(a, b) {
  return (
    Number(a?.decay) === Number(b?.decay) &&
    Number(a?.minTrain) === Number(b?.minTrain) &&
    Number(a?.windowCount) === Number(b?.windowCount) &&
    Number(a?.params?.targetsPerWindow) === Number(b?.params?.targetsPerWindow) &&
    Number(a?.params?.holdoutPerWindow) === Number(b?.params?.holdoutPerWindow) &&
    Number(a?.params?.trainingDrawsPerTarget) === Number(b?.params?.trainingDrawsPerTarget)
  );
}

function top3Overlap(a = [], b = []) {
  const right = new Set(b || []);
  return (a || []).filter((item) => right.has(item)).length;
}

function classifyDrift(latest, previous) {
  const dataChanged = latest?.fingerprint !== previous?.fingerprint;
  const engineChanged = latest?.engineVersion !== previous?.engineVersion;
  const configChanged = !sameParams(latest, previous);

  if (!dataChanged && !engineChanged && !configChanged) {
    return { code: "NO DRIFT", tone: "neutral", detail: "Snapshot, parameter, dan engine sama." };
  }
  if (engineChanged && configChanged) {
    return { code: "ENGINE + CONFIG DRIFT", tone: "warn", detail: "Versi engine dan parameter berubah; jangan atribusikan perubahan hasil hanya ke data." };
  }
  if (engineChanged) {
    return { code: "ENGINE DRIFT", tone: "warn", detail: "Versi engine berubah. Bandingkan hanya setelah parity/compatibility dikonfirmasi." };
  }
  if (configChanged) {
    return { code: "CONFIG DRIFT", tone: "warn", detail: "Parameter eksperimen berubah, sehingga hasil bukan perbandingan apple-to-apple." };
  }
  return { code: "DATA DRIFT", tone: "good", detail: "Engine + parameter sama; perubahan hasil terutama berasal dari snapshot data yang berbeda." };
}

function snapshotShift(newer = [], older = []) {
  if (!newer.length || !older.length) return { prepend: null, exactTail: false };
  const maxShift = Math.min(50, Math.max(0, newer.length - 1));
  for (let shift = 0; shift <= maxShift; shift += 1) {
    const comparable = Math.min(older.length, newer.length - shift);
    if (comparable < Math.min(30, older.length)) continue;
    let same = true;
    for (let i = 0; i < comparable; i += 1) {
      if (newer[shift + i] !== older[i]) {
        same = false;
        break;
      }
    }
    if (same) return { prepend: shift, exactTail: comparable === older.length };
  }
  return { prepend: null, exactTail: false };
}

function injectDriftStyles() {
  if (document.querySelector("#v066Styles")) return;
  const style = document.createElement("style");
  style.id = "v066Styles";
  style.textContent = `
    .drift-panel{position:relative;overflow:hidden}.drift-panel::before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(96,165,250,.75),rgba(167,139,250,.75),transparent)}
    .drift-summary{display:grid;grid-template-columns:1.3fr repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.drift-card{border:1px solid rgba(148,163,184,.16);background:rgba(7,13,27,.55);border-radius:14px;padding:13px;min-width:0}.drift-card span{display:block;color:#73819e;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.drift-card strong{display:block;margin-top:6px;font-size:18px;color:#eef2ff;overflow:hidden;text-overflow:ellipsis}.drift-card small{display:block;margin-top:5px;color:#8492ad;line-height:1.35}
    .drift-verdict{border:1px solid rgba(96,165,250,.25);background:rgba(59,130,246,.055);border-radius:15px;padding:14px;margin-top:12px;display:flex;gap:16px;justify-content:space-between;align-items:flex-start}.drift-verdict strong{font-size:17px}.drift-verdict.good{border-color:rgba(52,211,153,.30);background:rgba(52,211,153,.055)}.drift-verdict.warn{border-color:rgba(251,191,36,.28);background:rgba(251,191,36,.055)}
    .drift-positive{color:#6ee7b7!important}.drift-negative{color:#fda4af!important}.drift-neutral{color:#cbd5e1!important}.drift-table{min-width:1180px}.drift-table td,.drift-table th{white-space:nowrap}.drift-chip{display:inline-flex;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.22);font-size:10px;font-weight:800}.drift-empty{padding:15px;border:1px dashed rgba(148,163,184,.18);border-radius:13px;color:#7f8da8;font-size:12px;line-height:1.5;margin-top:12px}
    @media(max-width:980px){.drift-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.drift-summary .drift-card:first-child{grid-column:1/-1}}@media(max-width:560px){.drift-summary{grid-template-columns:1fr}.drift-summary .drift-card:first-child{grid-column:auto}.drift-verdict{flex-direction:column}}
  `;
  document.head.appendChild(style);
}

function injectDriftPanel() {
  if (document.querySelector("#driftPanel")) return;
  const experiment = document.querySelector("#experimentPanel");
  const results = document.querySelector(".results");
  if (!results) return;

  const panel = document.createElement("section");
  panel.className = "panel drift-panel";
  panel.id = "driftPanel";
  panel.innerHTML = `
    <div class="panel-title-row">
      <div>
        <h2>Experiment Compare & Drift Tracker</h2>
        <p class="panel-subtitle">V0.6.6 membandingkan run terbaru dengan run sebelumnya untuk memisahkan data drift, parameter drift, dan engine drift. Ini audit reproducibility, bukan probabilitas hasil berikutnya.</p>
      </div>
      <span class="small-badge">V0.6.6</span>
    </div>
    <div id="driftContent"><div class="drift-empty">Memuat Experiment History…</div></div>
    <div class="table-wrap model-table-wrap" style="margin-top:14px">
      <table class="model-table drift-table">
        <thead><tr><th>Compare</th><th>Drift type</th><th>Draw Δ</th><th>Top10 Δ</th><th>Mean rank Δ</th><th>Δ random change</th><th>Stable Δ</th><th>Gate</th><th>Regime</th><th>Top3 overlap</th><th>Engine</th></tr></thead>
        <tbody id="driftBody"></tbody>
      </table>
    </div>
  `;

  if (experiment) experiment.insertAdjacentElement("afterend", panel);
  else {
    const regime = document.querySelector(".regime-panel");
    if (regime) regime.insertAdjacentElement("afterend", panel);
    else results.appendChild(panel);
  }
}

async function fetchJson(url) {
  const response = await originalFetch(url, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}

function trendClass(value, lowerIsBetter = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "drift-neutral";
  const better = lowerIsBetter ? n < 0 : n > 0;
  return better ? "drift-positive" : "drift-negative";
}

function compareRuns(latest, previous) {
  const top10Delta = Number(latest.weightedTop10Rate) - Number(previous.weightedTop10Rate);
  const meanRankDelta = Number(latest.weightedMeanRank) - Number(previous.weightedMeanRank);
  const randomDeltaChange = Number(latest.meanRankDelta) - Number(previous.meanRankDelta);
  const stableDelta = Number(latest.stableWindows) - Number(previous.stableWindows);
  const drawDelta = Number(latest.drawCount) - Number(previous.drawCount);
  const overlap = top3Overlap(latest.currentTop3, previous.currentTop3);
  const drift = classifyDrift(latest, previous);
  return { latest, previous, top10Delta, meanRankDelta, randomDeltaChange, stableDelta, drawDelta, overlap, drift };
}

async function renderLatestSummary(experiments) {
  const host = document.querySelector("#driftContent");
  if (!host) return;
  if (experiments.length < 2) {
    host.innerHTML = `<div class="drift-empty"><strong>Baseline #${experiments[0]?.id ?? 1} sudah tersimpan.</strong><br>Butuh minimal 2 experiment untuk menghitung drift. Saat snapshot D1 berubah, jalankan <strong>Run Multi-Window</strong> lagi; V0.6.6 akan membandingkannya otomatis dengan run sebelumnya.</div>`;
    return;
  }

  const latest = experiments[0];
  const previous = experiments[1];
  const comparison = compareRuns(latest, previous);
  let shiftText = "snapshot berubah";
  try {
    const [latestDetail, previousDetail] = await Promise.all([
      fetchJson(`/api/experiments?id=${latest.id}`),
      fetchJson(`/api/experiments?id=${previous.id}`),
    ]);
    const shift = snapshotShift(latestDetail.experiment?.snapshot || [], previousDetail.experiment?.snapshot || []);
    if (shift.prepend === 0 && latest.fingerprint === previous.fingerprint) shiftText = "snapshot identik";
    else if (shift.prepend != null) shiftText = `+${shift.prepend} draw baru di head${shift.exactTail ? " · tail lama cocok" : ""}`;
  } catch {}

  const meanTrend = comparison.meanRankDelta < 0 ? "membaik" : comparison.meanRankDelta > 0 ? "memburuk" : "tetap";
  const top3Text = `${comparison.overlap}/3`;
  host.innerHTML = `
    <div class="drift-verdict ${comparison.drift.tone}">
      <div><span class="eyebrow">LATEST COMPARISON</span><strong>#${latest.id} vs #${previous.id} · ${esc(comparison.drift.code)}</strong><div class="panel-subtitle" style="margin-top:5px">${esc(comparison.drift.detail)}</div></div>
      <div class="exp-fingerprint">${esc(previous.fingerprint.slice(0,8))}… → ${esc(latest.fingerprint.slice(0,8))}…</div>
    </div>
    <div class="drift-summary">
      <div class="drift-card"><span>Snapshot drift</span><strong>${esc(shiftText)}</strong><small>${previous.drawCount} → ${latest.drawCount} draws · latest ${esc(latest.latestPeriod)} = ${esc(latest.latestResult)}</small></div>
      <div class="drift-card"><span>Top10 OOS</span><strong class="${trendClass(comparison.top10Delta)}">${pct(previous.weightedTop10Rate)} → ${pct(latest.weightedTop10Rate)}</strong><small>Δ ${signed(comparison.top10Delta,2)} pp</small></div>
      <div class="drift-card"><span>Mean rank</span><strong class="${trendClass(comparison.meanRankDelta,true)}">${fmt(previous.weightedMeanRank)} → ${fmt(latest.weightedMeanRank)}</strong><small>${meanTrend} · Δ ${signed(comparison.meanRankDelta)}</small></div>
      <div class="drift-card"><span>Stable windows</span><strong class="${trendClass(comparison.stableDelta)}">${previous.stableWindows}/${previous.windowCount} → ${latest.stableWindows}/${latest.windowCount}</strong><small>Δ ${signed(comparison.stableDelta,0)}</small></div>
      <div class="drift-card"><span>Top3 overlap</span><strong>${top3Text}</strong><small>${esc((previous.currentTop3||[]).join(" · "))} → ${esc((latest.currentTop3||[]).join(" · "))}</small></div>
    </div>
  `;
}

function renderHistory(experiments) {
  const body = document.querySelector("#driftBody");
  if (!body) return;
  if (experiments.length < 2) {
    body.innerHTML = '<tr><td colspan="11" style="color:#7f8da8">Belum ada pasangan experiment untuk dibandingkan.</td></tr>';
    return;
  }

  const rows = [];
  for (let i = 0; i < experiments.length - 1; i += 1) {
    const item = compareRuns(experiments[i], experiments[i + 1]);
    rows.push(`
      <tr>
        <td>#${item.latest.id} ← #${item.previous.id}</td>
        <td><span class="drift-chip">${esc(item.drift.code)}</span></td>
        <td>${signed(item.drawDelta,0)}</td>
        <td class="${trendClass(item.top10Delta)}">${signed(item.top10Delta,2)} pp</td>
        <td class="${trendClass(item.meanRankDelta,true)}">${signed(item.meanRankDelta)}</td>
        <td class="${trendClass(item.randomDeltaChange)}">${signed(item.randomDeltaChange)}</td>
        <td class="${trendClass(item.stableDelta)}">${signed(item.stableDelta,0)}</td>
        <td>${esc(item.previous.gateStatus)} → ${esc(item.latest.gateStatus)}</td>
        <td>${esc(item.previous.regimeVerdict)} → ${esc(item.latest.regimeVerdict)}</td>
        <td>${item.overlap}/3</td>
        <td>${esc(item.previous.engineVersion)} → ${esc(item.latest.engineVersion)}</td>
      </tr>
    `);
  }
  body.innerHTML = rows.join("");
}

async function loadDriftTracker() {
  injectDriftStyles();
  injectDriftPanel();
  const host = document.querySelector("#driftContent");
  if (!host) return;
  try {
    const data = await fetchJson("/api/experiments?limit=20");
    const experiments = Array.isArray(data.experiments) ? data.experiments : [];
    const signature = experiments.map((item) => `${item.id}:${item.fingerprint}:${item.engineVersion}`).join("|");
    if (signature === lastDriftSignature && document.querySelector("#driftBody")?.children.length) return;
    lastDriftSignature = signature;
    await renderLatestSummary(experiments);
    renderHistory(experiments);
  } catch (error) {
    host.innerHTML = `<div class="drift-empty">Drift Tracker belum dapat membaca Experiment History: ${esc(error.message || "unknown error")}</div>`;
  }
}

function scheduleDriftRefresh(delay = 350) {
  clearTimeout(driftRefreshTimer);
  driftRefreshTimer = setTimeout(loadDriftTracker, delay);
}

function updateVersionLabels() {
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.6.6 · Experiment Drift Tracker';
  const footerText = [...document.querySelectorAll("footer, .footer")].find((node) => /V0\.6\.2|regime|stability/i.test(node.textContent || ""));
  if (footerText) footerText.textContent = "V0.6.6 · reproducible experiments + drift tracker";
  document.title = "Test Kemungkinan 3D · V0.6.6";
}

function observeExperimentPanel() {
  const attach = () => {
    const target = document.querySelector("#experimentPanel");
    if (!target || target.dataset.driftObserved === "1") return false;
    target.dataset.driftObserved = "1";
    const observer = new MutationObserver(() => scheduleDriftRefresh(500));
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    return true;
  };
  if (attach()) return;
  const rootObserver = new MutationObserver(() => {
    if (attach()) rootObserver.disconnect();
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
}

function boot() {
  injectDriftStyles();
  injectDriftPanel();
  updateVersionLabels();
  observeExperimentPanel();
  loadDriftTracker();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
