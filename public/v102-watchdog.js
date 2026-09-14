const WATCHDOG_UI_VERSION = "1.0.2";
const watchdogFetch = window.fetch.bind(window);
const REFRESH_MS = 30_000;
let watchdogLoaded = false;
let watchdogLoading = false;
let watchdogTimer = null;

function escW(value) {
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

function fmtAgo(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return "—";
  if (n < 60) return `${Math.round(n)} dtk lalu`;
  return `${(n / 60).toFixed(1)} mnt lalu`;
}

function cls(status) {
  if (status === "HEALTHY") return "healthy";
  if (status === "DEGRADED") return "degraded";
  return "arming";
}

function label(status) {
  const map = {
    HEALTHY: "SERVER AUTO HEALTHY",
    DEGRADED: "SERVER AUTO DEGRADED",
    ARMING: "ARMING SERVER WATCHDOG",
    NOT_STARTED: "WAITING FIRST SERVER CRON",
  };
  return map[status] || String(status || "UNKNOWN").replaceAll("_", " ");
}

function ensureWatchdogShell() {
  if (document.querySelector("#watchdogWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab watchdog-tab";
  button.dataset.market = "watchdog";
  button.textContent = "WATCHDOG 🛰️";
  if (note) tabs.insertBefore(button, note); else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "watchdogWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="watchdog-shell">
      <header class="watchdog-head">
        <div>
          <p class="watchdog-eyebrow">V1.0.2 · Continuous Draw Watchdog</p>
          <h1>Apakah server tetap bekerja saat browser ditutup?</h1>
          <p>Cron server 1 menit adalah authority utama. Setiap invocation dicatat, lalu pipeline wajib menyelesaikan source → lock → observer. Browser hanya fallback.</p>
        </div>
        <div class="watchdog-badges"><span>1M SERVER CRON</span><span>HEARTBEAT PERSISTED</span><span>NO HINDSIGHT</span></div>
      </header>
      <div class="watchdog-toolbar"><span id="watchdogStatusText">Memuat heartbeat server…</span><div><button id="watchdogRefresh" type="button">REFRESH</button><button id="watchdogRun" type="button">RUN MANUAL CYCLE</button></div></div>
      <section class="watchdog-overview">
        <div class="watchdog-main"><small>SERVER AUTO STATUS</small><strong id="watchdogVerdict">—</strong><p id="watchdogVerdictNote">Manual cycle tidak dihitung sebagai bukti cron server.</p></div>
        <div><span>Last server cron</span><strong id="watchdogLastCron">—</strong><small id="watchdogLastCronAgo">—</small></div>
        <div><span>Scheduled / 60m</span><strong id="watchdog60m">—</strong><small>target ≈ 60 saat window penuh</small></div>
        <div><span>Max heartbeat gap</span><strong id="watchdogMaxGap">—</strong><small>degraded jika > 180 dtk</small></div>
      </section>
      <section class="watchdog-sources"><div id="watchdogUtama"></div><div id="watchdogEurope"></div></section>
      <section class="watchdog-section"><div class="watchdog-section-head"><div><small>RECENT SERVER HEARTBEATS</small><h2>Scheduled cron evidence</h2></div><span>browser/manual dipisahkan</span></div><div class="watchdog-table-wrap"><table class="watchdog-table"><thead><tr><th>Time</th><th>Status</th><th>Gap</th><th>UTAMA</th><th>EUROPE</th></tr></thead><tbody id="watchdogRecent"></tbody></table></div></section>
      <section class="watchdog-section"><div class="watchdog-section-head"><div><small>LONG-TERM ROLLUP</small><h2>Daily server health</h2></div><span>raw heartbeat 7 hari · daily rollup jangka panjang</span></div><div class="watchdog-table-wrap"><table class="watchdog-table"><thead><tr><th>Date</th><th>Scheduled</th><th>Healthy</th><th>Degraded</th><th>Error</th><th>Max gap</th></tr></thead><tbody id="watchdogDaily"></tbody></table></div></section>
      <section class="watchdog-guard"><strong>Watchdog guardrail.</strong> Gap lama sebelum V1.0.2 tidak dihapus. Window V1.0.2 berdiri sendiri untuk membuktikan server-only automation. Jika cron hilang, source lompat period, current lock tidak terbentuk, atau Observer miss, status berubah menjadi DEGRADED.</section>
    </section>`;

  const recovery = document.querySelector("#recoveryWorkspace");
  (recovery?.parentNode || utama.parentNode).insertBefore(workspace, recovery?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchWatchdog(true));
  workspace.querySelector("#watchdogRefresh")?.addEventListener("click", () => loadWatchdog(true));
  workspace.querySelector("#watchdogRun")?.addEventListener("click", () => runManualCycle());
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-market]");
    if (target && target.dataset.market !== "watchdog") switchWatchdog(false, true);
  });
  return true;
}

function switchWatchdog(active, preserveTabs = false) {
  const workspace = document.querySelector("#watchdogWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace", "#captureIntegrityWorkspace", "#recoveryWorkspace"]) {
      const node = document.querySelector(selector); if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active", "capture-integrity-active", "recovery-active");
    document.body.classList.add("watchdog-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "watchdog"));
    if (!watchdogLoaded) loadWatchdog(false);
    startWatchdogTimer();
  } else {
    document.body.classList.remove("watchdog-active");
    stopWatchdogTimer();
    if (!preserveTabs) { const node = document.querySelector("#utamaWorkspace"); if (node) node.hidden = false; }
  }
}

function startWatchdogTimer() {
  stopWatchdogTimer();
  watchdogTimer = setInterval(() => {
    if (!document.hidden && !document.querySelector("#watchdogWorkspace")?.hidden) loadWatchdog(false);
  }, REFRESH_MS);
}

function stopWatchdogTimer() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

function sourceCard(title, source, current, chain) {
  const rate = source?.captureRatePct == null ? "—" : `${Number(source.captureRatePct).toFixed(1)}%`;
  return `
    <article class="watchdog-source ${cls(source?.status)}">
      <div class="watchdog-source-head"><div><small>${escW(title)} · ${escW(source?.cadenceMinutes ?? "—")} MIN</small><h2>${escW(label(source?.status))}</h2></div><strong>${rate}</strong></div>
      <div class="watchdog-chain"><span>Result <b>${escW(current?.resultPeriod ?? "—")}</b></span><i>→</i><span>Lock <b>${escW(current?.lockAnchor ?? "—")}</b></span><i>→</i><span>Observer <b>${escW(current?.observerAnchor ?? "—")}</b></span></div>
      <div class="watchdog-grid"><div><span>Eligible</span><strong>${escW(source?.eligibleLocks ?? 0)}</strong></div><div><span>Captured</span><strong>${escW(source?.capturedLocks ?? 0)}</strong></div><div><span>Settled / Pending</span><strong>${escW(source?.settled ?? 0)} / ${escW(source?.pending ?? 0)}</strong></div><div><span>Chain</span><strong>${chain?.healthy ? "ALIGNED" : escW(chain?.reason || "—")}</strong></div></div>
      <div class="watchdog-detail"><span>Missing observer: <b>${(source?.missingObserverAnchors || []).length ? escW(source.missingObserverAnchors.join(" · ")) : "none"}</b></span><span>Missing lock periods: <b>${(source?.missingLockPeriods || []).length ? escW(source.missingLockPeriods.join(" · ")) : "none"}</b></span><span>Cadence shortfall: <b>${escW(source?.cadenceShortfallEstimate ?? 0)}</b></span></div>
    </article>`;
}

function renderWatchdog(data) {
  watchdogLoaded = true;
  const verdict = document.querySelector("#watchdogVerdict");
  if (verdict) { verdict.textContent = label(data.status); verdict.className = cls(data.status); }
  const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = String(value ?? "—"); };
  set("#watchdogStatusText", `${label(data.status)} · cron server ${data.cron?.expectedEveryMinutes || 1} menit · browser fallback only.`);
  set("#watchdogLastCron", data.cron?.lastScheduledStatus || "—");
  set("#watchdogLastCronAgo", `${fmtDate(data.cron?.lastScheduledAt)} · ${fmtAgo(data.cron?.secondsSinceLast)}`);
  set("#watchdog60m", data.cron?.scheduledCyclesLast60m ?? 0);
  set("#watchdogMaxGap", data.cron?.maxHeartbeatGapSecondsLast60m == null ? "—" : `${Number(data.cron.maxHeartbeatGapSecondsLast60m).toFixed(0)}s`);
  const u = document.querySelector("#watchdogUtama"); if (u) u.innerHTML = sourceCard("3D UTAMA", data.bySource?.utama, data.current?.utama, data.currentChain?.utama);
  const e = document.querySelector("#watchdogEurope"); if (e) e.innerHTML = sourceCard("EUROPE", data.bySource?.europe, data.current?.europe, data.currentChain?.europe);

  const recent = document.querySelector("#watchdogRecent");
  if (recent) recent.innerHTML = (data.cron?.recent || []).map((row) => `<tr><td>${escW(fmtDate(row.started_at))}</td><td><span class="watchdog-pill ${cls(row.status)}">${escW(row.status)}</span></td><td>${row.heartbeat_gap_seconds == null ? "—" : `${escW(Number(row.heartbeat_gap_seconds).toFixed(0))}s`}</td><td>${escW(row.utama_result_period ?? "—")} → ${escW(row.utama_lock_anchor ?? "—")} → ${escW(row.utama_observer_anchor ?? "—")}</td><td>${escW(row.europe_result_period ?? "—")} → ${escW(row.europe_lock_anchor ?? "—")} → ${escW(row.europe_observer_anchor ?? "—")}</td></tr>`).join("") || '<tr><td colspan="5">Belum ada scheduled heartbeat.</td></tr>';

  const daily = document.querySelector("#watchdogDaily");
  if (daily) daily.innerHTML = (data.daily || []).map((row) => `<tr><td>${escW(row.date_key)}</td><td>${escW(row.scheduled_count)}</td><td>${escW(row.healthy_count)}</td><td>${escW(row.degraded_count)}</td><td>${escW(row.error_count)}</td><td>${escW(Number(row.max_gap_seconds || 0).toFixed(0))}s</td></tr>`).join("") || '<tr><td colspan="6">Daily rollup belum tersedia.</td></tr>';

  const topBadge = [...document.querySelectorAll("body *")].find((node) => node.children.length === 0 && /V0\.9\.3\s*·\s*AutoPilot/i.test(node.textContent || ""));
  if (topBadge) topBadge.textContent = "V1.0.2 · Continuous Watchdog · SAFE";
}

async function loadWatchdog(showStatus = true) {
  if (watchdogLoading) return;
  watchdogLoading = true;
  const status = document.querySelector("#watchdogStatusText");
  if (showStatus && status) status.textContent = "Membaca server heartbeat dan chain integrity…";
  try {
    const response = await watchdogFetch("/api/watchdog", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Watchdog gagal (${response.status})`);
    renderWatchdog(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Watchdog gagal.";
  } finally {
    watchdogLoading = false;
  }
}

async function runManualCycle() {
  if (watchdogLoading) return;
  watchdogLoading = true;
  const button = document.querySelector("#watchdogRun");
  const status = document.querySelector("#watchdogStatusText");
  if (button) button.disabled = true;
  if (status) status.textContent = "Manual watchdog cycle berjalan. Ini TIDAK dihitung sebagai bukti scheduled cron…";
  try {
    const response = await watchdogFetch("/api/watchdog/run", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Manual watchdog cycle gagal (${response.status})`);
  } catch (error) {
    if (status) status.textContent = error?.message || "Manual watchdog cycle gagal.";
  } finally {
    watchdogLoading = false;
    if (button) button.disabled = false;
    await loadWatchdog(false);
  }
}

function initWatchdog() {
  if (!ensureWatchdogShell()) { setTimeout(initWatchdog, 120); return; }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initWatchdog, { once: true });
else initWatchdog();
