const BARRIER_UI_VERSION = "1.0.5";
const barrierFetch = window.fetch.bind(window);
let barrierLoaded = false;
let barrierLoading = false;

function escB(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function ensureBarrierShell() {
  if (document.querySelector("#barrierWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab barrier-tab";
  button.dataset.market = "barrier";
  button.textContent = "BARRIER 🛡️";
  if (note) tabs.insertBefore(button, note); else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "barrierWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="barrier-shell">
      <header class="barrier-head">
        <div>
          <p class="barrier-eyebrow">V1.0.5 · Sequential Lock Barrier</p>
          <h1>Source boleh maju hanya dengan bukti lock.</h1>
          <p>Setiap cron melakukan preflight source, menjalankan ordered pipeline, lalu memverifikasi result → lock → observer. Source jump dicatat sebagai gap dan tidak pernah ditutup dengan hindsight.</p>
        </div>
        <div class="barrier-badges"><span>1M SERVER CRON</span><span>NO HINDSIGHT</span><span>FULL CHAIN VERIFY</span></div>
      </header>
      <div class="barrier-toolbar"><span id="barrierStatus">Memuat barrier…</span><div><button id="barrierRefresh" type="button">REFRESH</button><button id="barrierRun" type="button">RUN MANUAL CHECK</button></div></div>
      <section id="barrierOverview" class="barrier-overview"></section>
      <section id="barrierLanes" class="barrier-lanes"></section>
      <section class="barrier-block"><div class="barrier-block-head"><div><small>GAP LEDGER</small><h2>Unrecoverable forward gaps sejak V1.0.5</h2></div><strong id="barrierGapCount">0</strong></div><div id="barrierGaps" class="barrier-table-wrap"></div></section>
      <section class="barrier-block"><div class="barrier-block-head"><div><small>SCHEDULED EVIDENCE</small><h2>Recent sequential cycles</h2></div></div><div id="barrierCycles" class="barrier-table-wrap"></div></section>
      <section class="barrier-guard"><strong>Guardrail.</strong> Manual check tidak dihitung sebagai bukti scheduled automation. Kalau source meloncat, period yang actual-nya sudah diketahui tetap gap; sistem hanya boleh mengunci latest untuk draw berikutnya yang belum diketahui.</section>
    </section>`;

  const continuity = document.querySelector("#continuityWorkspace");
  (continuity?.parentNode || utama.parentNode).insertBefore(workspace, continuity?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchBarrier(true));
  workspace.querySelector("#barrierRefresh")?.addEventListener("click", () => loadBarrier(true));
  workspace.querySelector("#barrierRun")?.addEventListener("click", runManualBarrier);
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-market]");
    if (target && target.dataset.market !== "barrier") switchBarrier(false, true);
  });
  return true;
}

function switchBarrier(active, preserveTabs = false) {
  const workspace = document.querySelector("#barrierWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace", "#captureIntegrityWorkspace", "#recoveryWorkspace", "#watchdogWorkspace", "#intelligenceWorkspace", "#continuityWorkspace"]) {
      const node = document.querySelector(selector); if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active", "capture-integrity-active", "recovery-active", "watchdog-active", "intelligence-active", "continuity-active");
    document.body.classList.add("barrier-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "barrier"));
    if (!barrierLoaded) loadBarrier(false);
  } else {
    document.body.classList.remove("barrier-active");
    if (!preserveTabs) { const node = document.querySelector("#utamaWorkspace"); if (node) node.hidden = false; }
  }
}

function statusClass(value) {
  if (value === "HEALTHY") return "healthy";
  if (value === "ARMING" || value === "PROCESSING") return "arming";
  return "bad";
}

function chainText(source, lane) {
  if (source === "utama") return `Result ${lane.resultPeriod ?? "—"} → Keeper ${lane.keeperAnchor ?? "—"} → Arena ${lane.arenaAnchor ?? "—"} → TwoStage ${lane.twoStageAnchor ?? "—"} → Observer ${lane.observerAnchor ?? "—"}`;
  return `Result ${lane.resultPeriod ?? "—"} → Forward ${lane.forwardAnchor ?? "—"} → Observer ${lane.observerAnchor ?? "—"}`;
}

function renderLane(source, title, lane) {
  const chain = lane?.chain || {};
  const missing = Array.isArray(chain.missing) && chain.missing.length ? chain.missing.join(" · ") : "none";
  return `<article class="barrier-lane ${chain.ok ? "healthy" : "bad"}">
    <div><small>${escB(title)}</small><h2>${chain.ok ? "CHAIN ALIGNED" : "CHAIN INCOMPLETE"}</h2></div>
    <p>${escB(chainText(source, lane || {}))}</p>
    <div class="barrier-lane-meta"><span>Reason <b>${escB(chain.reason || "—")}</b></span><span>Missing <b>${escB(missing)}</b></span></div>
  </article>`;
}

function renderBarrier(data) {
  barrierLoaded = true;
  const status = data.status || "—";
  const overview = document.querySelector("#barrierOverview");
  if (overview) overview.innerHTML = `
    <div class="barrier-verdict ${statusClass(status)}"><small>SERVER BARRIER STATUS</small><strong>${escB(status)}</strong><span>start ${escB(data.startedAt || "—")}</span></div>
    <div><small>SCHEDULED CYCLES</small><strong>${escB(data.scheduledCycles ?? 0)}</strong><span>clean streak ${escB(data.cleanCycleStreak ?? 0)}</span></div>
    <div><small>DRAW TRANSITIONS</small><strong>${escB(data.drawTransitionPasses ?? 0)} / ${escB(data.drawTransitionsObserved ?? 0)}</strong><span>${pct(data.drawTransitionPassRatePct)} pass</span></div>
    <div><small>GAPS SINCE START</small><strong>${escB(data.gapCountSinceStart ?? 0)}</strong><span>never reconstructed</span></div>`;

  const lanes = document.querySelector("#barrierLanes");
  if (lanes) lanes.innerHTML = `${renderLane("utama", "3D UTAMA", data.current?.utama || {})}${renderLane("europe", "EUROPE", data.current?.europe || {})}`;

  const gapCount = document.querySelector("#barrierGapCount");
  if (gapCount) gapCount.textContent = String(data.gapCountSinceStart ?? 0);
  const gaps = data.gaps || [];
  const gapsNode = document.querySelector("#barrierGaps");
  if (gapsNode) gapsNode.innerHTML = gaps.length ? `<table><thead><tr><th>Source</th><th>Anchor</th><th>Detected</th><th>Reason</th><th>DB before</th><th>Source seen</th></tr></thead><tbody>${gaps.map((row) => `<tr><td>${escB(row.source)}</td><td>${escB(row.anchor_period)}</td><td>${escB(row.detected_at)}</td><td>${escB(row.reason)}</td><td>${escB(row.db_before_period)}</td><td>${escB(row.source_seen_period)}</td></tr>`).join("")}</tbody></table>` : '<div class="barrier-empty">Belum ada gap V1.0.5. Bagus—biarkan server membuktikannya lintas draw.</div>';

  const cycles = (data.recentCycles || []).filter((row) => row.trigger === "scheduled");
  const cyclesNode = document.querySelector("#barrierCycles");
  if (cyclesNode) cyclesNode.innerHTML = cycles.length ? `<table><thead><tr><th>Time</th><th>Status</th><th>UTAMA</th><th>Europe</th><th>Pass</th><th>Fail</th><th>Gaps</th></tr></thead><tbody>${cycles.map((row) => `<tr><td>${escB(row.started_at)}</td><td><span class="barrier-pill ${statusClass(row.status)}">${escB(row.status)}</span></td><td>${escB(row.utama_db_before)} → ${escB(row.utama_source_seen)} → ${escB(row.utama_db_after)}</td><td>${escB(row.europe_db_before)} → ${escB(row.europe_source_seen)} → ${escB(row.europe_db_after)}</td><td>${escB(row.transition_pass_count)}</td><td>${escB(row.transition_fail_count)}</td><td>${escB(row.gap_count)}</td></tr>`).join("")}</tbody></table>` : '<div class="barrier-empty">Menunggu scheduled cycle pertama V1.0.5.</div>';

  const text = document.querySelector("#barrierStatus");
  if (text) text.textContent = `Barrier ${status} · transition ${data.drawTransitionPasses ?? 0}/${data.drawTransitionsObserved ?? 0} · gap ${data.gapCountSinceStart ?? 0}.`;
}

async function loadBarrier(showStatus = true) {
  if (barrierLoading) return;
  barrierLoading = true;
  const status = document.querySelector("#barrierStatus");
  const button = document.querySelector("#barrierRefresh");
  if (button) button.disabled = true;
  if (showStatus && status) status.textContent = "Membaca sequential lock evidence…";
  try {
    const response = await barrierFetch("/api/sequential-barrier", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Barrier status gagal (${response.status})`);
    renderBarrier(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Barrier status gagal.";
  } finally {
    if (button) button.disabled = false;
    barrierLoading = false;
  }
}

async function runManualBarrier() {
  const status = document.querySelector("#barrierStatus");
  const button = document.querySelector("#barrierRun");
  if (button) button.disabled = true;
  if (status) status.textContent = "Manual check berjalan · tidak dihitung sebagai bukti scheduled…";
  try {
    const response = await barrierFetch("/api/sequential-barrier/run", { method: "POST", headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && !data.status) throw new Error(data.error || `Manual barrier gagal (${response.status})`);
    await loadBarrier(false);
  } catch (error) {
    if (status) status.textContent = error?.message || "Manual barrier gagal.";
  } finally {
    if (button) button.disabled = false;
  }
}

function initBarrier() {
  if (!ensureBarrierShell()) { setTimeout(initBarrier, 120); return; }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initBarrier, { once: true });
else initBarrier();
