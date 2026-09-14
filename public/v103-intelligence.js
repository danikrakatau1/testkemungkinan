const INTELLIGENCE_UI_VERSION = "1.0.3";
const intelligenceFetch = window.fetch.bind(window);
let intelligenceLoaded = false;
let intelligenceLoading = false;

function escI(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmt(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function scoreClass(score) {
  const n = Number(score || 0);
  if (n >= 70) return "high";
  if (n >= 40) return "mid";
  return "low";
}

function trendClass(trend) {
  if (trend === "IMPROVING") return "up";
  if (trend === "COOLING") return "down";
  return "flat";
}

function scoreBar(score) {
  const n = Math.max(0, Math.min(100, Number(score || 0)));
  return `<div class="intelligence-bar"><i style="width:${n}%"></i></div>`;
}

function ensureIntelligenceShell() {
  if (document.querySelector("#intelligenceWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab intelligence-tab";
  button.dataset.market = "intelligence";
  button.textContent = "INTELLIGENCE 🧠";
  if (note) tabs.insertBefore(button, note); else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "intelligenceWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="intelligence-shell">
      <header class="intelligence-head">
        <div>
          <p class="intelligence-eyebrow">V1.0.3 · Prediction Intelligence Score</p>
          <h1>Apakah model benar-benar makin pintar?</h1>
          <p>Skor 0–100 ini merangkum kualitas evidence tiap model: integrity, sample maturity, rolling lift vs null, dan stabilitas lintas window.</p>
        </div>
        <div class="intelligence-badges"><span>READ ONLY</span><span>FORWARD ONLY</span><span>NOT WIN PROBABILITY</span></div>
      </header>
      <div class="intelligence-toolbar"><span id="intelligenceStatus">Memuat score…</span><button id="intelligenceRefresh" type="button">REFRESH SCORE</button></div>
      <section class="intelligence-overview" id="intelligenceOverview"></section>
      <section class="intelligence-source" id="intelligenceUtama"></section>
      <section class="intelligence-source" id="intelligenceEurope"></section>
      <section class="intelligence-guard"><strong>Interpretation guardrail.</strong> Score 80 bukan berarti peluang menang 80%. Score tinggi hanya berarti evidence forward lebih matang, lift deskriptif lebih kuat, dan lebih stabil. Klaim edge statistik tetap wajib lolos EDGE AUDIT.</section>
    </section>`;

  const watchdog = document.querySelector("#watchdogWorkspace");
  (watchdog?.parentNode || utama.parentNode).insertBefore(workspace, watchdog?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchIntelligence(true));
  workspace.querySelector("#intelligenceRefresh")?.addEventListener("click", () => loadIntelligence(true));
  tabs.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-market]");
    if (target && target.dataset.market !== "intelligence") switchIntelligence(false, true);
  });
  return true;
}

function switchIntelligence(active, preserveTabs = false) {
  const workspace = document.querySelector("#intelligenceWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace", "#edgeWorkspace", "#evidenceWorkspace", "#labReviewWorkspace", "#captureIntegrityWorkspace", "#recoveryWorkspace", "#watchdogWorkspace"]) {
      const node = document.querySelector(selector); if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active", "edge-active", "evidence-active", "lab-review-active", "capture-integrity-active", "recovery-active", "watchdog-active");
    document.body.classList.add("intelligence-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "intelligence"));
    if (!intelligenceLoaded) loadIntelligence(false);
  } else {
    document.body.classList.remove("intelligence-active");
    if (!preserveTabs) { const node = document.querySelector("#utamaWorkspace"); if (node) node.hidden = false; }
  }
}

function renderOverview(data) {
  const global = data.global || {};
  const watchdog = data.watchdog || {};
  const best = global.bestCandidate;
  const node = document.querySelector("#intelligenceOverview");
  if (!node) return;
  node.innerHTML = `
    <div class="intelligence-main ${scoreClass(global.score)}"><small>GLOBAL FLEET SCORE</small><strong>${fmt(global.score, 1)}<em>/100</em></strong><h2>${escI(global.label || "—")}</h2>${scoreBar(global.score)}</div>
    <div><span>Current leader</span><strong>${best ? escI(best.label) : "—"}</strong><small>${best ? `${fmt(best.score)} / 100 · ${escI(best.trend)}` : "belum ada"}</small></div>
    <div><span>Server evidence</span><strong>${escI(watchdog.status || "—")}</strong><small>${escI(watchdog.scheduledCyclesLast60m ?? "—")} cron / 60m</small></div>
    <div><span>Score meaning</span><strong>DESCRIPTIVE</strong><small>bukan probability · bukan win chance</small></div>`;
}

function componentCell(label, value, max) {
  return `<div><span>${escI(label)}</span><strong>${fmt(value, 1)}<small> / ${max}</small></strong></div>`;
}

function renderSource(selector, title, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const candidates = source?.candidates || [];
  const rows = candidates.map((candidate, index) => {
    const c = candidate.components || {};
    return `<tr>
      <td><div class="intelligence-rank">#${index + 1}</div></td>
      <td><strong>${escI(candidate.label)}</strong><small>${escI(candidate.kind)} · N ${escI(candidate.n)}</small></td>
      <td><div class="intelligence-score-cell ${scoreClass(candidate.score)}"><strong>${fmt(candidate.score)}</strong><small>/100</small>${scoreBar(candidate.score)}</div></td>
      <td><span class="intelligence-trend ${trendClass(candidate.trend)}">${escI(candidate.trend)}</span></td>
      <td>${fmt(c.integrity)} / 20</td>
      <td>${fmt(c.maturity)} / 25</td>
      <td>${fmt(c.rollingLift)} / 35</td>
      <td>${fmt(c.rollingStability)} / 20</td>
      <td><small>R10 ${fmt(candidate.rollingComposite?.[10], 2)} · R25 ${fmt(candidate.rollingComposite?.[25], 2)} · R50 ${fmt(candidate.rollingComposite?.[50], 2)}</small></td>
    </tr>`;
  }).join("") || '<tr><td colspan="9">Belum ada forward evidence yang cukup untuk score.</td></tr>';

  node.innerHTML = `
    <div class="intelligence-source-head"><div><small>${escI(title)}</small><h2>${fmt(source?.fleetScore)} / 100 · ${escI(source?.fleetLabel || "—")}</h2><p>${escI(source?.settled ?? 0)} settled · ${escI(source?.pending ?? 0)} pending · gate ${escI(source?.gate?.label || "—")}</p></div><div class="intelligence-source-health"><span>CAPTURE</span><strong>${source?.captureRatePct == null ? "—" : `${fmt(source.captureRatePct)}%`}</strong><small>${escI(source?.watchdogStatus || "—")} · chain ${source?.chainHealthy ? "ALIGNED" : "NOT ALIGNED"}</small></div></div>
    <div class="intelligence-table-wrap"><table class="intelligence-table"><thead><tr><th>#</th><th>Model</th><th>Score</th><th>Trend</th><th>Integrity</th><th>Maturity</th><th>Rolling lift</th><th>Stability</th><th>Window composite</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderIntelligence(data) {
  intelligenceLoaded = true;
  renderOverview(data);
  renderSource("#intelligenceUtama", "3D UTAMA", data.bySource?.utama || {});
  renderSource("#intelligenceEurope", "EUROPE", data.bySource?.europe || {});
  const status = document.querySelector("#intelligenceStatus");
  if (status) status.textContent = `Score selesai · global ${fmt(data.global?.score)} / 100 · ${data.global?.label || "—"}.`;
  const topBadge = [...document.querySelectorAll("body *")].find((node) => node.children.length === 0 && /V1\.0\.2\s*·\s*Continuous Watchdog/i.test(node.textContent || ""));
  if (topBadge) topBadge.textContent = "V1.0.3 · Intelligence Score · SAFE";
}

async function loadIntelligence(showStatus = true) {
  if (intelligenceLoading) return;
  intelligenceLoading = true;
  const button = document.querySelector("#intelligenceRefresh");
  const status = document.querySelector("#intelligenceStatus");
  if (button) button.disabled = true;
  if (showStatus && status) status.textContent = "Menghitung integrity + maturity + rolling lift + stability…";
  try {
    const response = await intelligenceFetch("/api/intelligence-score", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Intelligence score gagal (${response.status})`);
    renderIntelligence(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Intelligence score gagal.";
  } finally {
    if (button) button.disabled = false;
    intelligenceLoading = false;
  }
}

function initIntelligence() {
  if (!ensureIntelligenceShell()) { setTimeout(initIntelligence, 120); return; }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initIntelligence, { once: true });
else initIntelligence();
