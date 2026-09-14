const RECOVERY_UI_VERSION = "1.0.1";
const fetchRecovery = window.fetch.bind(window);
let recoveryLoaded = false;
let recoveryLoading = false;

function escR(value) {
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
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" });
}

function pct(value) {
  return value == null ? "—" : `${Number(value).toFixed(1)}%`;
}

function labelClass(value) {
  if (value === "OBSERVER_CAPTURED") return "ok";
  if (value === "VERIFIED_LOCK_NOT_OBSERVED") return "recover";
  if (value === "PARTIAL_MODEL_LOCK_ONLY") return "partial";
  return "missing";
}

function labelText(value) {
  const map = {
    OBSERVER_CAPTURED: "LOCK + OBSERVER",
    VERIFIED_LOCK_NOT_OBSERVED: "VERIFIED LOCK · OBSERVER MISSED",
    PARTIAL_MODEL_LOCK_ONLY: "PARTIAL MODEL LOCK",
    TRULY_MISSING_LEARNER_LOCK: "NO ORIGINAL LEARNER LOCK",
  };
  return map[value] || value || "—";
}

function ensureRecoveryShell() {
  if (document.querySelector("#recoveryWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab recovery-tab";
  button.dataset.market = "recovery";
  button.textContent = "RECOVERY 🔬";
  if (note) tabs.insertBefore(button, note); else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "recoveryWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="recovery-shell">
      <header class="recovery-head">
        <div><p class="recovery-eyebrow">V1.0.1 · Forward Lock Recovery Audit</p><h1>24 jam kemarin sebenarnya tersimpan berapa tebakan asli?</h1><p>Audit ini tidak membuat prediksi masa lalu. Ia hanya mencocokkan raw result dengan forward lock asli yang memang sudah ada sebelum settlement.</p></div>
        <div class="recovery-badges"><span>READ ONLY</span><span>NO HINDSIGHT</span><span>ORIGINAL LOCKS ONLY</span></div>
      </header>
      <div class="recovery-toolbar"><span id="recoveryStatus">Menunggu audit…</span><div><select id="recoveryHours"><option value="24">24H legacy window</option><option value="48">48H</option><option value="72">72H</option></select><button id="recoveryRun" type="button">RUN AUDIT</button></div></div>
      <section class="recovery-overview" id="recoveryOverview"></section>
      <section class="recovery-source" id="recoveryUtama"></section>
      <section class="recovery-source" id="recoveryEurope"></section>
      <section class="recovery-guard"><strong>Recovery guardrail.</strong> Lock yang memang ada tetap sah sebagai forward evidence meskipun Observer tidak sempat snapshot. Period yang tidak pernah punya original learner lock tidak akan direkonstruksi sekarang.</section>
    </section>`;
  const capture = document.querySelector("#captureIntegrityWorkspace");
  (capture?.parentNode || utama.parentNode).insertBefore(workspace, capture?.nextSibling || utama.nextSibling);

  button.addEventListener("click", () => switchRecovery(true));
  workspace.querySelector("#recoveryRun")?.addEventListener("click", () => loadRecovery(true));
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-market]");
    if (target && target.dataset.market !== "recovery") switchRecovery(false, true);
  });
  return true;
}

function switchRecovery(active, preserveTabs = false) {
  const workspace = document.querySelector("#recoveryWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace", "#captureIntegrityWorkspace"]) {
      const node = document.querySelector(selector); if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active", "capture-integrity-active");
    document.body.classList.add("recovery-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "recovery"));
    if (!recoveryLoaded) loadRecovery(false);
  } else {
    document.body.classList.remove("recovery-active");
    if (!preserveTabs) { const node = document.querySelector("#utamaWorkspace"); if (node) node.hidden = false; }
  }
}

function renderOverview(data) {
  const s = data.summary || {};
  const node = document.querySelector("#recoveryOverview");
  if (!node) return;
  node.innerHTML = `
    <div class="recovery-summary-main"><small>AUDIT WINDOW</small><strong>${escR(data.window?.hours)}H BEFORE RELIABLE START</strong><p>${escR(fmtDate(data.window?.startAt))} → ${escR(fmtDate(data.window?.endAt))}</p></div>
    <div><span>Raw results</span><strong>${escR(s.rawResults ?? 0)}</strong></div>
    <div><span>Verified learner locks</span><strong>${escR(s.verifiedLearnerLocks ?? 0)}</strong></div>
    <div><span>Observer captured</span><strong>${escR(s.observerCaptured ?? 0)}</strong></div>
    <div><span>Valid locks Observer missed</span><strong>${escR(s.verifiedLockNotObserved ?? 0)}</strong></div>
    <div><span>Truly missing learner locks</span><strong>${escR(s.trulyMissingLearnerLocks ?? 0)}</strong></div>`;
}

function renderSource(selector, title, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const rows = source?.rows || [];
  node.innerHTML = `
    <div class="recovery-source-head"><div><small>${escR(title)}</small><h2>${escR(source?.verifiedLearnerLocks ?? 0)} / ${escR(source?.rawResults ?? 0)} ORIGINAL LEARNER LOCKS</h2></div><strong>${pct(source?.learnerCoveragePct)}</strong></div>
    <div class="recovery-metrics">
      <div><span>Raw result opportunity</span><strong>${escR(source?.rawResults ?? 0)}</strong></div>
      <div><span>Verified learner lock</span><strong>${escR(source?.verifiedLearnerLocks ?? 0)}</strong></div>
      <div><span>Observer captured</span><strong>${escR(source?.observerCaptured ?? 0)}</strong></div>
      <div><span>Lock valid, Observer missed</span><strong>${escR(source?.verifiedLockNotObserved ?? 0)}</strong></div>
      <div><span>Truly missing learner lock</span><strong>${escR(source?.trulyMissingLearnerLocks ?? 0)}</strong></div>
    </div>
    <div class="recovery-table-wrap"><table class="recovery-table"><thead><tr><th>Period</th><th>Actual</th><th>Draw</th><th>Status</th><th>Original lock</th><th>Observer</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escR(row.period)}</td><td class="mono">${escR(row.result)}</td><td>${escR(fmtDate(row.drawAt))}</td><td><span class="recovery-pill ${labelClass(row.classification)}">${escR(labelText(row.classification))}</span></td><td>${row.learnerLock?.verified ? `#${escR(row.learnerLock.id)} · anchor ${escR(row.learnerLock.anchorPeriod)}` : "—"}</td><td>${row.observer ? `#${escR(row.observer.id)} · ${escR(row.observer.status)}` : "—"}</td></tr>`).join("") || '<tr><td colspan="6">Tidak ada result di window ini.</td></tr>'}</tbody></table></div>`;
}

function renderRecovery(data) {
  recoveryLoaded = true;
  renderOverview(data);
  renderSource("#recoveryUtama", "3D UTAMA", data.bySource?.utama || {});
  renderSource("#recoveryEurope", "EUROPE", data.bySource?.europe || {});
  const status = document.querySelector("#recoveryStatus");
  if (status) status.textContent = `Audit selesai · ${data.summary?.verifiedLearnerLocks || 0} original learner locks terverifikasi · ${data.summary?.trulyMissingLearnerLocks || 0} benar-benar tidak punya learner lock.`;
}

async function loadRecovery(userTriggered) {
  if (recoveryLoading) return;
  recoveryLoading = true;
  const button = document.querySelector("#recoveryRun");
  const status = document.querySelector("#recoveryStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = "Mencocokkan raw results → original locks → Observer…";
  try {
    const hours = Number(document.querySelector("#recoveryHours")?.value || 24);
    const response = await fetchRecovery(`/api/lock-recovery?hours=${encodeURIComponent(hours)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Recovery audit gagal (${response.status})`);
    renderRecovery(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Recovery audit gagal.";
  } finally {
    if (button) button.disabled = false;
    recoveryLoading = false;
  }
}

function initRecovery() {
  if (!ensureRecoveryShell()) { setTimeout(initRecovery, 150); return; }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initRecovery, { once: true });
else initRecovery();

console.debug(`Forward Lock Recovery UI V${RECOVERY_UI_VERSION} active`);
