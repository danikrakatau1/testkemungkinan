const UI_VERSION = "0.8.0";
const apiFetch = window.fetch.bind(window);
let labOpen = false;
let refreshTimer = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function injectStyles() {
  if (document.querySelector("#v080Styles")) return;
  const style = document.createElement("style");
  style.id = "v080Styles";
  style.textContent = `
    body.autopilot-simple .hero,body.autopilot-simple .workspace{display:none!important}
    body.autopilot-simple footer{display:none!important}
    .autopilot-shell{max-width:980px;margin:24px auto 70px;padding:0 18px}
    .autopilot-panel{border:1px solid rgba(148,163,184,.18);border-radius:22px;background:#0c1322;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.22)}
    .autopilot-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 22px 14px}
    .autopilot-title{margin:0;color:#f8fafc;font-size:22px;letter-spacing:-.03em}.autopilot-sub{margin:5px 0 0;color:#7f8da8;font-size:12px}
    .auto-badge{display:inline-flex;gap:7px;align-items:center;padding:7px 10px;border:1px solid rgba(52,211,153,.24);border-radius:999px;color:#86efac;background:rgba(22,163,74,.07);font-size:11px;font-weight:800}.auto-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.08)}
    .autopilot-status{margin:0 22px 16px;padding:11px 13px;border:1px solid rgba(148,163,184,.12);border-radius:12px;color:#94a3b8;font-size:11px;background:rgba(15,23,42,.45)}.autopilot-status.good{color:#86efac}.autopilot-status.bad{color:#fda4af}.autopilot-status.running{color:#93c5fd}
    .auto-latest{display:grid;grid-template-columns:190px 1fr;gap:14px;padding:0 22px 18px}.latest-card,.prediction-card,.last-card{border:1px solid rgba(148,163,184,.13);border-radius:16px;background:rgba(15,23,42,.45)}
    .latest-card{padding:18px}.auto-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6f7d96}.latest-number{font-family:"SFMono-Regular",Consolas,monospace;font-size:48px;line-height:1;color:#f8fafc;font-weight:900;margin:10px 0}.latest-meta{font-size:11px;color:#94a3b8;line-height:1.6}
    .prediction-wrap{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.prediction-card{padding:14px}.prediction-name{font-size:11px;color:#cbd5e1;font-weight:800;margin-bottom:10px}.prediction-top3{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.prediction-num{padding:11px 4px;border-radius:10px;text-align:center;background:#101a2d;border:1px solid rgba(129,140,248,.15);font-family:"SFMono-Regular",Consolas,monospace;font-size:20px;font-weight:900;color:#eef2ff}.prediction-num small{display:block;font-size:8px;color:#64748b;margin-bottom:4px;font-family:inherit}
    .auto-last{padding:0 22px 18px}.last-card{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.last-main{font-size:12px;color:#cbd5e1}.last-main strong{color:#f8fafc}.last-note{font-size:10px;color:#70809a}
    .auto-actions{padding:0 22px 22px;display:flex;gap:8px;flex-wrap:wrap}.auto-btn{border:1px solid rgba(148,163,184,.20);background:#0b1220;color:#cbd5e1;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}.auto-btn.primary{border-color:rgba(56,189,248,.30);background:rgba(14,165,233,.08);color:#bae6fd}.auto-btn:disabled{opacity:.5;cursor:not-allowed}
    .auto-foot{padding:13px 22px;border-top:1px solid rgba(148,163,184,.10);color:#64748b;font-size:10px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    @media(max-width:760px){.autopilot-head{align-items:flex-start}.auto-latest{grid-template-columns:1fr}.prediction-wrap{grid-template-columns:1fr}.latest-number{font-size:42px}.autopilot-shell{padding:0 10px;margin-top:12px}}
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  if (document.querySelector("#autopilotPanel")) return;
  const main = document.querySelector("main");
  if (!main) return;
  const wrap = document.createElement("section");
  wrap.className = "autopilot-shell";
  wrap.id = "autopilotPanel";
  wrap.innerHTML = `
    <div class="autopilot-panel">
      <div class="autopilot-head">
        <div><h1 class="autopilot-title">AutoPilot 3D</h1><p class="autopilot-sub">Result masuk → score lama → prediksi baru → lock otomatis.</p></div>
        <span class="auto-badge"><i class="auto-dot"></i>AUTO</span>
      </div>
      <div id="autoStatus" class="autopilot-status running">Memuat status…</div>
      <div class="auto-latest">
        <div class="latest-card">
          <div class="auto-label">Result terbaru</div>
          <div id="autoLatestNumber" class="latest-number">---</div>
          <div id="autoLatestMeta" class="latest-meta">Menunggu D1…</div>
        </div>
        <div id="autoPredictions" class="prediction-wrap"></div>
      </div>
      <div class="auto-last"><div id="autoLast" class="last-card"><div class="last-main">Belum ada result forward yang selesai.</div></div></div>
      <div class="auto-actions">
        <button id="autoRefreshBtn" class="auto-btn primary" type="button">Refresh sekarang</button>
        <button id="autoLabBtn" class="auto-btn" type="button">Buka detail lab</button>
      </div>
      <div class="auto-foot"><span>Auto collector: tiap 10 menit</span><span id="autoUpdated">V${UI_VERSION}</span></div>
    </div>
  `;
  main.prepend(wrap);
  document.body.classList.add("autopilot-simple");
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.8.0 · AutoPilot';
  document.title = "AutoPilot 3D · V0.8.0";

  document.querySelector("#autoRefreshBtn")?.addEventListener("click", runNow);
  document.querySelector("#autoLabBtn")?.addEventListener("click", toggleLab);
}

function toggleLab() {
  labOpen = !labOpen;
  document.body.classList.toggle("autopilot-simple", !labOpen);
  const button = document.querySelector("#autoLabBtn");
  if (button) button.textContent = labOpen ? "Tutup detail lab" : "Buka detail lab";
  if (!labOpen) document.querySelector("#autopilotPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPredictions(run) {
  const node = document.querySelector("#autoPredictions");
  if (!node) return;
  const models = run?.predictions || [];
  if (!models.length) {
    node.innerHTML = '<div class="prediction-card"><div class="prediction-name">Prediksi berikutnya</div><div class="last-note">Belum ada lock aktif. AutoPilot akan membuatnya otomatis.</div></div>';
    return;
  }
  node.innerHTML = models.slice(0, 3).map((model) => `
    <article class="prediction-card">
      <div class="prediction-name">${esc(model.label)}</div>
      <div class="prediction-top3">${(model.top3 || []).slice(0, 3).map((number, index) => `<div class="prediction-num"><small>#${index + 1}</small>${esc(number)}</div>`).join("")}</div>
    </article>
  `).join("");
}

function renderLast(data) {
  const node = document.querySelector("#autoLast");
  if (!node) return;
  const run = data.lastArena;
  if (!run) {
    node.innerHTML = '<div class="last-main">Belum ada Arena Forward yang selesai.</div><div class="last-note">Menunggu result setelah lock pertama.</div>';
    return;
  }
  const scoreText = (run.scores || []).map((score) => {
    const bits = [];
    if (score.exactTop3) bits.push("Exact");
    else if (score.permutationHit) bits.push("Permutation");
    else bits.push(`${score.bestDigitOverlap ?? 0}/3 digit`);
    return `${score.label}: ${bits.join(" · ")}`;
  }).join("  |  ");
  node.innerHTML = `<div class="last-main"><strong>${run.actualPeriod} = ${esc(run.actualResult)}</strong> · hasil forward terakhir</div><div class="last-note">${esc(scoreText || "Score tersimpan")}</div>`;
}

function render(data) {
  const latest = data.latest || {};
  const number = document.querySelector("#autoLatestNumber");
  const meta = document.querySelector("#autoLatestMeta");
  const status = document.querySelector("#autoStatus");
  const updated = document.querySelector("#autoUpdated");
  if (number) number.textContent = latest.result || "---";
  if (meta) meta.innerHTML = `Period <strong>${latest.period ?? "—"}</strong><br>${esc(latest.drawDate || "")}${latest.drawTime ? ` · ${esc(latest.drawTime)}` : ""}<br>${data.draws ?? 0} draw tersimpan`;
  renderPredictions(data.pendingArena);
  renderLast(data);
  if (status) {
    const pending = data.pendingArena;
    status.className = "autopilot-status good";
    status.textContent = pending
      ? `AUTO aktif · prediksi untuk period setelah ${pending.anchorPeriod} sudah terkunci.`
      : "AUTO aktif · menunggu pipeline membuat lock berikutnya.";
  }
  if (updated) updated.textContent = `Update ${fmtTime(data.now)} · V${UI_VERSION}`;
}

async function loadStatus({ quiet = false } = {}) {
  const status = document.querySelector("#autoStatus");
  if (!quiet && status) {
    status.className = "autopilot-status running";
    status.textContent = "Memeriksa AutoPilot…";
  }
  try {
    const response = await apiFetch("/api/autopilot", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Status gagal (${response.status})`);
    render(data);
  } catch (error) {
    if (status) {
      status.className = "autopilot-status bad";
      status.textContent = error.message || "AutoPilot tidak dapat dibaca.";
    }
  }
}

async function runNow() {
  const button = document.querySelector("#autoRefreshBtn");
  const status = document.querySelector("#autoStatus");
  if (button) button.disabled = true;
  if (status) {
    status.className = "autopilot-status running";
    status.textContent = "Mengambil result terbaru + menjalankan pipeline…";
  }
  try {
    const response = await apiFetch("/api/autopilot", { method: "POST", headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `AutoPilot gagal (${response.status})`);
    render(data);
  } catch (error) {
    if (status) {
      status.className = "autopilot-status bad";
      status.textContent = error.message || "AutoPilot gagal.";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function startPolling() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden) loadStatus({ quiet: true });
  }, 30_000);
}

function init() {
  injectStyles();
  injectPanel();
  loadStatus();
  startPolling();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
