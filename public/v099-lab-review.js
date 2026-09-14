const LAB_UI_VERSION = "0.9.9";
const LAB_ACTIVE_KEY = "testkemungkinan-lab-review-active";
const labFetch = window.fetch.bind(window);
const REFRESH_MS = 60_000;
let labLoaded = false;
let labLoading = false;
let labTabsHooked = false;
let labRefreshTimer = null;
let countdownTimer = null;
let lastDueAt = null;

function escL(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" });
}

function fmtHours(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}h` : "—";
}

function decisionLabel(value) {
  const map = {
    EXTEND_COLLECTION: "EXTEND COLLECTION",
    REVIEW_READY: "REVIEW READY",
    EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED: "EDGE CANDIDATE · HUMAN REVIEW",
  };
  return map[value] || String(value || "WAITING").replaceAll("_", " ");
}

function decisionClass(value) {
  if (value === "EDGE_CANDIDATE_HUMAN_REVIEW_REQUIRED") return "warn";
  if (value === "REVIEW_READY") return "ready";
  return "collect";
}

function formatCountdown(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms <= 0) return "DUE NOW";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isLabActive() {
  const workspace = document.querySelector("#labReviewWorkspace");
  return Boolean(workspace && !workspace.hidden);
}

function ensureLabShell() {
  if (document.querySelector("#labReviewWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab lab-review-tab";
  button.dataset.market = "lab-review";
  button.textContent = "LAB REVIEW 🧾";
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "labReviewWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="lab-review-shell">
      <div class="lab-review-panel">
        <header class="lab-review-head">
          <div>
            <p class="lab-review-eyebrow">24H Review Orchestrator · Automated Evidence Gate</p>
            <h1>Semalam mesin belajar apa?</h1>
            <p>Review otomatis menggabungkan Evidence Monitor, Edge Audit, Randomness Forensics, dan Monte Carlo. Model tidak pernah diubah otomatis.</p>
          </div>
          <div class="lab-review-badges"><span>AUTO CRON 5M</span><span>REPORT WRITE ONLY</span><span>HUMAN GATE</span></div>
        </header>

        <div class="lab-review-toolbar">
          <span id="labReviewStatus">Memuat status review…</span>
          <div class="lab-review-actions">
            <button type="button" id="labReviewRefreshBtn">REFRESH</button>
            <button type="button" id="labReviewRunBtn">RUN REVIEW NOW</button>
          </div>
        </div>

        <section class="lab-review-overview">
          <div class="lab-review-overview-main"><small>LATEST DECISION</small><strong id="labReviewDecision">WAITING</strong><p id="labReviewDecisionNote">24H dan milestone audit akan berjalan otomatis dari cron.</p></div>
          <div><span>24H countdown</span><strong id="labReviewCountdown">—</strong><small id="labReviewDueAt">—</small></div>
          <div><span>Elapsed</span><strong id="labReviewElapsed">—</strong><small id="labReviewStarted">—</small></div>
          <div><span>Due triggers</span><strong id="labReviewDueCount">0</strong><small id="labReviewDueNames">none</small></div>
        </section>

        <section class="lab-review-sources">
          <div id="labReviewUtama" class="lab-review-source"></div>
          <div id="labReviewEurope" class="lab-review-source"></div>
        </section>

        <section class="lab-review-section">
          <div class="lab-review-section-head"><div><p>Latest automated report</p><h2>Audit bundle snapshot</h2></div><span id="labReviewReportTime">NO REPORT YET</span></div>
          <div class="lab-review-audit-grid">
            <div><span>Edge Audit</span><strong id="labAuditEdge">—</strong></div>
            <div><span>Randomness</span><strong id="labAuditRandom">—</strong></div>
            <div><span>Monte Carlo</span><strong id="labAuditMc">—</strong></div>
            <div><span>Simulations</span><strong id="labAuditSims">—</strong></div>
          </div>
          <div id="labReviewWatchlist" class="lab-review-watchlist"></div>
        </section>

        <section class="lab-review-section">
          <div class="lab-review-section-head"><div><p>Report history</p><h2>Review checkpoints</h2></div><span>24H · 24 · 50 · 100 · 200</span></div>
          <div class="lab-review-table-wrap"><table class="lab-review-table"><thead><tr><th>Time</th><th>Trigger</th><th>Decision</th><th>Settled</th><th>Errors</th></tr></thead><tbody id="labReviewHistory"></tbody></table></div>
        </section>

        <section class="lab-review-guardrail"><strong>Automation guardrail.</strong> Scheduler boleh membuat laporan audit, tetapi <b>tidak boleh</b> mengaktifkan AI V2 Phase 1, mengubah weight, Keeper7, Adaptive, atau menulis ulang prediction lock. Jika muncul EDGE CANDIDATE, keputusan berhenti di <b>HUMAN REVIEW REQUIRED</b>.</section>
        <footer class="lab-review-footer"><span>Source: locked forward evidence + read-only audits · report table write only</span><span id="labReviewUpdated">V${LAB_UI_VERSION}</span></footer>
      </div>
    </section>`;

  const evidence = document.querySelector("#evidenceWorkspace");
  (evidence?.parentNode || utama.parentNode).insertBefore(workspace, evidence?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchLab(true));
  workspace.querySelector("#labReviewRefreshBtn")?.addEventListener("click", () => loadLab(false));
  workspace.querySelector("#labReviewRunBtn")?.addEventListener("click", () => runLabReview());
  hookLabTabs();
  return true;
}

function hookLabTabs() {
  const tabs = document.querySelector("#marketTabs");
  if (!tabs || labTabsHooked) return;
  labTabsHooked = true;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-market]");
    if (!button) return;
    if (button.dataset.market !== "lab-review") switchLab(false, { preserveTabs: true });
  });
}

function switchLab(active, options = {}) {
  const workspace = document.querySelector("#labReviewWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace"]) {
      const node = document.querySelector(selector);
      if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active");
    document.body.classList.add("lab-review-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "lab-review"));
    try { localStorage.setItem(LAB_ACTIVE_KEY, "1"); } catch {}
    if (!labLoaded) loadLab(false);
    startRefreshLoop();
  } else {
    document.body.classList.remove("lab-review-active");
    try { localStorage.removeItem(LAB_ACTIVE_KEY); } catch {}
    stopRefreshLoop();
    if (!options.preserveTabs) {
      const utama = document.querySelector("#utamaWorkspace");
      if (utama) utama.hidden = false;
    }
  }
}

function startRefreshLoop() {
  stopRefreshLoop();
  labRefreshTimer = setInterval(() => {
    if (isLabActive() && !document.hidden) loadLab(false);
  }, REFRESH_MS);
  if (!countdownTimer) countdownTimer = setInterval(updateCountdown, 1000);
}

function stopRefreshLoop() {
  if (labRefreshTimer) clearInterval(labRefreshTimer);
  labRefreshTimer = null;
}

function updateCountdown() {
  const node = document.querySelector("#labReviewCountdown");
  if (!node) return;
  if (!lastDueAt) {
    node.textContent = "—";
    return;
  }
  node.textContent = formatCountdown(Date.parse(lastDueAt) - Date.now());
}

function renderSource(selector, name, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const settled = Number(source?.settled || 0);
  const pending = Number(source?.pending || 0);
  const gate = source?.gate?.label || "COLLECT";
  const progress = source?.progress || {};
  const next = progress.nextMilestone ?? "DONE";
  const remaining = progress.remaining ?? 0;
  const watches = source?.watchlist || [];
  node.innerHTML = `
    <div class="lab-review-source-head"><div><small>${escL(name)}</small><strong>${escL(gate)}</strong></div><span>${settled} settled · ${pending} pending</span></div>
    <div class="lab-review-progress"><span style="width:${Math.min(100, Number(progress.percentToNext || 0))}%"></span></div>
    <div class="lab-review-source-meta"><span>Next ${escL(next)}</span><strong>${escL(remaining)} lagi</strong></div>
    <div class="lab-review-source-watch">${watches.length ? watches.map((w) => `<span>WATCH · ${escL(w.label)}</span>`).join("") : "NO WATCHLIST"}</div>`;
}

function renderHistory(reports) {
  const body = document.querySelector("#labReviewHistory");
  if (!body) return;
  if (!reports?.length) {
    body.innerHTML = `<tr><td colspan="5">Belum ada automated report. Report pertama akan dibuat saat trigger 24H atau milestone jatuh tempo.</td></tr>`;
    return;
  }
  body.innerHTML = reports.slice(0, 10).map((report) => {
    const counts = report.summary?.counts || {};
    const total = Number(counts.settled || 0);
    const errors = report.errors || report.summary?.errors || [];
    return `<tr><td>${escL(fmtDate(report.createdAt))}</td><td>${escL((report.reasons || []).join(" + "))}</td><td><span class="lab-review-pill ${decisionClass(report.decision)}">${escL(decisionLabel(report.decision))}</span></td><td>${total}</td><td>${errors.length}</td></tr>`;
  }).join("");
}

function renderLab(data) {
  labLoaded = true;
  lastDueAt = data.review24h?.dueAt || null;
  updateCountdown();
  const latest = data.latestReport;
  const decision = latest?.decision || (data.dueTriggers?.length ? "EXTEND_COLLECTION" : null);
  const decisionNode = document.querySelector("#labReviewDecision");
  if (decisionNode) {
    decisionNode.textContent = decisionLabel(decision || "WAITING");
    decisionNode.className = decisionClass(decision);
  }
  const note = document.querySelector("#labReviewDecisionNote");
  if (note) note.textContent = latest
    ? `Report ${latest.reviewKey} · ${latest.simulations.toLocaleString("id-ID")} simulations · model tetap frozen.`
    : "Belum ada report. Scheduler menunggu 24H atau milestone pertama.";

  const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = String(value ?? "—"); };
  set("#labReviewDueAt", data.review24h?.completed ? "24H review completed" : `Due ${fmtDate(data.review24h?.dueAt)}`);
  set("#labReviewElapsed", fmtHours(data.elapsedHours));
  set("#labReviewStarted", `Start ${fmtDate(data.phaseStartedAt)}`);
  set("#labReviewDueCount", data.dueTriggers?.length || 0);
  set("#labReviewDueNames", data.dueTriggers?.length ? data.dueTriggers.map((t) => t.key).join(" · ") : "none");

  renderSource("#labReviewUtama", "3D UTAMA", data.evidence?.bySource?.utama || {});
  renderSource("#labReviewEurope", "EUROPE", data.evidence?.bySource?.europe || {});

  const summary = latest?.summary || {};
  set("#labReviewReportTime", latest ? fmtDate(latest.createdAt) : "NO REPORT YET");
  set("#labAuditEdge", summary.audits?.edge || "—");
  set("#labAuditRandom", summary.audits?.randomness || "—");
  set("#labAuditMc", summary.audits?.monteCarlo || "—");
  set("#labAuditSims", latest?.simulations || "—");

  const watch = document.querySelector("#labReviewWatchlist");
  if (watch) {
    const utama = summary.watchlist?.utama || data.evidence?.bySource?.utama?.watchlist || [];
    const europe = summary.watchlist?.europe || data.evidence?.bySource?.europe?.watchlist || [];
    const items = [
      ...utama.map((w) => `UTAMA · ${w.label}`),
      ...europe.map((w) => `EUROPE · ${w.label}`),
    ];
    watch.innerHTML = items.length ? `<strong>WATCHLIST</strong>${items.map((item) => `<span>${escL(item)}</span>`).join("")}` : `<strong>WATCHLIST</strong><span>none</span>`;
  }

  renderHistory(data.recentReports || []);
  set("#labReviewUpdated", `Update ${new Date().toLocaleTimeString("id-ID")} · V${LAB_UI_VERSION}`);
}

async function loadLab(showStatus = true) {
  if (labLoading) return;
  labLoading = true;
  const status = document.querySelector("#labReviewStatus");
  if (showStatus && status) status.textContent = "Memuat status review…";
  try {
    const response = await labFetch("/api/lab-review", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Lab Review gagal (${response.status})`);
    renderLab(data);
    if (status) status.textContent = `AUTO armed · ${data.evidence?.totalSettled || 0} settled · ${data.evidence?.totalPending || 0} pending · cron 5m.`;
  } catch (error) {
    if (status) status.textContent = error?.message || "Lab Review status gagal.";
  } finally {
    labLoading = false;
  }
}

async function runLabReview() {
  if (labLoading) return;
  labLoading = true;
  const button = document.querySelector("#labReviewRunBtn");
  const status = document.querySelector("#labReviewStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = "Menjalankan manual 1,000-sim audit bundle…";
  try {
    const response = await labFetch("/api/lab-review/run?sims=1000", { method: "POST", headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Manual review gagal (${response.status})`);
    renderLab(data);
    if (status) status.textContent = `Manual report selesai · ${decisionLabel(data.review?.decision)}.`;
  } catch (error) {
    if (status) status.textContent = error?.message || "Manual review gagal.";
  } finally {
    labLoading = false;
    if (button) button.disabled = false;
  }
}

function initLabReview() {
  if (!ensureLabShell()) {
    setTimeout(initLabReview, 120);
    return;
  }
  try {
    if (localStorage.getItem(LAB_ACTIVE_KEY) === "1") switchLab(true);
  } catch {}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLabReview, { once: true });
else initLabReview();
