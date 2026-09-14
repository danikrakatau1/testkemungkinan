const EVIDENCE_UI_VERSION = "0.9.8";
const EVIDENCE_ACTIVE_KEY = "testkemungkinan-evidence-active";
const evidenceFetch = window.fetch.bind(window);
const REFRESH_MS = 60_000;
let evidenceLoaded = false;
let evidenceLoading = false;
let evidenceTabsHooked = false;
let evidenceTimer = null;

function escV(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pctV(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

function numV(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function isEvidenceActive() {
  const workspace = document.querySelector("#evidenceWorkspace");
  return Boolean(workspace && !workspace.hidden);
}

function ensureEvidenceShell() {
  if (document.querySelector("#evidenceWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab evidence-tab";
  button.dataset.market = "evidence";
  button.textContent = "EVIDENCE 📊";
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "evidenceWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="evidence-shell">
      <div class="evidence-panel">
        <header class="evidence-head">
          <div>
            <p class="evidence-eyebrow">Evidence Monitor · Forward Only</p>
            <h1>Apakah data sudah cukup untuk dipercaya?</h1>
            <p>Monitor progress statistik UTAMA dan EUROPE tanpa mengubah model. Rolling 10 / 25 / 50 membandingkan performa terhadap permutation-null mean deskriptif.</p>
          </div>
          <div class="evidence-badges"><span>READ ONLY</span><span>NO CLAIM</span><span>AUTO REFRESH 60S</span></div>
        </header>

        <div class="evidence-toolbar">
          <span id="evidenceStatus">Memuat forward evidence…</span>
          <button type="button" id="evidenceRefreshBtn">REFRESH</button>
        </div>

        <section class="evidence-overview">
          <div class="evidence-overview-main"><small>LAB STATUS</small><strong id="evidenceLabStatus">COLLECT</strong><p id="evidenceLabNote">Watchlist hanya sinyal deskriptif. Klaim edge tetap harus lewat Edge Audit.</p></div>
          <div><span>Settled</span><strong id="evidenceSettled">—</strong></div>
          <div><span>Pending</span><strong id="evidencePending">—</strong></div>
          <div><span>Next milestone</span><strong id="evidenceNext">—</strong></div>
        </section>

        <section id="evidenceUtama" class="evidence-source"></section>
        <section id="evidenceEurope" class="evidence-source"></section>

        <section class="evidence-guardrail"><strong>Evidence guardrail.</strong> WATCH berarti performa rolling sedang di atas permutation-null mean secara deskriptif, <b>bukan</b> bukti edge. Tidak ada p-value di monitor ini. Klaim statistik hanya boleh datang dari <b>EDGE AUDIT</b> setelah sample dan calibration cukup.</section>
        <footer class="evidence-footer"><span>Source: ai_v2_observations · locked-before-result · settled metrics only</span><span id="evidenceUpdated">V${EVIDENCE_UI_VERSION}</span></footer>
      </div>
    </section>`;

  const edge = document.querySelector("#edgeWorkspace");
  (edge?.parentNode || utama.parentNode).insertBefore(workspace, edge?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchEvidence(true));
  workspace.querySelector("#evidenceRefreshBtn")?.addEventListener("click", () => loadEvidence(true));
  hookEvidenceTabs();
  return true;
}

function hookEvidenceTabs() {
  const tabs = document.querySelector("#marketTabs");
  if (!tabs || evidenceTabsHooked) return;
  evidenceTabsHooked = true;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-market]");
    if (!button) return;
    if (button.dataset.market !== "evidence") switchEvidence(false, { preserveTabs: true });
  });
}

function startEvidenceTimer() {
  if (evidenceTimer) clearInterval(evidenceTimer);
  evidenceTimer = setInterval(() => {
    if (isEvidenceActive() && !document.hidden) loadEvidence(false);
  }, REFRESH_MS);
}

function switchEvidence(active, options = {}) {
  const workspace = document.querySelector("#evidenceWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace"]) {
      const node = document.querySelector(selector);
      if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active");
    document.body.classList.add("evidence-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "evidence"));
    try { localStorage.setItem(EVIDENCE_ACTIVE_KEY, "1"); } catch {}
    if (!evidenceLoaded) loadEvidence(false);
    startEvidenceTimer();
  } else {
    document.body.classList.remove("evidence-active");
    try { localStorage.removeItem(EVIDENCE_ACTIVE_KEY); } catch {}
    if (evidenceTimer) {
      clearInterval(evidenceTimer);
      evidenceTimer = null;
    }
    if (!options.preserveTabs) {
      const utama = document.querySelector("#utamaWorkspace");
      if (utama) utama.hidden = false;
    }
  }
}

function progressBar(progress) {
  const pct = Math.max(0, Math.min(100, Number(progress?.percentToNext || 0)));
  const next = progress?.nextMilestone;
  return `<div class="evidence-progress"><div class="evidence-progress-track"><span style="width:${pct}%"></span></div><div class="evidence-progress-meta"><span>${pct.toFixed(1)}% menuju ${next ?? "200+"}</span><strong>${next == null ? "STRONGER TEST" : `${progress.remaining} lagi`}</strong></div></div>`;
}

function lifetimeSummary(model) {
  const m = model?.lifetime || {};
  return `${pctV(m.exactTop3Rate)} exact · ${numV(m.meanDigitOverlap)} overlap · ${numV(m.meanPositionHits)} pos`;
}

function windowCell(model, size) {
  const w = model?.rolling?.[size] || {};
  const o = w.observed || {};
  const n = w.nullMean || {};
  if (!w.n) return `<td><span class="evidence-muted">—</span></td>`;
  const overlapLift = Number(o.meanDigitOverlap || 0) - Number(n.meanDigitOverlap || 0);
  const posLift = Number(o.meanPositionHits || 0) - Number(n.meanPositionHits || 0);
  const cls = overlapLift >= 0.15 || posLift >= 0.10 ? "up" : "flat";
  return `<td><strong>${w.n} rows</strong><small class="${cls}">overlap ${numV(o.meanDigitOverlap)} vs ${numV(n.meanDigitOverlap)} null</small><small class="${cls}">pos ${numV(o.meanPositionHits)} vs ${numV(n.meanPositionHits)} null</small><small>exact ${pctV(o.exactTop3Rate)} vs ${pctV(n.exactTop3Rate)} null</small></td>`;
}

function renderModels(source) {
  const models = source?.models || [];
  if (!models.length) return `<div class="evidence-empty">Belum ada model history yang cukup lengkap.</div>`;
  return `<div class="evidence-table-wrap"><table class="evidence-table"><thead><tr><th>Model</th><th>Lifetime</th><th>Rolling 10</th><th>Rolling 25</th><th>Rolling 50</th></tr></thead><tbody>${models.map((model) => `<tr><td><strong>${escV(model.label)}</strong><small>N ${escV(model.n)}</small></td><td><strong>${escV(lifetimeSummary(model))}</strong></td>${windowCell(model, 10)}${windowCell(model, 25)}${windowCell(model, 50)}</tr>`).join("")}</tbody></table></div>`;
}

function renderKeeper(source) {
  const keeper = source?.keeper7;
  if (!keeper) return `<div class="evidence-empty">Keeper7 evidence belum tersedia.</div>`;
  const life = keeper.lifetime || {};
  const cells = [10, 25, 50].map((size) => {
    const w = keeper.rolling?.[size] || {};
    const o = w.observed || {};
    const n = w.nullMean || {};
    return `<div><span>ROLL ${size}</span><strong>${pctV(o.all3Rate)} ALL3</strong><small>${w.n || 0} rows · null ${pctV(n.all3Rate)}</small><small>coverage ${numV(o.meanCoverage)}/3 · null ${numV(n.meanCoverage)}</small></div>`;
  }).join("");
  return `<div class="evidence-keeper"><div><span>LIFETIME</span><strong>${pctV(life.all3Rate)} ALL3</strong><small>N ${keeper.n} · avg ${numV(life.meanCoverage)}/3</small><small>sample baseline ${pctV(life.sampleMatchedAll3Baseline)}</small></div>${cells}</div>`;
}

function renderWatchlist(source) {
  const rows = source?.watchlist || [];
  if (!rows.length) return `<div class="evidence-watch empty"><strong>NO CLAIM</strong><span>Tidak ada rolling-10 signal yang melewati watch threshold.</span></div>`;
  return `<div class="evidence-watch-list">${rows.map((row) => `<div class="evidence-watch"><strong>WATCH · ${escV(row.label)}</strong><span>${escV((row.reasons || []).join(" · "))}</span><small>DESCRIPTIVE ONLY · bukan edge claim</small></div>`).join("")}</div>`;
}

function renderSource(selector, title, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const gate = source?.gate || {};
  const progress = source?.progress || {};
  node.innerHTML = `
    <div class="evidence-source-head">
      <div><p>${escV(title)} · FORWARD EVIDENCE</p><h2>${escV(gate.label || "—")}</h2><span>${escV(gate.note || "")}</span></div>
      <div class="evidence-source-count"><small>SETTLED / PENDING</small><strong>${escV(source?.settled ?? 0)} / ${escV(source?.pending ?? 0)}</strong><span>anchor ${escV(source?.firstAnchorPeriod ?? "—")} → ${escV(source?.lastAnchorPeriod ?? "—")}</span></div>
    </div>
    ${progressBar(progress)}
    <div class="evidence-milestones">${(progress.milestones || []).map((m) => `<span class="${m.reached ? "done" : ""}">${m.reached ? "✓" : "○"} ${m.target}</span>`).join("")}</div>
    <h3>Rolling model performance</h3>
    ${renderModels(source)}
    <h3>Keeper7 evidence</h3>
    ${renderKeeper(source)}
    <h3>Descriptive watchlist</h3>
    ${renderWatchlist(source)}`;
}

function renderEvidence(data) {
  evidenceLoaded = true;
  const set = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = String(value ?? "—"); };
  set("#evidenceSettled", data.totalSettled ?? 0);
  set("#evidencePending", data.totalPending ?? 0);
  const next = data.nextReady || {};
  set("#evidenceNext", next.next == null ? "200+" : `${String(next.source || "").toUpperCase()} → ${next.next} (${next.remaining} lagi)`);
  const anyWatch = (data.bySource?.utama?.watchlist || []).length + (data.bySource?.europe?.watchlist || []).length > 0;
  set("#evidenceLabStatus", anyWatch ? "COLLECT · WATCHLIST ACTIVE" : "COLLECT · NO CLAIM");
  renderSource("#evidenceUtama", "3D UTAMA", data.bySource?.utama || {});
  renderSource("#evidenceEurope", "EUROPE", data.bySource?.europe || {});
  set("#evidenceUpdated", `Update ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · V${EVIDENCE_UI_VERSION}`);
}

async function loadEvidence(manual) {
  if (evidenceLoading) return;
  evidenceLoading = true;
  const button = document.querySelector("#evidenceRefreshBtn");
  const status = document.querySelector("#evidenceStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = manual ? "Refreshing evidence…" : "Membaca settled forward evidence…";
  try {
    const response = await evidenceFetch("/api/evidence-monitor", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Evidence Monitor gagal (${response.status})`);
    renderEvidence(data);
    if (status) status.textContent = `Monitor aktif · ${data.totalSettled || 0} settled · ${data.totalPending || 0} pending · auto refresh 60 detik saat tab aktif.`;
  } catch (error) {
    if (status) status.textContent = error?.message || "Evidence Monitor gagal.";
  } finally {
    evidenceLoading = false;
    if (button) button.disabled = false;
  }
}

function initEvidenceMonitor() {
  if (!ensureEvidenceShell()) {
    setTimeout(initEvidenceMonitor, 120);
    return;
  }
  try {
    if (localStorage.getItem(EVIDENCE_ACTIVE_KEY) === "1") switchEvidence(true);
  } catch {}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEvidenceMonitor, { once: true });
else initEvidenceMonitor();
