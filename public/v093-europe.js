const EUROPE_UI_VERSION = "0.9.3";
const fetchEuropeUi = window.fetch.bind(window);
let europeTimer = null;
let countdownTimer = null;
let europeLoadedOnce = false;
let latestEuropeData = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function phaseLabel(value) {
  const phase = String(value || "COLD_START").toUpperCase();
  if (phase === "COLD_START") return "COLD";
  if (phase === "LEARNING") return "LEARN";
  return phase;
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

function parseSourceTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const iso = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtSource(value) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? `${match[3]}/${match[2]} ${match[4]}:${match[5]}` : text;
}

function modelById(run, id) {
  return (run?.models || []).find((model) => String(model.id || "").toLowerCase() === id) || null;
}

function modelCard(label, model) {
  const top3 = model?.top3 || [];
  return `<article class="europe-model">
    <div class="europe-model-name">${esc(label)}</div>
    <div class="europe-top3">${[0, 1, 2].map((index) => `<div class="europe-pick"><small>#${index + 1}</small>${esc(top3[index] || "---")}</div>`).join("")}</div>
  </article>`;
}

function digitPool(values, drop = false) {
  const rows = Array.isArray(values) ? values : [];
  return rows.map((digit, index) => `<div class="europe-digit${drop ? " drop" : ""}">${esc(digit)}<small style="display:block;font:600 6px/1 system-ui;margin-bottom:4px;color:#53627a">#${index + 1}</small></div>`).join("");
}

function createShell() {
  if (document.querySelector("#marketTabs")) return;
  const shell = document.querySelector(".shell") || document.body;
  const topbar = document.querySelector(".topbar");
  const main = document.querySelector("main");
  if (!main) return;
  main.id = main.id || "utamaWorkspace";

  const tabs = document.createElement("nav");
  tabs.id = "marketTabs";
  tabs.className = "market-tabs";
  tabs.setAttribute("aria-label", "Pilih sumber analisis");
  tabs.innerHTML = `
    <button type="button" class="market-tab active" data-market="utama">3D UTAMA</button>
    <button type="button" class="market-tab" data-market="europe">EUROPE</button>
    <span class="market-tab-note">Dataset & learner dipisah total</span>
  `;
  if (topbar?.parentNode) topbar.parentNode.insertBefore(tabs, topbar.nextSibling);
  else shell.insertBefore(tabs, main);

  const europe = document.createElement("main");
  europe.id = "europeWorkspace";
  europe.hidden = true;
  europe.innerHTML = `
    <section class="europe-panel">
      <header class="europe-head">
        <div>
          <p class="europe-eyebrow">Europe · 45 Minute Lab</p>
          <h1 class="europe-title">Europe 3D · First Place</h1>
          <p class="europe-sub">Dataset Europe berdiri sendiri. Hanya field <strong>result</strong> / First Place yang dipakai; Second Place dan Third Place tidak masuk training, forward lock, atau Adaptive Learner.</p>
        </div>
        <div class="europe-badges"><span class="europe-badge">FIRST PLACE ONLY</span><span class="europe-badge phase" id="europePhaseBadge">COLD 0</span></div>
      </header>

      <div class="europe-status" id="europeStatus"><span>Memuat Europe AutoPilot…</span><button class="europe-sync" id="europeSyncBtn" type="button">SYNC NOW</button></div>

      <div class="europe-hero">
        <div class="europe-latest">
          <div class="europe-label">Result terbaru</div>
          <div class="europe-number" id="europeLatestNumber">---</div>
          <div class="europe-meta" id="europeLatestMeta">Menunggu D1…</div>
          <div class="europe-countdown"><div class="europe-label">Next draw</div><div class="europe-countdown-value" id="europeCountdown">--:--:--</div></div>
        </div>
        <div class="europe-models" id="europeModels"></div>
      </div>

      <section class="europe-section">
        <div class="europe-section-head"><div><h2 class="europe-section-title">Keeper7 Europe</h2><p class="europe-section-sub">Konteks khusus 45 menit: recent + global + slot-of-day + transition + model consensus.</p></div><span class="europe-lock" id="europeLock">WAITING</span></div>
        <div class="europe-keeper">
          <div class="europe-pools">
            <div class="europe-pool"><div class="europe-label">KEEP7</div><div class="europe-digits" id="europeKeep7"></div><div class="europe-assist" id="europeAssist">3D Assist: <b>—</b></div></div>
            <div class="europe-pool"><div class="europe-label">DROP3</div><div class="europe-digits drop" id="europeDrop3"></div></div>
          </div>
          <div class="europe-keeper-metrics">
            <div class="europe-metric"><span>Coverage Mass</span><strong id="europeCoverage">—</strong></div>
            <div class="europe-metric"><span>Recent Coverage</span><strong id="europeRecentCoverage">—</strong></div>
            <div class="europe-metric"><span>45m Slot Coverage</span><strong id="europeSlotCoverage">—</strong></div>
            <div class="europe-metric"><span>Forward terakhir</span><strong id="europeForwardResult">—</strong></div>
          </div>
        </div>
      </section>

      <section class="europe-section">
        <div class="europe-section-head"><div><h2 class="europe-section-title">Adaptive Error Learner · Europe</h2><p class="europe-section-sub">Forward-only, bounded, dan tidak pernah mengubah lock lama setelah actual diketahui.</p></div></div>
        <div class="europe-adaptive">
          <div><div class="europe-label">Evidence weights</div><div class="europe-weight-grid" id="europeWeights"></div></div>
          <div><div class="europe-label">Model trust</div><div class="europe-trust" id="europeTrust"></div><div class="europe-forward-note" id="europeAdaptiveNote">Menunggu settled forward Europe.</div></div>
        </div>
      </section>

      <section class="europe-section europe-history">
        <div class="europe-section-head"><div><h2 class="europe-section-title">Recent First Place History</h2><p class="europe-section-sub">Leading zero dipertahankan sebagai TEXT.</p></div></div>
        <div class="europe-table-wrap"><table class="europe-table"><thead><tr><th>Period</th><th>First Place</th><th>Result time</th><th>Next draw</th></tr></thead><tbody id="europeHistoryBody"></tbody></table></div>
      </section>

      <footer class="europe-footer"><span>Europe collector: every 5 min · source cadence: 45 min</span><span id="europeUpdated">V${EUROPE_UI_VERSION}</span></footer>
    </section>
  `;
  main.parentNode.insertBefore(europe, main.nextSibling);

  tabs.querySelectorAll("[data-market]").forEach((button) => button.addEventListener("click", () => switchMarket(button.dataset.market)));
  europe.querySelector("#europeSyncBtn")?.addEventListener("click", () => syncEurope(true));
}

function switchMarket(market) {
  const main = document.querySelector("#utamaWorkspace");
  const europe = document.querySelector("#europeWorkspace");
  const isEurope = market === "europe";
  if (main) main.hidden = isEurope;
  if (europe) europe.hidden = !isEurope;
  document.querySelectorAll(".market-tab").forEach((button) => button.classList.toggle("active", button.dataset.market === market));
  try { localStorage.setItem("testkemungkinan-market", market); } catch {}
  if (isEurope) {
    document.body.classList.add("europe-active");
    loadEurope({ bootstrap: true });
  } else {
    document.body.classList.remove("europe-active");
  }
}

function renderModels(data) {
  const node = document.querySelector("#europeModels");
  const run = data.pending;
  if (!node) return;
  node.innerHTML = [
    modelCard("Legacy", modelById(run, "legacy")),
    modelCard("DigitBoost", modelById(run, "digitboost")),
    modelCard("Hybrid", modelById(run, "hybrid")),
    modelCard("Two-Stage", modelById(run, "two-stage")),
  ].join("");
}

function renderAdaptive(data) {
  const adaptive = data.adaptive || {};
  const phase = phaseLabel(adaptive.phase);
  const settled = Number(adaptive.settledCount || 0);
  const badge = document.querySelector("#europePhaseBadge");
  if (badge) badge.textContent = `${phase} ${settled}`;

  const weights = adaptive.weights || {};
  const weightNode = document.querySelector("#europeWeights");
  if (weightNode) {
    weightNode.innerHTML = ["recent", "global", "slot", "transition", "model"].map((key) => `<div class="europe-weight"><span>${esc(key)}</span><strong>${pct(weights[key])}</strong></div>`).join("");
  }
  const trust = adaptive.modelTrust || {};
  const trustNode = document.querySelector("#europeTrust");
  if (trustNode) {
    const keys = ["legacy", "digitboost", "hybrid", "two-stage"];
    trustNode.innerHTML = keys.map((key) => `<div class="europe-trust-item">${esc(key)}<strong>${Number.isFinite(Number(trust[key])) ? Number(trust[key]).toFixed(3) : "1.000"}</strong></div>`).join("");
  }
  const note = document.querySelector("#europeAdaptiveNote");
  if (note) note.textContent = settled
    ? `${settled} settled forward · phase ${adaptive.phase} · state ${adaptive.stateKey || "—"}`
    : "COLD START · bobot default dipakai sampai ada forward Europe yang selesai.";
}

function renderKeeper(data) {
  const pending = data.pending;
  const keeper = pending?.keeper || {};
  const lock = document.querySelector("#europeLock");
  if (lock) lock.textContent = pending ? `LOCKED · ${phaseLabel(data.adaptive?.phase)} ${data.adaptive?.settledCount || 0}` : "WAITING";
  const keep = document.querySelector("#europeKeep7");
  const drop = document.querySelector("#europeDrop3");
  if (keep) keep.innerHTML = digitPool(keeper.keep7 || []);
  if (drop) drop.innerHTML = digitPool(keeper.drop3 || [], true);
  const assist = document.querySelector("#europeAssist");
  if (assist) assist.innerHTML = `3D Assist: <b>${esc((keeper.assistedTop3 || []).join(" · ") || "—")}</b>`;
  const setText = (id, value) => { const el = document.querySelector(id); if (el) el.textContent = value; };
  setText("#europeCoverage", keeper.coverageMassPct == null ? "—" : `${Number(keeper.coverageMassPct).toFixed(2)}%`);
  setText("#europeRecentCoverage", keeper.recentCoveragePct == null ? "—" : `${Number(keeper.recentCoveragePct).toFixed(2)}%`);
  setText("#europeSlotCoverage", keeper.slotCoveragePct == null ? "—" : `${Number(keeper.slotCoveragePct).toFixed(2)}% · n=${keeper.slotSamples || 0}`);

  const last = data.lastSettled;
  const forward = document.querySelector("#europeForwardResult");
  if (forward) {
    if (!last?.actualResult) forward.textContent = "—";
    else {
      const score = last.keeperScore;
      forward.textContent = score ? `${last.actualResult} · ${score.covered}/3${score.all3 ? " ALL3" : ""}` : last.actualResult;
    }
  }
}

function renderHistory(data) {
  const body = document.querySelector("#europeHistoryBody");
  if (!body) return;
  body.innerHTML = (data.recentHistory || []).map((row) => `<tr><td>${esc(row.period)}</td><td class="mono">${esc(row.result)}</td><td>${esc(fmtSource(row.datetime))}</td><td>${esc(fmtSource(row.nextDrawTime))}</td></tr>`).join("") || '<tr><td colspan="4">Belum ada data Europe.</td></tr>';
}

function renderEurope(data) {
  latestEuropeData = data;
  const latest = data.latest || {};
  const number = document.querySelector("#europeLatestNumber");
  const meta = document.querySelector("#europeLatestMeta");
  const status = document.querySelector("#europeStatus span");
  const updated = document.querySelector("#europeUpdated");
  if (number) number.textContent = latest.result || "---";
  if (meta) meta.innerHTML = `Period <strong>${esc(latest.period ?? "—")}</strong><br>${esc(fmtSource(latest.datetime))}<br>${Number(data.draws || 0)} draw tersimpan`;
  if (status) status.innerHTML = data.pending
    ? `<strong>AUTO aktif.</strong> Lock Europe untuk period ${esc(data.pending.targetPeriod ?? "berikutnya")} sudah dibuat dari anchor ${esc(data.pending.anchorPeriod)}.`
    : `<strong>AUTO aktif.</strong> Menunggu minimal 40 history / lock berikutnya.`;
  if (updated) updated.textContent = `Update ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · V${EUROPE_UI_VERSION}`;
  renderModels(data);
  renderKeeper(data);
  renderAdaptive(data);
  renderHistory(data);
  tickCountdown();
}

function tickCountdown() {
  const node = document.querySelector("#europeCountdown");
  if (!node) return;
  const targetText = latestEuropeData?.pending?.targetDrawTime || latestEuropeData?.latest?.nextDrawTime;
  const target = parseSourceTime(targetText);
  if (!target) {
    node.textContent = "--:--:--";
    return;
  }
  const ms = Math.max(0, target.getTime() - Date.now());
  const total = Math.floor(ms / 1000);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  node.textContent = `${hh}:${mm}:${ss}`;
}

async function loadEurope({ bootstrap = false } = {}) {
  try {
    const response = await fetchEuropeUi("/api/europe", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Europe status gagal (${response.status})`);
    renderEurope(data);
    if (bootstrap && !europeLoadedOnce && Number(data.draws || 0) < 40) {
      europeLoadedOnce = true;
      await syncEurope(false);
    } else {
      europeLoadedOnce = true;
    }
  } catch (error) {
    const status = document.querySelector("#europeStatus span");
    if (status) status.textContent = error?.message || "Europe status tidak dapat dibaca.";
  }
}

async function syncEurope(userTriggered) {
  const button = document.querySelector("#europeSyncBtn");
  const status = document.querySelector("#europeStatus span");
  if (button) button.disabled = true;
  if (status) status.textContent = userTriggered ? "Sync Europe + settle + lock…" : "Bootstrap history Europe…";
  try {
    const response = await fetchEuropeUi("/api/europe-sync", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ backfill: !latestEuropeData || Number(latestEuropeData.draws || 0) < 120 }),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Europe sync gagal (${response.status})`);
    renderEurope(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Europe sync gagal.";
  } finally {
    if (button) button.disabled = false;
  }
}

function startTimers() {
  clearInterval(europeTimer);
  clearInterval(countdownTimer);
  europeTimer = setInterval(() => {
    if (!document.hidden && !document.querySelector("#europeWorkspace")?.hidden) loadEurope();
  }, 30_000);
  countdownTimer = setInterval(tickCountdown, 1000);
}

function initEuropeUi() {
  createShell();
  startTimers();
  let preferred = "utama";
  try { preferred = localStorage.getItem("testkemungkinan-market") || "utama"; } catch {}
  switchMarket(preferred === "europe" ? "europe" : "utama");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEuropeUi, { once: true });
else initEuropeUi();
