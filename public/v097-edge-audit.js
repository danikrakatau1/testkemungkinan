const EDGE_UI_VERSION = "0.9.7";
const EDGE_ACTIVE_KEY = "testkemungkinan-edge-active";
const edgeFetch = window.fetch.bind(window);
let edgeLoaded = false;
let edgeLoading = false;
let edgeTabsHooked = false;

function escE(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pctE(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

function numE(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function pE(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}

function verdictLabel(value) {
  const map = {
    COLLECT_MORE_FORWARD_DATA: "COLLECT MORE FORWARD DATA",
    NO_CALIBRATED_FORWARD_EDGE: "NO CALIBRATED FORWARD EDGE",
    EDGE_SIGNAL_REQUIRES_REPLICATION: "EDGE SIGNAL · REQUIRES REPLICATION",
    INSUFFICIENT_FORWARD_SAMPLE: "INSUFFICIENT SAMPLE",
    NO_CALIBRATED_EDGE: "NO CALIBRATED EDGE",
    POSSIBLE_EDGE_REPLICATE: "POSSIBLE EDGE · REPLICATE",
    CALIBRATED_EDGE_CANDIDATE: "CALIBRATED EDGE CANDIDATE",
  };
  return map[value] || String(value || "—").replaceAll("_", " ");
}

function verdictClass(value) {
  if (String(value).includes("CANDIDATE") || String(value).includes("POSSIBLE") || String(value).includes("REPLICATION")) return "warn";
  if (String(value).includes("NO_CALIBRATED")) return "clean";
  return "collect";
}

function ensureEdgeShell() {
  if (document.querySelector("#edgeWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab edge-tab";
  button.dataset.market = "edge";
  button.textContent = "EDGE AUDIT 📐";
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "edgeWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="edge-shell">
      <div class="edge-panel">
        <header class="edge-head">
          <div>
            <p class="edge-eyebrow">Forward Prediction Edge Audit · V1</p>
            <h1>Apakah model benar-benar mengalahkan chance?</h1>
            <p>Audit hanya memakai prediction lock yang sudah ada <b>sebelum result</b>. UTAMA dan EUROPE dikalibrasi terpisah. Tidak ada weight/model yang diubah.</p>
          </div>
          <div class="edge-badges"><span>READ ONLY</span><span>LOCKED BEFORE RESULT</span><span>NO MODEL WRITE</span></div>
        </header>

        <div class="edge-toolbar">
          <span id="edgeStatus">Memuat forward sample…</span>
          <div class="edge-actions">
            <select id="edgeSims" aria-label="Monte Carlo simulations"><option value="500">500 sims</option><option value="1000" selected>1,000 sims</option><option value="2500">2,500 sims</option></select>
            <button type="button" id="edgeRunBtn">RUN CALIBRATION</button>
          </div>
        </div>

        <section class="edge-overview">
          <div class="edge-overview-main"><small>Overall verdict</small><strong id="edgeVerdict">—</strong><p id="edgeVerdictNote">Belum ada edge claim sampai forward sample dan calibration cukup.</p></div>
          <div><span>Total settled locks</span><strong id="edgeTotal">—</strong></div>
          <div><span>UTAMA</span><strong id="edgeUtamaN">—</strong></div>
          <div><span>EUROPE</span><strong id="edgeEuropeN">—</strong></div>
        </section>

        <section id="edgeUtamaSection" class="edge-source"></section>
        <section id="edgeEuropeSection" class="edge-source"></section>

        <section class="edge-guardrail">
          <strong>Edge guardrail.</strong> Empirical p dihitung dengan mengacak actual result terhadap lock asli di source yang sama. Bonferroni dipakai untuk family metrics, dan sinyal tidak lolos bila metric terkuat tidak tetap di atas null mean pada dua separuh kronologis. <b>Hit streak bukan edge.</b>
        </section>
        <footer class="edge-footer"><span>Source: ai_v2_observations · settled + locked-before-result only · SELECT only</span><span id="edgeUpdated">V${EDGE_UI_VERSION}</span></footer>
      </div>
    </section>`;

  const forensics = document.querySelector("#forensicsWorkspace");
  (forensics?.parentNode || utama.parentNode).insertBefore(workspace, forensics?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchEdge(true));
  workspace.querySelector("#edgeRunBtn")?.addEventListener("click", () => loadEdge(true));
  hookEdgeTabs();
  return true;
}

function hookEdgeTabs() {
  const tabs = document.querySelector("#marketTabs");
  if (!tabs || edgeTabsHooked) return;
  edgeTabsHooked = true;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-market]");
    if (!button) return;
    if (button.dataset.market !== "edge") switchEdge(false, { preserveTabs: true });
  });
}

function switchEdge(active, options = {}) {
  const workspace = document.querySelector("#edgeWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    for (const selector of ["#utamaWorkspace", "#europeWorkspace", "#aiV2Workspace", "#forensicsWorkspace"]) {
      const node = document.querySelector(selector);
      if (node) node.hidden = true;
    }
    document.body.classList.remove("europe-active", "ai2-active", "forensics-active");
    document.body.classList.add("edge-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "edge"));
    try { localStorage.setItem(EDGE_ACTIVE_KEY, "1"); } catch {}
    if (!edgeLoaded) loadEdge(false);
  } else {
    document.body.classList.remove("edge-active");
    try { localStorage.removeItem(EDGE_ACTIVE_KEY); } catch {}
    if (!options.preserveTabs) {
      const utama = document.querySelector("#utamaWorkspace");
      if (utama) utama.hidden = false;
    }
  }
}

function metricCell(row, key, formatter) {
  const metric = row.metrics?.[key] || {};
  const observed = formatter(metric.observed);
  const nullMean = formatter(metric.nullMean);
  return `<td><strong>${observed}</strong><small>null ${nullMean} · p ${pE(metric.empiricalP)}</small></td>`;
}

function renderModelTable(source) {
  const models = source.models || [];
  if (!models.length) return `<div class="edge-empty">Belum ada model lock yang cukup lengkap di source ini.</div>`;
  return `<div class="edge-table-wrap"><table class="edge-table"><thead><tr><th>Model</th><th>N</th><th>Exact Top3</th><th>Top10</th><th>Permutation</th><th>Avg digit overlap</th><th>Avg position</th><th>Adj p</th><th>Status</th></tr></thead><tbody>${models.map((row) => `<tr>
    <td><strong>${escE(row.label)}</strong><small>${escE(row.id)}</small></td>
    <td>${escE(row.n)}</td>
    ${metricCell(row, "exactTop3Rate", pctE)}
    ${metricCell(row, "top10Rate", pctE)}
    ${metricCell(row, "permutationRate", pctE)}
    ${metricCell(row, "meanDigitOverlap", (v) => numE(v, 2))}
    ${metricCell(row, "meanPositionHits", (v) => numE(v, 2))}
    <td><strong>${pE(row.familyAdjustedP)}</strong><small>${row.replication ? `replicate ${row.replication.sameDirectionAboveNull ? "YES" : "NO"}` : "replicate —"}</small></td>
    <td><span class="edge-pill ${verdictClass(row.verdict)}">${escE(verdictLabel(row.verdict))}</span></td>
  </tr>`).join("")}</tbody></table></div>`;
}

function renderKeeper(row) {
  if (!row) return `<div class="edge-empty">Keeper7 lock belum tersedia.</div>`;
  const all3 = row.metrics?.all3Rate || {};
  const coverage = row.metrics?.meanCoverage || {};
  return `<div class="edge-keeper-grid">
    <div><span>N</span><strong>${escE(row.n)}</strong></div>
    <div><span>ALL3</span><strong>${pctE(all3.observed)}</strong><small>null ${pctE(all3.nullMean)} · p ${pE(all3.empiricalP)}</small></div>
    <div><span>Avg coverage</span><strong>${numE(coverage.observed, 2)}/3</strong><small>null ${numE(coverage.nullMean, 2)} · p ${pE(coverage.empiricalP)}</small></div>
    <div><span>Family adjusted p</span><strong>${pE(row.familyAdjustedP)}</strong><small>${row.replication ? `replicate ${row.replication.sameDirectionAboveNull ? "YES" : "NO"}` : "replicate —"}</small></div>
    <div><span>Verdict</span><strong class="edge-pill ${verdictClass(row.verdict)}">${escE(verdictLabel(row.verdict))}</strong></div>
  </div>`;
}

function renderSource(selector, title, source) {
  const node = document.querySelector(selector);
  if (!node) return;
  const gate = source.gate || {};
  node.innerHTML = `
    <div class="edge-source-head">
      <div><p>${escE(title)} · FORWARD ONLY</p><h2>${escE(verdictLabel(source.verdict))}</h2><span>Period anchor ${escE(source.firstAnchorPeriod ?? "—")} → ${escE(source.lastAnchorPeriod ?? "—")}</span></div>
      <div class="edge-gate"><small>CURRENT GATE</small><strong>${escE(gate.label || "—")}</strong><span>${escE(gate.note || "")}</span></div>
    </div>
    <h3>3D model calibration</h3>
    ${renderModelTable(source)}
    <h3>Keeper7 calibration</h3>
    ${renderKeeper(source.keeper7)}
    <div class="edge-family-note">Family metrics tested: ${escE(source.familySize || 0)} · edge candidates: ${escE((source.edgeCandidates || []).length)}</div>`;
}

function renderEdge(data) {
  edgeLoaded = true;
  const verdict = document.querySelector("#edgeVerdict");
  if (verdict) {
    verdict.textContent = verdictLabel(data.overallVerdict);
    verdict.className = verdictClass(data.overallVerdict);
  }
  const note = document.querySelector("#edgeVerdictNote");
  if (note) note.textContent = data.simulations
    ? `${data.simulations.toLocaleString("id-ID")} shuffle calibrations · empirical resolution ≈ ${data.empiricalResolution ?? "—"}.`
    : "Preview descriptive only. Jalankan calibration untuk empirical p-value.";
  const set = (id, value) => { const el = document.querySelector(id); if (el) el.textContent = value; };
  set("#edgeTotal", data.dataset?.totalSettledLockedObservations ?? 0);
  set("#edgeUtamaN", data.dataset?.utama ?? 0);
  set("#edgeEuropeN", data.dataset?.europe ?? 0);
  renderSource("#edgeUtamaSection", "3D UTAMA", data.bySource?.utama || {});
  renderSource("#edgeEuropeSection", "EUROPE", data.bySource?.europe || {});
  set("#edgeUpdated", `Update ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · V${EDGE_UI_VERSION}`);
}

async function loadEdge(calibrated) {
  if (edgeLoading) return;
  edgeLoading = true;
  const button = document.querySelector("#edgeRunBtn");
  const status = document.querySelector("#edgeStatus");
  if (button) button.disabled = true;
  const sims = calibrated ? Number(document.querySelector("#edgeSims")?.value || 1000) : 0;
  if (status) status.textContent = calibrated ? `Kalibrasi ${sims.toLocaleString("id-ID")} shuffle sedang berjalan…` : "Membaca settled forward locks…";
  try {
    const response = await edgeFetch(`/api/edge-audit?sims=${sims}`, { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Edge Audit gagal (${response.status})`);
    renderEdge(data);
    if (status) status.textContent = data.simulations
      ? `Calibration selesai · ${data.dataset?.totalSettledLockedObservations || 0} locked forward observations · ${data.simulations.toLocaleString("id-ID")} shuffles.`
      : `Preview · ${data.dataset?.totalSettledLockedObservations || 0} settled locked observations. Jalankan calibration untuk edge test.`;
  } catch (error) {
    if (status) status.textContent = error?.message || "Edge Audit gagal.";
  } finally {
    edgeLoading = false;
    if (button) button.disabled = false;
  }
}

function initEdgeAudit() {
  if (!ensureEdgeShell()) {
    setTimeout(initEdgeAudit, 120);
    return;
  }
  try {
    if (localStorage.getItem(EDGE_ACTIVE_KEY) === "1") switchEdge(true);
  } catch {}
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEdgeAudit, { once: true });
else initEdgeAudit();
