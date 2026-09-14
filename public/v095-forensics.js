const FORENSICS_UI_VERSION = "0.9.5";
const FORENSICS_ACTIVE_KEY = "testkemungkinan-forensics-active";
const forensicsFetch = window.fetch.bind(window);
let forensicsLoaded = false;
let forensicsLoading = false;
let forensicsTabsHooked = false;

function escF(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pFmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n < 0.000001) return "<1e-6";
  if (n < 0.001) return n.toExponential(2);
  return n.toFixed(4);
}

function num(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function pctF(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

function verdictClass(code) {
  if (code === "CONSISTENT_WITH_RANDOMNESS") return "good";
  if (code === "ANOMALY_DETECTED") return "warn";
  if (code === "STRONG_SERIAL_DEPENDENCE") return "bad";
  return "warn";
}

function ensureForensicsShell() {
  if (document.querySelector("#forensicsWorkspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const utama = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !utama) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab forensics-tab";
  button.dataset.market = "forensics";
  button.textContent = "FORENSICS 🧬";
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "forensicsWorkspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="forensics-shell">
      <div class="forensics-panel">
        <header class="forensics-head">
          <div>
            <p class="forensics-eyebrow">Randomness Forensics · UTAMA 3D</p>
            <h1 class="forensics-title">Read-Only Randomness Audit</h1>
            <p class="forensics-sub">Audit statistik terpisah dari prediction engine. Seluruh analisis membaca tabel <b>results_3d</b> saja dan tidak mengubah weight, lock, Keeper7, Adaptive, EUROPE, atau AI V2.</p>
          </div>
          <div class="forensics-badges"><span class="forensics-badge">READ ONLY</span><span class="forensics-badge">UTAMA ONLY</span><span class="forensics-badge">NO MODEL WRITE</span></div>
        </header>

        <div class="forensics-status"><span id="forensicsStatus">Menunggu audit…</span><button type="button" class="forensics-run" id="forensicsRunBtn">RUN AUDIT</button></div>

        <section class="forensics-verdict">
          <div class="forensics-verdict-main"><small>Overall forensic verdict</small><strong id="forensicsVerdict">—</strong><p id="forensicsVerdictNote">Tes statistik dapat mendeteksi penyimpangan dari IID/uniform, tetapi tidak dapat membuktikan RNG kriptografis hanya dari output.</p></div>
          <div class="forensics-metric"><span>Draws</span><strong id="forensicsDraws">—</strong></div>
          <div class="forensics-metric"><span>Period span</span><strong id="forensicsPeriods">—</strong></div>
          <div class="forensics-metric"><span>Reliable tests</span><strong id="forensicsReliable">—</strong></div>
        </section>

        <section class="forensics-section">
          <div class="forensics-section-head"><div><h2>01 · Distribution & Entropy</h2><p>Uniformity digit gabungan, per posisi, entropy, serta struktur digit kembar.</p></div><span id="forensicsDistributionSignal" class="forensics-signal">WAITING</span></div>
          <div class="forensics-grid">
            <div class="forensics-stat"><span>Overall uniformity</span><strong id="fUniformP">p —</strong><em id="fUniformChi">χ² —</em></div>
            <div class="forensics-stat"><span>Entropy</span><strong id="fEntropy">—</strong><em>maks 3.322 bit</em></div>
            <div class="forensics-stat"><span>Repeated digits</span><strong id="fRepeatP">p —</strong><em id="fRepeatCounts">—</em></div>
            <div class="forensics-stat"><span>Position min p</span><strong id="fPositionP">—</strong><em>3 posisi diuji terpisah</em></div>
          </div>
          <div class="forensics-table-wrap" style="margin-top:12px"><table class="forensics-table"><thead><tr><th>Position</th><th>0</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>p</th><th>Entropy</th></tr></thead><tbody id="fPositionBody"></tbody></table></div>
        </section>

        <section class="forensics-section">
          <div class="forensics-section-head"><div><h2>02 · Serial Dependence</h2><p>Autocorrelation lag 1–24, runs test, transition 10×10, dan bias-corrected mutual information.</p></div><span id="forensicsSerialSignal" class="forensics-signal">WAITING</span></div>
          <div class="forensics-grid">
            <div class="forensics-stat"><span>Strongest lag</span><strong id="fBestLag">—</strong><em id="fSerialP">Bonferroni p —</em></div>
            <div class="forensics-stat"><span>Runs test</span><strong id="fRuns">—</strong><em id="fRunsP">p —</em></div>
            <div class="forensics-stat"><span>Transition dependence</span><strong id="fTransitionV">—</strong><em id="fTransitionP">p —</em></div>
            <div class="forensics-stat"><span>Temporal MI</span><strong id="fTemporalMi">—</strong><em>bias-corrected bits</em></div>
          </div>
          <div id="fLagGrid" class="forensics-lags" style="margin-top:12px"></div>
          <div class="forensics-table-wrap" style="margin-top:12px"><table class="forensics-table forensics-matrix"><thead id="fTransitionHead"></thead><tbody id="fTransitionBody"></tbody></table></div>
        </section>

        <section class="forensics-section">
          <div class="forensics-section-head"><div><h2>03 · Repeat, Gap & Permutation</h2><p>Exact repeat berurutan, gap antar kemunculan digit, serta transition yang hanya merupakan permutation angka sebelumnya.</p></div></div>
          <div class="forensics-grid">
            <div class="forensics-stat"><span>Exact consecutive repeat</span><strong id="fExactRepeat">—</strong><em id="fExactRepeatP">expected —</em></div>
            <div class="forensics-stat"><span>Permutation transition</span><strong id="fPermutation">—</strong><em id="fPermutationP">expected —</em></div>
            <div class="forensics-stat"><span>Mean digit gap</span><strong id="fGapMean">—</strong><em>geometric uniform expectation ≈ 10</em></div>
            <div class="forensics-stat"><span>Maximum observed gap</span><strong id="fGapMax">—</strong><em id="fGapObs">— observations</em></div>
          </div>
        </section>

        <section class="forensics-section">
          <div class="forensics-section-head"><div><h2>04 · Time Bias</h2><p>Apakah komposisi digit berubah menurut jam draw atau weekday. Sparse-cell warning membuat hasil tidak dipakai sebagai bukti utama bila sampel per grup terlalu kecil.</p></div></div>
          <div class="forensics-grid">
            <div class="forensics-stat"><span>Hour-of-day</span><strong id="fHourP">p —</strong><em id="fHourV">V —</em></div>
            <div class="forensics-stat"><span>Hour sparse cells</span><strong id="fHourSparse">—</strong><em>ideal &lt;20%</em></div>
            <div class="forensics-stat"><span>Weekday</span><strong id="fWeekP">p —</strong><em id="fWeekV">V —</em></div>
            <div class="forensics-stat"><span>Weekday sparse cells</span><strong id="fWeekSparse">—</strong><em>ideal &lt;20%</em></div>
          </div>
        </section>

        <section class="forensics-section">
          <div class="forensics-section-head"><div><h2>05 · Rolling Drift</h2><p>Rolling 50 draw, step 10. Cari window yang distribusinya menyimpang dan ukur Jensen-Shannon divergence terhadap distribusi global.</p></div><span id="forensicsDriftSignal" class="forensics-signal">WAITING</span></div>
          <div class="forensics-grid">
            <div class="forensics-stat"><span>Min window p</span><strong id="fDriftMinP">—</strong><em id="fDriftAdjP">Bonferroni —</em></div>
            <div class="forensics-stat"><span>Max JSD</span><strong id="fDriftJsd">—</strong><em>bits</em></div>
            <div class="forensics-stat"><span>Window size</span><strong id="fDriftWindow">—</strong><em>draws</em></div>
            <div class="forensics-stat"><span>Windows tested</span><strong id="fDriftCount">—</strong><em>multiple testing corrected</em></div>
          </div>
          <div class="forensics-table-wrap" style="margin-top:12px"><table class="forensics-table"><thead><tr><th>Period range</th><th>χ²</th><th>raw p</th><th>JSD bits</th></tr></thead><tbody id="fDriftBody"></tbody></table></div>
        </section>

        <section class="forensics-note"><strong>Interpretation guardrail:</strong> “CONSISTENT WITH RANDOMNESS” berarti dataset belum menunjukkan penyimpangan statistik kuat dari model sederhana uniform/IID pada tes yang digunakan. Itu <b>bukan</b> bukti bahwa situs memakai true RNG, CSPRNG, seed tertentu, atau sistem provably-fair. Untuk membuktikan mekanisme generator diperlukan transparansi server/algoritma/audit yang tidak tersedia hanya dari histori result.</section>
        <footer class="forensics-footer"><span>Source: D1 results_3d · SELECT only · UTAMA</span><span id="forensicsUpdated">V${FORENSICS_UI_VERSION}</span></footer>
      </div>
    </section>`;

  const ai = document.querySelector("#aiV2Workspace");
  (ai?.parentNode || utama.parentNode).insertBefore(workspace, ai?.nextSibling || utama.nextSibling);
  button.addEventListener("click", () => switchForensics(true));
  workspace.querySelector("#forensicsRunBtn")?.addEventListener("click", () => loadForensics(true));
  hookTabs();
  return true;
}

function hookTabs() {
  const tabs = document.querySelector("#marketTabs");
  if (!tabs || forensicsTabsHooked) return;
  forensicsTabsHooked = true;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-market]");
    if (!button) return;
    if (button.dataset.market !== "forensics") switchForensics(false, { preserveTabs: true });
  });
}

function switchForensics(active, options = {}) {
  const workspace = document.querySelector("#forensicsWorkspace");
  if (!workspace) return;
  workspace.hidden = !active;
  if (active) {
    const utama = document.querySelector("#utamaWorkspace");
    const europe = document.querySelector("#europeWorkspace");
    const ai = document.querySelector("#aiV2Workspace");
    if (utama) utama.hidden = true;
    if (europe) europe.hidden = true;
    if (ai) ai.hidden = true;
    document.body.classList.remove("europe-active", "ai2-active");
    document.body.classList.add("forensics-active");
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "forensics"));
    try { localStorage.setItem(FORENSICS_ACTIVE_KEY, "1"); } catch {}
    if (!forensicsLoaded) loadForensics(false);
  } else {
    document.body.classList.remove("forensics-active");
    try { localStorage.removeItem(FORENSICS_ACTIVE_KEY); } catch {}
    if (!options.preserveTabs) {
      const utama = document.querySelector("#utamaWorkspace");
      if (utama) utama.hidden = false;
    }
  }
}

function setTextF(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = String(value ?? "—");
}

function signal(selector, text, alert = false) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = text;
  node.className = `forensics-signal ${alert ? "alert" : "clean"}`;
}

function renderPositions(tests) {
  const body = document.querySelector("#fPositionBody");
  if (!body) return;
  const labels = ["Hundreds", "Tens", "Units"];
  body.innerHTML = (tests.positionUniformity || []).map((row) => `<tr><td><strong>${labels[row.position] || row.position}</strong></td>${(row.counts || []).map((c) => `<td>${escF(c)}</td>`).join("")}<td class="forensics-p ${Number(row.p) < .01 ? "sig" : "ok"}">${pFmt(row.p)}</td><td>${pctF(row.entropyNormalized)}</td></tr>`).join("");
}

function renderLags(test) {
  const grid = document.querySelector("#fLagGrid");
  if (!grid) return;
  grid.innerHTML = (test.lags || []).map((row) => `<div class="forensics-lag"><span>L${escF(row.lag)}</span><strong>${Number(row.r) >= 0 ? "+" : ""}${num(row.r, 3)}</strong><span>p ${pFmt(row.p)}</span></div>`).join("");
}

function renderTransition(test) {
  const head = document.querySelector("#fTransitionHead");
  const body = document.querySelector("#fTransitionBody");
  if (!head || !body) return;
  head.innerHTML = `<tr><th>prev→next</th>${Array.from({ length: 10 }, (_, i) => `<th>${i}</th>`).join("")}</tr>`;
  body.innerHTML = (test.matrix || []).map((row, i) => `<tr><th>${i}</th>${row.map((v) => `<td>${escF(v)}</td>`).join("")}</tr>`).join("");
}

function renderDrift(test) {
  const body = document.querySelector("#fDriftBody");
  if (!body) return;
  const rows = [...(test.windows || [])].sort((a, b) => Number(a.p ?? 1) - Number(b.p ?? 1));
  body.innerHTML = rows.length ? rows.map((row) => `<tr><td><strong>${escF(row.startPeriod)} → ${escF(row.endPeriod)}</strong></td><td>${num(row.chi2, 2)}</td><td class="forensics-p ${Number(row.p) < .01 ? "sig" : ""}">${pFmt(row.p)}</td><td>${num(row.jsdBits, 4)}</td></tr>`).join("") : '<tr><td colspan="4">Belum cukup draw untuk rolling window.</td></tr>';
}

function renderForensics(data) {
  const tests = data.tests || {};
  const verdict = data.verdict || {};
  const dataset = data.dataset || {};
  forensicsLoaded = true;

  const verdictNode = document.querySelector("#forensicsVerdict");
  if (verdictNode) {
    verdictNode.textContent = verdict.label || "—";
    verdictNode.className = verdictClass(verdict.code);
  }
  setTextF("#forensicsVerdictNote", verdict.sampleNote || data.policy?.interpretation || "—");
  setTextF("#forensicsDraws", dataset.draws ?? "—");
  setTextF("#forensicsPeriods", dataset.firstPeriod != null ? `${dataset.firstPeriod} → ${dataset.lastPeriod}` : "—");
  setTextF("#forensicsReliable", verdict.reliableTests ?? "—");

  const uniform = tests.digitUniformity || {};
  setTextF("#fUniformP", `p ${pFmt(uniform.p)}`);
  setTextF("#fUniformChi", `χ² ${num(uniform.chi2, 2)} · df ${uniform.df ?? "—"}`);
  setTextF("#fEntropy", `${num(uniform.entropyBits, 3)} bit · ${pctF(uniform.entropyNormalized)}`);

  const repeat = tests.repeatedDigits || {};
  setTextF("#fRepeatP", `p ${pFmt(repeat.p)}`);
  setTextF("#fRepeatCounts", `unique ${repeat.observed?.unique ?? 0} · pair ${repeat.observed?.pair ?? 0} · triple ${repeat.observed?.triple ?? 0}`);
  const posP = (tests.positionUniformity || []).map((r) => Number(r.p)).filter(Number.isFinite);
  setTextF("#fPositionP", posP.length ? pFmt(Math.min(...posP)) : "—");
  renderPositions(tests);
  signal("#forensicsDistributionSignal", Number(uniform.p) < .01 || Number(repeat.p) < .01 || posP.some((p) => p < .0033) ? "SIGNAL" : "NO STRONG SIGNAL", Number(uniform.p) < .01 || Number(repeat.p) < .01 || posP.some((p) => p < .0033));

  const serial = tests.serialCorrelation || {};
  setTextF("#fBestLag", serial.bestLag ? `L${serial.bestLag.lag} · r ${serial.bestLag.r >= 0 ? "+" : ""}${num(serial.bestLag.r, 3)}` : "—");
  setTextF("#fSerialP", `Bonferroni p ${pFmt(serial.bonferroniP)}`);
  const runs = tests.runs || {};
  setTextF("#fRuns", `${runs.runs ?? "—"} runs · z ${num(runs.z, 2)}`);
  setTextF("#fRunsP", `p ${pFmt(runs.p)}`);
  const transition = tests.transition || {};
  setTextF("#fTransitionV", `V ${num(transition.cramersV, 3)}`);
  setTextF("#fTransitionP", `p ${pFmt(transition.p)} · sparse ${num(transition.sparseCellsPct, 1)}%`);
  const mi = tests.mutualInformation?.temporal || {};
  setTextF("#fTemporalMi", `${num(mi.biasCorrectedBits, 4)} bit`);
  renderLags(serial);
  renderTransition(transition);
  const serialAlert = (Number(serial.bonferroniP) < .01 && Math.abs(Number(serial.bestLag?.r || 0)) >= .12) || (Number(transition.p) < .01 && Number(transition.cramersV) >= .10 && Number(transition.sparseCellsPct) <= 20) || Number(runs.p) < .01;
  signal("#forensicsSerialSignal", serialAlert ? "DEPENDENCE SIGNAL" : "NO STRONG SERIAL SIGNAL", serialAlert);

  const exact = tests.exactRepeats || {};
  setTextF("#fExactRepeat", exact.consecutive ?? "—");
  setTextF("#fExactRepeatP", `expected ${num(exact.expected, 3)} · excess p ${pFmt(exact.excessP)}`);
  const perm = tests.permutationRate || {};
  setTextF("#fPermutation", perm.consecutive ?? "—");
  setTextF("#fPermutationP", `expected ${num(perm.expected, 3)} · excess p ${pFmt(perm.excessP)}`);
  const gap = tests.gapDistribution || {};
  setTextF("#fGapMean", num(gap.mean, 2));
  setTextF("#fGapMax", gap.maxGap ?? "—");
  setTextF("#fGapObs", `${gap.observations ?? 0} observations`);

  const hour = tests.hourBias || {};
  const week = tests.weekdayBias || {};
  setTextF("#fHourP", `p ${pFmt(hour.p)}`);
  setTextF("#fHourV", `Cramér V ${num(hour.cramersV, 3)}`);
  setTextF("#fHourSparse", `${num(hour.sparseCellsPct, 1)}%`);
  setTextF("#fWeekP", `p ${pFmt(week.p)}`);
  setTextF("#fWeekV", `Cramér V ${num(week.cramersV, 3)}`);
  setTextF("#fWeekSparse", `${num(week.sparseCellsPct, 1)}%`);

  const drift = tests.rollingDrift || {};
  setTextF("#fDriftMinP", pFmt(drift.minP));
  setTextF("#fDriftAdjP", `Bonferroni ${pFmt(drift.bonferroniP)}`);
  setTextF("#fDriftJsd", num(drift.maxJsdBits, 4));
  setTextF("#fDriftWindow", drift.windowSize ?? "—");
  setTextF("#fDriftCount", (drift.windows || []).length);
  renderDrift(drift);
  const driftAlert = Number(drift.bonferroniP) < .01;
  signal("#forensicsDriftSignal", driftAlert ? "ROLLING ANOMALY" : "NO STRONG DRIFT", driftAlert);

  const notable = (verdict.notableTests || []).map((t) => `${t.id} p=${pFmt(t.p)}`).join(" · ");
  const status = document.querySelector("#forensicsStatus");
  if (status) status.innerHTML = `<strong>Audit selesai.</strong> ${dataset.draws ?? 0} draw dianalisis${notable ? ` · notable: ${escF(notable)}` : " · tidak ada core-test p<0.01 yang reliable"}.`;
  setTextF("#forensicsUpdated", `Generated ${new Date(data.generatedAt || Date.now()).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · V${FORENSICS_UI_VERSION}`);
}

async function loadForensics(userTriggered) {
  if (forensicsLoading) return;
  forensicsLoading = true;
  const button = document.querySelector("#forensicsRunBtn");
  const status = document.querySelector("#forensicsStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = userTriggered ? "Menjalankan ulang audit read-only…" : "Menganalisis seluruh histori UTAMA di D1…";
  try {
    const response = await forensicsFetch("/api/forensics", { headers: { accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Forensics gagal (${response.status})`);
    renderForensics(data);
  } catch (error) {
    if (status) status.textContent = error?.message || "Randomness Forensics gagal dibaca.";
  } finally {
    if (button) button.disabled = false;
    forensicsLoading = false;
  }
}

function initForensics() {
  if (!ensureForensicsShell()) {
    setTimeout(initForensics, 80);
    return;
  }
  hookTabs();
  let active = false;
  try { active = localStorage.getItem(FORENSICS_ACTIVE_KEY) === "1"; } catch {}
  if (active) switchForensics(true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initForensics, { once: true });
else initForensics();
