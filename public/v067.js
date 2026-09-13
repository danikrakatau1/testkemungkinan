const FORWARD_VERSION = "0.6.7";
const baseFetch = window.fetch.bind(window);
let lastRows = [];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function fmtTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function pill(label, tone = "neutral") {
  return `<span class="forward-pill ${tone}">${esc(label)}</span>`;
}

function setStatus(message, tone = "") {
  const node = document.querySelector("#forwardStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `forward-status ${tone}`;
}

function injectStyles() {
  if (document.querySelector("#v067Styles")) return;
  const style = document.createElement("style");
  style.id = "v067Styles";
  style.textContent = `
    .forward-panel{position:relative;overflow:hidden}
    .forward-panel::before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(56,189,248,.8),transparent)}
    .forward-toolbar{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin:12px 0}
    .forward-actions{display:flex;gap:8px;flex-wrap:wrap}
    .forward-btn{border:1px solid rgba(56,189,248,.35);background:rgba(14,165,233,.10);color:#bae6fd;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}
    .forward-btn.secondary{border-color:rgba(148,163,184,.22);background:#0b1221;color:#cbd5e1}
    .forward-btn:disabled{opacity:.45;cursor:not-allowed}
    .forward-status{font-size:12px;color:#94a3b8}.forward-status.good{color:#6ee7b7}.forward-status.warn{color:#fde68a}.forward-status.bad{color:#fda4af}.forward-status.running{color:#93c5fd}
    .forward-current{margin:12px 0;padding:13px 14px;border:1px solid rgba(56,189,248,.18);border-radius:12px;background:rgba(8,47,73,.10);font-size:12px;color:#a8b4c8}
    .forward-current strong{color:#e5edf9}.forward-current .mono{color:#c7d2fe}
    .forward-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:12px 0 14px}
    .forward-metric{padding:12px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(15,23,42,.45)}
    .forward-metric span{display:block;font-size:10px;color:#7f8da8;margin-bottom:6px}.forward-metric strong{font-size:20px;color:#edf2fb}.forward-metric small{display:block;color:#64748b;margin-top:4px;font-size:10px}
    .forward-table{min-width:1280px}.forward-table td,.forward-table th{white-space:nowrap}
    .forward-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid rgba(148,163,184,.2);color:#cbd5e1;background:rgba(148,163,184,.07)}
    .forward-pill.good{border-color:rgba(52,211,153,.3);color:#6ee7b7;background:rgba(52,211,153,.07)}
    .forward-pill.warn{border-color:rgba(251,191,36,.3);color:#fde68a;background:rgba(251,191,36,.07)}
    .forward-pill.bad{border-color:rgba(248,113,113,.3);color:#fda4af;background:rgba(248,113,113,.07)}
    .forward-empty{padding:14px;border:1px dashed rgba(148,163,184,.18);border-radius:12px;color:#7f8da8;font-size:12px}
    @media(max-width:900px){.forward-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  if (document.querySelector("#forwardPanel")) return;
  const results = document.querySelector(".results");
  if (!results) return;

  const panel = document.createElement("section");
  panel.className = "panel forward-panel";
  panel.id = "forwardPanel";
  panel.innerHTML = `
    <div class="panel-title-row">
      <div>
        <h2>Forward Scorecard & Post-Result Autopsy</h2>
        <p class="panel-subtitle">V0.6.7 mengunci prediksi <strong>sebelum</strong> result berikutnya keluar. Setelah result baru masuk D1, scorecard menilai exact 3D, permutation, digit overlap, posisi digit, pool coverage, dan rank aktual tanpa hindsight.</p>
      </div>
      <span class="small-badge">V0.6.7</span>
    </div>
    <div class="forward-toolbar">
      <div id="forwardStatus" class="forward-status">Memuat forward scorecard…</div>
      <div class="forward-actions">
        <button id="forwardLockBtn" class="forward-btn" type="button">Lock prediksi berikutnya</button>
        <button id="forwardRefreshBtn" class="forward-btn secondary" type="button">Refresh / settle</button>
      </div>
    </div>
    <div id="forwardCurrent" class="forward-current">Belum ada forward lock aktif.</div>
    <div id="forwardMetrics" class="forward-metrics"></div>
    <div class="table-wrap model-table-wrap">
      <table class="model-table forward-table">
        <thead><tr><th>Test</th><th>Locked</th><th>Anchor</th><th>Top 3 locked</th><th>Actual</th><th>Actual rank</th><th>Exact Top3</th><th>Permutation</th><th>Best digit overlap</th><th>Exact position</th><th>Top3 pool coverage</th><th>Closest candidate</th><th>Status</th></tr></thead>
        <tbody id="forwardBody"></tbody>
      </table>
    </div>
    <div id="forwardEmpty" class="forward-empty" hidden>Belum ada forward test. Klik <strong>Lock prediksi berikutnya</strong> setelah Muat D1 + Analisis, sebelum result selanjutnya keluar.</div>
  `;

  const drift = document.querySelector("#driftPanel");
  const experiments = document.querySelector("#experimentPanel");
  if (drift) drift.insertAdjacentElement("afterend", panel);
  else if (experiments) experiments.insertAdjacentElement("afterend", panel);
  else results.appendChild(panel);

  document.querySelector("#forwardLockBtn")?.addEventListener("click", lockForward);
  document.querySelector("#forwardRefreshBtn")?.addEventListener("click", () => loadForward(true));
}

function renderRows(rows = []) {
  lastRows = rows;
  const body = document.querySelector("#forwardBody");
  const empty = document.querySelector("#forwardEmpty");
  const current = document.querySelector("#forwardCurrent");
  const metrics = document.querySelector("#forwardMetrics");
  if (!body || !empty || !current || !metrics) return;

  empty.hidden = rows.length > 0;
  const pending = rows.find((row) => row.status === "pending");
  if (pending) {
    current.innerHTML = `<strong>Forward lock #${pending.id} aktif.</strong> Anchor <span class="mono">${pending.anchorPeriod} = ${esc(pending.anchorResult)}</span> · Top3 <span class="mono">${pending.top3.map(esc).join(" · ")}</span>. Menunggu period pertama setelah anchor.`;
  } else {
    current.innerHTML = `Tidak ada lock pending. Muat D1 terbaru, pastikan Top 3 sudah tampil, lalu klik <strong>Lock prediksi berikutnya</strong> sebelum result berikut keluar.`;
  }

  const settled = rows.filter((row) => row.status === "settled");
  const exact = settled.filter((row) => row.exactTop3).length;
  const top10 = settled.filter((row) => row.top10Hit).length;
  const permutation = settled.filter((row) => row.permutationHit).length;
  const pool3 = settled.filter((row) => Number(row.poolDigitCoverage) === 3).length;
  const meanRank = settled.length
    ? settled.reduce((sum, row) => sum + Number(row.actualRank || 1000), 0) / settled.length
    : null;

  metrics.innerHTML = `
    <div class="forward-metric"><span>Forward tests</span><strong>${rows.length}</strong><small>${pending ? "1 pending" : "0 pending"}</small></div>
    <div class="forward-metric"><span>Exact Top3</span><strong>${exact}/${settled.length}</strong><small>exact 3D</small></div>
    <div class="forward-metric"><span>Top10 exact</span><strong>${top10}/${settled.length}</strong><small>actual rank ≤ 10</small></div>
    <div class="forward-metric"><span>Permutation hit</span><strong>${permutation}/${settled.length}</strong><small>3 digit sama, urutan beda boleh</small></div>
    <div class="forward-metric"><span>Pool coverage 3/3</span><strong>${pool3}/${settled.length}</strong><small>semua digit actual terbawa Top3 pool</small></div>
    <div class="forward-metric"><span>Mean actual rank</span><strong>${meanRank == null ? "—" : meanRank.toFixed(1)}</strong><small>lebih kecil lebih baik</small></div>
  `;

  body.innerHTML = rows.map((row) => {
    const settledRow = row.status === "settled";
    const exactTone = row.exactTop3 ? "good" : "bad";
    const permutationTone = row.permutationHit ? "good" : (settledRow ? "bad" : "neutral");
    const coverageTone = Number(row.poolDigitCoverage) === 3 ? "good" : (Number(row.poolDigitCoverage) === 2 ? "warn" : "bad");
    return `
      <tr>
        <td class="rank-cell">#${row.id}</td>
        <td>${fmtTime(row.createdAt)}</td>
        <td class="mono">${row.anchorPeriod} · ${esc(row.anchorResult)}</td>
        <td class="mono"><strong>${(row.top3 || []).map(esc).join(" · ")}</strong></td>
        <td class="mono">${settledRow ? `${row.actualPeriod} · <strong>${esc(row.actualResult)}</strong>` : "menunggu"}</td>
        <td class="mono">${settledRow ? `#${row.actualRank}` : "—"}</td>
        <td>${settledRow ? pill(row.exactTop3 ? "HIT" : "MISS", exactTone) : "—"}</td>
        <td>${settledRow ? pill(row.permutationHit ? "3/3" : "MISS", permutationTone) : "—"}</td>
        <td class="mono">${settledRow ? `${row.bestDigitOverlap}/3` : "—"}</td>
        <td class="mono">${settledRow ? `${row.bestPositionHits}/3` : "—"}</td>
        <td>${settledRow ? pill(`${row.poolDigitCoverage}/3`, coverageTone) : "—"}</td>
        <td class="mono">${settledRow ? esc(row.bestCandidate || "—") : "—"}</td>
        <td>${row.status === "pending" ? pill("PENDING", "warn") : pill("SETTLED", "good")}</td>
      </tr>
    `;
  }).join("");
}

async function getCurrentAnalysis() {
  const history = parseHistory();
  if (history.length < 3) throw new Error("Muat D1 terlebih dahulu.");
  const decay = Number(document.querySelector("#decay")?.value || 0.9);
  const modelId = document.querySelector("#modelSelect")?.value || "ensemble";
  const response = await baseFetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ history, decay, modelId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Analisis gagal (${response.status})`);
  return { history, decay, modelId, data };
}

async function lockForward() {
  const button = document.querySelector("#forwardLockBtn");
  if (button) button.disabled = true;
  setStatus("Membekukan snapshot + Top 3 sebelum result berikutnya…", "running");
  try {
    const current = await getCurrentAnalysis();
    const fingerprint = await sha256(JSON.stringify(current.history));
    const response = await baseFetch("/api/forward", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        history: current.history,
        fingerprint,
        engineVersion: FORWARD_VERSION,
        modelId: current.modelId,
        decay: current.decay,
        top3: (current.data.top3 || []).map((row) => row.number),
        top10: (current.data.top10 || []).map((row) => row.number),
      }),
    });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok || !saved.ok) throw new Error(saved.error || `Lock gagal (${response.status})`);
    setStatus(`Forward #${saved.prediction.id} terkunci. Jangan ubah lock; tunggu result berikut masuk D1.`, "good");
    await loadForward(false);
  } catch (error) {
    setStatus(error.message || "Forward lock gagal.", "bad");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadForward(showLoading = false) {
  if (showLoading) setStatus("Mengecek D1 dan menyelesaikan pending autopsy jika result baru sudah masuk…", "running");
  try {
    const response = await baseFetch("/api/forward?limit=50", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Forward scorecard gagal (${response.status})`);
    renderRows(data.predictions || []);
    const pending = (data.predictions || []).filter((row) => row.status === "pending").length;
    const settled = (data.predictions || []).filter((row) => row.status === "settled").length;
    if (showLoading || !document.querySelector("#forwardStatus")?.classList.contains("good")) {
      setStatus(`${settled} settled · ${pending} pending. Exact 3D tetap dinilai terpisah dari kedekatan digit.`, "");
    }
  } catch (error) {
    setStatus(error.message || "Forward scorecard gagal dimuat.", "bad");
  }
}

function patchVersionLabels() {
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = `<span class="status-dot"></span> V0.6.7 · Forward Scorecard`;
  const footer = document.querySelector("footer");
  if (footer && /V0\.6\.2/.test(footer.textContent || "")) {
    footer.textContent = "V0.6.7 · forward scorecard + drift + regime diagnostics";
  }
}

function init() {
  injectStyles();
  injectPanel();
  patchVersionLabels();
  loadForward(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();

window.addEventListener("focus", () => {
  if (lastRows.some((row) => row.status === "pending")) loadForward(false);
});
