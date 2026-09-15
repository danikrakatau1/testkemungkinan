const CONTINUITY_UI_VERSION = "1.0.4";
const continuityFetch = window.fetch.bind(window);
let continuityLoaded = false;
let continuityLoading = false;

function escC(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function joinPeriods(values) {
  return Array.isArray(values) && values.length ? values.join(" · ") : "none";
}

function ensureContinuityShell() {
  if (document.querySelector("#continuityWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab continuity-tab";
  button.dataset.market = "continuity";
  button.textContent = "CONTINUITY 🔗";
  if (note) tabs.insertBefore(button, note); else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "continuityWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="continuity-shell">
      <header class="continuity-head">
        <div>
          <p class="continuity-eyebrow">V1.0.4 · Learner Continuity Guard</p>
          <h1>Setiap result benar-benar punya forward lock?</h1>
          <p>Audit read-only membandingkan raw result dengan Keeper7, Arena, Two-Stage, Europe forward lock, dan Observer. Gap lama tidak direkonstruksi.</p>
        </div>
        <div class="continuity-badges"><span>READ ONLY</span><span>NO HINDSIGHT</span><span>RAW RESULT = DENOMINATOR</span></div>
      </header>
      <div class="continuity-toolbar"><span id="continuityStatus">Memuat continuity audit…</span><button id="continuityRefresh" type="button">REFRESH AUDIT</button></div>
      <section class="continuity-overview" id="continuityOverview"></section>
      <section class="continuity-lane" id="continuityUtama"></section>
      <section class="continuity-lane" id="continuityEurope"></section>
      <section class="continuity-guardrail"><strong>Guardrail.</strong> Missing period hanya dilaporkan. Sistem tidak membuat ulang prediksi lama setelah actual diketahui.</section>
    </section>`;

  const intelligence = document.querySelector("#intelligenceWorkspace");
  (intelligence?.parentNode || utama.parentNode).insertBefore(workspace, intelligence?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchContinuity(true));
  workspace.querySelector("#continuityRefresh")?.addEventListener("click", () => loadContinuity(true));
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-market]");
    if (target && target.dataset.market !== "continuity") switchContinuity(false, true);
  });
  return true;
}

function switchContinuity(active, preserveTabs = false) {
  const workspace = document.querySelector("#continuityWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace", "#captureIntegrityWorkspace", "#recoveryWorkspace", "#watchdogWorkspace", "#intelligenceWorkspace"]) {
      const node = document.querySelector(selector); if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active", "capture-integrity-active", "recovery-active", "watchdog-active", "intelligence-active");
    document.body.classList.add("continuity-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "continuity"));
    if (!continuityLoaded) loadContinuity(false);
  } else {
    document.body.classList.remove("continuity-active");
    if (!preserveTabs) { const node = document.querySelector("#utamaWorkspace"); if (node) node.hidden = false; }
  }
}

function statusClass(status) {
  if (status === "HEALTHY") return "healthy";
  if (status === "PROCESSING" || status === "ARMING") return "arming";
  return "gap";
}

function renderOverview(data) {
  const hist = data.historical || {};
  const utama = hist.bySource?.utama || {};
  const europe = hist.bySource?.europe || {};
  const node = document.querySelector("#continuityOverview");
  if (!node) return;
  node.innerHTML = `
    <div class="continuity-verdict ${statusClass(hist.status)}"><small>HISTORICAL CONTINUITY</small><strong>${escC(hist.status || "—")}</strong><span>sejak scheduled watchdog pertama</span></div>
    <div><small>UTAMA KEEPER7 SETTLED</small><strong>${escC(utama.totals?.keeper7?.settled ?? "—")}</strong><span>expected settled window ${escC(utama.expectedSettled ?? "—")}</span></div>
    <div><small>UTAMA SHORTFALL</small><strong>${escC(utama.learnerShortfall ?? "—")}</strong><span>${fmtPct(utama.continuityPct)} lock continuity</span></div>
    <div><small>EUROPE SETTLED</small><strong>${escC(europe.totals?.forward?.settled ?? "—")}</strong><span>shortfall ${escC(europe.learnerShortfall ?? "—")}</span></div>`;
}

function rowStatus(status) {
  const klass = status === "COMPLETE" || status === "CURRENT_LOCKED" ? "ok" : status === "PROCESSING" ? "wait" : "bad";
  return `<span class="continuity-pill ${klass}">${escC(status)}</span>`;
}

function renderUtama(source) {
  const node = document.querySelector("#continuityUtama");
  if (!node) return;
  const rows = (source.recent || []).map((row) => `<tr>
    <td>${escC(row.period)}</td><td>${escC(row.result)}</td><td>${rowStatus(row.status)}</td>
    <td>${row.keeper ? escC(row.keeper.status) : "—"}</td><td>${row.arena ? escC(row.arena.status) : "—"}</td>
    <td>${row.twoStage ? escC(row.twoStage.status) : "—"}</td><td>${row.observer ? escC(row.observer.status) : "—"}</td>
  </tr>`).join("");
  node.innerHTML = `
    <div class="continuity-lane-head"><div><small>3D UTAMA</small><h2 class="${statusClass(source.status)}">${escC(source.status || "—")}</h2><p>raw ${escC(source.rawResults ?? 0)} · expected lock ${escC(source.expectedLearnerLocks ?? 0)} · locked ${escC(source.locked ?? 0)} · settled ${escC(source.settled ?? 0)}</p></div><strong>${fmtPct(source.continuityPct)}</strong></div>
    <div class="continuity-missing">
      <div><span>Missing Keeper7</span><b>${joinPeriods(source.missingKeeperPeriods)}</b></div>
      <div><span>Missing Arena</span><b>${joinPeriods(source.missingArenaPeriods)}</b></div>
      <div><span>Missing Two-Stage</span><b>${joinPeriods(source.missingTwoStagePeriods)}</b></div>
      <div><span>Missing Observer</span><b>${joinPeriods(source.missingObserverPeriods)}</b></div>
      <div><span>Raw period gaps</span><b>${joinPeriods(source.missingRawPeriods)}</b></div>
      <div><span>Learner shortfall</span><b>${escC(source.learnerShortfall ?? 0)}</b></div>
    </div>
    <div class="continuity-table-wrap"><table><thead><tr><th>Period</th><th>Actual</th><th>Status</th><th>Keeper7</th><th>Arena</th><th>Two-Stage</th><th>Observer</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Belum ada data.</td></tr>'}</tbody></table></div>`;
}

function renderEurope(source) {
  const node = document.querySelector("#continuityEurope");
  if (!node) return;
  const rows = (source.recent || []).map((row) => `<tr>
    <td>${escC(row.period)}</td><td>${escC(row.result)}</td><td>${rowStatus(row.status)}</td>
    <td>${row.forward ? escC(row.forward.status) : "—"}</td><td>${row.observer ? escC(row.observer.status) : "—"}</td>
  </tr>`).join("");
  node.innerHTML = `
    <div class="continuity-lane-head"><div><small>EUROPE · FIRST PLACE</small><h2 class="${statusClass(source.status)}">${escC(source.status || "—")}</h2><p>raw ${escC(source.rawResults ?? 0)} · expected lock ${escC(source.expectedLearnerLocks ?? 0)} · locked ${escC(source.locked ?? 0)} · settled ${escC(source.settled ?? 0)}</p></div><strong>${fmtPct(source.continuityPct)}</strong></div>
    <div class="continuity-missing">
      <div><span>Missing Forward Lock</span><b>${joinPeriods(source.missingForwardPeriods)}</b></div>
      <div><span>Missing Observer</span><b>${joinPeriods(source.missingObserverPeriods)}</b></div>
      <div><span>Raw period gaps</span><b>${joinPeriods(source.missingRawPeriods)}</b></div>
      <div><span>Learner shortfall</span><b>${escC(source.learnerShortfall ?? 0)}</b></div>
    </div>
    <div class="continuity-table-wrap"><table><thead><tr><th>Period</th><th>Actual</th><th>Status</th><th>Forward lock</th><th>Observer</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Belum ada data.</td></tr>'}</tbody></table></div>`;
}

function renderContinuity(data) {
  continuityLoaded = true;
  renderOverview(data);
  renderUtama(data.historical?.bySource?.utama || {});
  renderEurope(data.historical?.bySource?.europe || {});
  const status = document.querySelector("#continuityStatus");
  if (status) status.textContent = `Audit selesai · historical ${data.historical?.status || "—"} · no hindsight reconstruction.`;
}

async function loadContinuity(showStatus = true) {
  if (continuityLoading) return;
  continuityLoading = true;
  const button = document.querySelector("#continuityRefresh");
  const status = document.querySelector("#continuityStatus");
  if (button) button.disabled = true;
  if (showStatus && status) status.textContent = "Membandingkan raw result dengan seluruh forward lock…";
  try {
    const response = await continuityFetch("/api/learner-continuity", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Continuity audit gagal (${response.status})`);
    renderContinuity(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Continuity audit gagal.";
  } finally {
    if (button) button.disabled = false;
    continuityLoading = false;
  }
}

function initContinuity() {
  if (!ensureContinuityShell()) { setTimeout(initContinuity, 120); return; }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initContinuity, { once: true });
else initContinuity();
