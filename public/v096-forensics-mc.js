const FORENSICS_MC_UI_VERSION = "0.9.6";
const mcFetch = window.fetch.bind(window);
let mcMounted = false;
let mcRunning = false;

function escMc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtMc(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) > 0 && Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toFixed(digits);
}

function pMc(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 0.001) return n.toExponential(2);
  return n.toFixed(4);
}

function ensureMcStyles() {
  if (document.querySelector("#forensicsMcStyles")) return;
  const style = document.createElement("style");
  style.id = "forensicsMcStyles";
  style.textContent = `
    .forensics-mc-summary{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(120px,.55fr));border:1px solid rgba(148,163,184,.12);border-radius:14px;overflow:hidden;margin-top:12px}
    .forensics-mc-summary>div{padding:13px 14px;min-width:0}.forensics-mc-summary>div+div{border-left:1px solid rgba(148,163,184,.09)}
    .forensics-mc-summary span{display:block;font-size:7px;color:#61728d;text-transform:uppercase;letter-spacing:.08em}.forensics-mc-summary strong{display:block;margin-top:5px;color:#dbeafe;font-size:12px}.forensics-mc-summary p{margin:5px 0 0;color:#71819c;font-size:8px;line-height:1.5}
    .forensics-mc-verdict.good{color:#86efac!important}.forensics-mc-verdict.warn{color:#fde68a!important}.forensics-mc-verdict.bad{color:#fda4af!important}
    .forensics-mc-table td strong{color:#dbeafe}.forensics-mc-table .mc-p.good{color:#86efac}.forensics-mc-table .mc-p.warn{color:#fde68a}.forensics-mc-table .mc-p.bad{color:#fda4af}
    .forensics-mc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.forensics-mc-select{min-height:30px;border:1px solid rgba(148,163,184,.16);border-radius:9px;background:#07101e;color:#cbd5e1;padding:0 9px;font:700 9px system-ui}.forensics-mc-run{min-height:30px;border:1px solid rgba(56,189,248,.25);border-radius:9px;background:rgba(14,165,233,.07);color:#bae6fd;padding:0 11px;font:850 9px system-ui;cursor:pointer}.forensics-mc-run:disabled{opacity:.5;cursor:wait}
    @media(max-width:780px){.forensics-mc-summary{grid-template-columns:1fr 1fr}.forensics-mc-summary>div:nth-child(3){border-left:0;border-top:1px solid rgba(148,163,184,.09)}.forensics-mc-summary>div:nth-child(4){border-top:1px solid rgba(148,163,184,.09)}}
  `;
  document.head.appendChild(style);
}

function mcPClass(value) {
  const p = Number(value);
  if (!Number.isFinite(p)) return "";
  if (p < 0.01) return "bad";
  if (p < 0.05) return "warn";
  return "good";
}

function mountMc() {
  if (mcMounted || document.querySelector("#forensicsMcSection")) return true;
  const workspace = document.querySelector("#forensicsWorkspace");
  const note = workspace?.querySelector(".forensics-note");
  if (!workspace || !note) return false;
  ensureMcStyles();

  const section = document.createElement("section");
  section.id = "forensicsMcSection";
  section.className = "forensics-section";
  section.innerHTML = `
    <div class="forensics-section-head">
      <div><h2>06 · Monte Carlo / Permutation Calibration · V1.1</h2><p>Randomisasi urutan draw yang sama untuk mengkalibrasi transition, serial lag, rolling drift, dan runs tanpa mengubah marginal dataset.</p></div>
      <div class="forensics-mc-actions"><select id="forensicsMcSims" class="forensics-mc-select" aria-label="Jumlah simulasi"><option value="500">500 sims</option><option value="1000" selected>1,000 sims</option><option value="2500">2,500 sims</option></select><button id="forensicsMcRun" class="forensics-mc-run" type="button">RUN MONTE CARLO</button></div>
    </div>
    <div class="forensics-mc-summary">
      <div><span>Calibrated verdict</span><strong id="mcVerdict" class="forensics-mc-verdict">BELUM DIJALANKAN</strong><p id="mcInterpretation">Permutation test mempertahankan draw yang sama tetapi mengacak urutannya, sehingga fokus pada struktur temporal.</p></div>
      <div><span>Simulations</span><strong id="mcSimCount">—</strong><p id="mcResolution">empirical p resolution —</p></div>
      <div><span>Dataset</span><strong id="mcDraws">—</strong><p id="mcPeriods">period —</p></div>
      <div><span>Runtime</span><strong id="mcElapsed">—</strong><p id="mcSeed">seed —</p></div>
    </div>
    <div class="forensics-table-wrap" style="margin-top:12px"><table class="forensics-table forensics-mc-table"><thead><tr><th>Calibrated statistic</th><th>Observed</th><th>Empirical p</th><th>Null mean</th><th>Null P95</th><th>Null P99</th></tr></thead><tbody id="mcBody"><tr><td colspan="6">Klik RUN MONTE CARLO. Audit ini manual dan tidak ikut polling AutoPilot.</td></tr></tbody></table></div>
    <div class="forensics-note" style="margin-top:12px"><strong>Null model:</strong> urutan 3D yang sudah terjadi diacak berulang kali. Ini mempertahankan exact observed draw multiset, distribusi digit, posisi, dan struktur di dalam satu draw, tetapi menghancurkan urutan temporal. Empirical p kecil berarti statistik temporal asli lebih ekstrem daripada mayoritas urutan acak dari data yang sama. Tetap bukan bukti mekanisme RNG server.</div>`;

  note.parentNode.insertBefore(section, note);
  section.querySelector("#forensicsMcRun")?.addEventListener("click", runMc);
  mcMounted = true;
  return true;
}

function metricRow(label, row, observedOverride = null) {
  const p = Number(row?.empiricalP);
  const observed = observedOverride == null ? row?.observed : observedOverride;
  return `<tr><td><strong>${escMc(label)}</strong></td><td>${escMc(fmtMc(observed))}</td><td class="mc-p ${mcPClass(p)}">${escMc(pMc(p))}</td><td>${escMc(fmtMc(row?.nullMean))}</td><td>${escMc(fmtMc(row?.nullP95))}</td><td>${escMc(fmtMc(row?.nullP99))}</td></tr>`;
}

function renderMc(data) {
  const verdict = document.querySelector("#mcVerdict");
  const interpretation = document.querySelector("#mcInterpretation");
  const simulation = data.simulation || {};
  const dataset = data.dataset || {};
  const calibration = data.calibration || {};
  if (verdict) {
    verdict.textContent = data.verdict?.label || "—";
    verdict.className = `forensics-mc-verdict ${data.verdict?.code === "NO_CALIBRATED_ANOMALY" ? "good" : data.verdict?.code === "STRONG_CALIBRATED_ANOMALY" ? "bad" : "warn"}`;
  }
  if (interpretation) interpretation.textContent = data.verdict?.interpretation || "—";
  const set = (id, text) => { const node = document.querySelector(id); if (node) node.textContent = text; };
  set("#mcSimCount", simulation.count == null ? "—" : Number(simulation.count).toLocaleString("id-ID"));
  set("#mcResolution", simulation.pResolution == null ? "empirical p resolution —" : `empirical p resolution ≈ ${pMc(simulation.pResolution)}`);
  set("#mcDraws", dataset.draws == null ? "—" : `${dataset.draws} draws`);
  set("#mcPeriods", `period ${dataset.firstPeriod ?? "—"} → ${dataset.lastPeriod ?? "—"}`);
  set("#mcElapsed", simulation.elapsedMs == null ? "—" : `${simulation.elapsedMs} ms`);
  set("#mcSeed", simulation.seed == null ? "seed —" : `seed ${simulation.seed} · reproducible`);

  const body = document.querySelector("#mcBody");
  if (body) body.innerHTML = [
    metricRow("Transition Cramér’s V", calibration.transitionCramersV),
    metricRow(`Max |serial r| lag 1–24${calibration.maxAbsSerialLag1To24?.observedLag ? ` · L${calibration.maxAbsSerialLag1To24.observedLag}` : ""}`, calibration.maxAbsSerialLag1To24),
    metricRow("Max rolling JSD · 50 draws", calibration.maxRollingJsdBits),
    metricRow("Runs |z|", calibration.runsAbsZ),
  ].join("");
}

async function runMc() {
  if (mcRunning) return;
  mcRunning = true;
  const button = document.querySelector("#forensicsMcRun");
  const select = document.querySelector("#forensicsMcSims");
  const sims = Math.max(100, Math.min(2500, Number(select?.value || 1000)));
  if (button) { button.disabled = true; button.textContent = `RUNNING ${sims.toLocaleString("id-ID")}…`; }
  const verdict = document.querySelector("#mcVerdict");
  if (verdict) { verdict.textContent = "MONTE CARLO RUNNING…"; verdict.className = "forensics-mc-verdict"; }
  try {
    const response = await mcFetch(`/api/forensics-mc?sims=${encodeURIComponent(sims)}`, { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Monte Carlo gagal (${response.status})`);
    renderMc(data);
  } catch (error) {
    if (verdict) { verdict.textContent = error?.message || "MONTE CARLO ERROR"; verdict.className = "forensics-mc-verdict bad"; }
  } finally {
    mcRunning = false;
    if (button) { button.disabled = false; button.textContent = "RUN MONTE CARLO"; }
  }
}

function initMc() {
  if (mountMc()) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mountMc() || tries > 80) clearInterval(timer);
  }, 250);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMc, { once: true });
else initMc();

console.debug(`Forensics Monte Carlo UI V${FORENSICS_MC_UI_VERSION} ready`);
