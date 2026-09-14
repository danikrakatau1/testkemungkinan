const CAPTURE_UI_VERSION = "1.0.0";
const CAPTURE_ACTIVE_KEY = "testkemungkinan-capture-integrity-active";
const captureFetch = window.fetch.bind(window);
const REFRESH_MS = 60_000;
let captureLoaded = false;
let captureLoading = false;
let captureTabsHooked = false;
let captureRefreshTimer = null;
let captureCountdownTimer = null;
let lastDueAt = null;

function escC(value) {
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
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" });
}

function fmtCountdown(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms <= 0) return "DUE";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function statusClass(status) {
  if (status === "PASS") return "pass";
  if (status === "GAP_DETECTED") return "gap";
  return "arming";
}

function statusLabel(status) {
  const map = {
    PASS: "CAPTURE COMPLETE",
    GAP_DETECTED: "CAPTURE GAP DETECTED",
    ARMING: "ARMING RELIABLE WINDOW",
    NOT_STARTED: "WAITING FIRST ORDERED CYCLE",
  };
  return map[status] || String(status || "UNKNOWN").replaceAll("_", " ");
}

function isCaptureActive() {
  const node = document.querySelector("#captureIntegrityWorkspace");
  return Boolean(node && !node.hidden);
}

function ensureCaptureShell() {
  if (document.querySelector("#captureIntegrityWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab capture-integrity-tab";
  button.dataset.market = "capture-integrity";
  button.textContent = "CAPTURE 🛡️";
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "captureIntegrityWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="capture-shell">
      <div class="capture-panel">
        <header class="capture-head">
          <div>
            <p class="capture-eyebrow">V1.0.0 · Ordered Capture Integrity</p>
            <h1>Apakah setiap draw benar-benar tertangkap?</h1>
            <p>Reliable clock hanya dimulai setelah pipeline server berjalan berurutan: source → settlement → semua lock → observer. Window lama tetap disimpan, tetapi tidak disebut continuous 24H.</p>
          </div>
          <div class="capture-badges"><span>SERVER ORDERED</span><span>NO HINDSIGHT BACKFILL</span><span>5M CRON</span></div>
        </header>

        <div class="capture-toolbar">
          <span id="captureStatusText">Menunggu status ordered capture…</span>
          <div class="capture-actions"><button type="button" id="captureRefreshBtn">REFRESH</button><button type="button" id="captureSyncBtn">RUN ORDERED SYNC</button></div>
        </div>

        <section class="capture-overview">
          <div class="capture-overview-main"><small>INTEGRITY STATUS</small><strong id="captureVerdict">—</strong><p id="captureVerdictNote">Old Phase-0 wall clock bukan continuous coverage.</p></div>
          <div><span>Reliable elapsed</span><strong id="captureElapsed">—</strong><small id="captureStarted">—</small></div>
          <div><span>Reliable 24H</span><strong id="captureCountdown">—</strong><small id="captureDue">—</small></div>
          <div><span>Last ordered cycle</span><strong id="captureLastCycle">—</strong><small id="captureLastCycleTime">—</small></div>
        </section>

        <section class="capture-sources">
          <div id="captureUtama" class="capture-source"></div>
          <div id="captureEurope" class="capture-source"></div>
        </section>

        <section class="capture-legacy">
          <div><small>LEGACY WINDOW</small><strong>INCOMPLETE CAPTURE WINDOW</strong></div>
          <p>Observation sebelum reliable start tetap valid karena dibuat sebelum result, tetapi tidak dipakai untuk klaim “24 jam capture penuh”. Tidak ada backfill hasil lama yang dipalsukan menjadi forward.</p>
          <div id="captureLegacyCounts" class="capture-legacy-counts"></div>
        </section>

        <section class="capture-guardrail"><strong>Integrity guardrail.</strong> Denominator utama adalah forward lock yang benar-benar dibuat setelah reliable start. Sistem juga memeriksa missing anchor period dan conservative cadence shortfall. Jika satu lock tidak punya snapshot observer ketika masih pending, status berubah menjadi <b>GAP DETECTED</b>.</section>
        <footer class="capture-footer"><span>Ordered server cron · browser tidak wajib terbuka</span><span id="captureUpdated">V${CAPTURE_UI_VERSION}</span></footer>
      </div>
    </section>`;

  const lab = document.querySelector("#labReviewWorkspace");
  (lab?.parentNode || utama.parentNode).insertBefore(workspace, lab?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchCapture(true));
  workspace.querySelector("#captureRefreshBtn")?.addEventListener("click", () => loadCapture(true));
  workspace.querySelector("#captureSyncBtn")?.addEventListener("click", () => runOrderedSync());
  hookCaptureTabs();
  return true;
}

function hookCaptureTabs() {
  const tabs = document.querySelector("#marketTabs");
  if (!tabs || captureTabsHooked) return;
  captureTabsHooked = true;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-market]");
    if (!button) return;
    if (button.dataset.market !== "capture-integrity") switchCapture(false, { preserveTabs: true });
  });
}

function switchCapture(active, options = {}) {
  const workspace = document.querySelector("#captureIntegrityWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace"]) {
      const node = document.querySelector(selector);
      if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active");
    document.body.classList.add("capture-integrity-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "capture-integrity"));
    try { localStorage.setItem(CAPTURE_ACTIVE_KEY, "1"); } catch {}
    if (!captureLoaded) loadCapture(false);
    startCaptureTimers();
  } else {
    document.body.classList.remove("capture-integrity-active");
    try { localStorage.removeItem(CAPTURE_ACTIVE_KEY); } catch {}
    stopCaptureTimers();
    if (!options.preserveTabs) {
      const node = document.querySelector("#utamaWorkspace");
      if (node) node.hidden = false;
    }
  }
}

function startCaptureTimers() {
  stopCaptureTimers();
  captureRefreshTimer = setInterval(() => {
    if (isCaptureActive() && !document.hidden) loadCapture(false);
  }, REFRESH_MS);
  captureCountdownTimer = setInterval(updateCountdown, 1000);
}

function stopCaptureTimers() {
  if (captureRefreshTimer) clearInterval(captureRefreshTimer);
  if (captureCountdownTimer) clearInterval(captureCountdownTimer);
  captureRefreshTimer = null;
  captureCountdownTimer = null;
}

function updateCountdown() {
  const node = document.querySelector("#captureCountdown");
  if (!node) return;
  node.textContent = lastDueAt ? fmtCountdown(Date.parse(lastDueAt) - Date.now()) : "—";
}

function anchorsText(values) {
  const rows = Array.isArray(values) ? values : [];
  return rows.length ? rows.slice(0, 12).join(" · ") : "none";
}

function renderSource(selector, title, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const rate = source?.captureRatePct == null ? "—" : `${Number(source.captureRatePct).toFixed(1)}%`;
  const cls = statusClass(source?.status);
  node.innerHTML = `
    <div class="capture-source-head"><div><small>${escC(title)} · ${escC(source?.cadenceMinutes ?? "—")} MIN CADENCE</small><strong class="${cls}">${escC(statusLabel(source?.status))}</strong></div><span>${rate}</span></div>
    <div class="capture-source-grid">
      <div><span>Eligible locks</span><strong>${escC(source?.eligibleLocks ?? 0)}</strong></div>
      <div><span>Captured</span><strong>${escC(source?.capturedLocks ?? 0)}</strong></div>
      <div><span>Settled / Pending</span><strong>${escC(source?.settled ?? 0)} / ${escC(source?.pending ?? 0)}</strong></div>
      <div><span>Max capture latency</span><strong>${source?.latency?.maxSeconds == null ? "—" : `${escC(source.latency.maxSeconds)}s`}</strong></div>
    </div>
    <div class="capture-source-details">
      <span>Anchor ${escC(source?.firstAnchorPeriod ?? "—")} → ${escC(source?.lastAnchorPeriod ?? "—")}</span>
      <span>Cadence opportunities ≈ ${escC(source?.cadenceOpportunitiesEstimate ?? 0)} · minimum expected locks ${escC(source?.minimumExpectedLocks ?? 0)}</span>
      <span>Missing observer anchors: <b>${escC(anchorsText(source?.missingObservationAnchors))}</b></span>
      <span>Missing lock periods: <b>${escC(anchorsText(source?.missingLockPeriods))}</b></span>
      <span>Cadence shortfall estimate: <b>${escC(source?.cadenceShortfallEstimate ?? 0)}</b></span>
    </div>`;
}

function renderCapture(data) {
  captureLoaded = true;
  const verdict = document.querySelector("#captureVerdict");
  if (verdict) {
    verdict.textContent = statusLabel(data.status);
    verdict.className = statusClass(data.status);
  }
  const status = document.querySelector("#captureStatusText");
  if (status) status.textContent = data.status === "NOT_STARTED"
    ? "Reliable clock belum dimulai · menunggu ordered server cycle pertama."
    : `${statusLabel(data.status)} · source→lock→observer barrier aktif.`;

  lastDueAt = data.reliable24h?.dueAt || null;
  updateCountdown();
  const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = String(value ?? "—"); };
  set("#captureElapsed", data.reliableElapsedHours == null ? "—" : `${Number(data.reliableElapsedHours).toFixed(2)}h`);
  set("#captureStarted", `Start ${fmtDate(data.reliableCollectionStartedAt)}`);
  set("#captureDue", data.reliable24h?.dueAt ? `Due ${fmtDate(data.reliable24h.dueAt)}` : "menunggu first ordered cycle");
  set("#captureLastCycle", data.lastOrderedCycle?.status || "—");
  set("#captureLastCycleTime", fmtDate(data.lastOrderedCycle?.at));

  renderSource("#captureUtama", "3D UTAMA", data.bySource?.utama || {});
  renderSource("#captureEurope", "EUROPE", data.bySource?.europe || {});

  const legacyNode = document.querySelector("#captureLegacyCounts");
  if (legacyNode) {
    const u = data.legacyWindow?.observationsBeforeReliableStart?.utama || {};
    const e = data.legacyWindow?.observationsBeforeReliableStart?.europe || {};
    legacyNode.innerHTML = `<span>UTAMA · ${escC(u.settled || 0)} settled · ${escC(u.pending || 0)} pending</span><span>EUROPE · ${escC(e.settled || 0)} settled · ${escC(e.pending || 0)} pending</span>`;
  }
  set("#captureUpdated", `Update ${new Date().toLocaleTimeString("id-ID")} · V${CAPTURE_UI_VERSION}`);
}

async function loadCapture(showStatus = true) {
  if (captureLoading) return;
  captureLoading = true;
  const status = document.querySelector("#captureStatusText");
  if (showStatus && status) status.textContent = "Membaca capture integrity…";
  try {
    const response = await captureFetch("/api/capture-integrity", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Capture Integrity gagal (${response.status})`);
    renderCapture(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Capture Integrity gagal.";
  } finally {
    captureLoading = false;
  }
}

async function runOrderedSync() {
  if (captureLoading) return;
  const button = document.querySelector("#captureSyncBtn");
  const status = document.querySelector("#captureStatusText");
  if (button) button.disabled = true;
  if (status) status.textContent = "Ordered sync: source → locks → observer → integrity…";
  try {
    const response = await captureFetch("/api/ordered-sync", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Ordered sync gagal (${response.status})`);
    await loadCapture(false);
  } catch (error) {
    if (status) status.textContent = error?.message || "Ordered sync gagal.";
  } finally {
    if (button) button.disabled = false;
  }
}

function initCaptureIntegrity() {
  if (!ensureCaptureShell()) {
    setTimeout(initCaptureIntegrity, 120);
    return;
  }
  try {
    if (localStorage.getItem(CAPTURE_ACTIVE_KEY) === "1") switchCapture(true);
  } catch {}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initCaptureIntegrity, { once: true });
else initCaptureIntegrity();
