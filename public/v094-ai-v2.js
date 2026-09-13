const AI2_UI_VERSION = "0.9.4";
const AI2_ACTIVE_KEY = "testkemungkinan-ai-v2-active";
const AI2_HISTORY_LIMIT_KEY = "testkemungkinan-ai-v2-history-limit";
const ai2Fetch = window.fetch.bind(window);
let ai2Timer = null;
let ai2Syncing = false;
let ai2HistoryData = { utama: [], europe: [] };
let ai2HistoryLimit = "10";

function ai2Esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function ai2Time(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ai2Esc(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ai2SourceLabel(source) {
  return source === "europe" ? "EUROPE" : "UTAMA";
}

function ai2CreateShell() {
  if (document.querySelector("#aiV2Workspace")) return true;
  const tabs = document.querySelector("#marketTabs");
  const main = document.querySelector("#utamaWorkspace") || document.querySelector("main");
  if (!tabs || !main) return false;

  const note = tabs.querySelector(".market-tab-note");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "market-tab ai2-tab";
  button.dataset.market = "ai-v2";
  button.innerHTML = 'AI V2 <span aria-hidden="true">🧪</span>';
  if (note) tabs.insertBefore(button, note);
  else tabs.appendChild(button);

  const workspace = document.createElement("main");
  workspace.id = "aiV2Workspace";
  workspace.hidden = true;
  workspace.innerHTML = `
    <section class="ai2-shell">
      <header class="ai2-head">
        <div>
          <p class="ai2-eyebrow">AI V2 · Phase 0</p>
          <h1>Observer Laboratory</h1>
          <p class="ai2-sub">AI V2 belum membuat prediksi. Ia hanya merekam lock forward V1 yang masih pending, lalu memasangkan hasil aktual setelah settlement. V1 UTAMA dan EUROPE tetap menjadi control group dan tidak ditulis ulang.</p>
        </div>
        <div class="ai2-badges">
          <span class="ai2-badge observer">OBSERVER</span>
          <span class="ai2-badge">NO AI PREDICTION</span>
          <span class="ai2-badge">FORWARD ONLY</span>
        </div>
      </header>

      <div class="ai2-statusbar">
        <span id="ai2StatusText">Memuat AI V2 Phase 0…</span>
        <button type="button" id="ai2SyncBtn">SNAPSHOT NOW</button>
      </div>

      <section class="ai2-metrics" aria-label="AI V2 observation metrics">
        <div><span>Total observations</span><strong id="ai2Total">0</strong></div>
        <div><span>Settled forward</span><strong id="ai2Settled">0</strong></div>
        <div><span>Pending</span><strong id="ai2Pending">0</strong></div>
        <div><span>Current gate</span><strong id="ai2Gate">COLLECT</strong></div>
      </section>

      <section class="ai2-section">
        <div class="ai2-section-head">
          <div><h2>Source isolation</h2><p>UTAMA dan EUROPE direkam terpisah. Observer hanya membaca output V1; tidak ada weight AI dan tidak ada kandidat angka AI pada fase ini.</p></div>
        </div>
        <div class="ai2-source-grid">
          <article>
            <div class="ai2-source-name">3D UTAMA</div>
            <div class="ai2-source-count" id="ai2UtamaTotal">0</div>
            <div class="ai2-source-meta"><span id="ai2UtamaSettled">0 settled</span><span id="ai2UtamaPending">0 pending</span></div>
          </article>
          <article>
            <div class="ai2-source-name">EUROPE</div>
            <div class="ai2-source-count" id="ai2EuropeTotal">0</div>
            <div class="ai2-source-meta"><span id="ai2EuropeSettled">0 settled</span><span id="ai2EuropePending">0 pending</span></div>
          </article>
        </div>
      </section>

      <section class="ai2-section ai2-history-section">
        <div class="ai2-section-head ai2-history-head">
          <div>
            <h2>Histori Result & Histori Tebakan</h2>
            <p><strong>ACTUAL RESULT</strong> dipisahkan dari <strong>LOCKED PREDICTION</strong>. Semua tebakan di bawah berasal dari lock asli yang sudah ada sebelum result keluar; prediksi lama tidak diregenerate.</p>
          </div>
          <div class="ai2-history-controls" aria-label="Jumlah histori">
            <button type="button" data-history-limit="10" class="active">10</button>
            <button type="button" data-history-limit="25">25</button>
            <button type="button" data-history-limit="50">50</button>
            <button type="button" data-history-limit="all">ALL</button>
          </div>
        </div>
        <div class="ai2-history-proof"><span>LOCKED BEFORE RESULT ✅</span><span>Forward-only evidence</span><span>No hindsight regeneration</span></div>

        <div class="ai2-history-group">
          <div class="ai2-history-title"><strong>3D UTAMA · 3 ANGKA</strong><span>Result asli vs Legacy / DigitBoost / Hybrid / Two-Stage / 3D Assist</span></div>
          <div class="ai2-table-wrap"><table class="ai2-table ai2-history-table ai2-3d-table">
            <thead><tr><th>Actual Result</th><th>Locked At</th><th>Legacy</th><th>DigitBoost</th><th>Hybrid</th><th>Two-Stage</th><th>3D Assist</th></tr></thead>
            <tbody id="ai2Utama3dHistory"><tr><td colspan="7">Belum ada settled history.</td></tr></tbody>
          </table></div>
        </div>

        <div class="ai2-history-group">
          <div class="ai2-history-title"><strong>3D UTAMA · KEEP7</strong><span>Result asli vs 7 digit yang benar-benar dikunci sebelum result</span></div>
          <div class="ai2-table-wrap"><table class="ai2-table ai2-history-table ai2-keeper-table">
            <thead><tr><th>Actual Result</th><th>Locked At</th><th>KEEP7</th><th>DROP3</th><th>Coverage</th><th>Verdict</th></tr></thead>
            <tbody id="ai2UtamaKeeperHistory"><tr><td colspan="6">Belum ada settled history.</td></tr></tbody>
          </table></div>
        </div>

        <div class="ai2-history-group">
          <div class="ai2-history-title"><strong>EUROPE · 3 ANGKA</strong><span>First Place actual vs lock 3D Europe sebelum draw</span></div>
          <div class="ai2-table-wrap"><table class="ai2-table ai2-history-table ai2-3d-table">
            <thead><tr><th>Actual Result</th><th>Locked At</th><th>Legacy</th><th>DigitBoost</th><th>Hybrid</th><th>Two-Stage</th><th>3D Assist</th></tr></thead>
            <tbody id="ai2Europe3dHistory"><tr><td colspan="7">Belum ada settled history.</td></tr></tbody>
          </table></div>
        </div>

        <div class="ai2-history-group">
          <div class="ai2-history-title"><strong>EUROPE · KEEP7</strong><span>First Place actual vs KEEP7/DROP3 Europe yang terkunci</span></div>
          <div class="ai2-table-wrap"><table class="ai2-table ai2-history-table ai2-keeper-table">
            <thead><tr><th>Actual Result</th><th>Locked At</th><th>KEEP7</th><th>DROP3</th><th>Coverage</th><th>Verdict</th></tr></thead>
            <tbody id="ai2EuropeKeeperHistory"><tr><td colspan="6">Belum ada settled history.</td></tr></tbody>
          </table></div>
        </div>
      </section>

      <section class="ai2-section">
        <div class="ai2-section-head">
          <div><h2>Phase 0 capture contract</h2><p id="ai2Started">Menunggu observer start…</p></div>
        </div>
        <div class="ai2-contract">
          <div><strong>01</strong><span>Snapshot hanya saat source lock masih <b>pending</b>.</span></div>
          <div><strong>02</strong><span>Legacy / DigitBoost / Hybrid / Two-Stage / Keeper7 / Adaptive disimpan sebagai feature evidence.</span></div>
          <div><strong>03</strong><span>Actual baru ditempel setelah settlement; historical settled locks tidak di-backfill sebagai training palsu.</span></div>
          <div><strong>04</strong><span>Setelah survei 24 jam, dataset diperiksa sebelum Meta-Learner diaktifkan.</span></div>
        </div>
      </section>

      <section class="ai2-section">
        <div class="ai2-section-head">
          <div><h2>Forward observation log</h2><p>Timeline mentah observer. Pending berarti result target belum ditempel; histori di atas hanya memakai row yang sudah settled.</p></div>
        </div>
        <div class="ai2-table-wrap">
          <table class="ai2-table">
            <thead><tr><th>Source</th><th>Anchor</th><th>Target</th><th>Captured</th><th>Status</th><th>Actual</th><th>Keeper</th></tr></thead>
            <tbody id="ai2LogBody"><tr><td colspan="7">Belum ada observation.</td></tr></tbody>
          </table>
        </div>
      </section>

      <footer class="ai2-footer">
        <span>V1 CONTROL = untouched · AI V2 = challenger laboratory</span>
        <span id="ai2Updated">V${AI2_UI_VERSION}</span>
      </footer>
    </section>`;

  const europe = document.querySelector("#europeWorkspace");
  (europe?.parentNode || main.parentNode).insertBefore(workspace, europe?.nextSibling || main.nextSibling);

  button.addEventListener("click", () => ai2Switch(true));
  tabs.querySelectorAll('[data-market="utama"], [data-market="europe"]').forEach((node) => {
    node.addEventListener("click", () => ai2Switch(false, { preserveTabs: true }));
  });
  workspace.querySelector("#ai2SyncBtn")?.addEventListener("click", () => ai2Sync(true));
  workspace.querySelectorAll("[data-history-limit]").forEach((node) => {
    node.addEventListener("click", () => ai2SetHistoryLimit(node.dataset.historyLimit));
  });
  return true;
}

function ai2Switch(active, options = {}) {
  const workspace = document.querySelector("#aiV2Workspace");
  const utama = document.querySelector("#utamaWorkspace");
  const europe = document.querySelector("#europeWorkspace");
  if (!workspace) return;

  workspace.hidden = !active;
  if (active) {
    if (utama) utama.hidden = true;
    if (europe) europe.hidden = true;
    document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "ai-v2"));
    document.body.classList.add("ai2-active");
    try { localStorage.setItem(AI2_ACTIVE_KEY, "1"); } catch {}
    ai2LoadAll();
  } else {
    document.body.classList.remove("ai2-active");
    try { localStorage.removeItem(AI2_ACTIVE_KEY); } catch {}
    if (!options.preserveTabs) {
      document.querySelectorAll("#marketTabs .market-tab").forEach((node) => node.classList.toggle("active", node.dataset.market === "utama"));
      if (utama) utama.hidden = false;
    }
  }
}

function ai2SetText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = String(value ?? "—");
}

function ai2Captured(row) {
  const captured = row?.captured || {};
  const labels = [];
  if (captured.arena) labels.push("Arena");
  if (captured.twoStage) labels.push("2S");
  if (captured.keeper7) labels.push("K7");
  if (captured.adaptive) labels.push("Adaptive");
  return labels.join(" · ") || "—";
}

function ai2KeeperSummary(row) {
  if (row.status !== "settled") return "—";
  const summary = row.resultSummary || {};
  if (summary.keeperCovered == null) return "—";
  return `${summary.keeperCovered}/3${summary.keeperAll3 ? " ALL3" : ""}`;
}

function ai2Render(data) {
  const counts = data.counts || {};
  const bySource = counts.bySource || {};
  const utama = bySource.utama || {};
  const europe = bySource.europe || {};

  ai2SetText("#ai2Total", counts.total || 0);
  ai2SetText("#ai2Settled", counts.settled || 0);
  ai2SetText("#ai2Pending", counts.pending || 0);
  ai2SetText("#ai2Gate", data.gates?.currentGate === "COLLECT_FORWARD_EVIDENCE" ? "COLLECT" : (data.gates?.currentGate || "—"));
  ai2SetText("#ai2UtamaTotal", utama.total || 0);
  ai2SetText("#ai2UtamaSettled", `${utama.settled || 0} settled`);
  ai2SetText("#ai2UtamaPending", `${utama.pending || 0} pending`);
  ai2SetText("#ai2EuropeTotal", europe.total || 0);
  ai2SetText("#ai2EuropeSettled", `${europe.settled || 0} settled`);
  ai2SetText("#ai2EuropePending", `${europe.pending || 0} pending`);
  ai2SetText("#ai2Started", data.startedAt ? `Observer mulai ${ai2Time(data.startedAt)} · target survei awal 24 jam · Meta-Learner masih OFF.` : "Observer belum memiliki start timestamp.");

  const status = document.querySelector("#ai2StatusText");
  if (status) status.innerHTML = `<strong>OBSERVER aktif.</strong> ${Number(counts.settled || 0)} settled forward tersimpan. AI prediction tetap <strong>OFF</strong>.`;

  const body = document.querySelector("#ai2LogBody");
  if (body) {
    const recent = Array.isArray(data.recent) ? data.recent : [];
    body.innerHTML = recent.length ? recent.map((row) => `
      <tr>
        <td><span class="ai2-source-pill ${row.source === "europe" ? "europe" : "utama"}">${ai2Esc(ai2SourceLabel(row.source))}</span></td>
        <td><b>${ai2Esc(row.anchorPeriod)}</b><small>${ai2Esc(row.anchorResult)}</small></td>
        <td><b>${ai2Esc(row.targetPeriod ?? "—")}</b><small>${ai2Esc(row.targetTime || "")}</small></td>
        <td>${ai2Esc(ai2Captured(row))}</td>
        <td><span class="ai2-state ${row.status === "settled" ? "settled" : "pending"}">${ai2Esc(row.status)}</span></td>
        <td class="ai2-mono">${ai2Esc(row.actualResult || "---")}</td>
        <td>${ai2Esc(ai2KeeperSummary(row))}</td>
      </tr>`).join("") : '<tr><td colspan="7">Belum ada observation forward. Tekan SNAPSHOT NOW saat lock V1 masih pending.</td></tr>';
  }

  ai2SetText("#ai2Updated", `Update ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · V${AI2_UI_VERSION}`);
}

function ai2ScoreLabel(score) {
  if (!score) return { text: "PENDING", cls: "pending" };
  if (score.exactTop3) return { text: "EXACT", cls: "exact" };
  const parts = [];
  if (score.top10Hit) parts.push("TOP10");
  if (score.permutationHit) parts.push("PERM");
  if (Number(score.bestDigitOverlap || 0) > 0) parts.push(`${score.bestDigitOverlap}D`);
  if (Number(score.bestPositionHits || 0) > 0) parts.push(`${score.bestPositionHits}P`);
  return parts.length ? { text: parts.join(" · "), cls: "partial" } : { text: "MISS", cls: "miss" };
}

function ai2ModelById(row, id) {
  const models = row?.predictionHistory?.models || [];
  return models.find((model) => String(model.id || "").toLowerCase() === id) || null;
}

function ai2PredictionCell(model) {
  if (!model) return '<span class="ai2-empty">—</span>';
  const top3 = Array.isArray(model.top3) ? model.top3 : [];
  const score = ai2ScoreLabel(model.score);
  return `<div class="ai2-prediction-cell"><b>${ai2Esc(top3.join(" · ") || "—")}</b><small class="ai2-score ${score.cls}">${ai2Esc(score.text)}</small></div>`;
}

function ai2ActualCell(row) {
  return `<div class="ai2-actual-cell"><strong>${ai2Esc(row.actualResult || "---")}</strong><small>Period ${ai2Esc(row.actualPeriod ?? row.targetPeriod ?? "—")}</small></div>`;
}

function ai2LockCell(row) {
  return `<div class="ai2-lock-cell"><b>${ai2Esc(ai2Time(row.lockedAt))}</b><small>LOCKED BEFORE RESULT ${row.lockProof?.lockedBeforeResult ? "✅" : "⚠️"}</small></div>`;
}

function ai2HistoryRows(source) {
  const rows = ai2HistoryData[source] || [];
  if (ai2HistoryLimit === "all") return rows;
  return rows.slice(0, Math.max(1, Number(ai2HistoryLimit) || 10));
}

function ai2Render3dHistory(source, selector) {
  const body = document.querySelector(selector);
  if (!body) return;
  const rows = ai2HistoryRows(source);
  body.innerHTML = rows.length ? rows.map((row) => {
    const legacy = ai2ModelById(row, "legacy");
    const digit = ai2ModelById(row, "digitboost");
    const hybrid = ai2ModelById(row, "hybrid");
    const twoStage = row.predictionHistory?.twoStage || ai2ModelById(row, "two-stage");
    const assist = row.predictionHistory?.assist || null;
    return `<tr>
      <td>${ai2ActualCell(row)}</td>
      <td>${ai2LockCell(row)}</td>
      <td>${ai2PredictionCell(legacy)}</td>
      <td>${ai2PredictionCell(digit)}</td>
      <td>${ai2PredictionCell(hybrid)}</td>
      <td>${ai2PredictionCell(twoStage)}</td>
      <td>${ai2PredictionCell(assist)}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="7">Belum ada settled history dari lock Phase 0.</td></tr>';
}

function ai2RenderKeeperHistory(source, selector) {
  const body = document.querySelector(selector);
  if (!body) return;
  const rows = ai2HistoryRows(source);
  body.innerHTML = rows.length ? rows.map((row) => {
    const keeper = row.predictionHistory?.keeper7 || {};
    const score = keeper.score || {};
    const covered = score.covered == null ? "—" : `${score.covered}/3`;
    const verdict = score.all3 ? { text: "ALL3", cls: "exact" } : score.covered == null ? { text: "—", cls: "pending" } : { text: covered, cls: Number(score.covered) >= 2 ? "partial" : "miss" };
    return `<tr>
      <td>${ai2ActualCell(row)}</td>
      <td>${ai2LockCell(row)}</td>
      <td><div class="ai2-digit-list">${(keeper.keep7 || []).map((d) => `<span>${ai2Esc(d)}</span>`).join("") || "—"}</div></td>
      <td><div class="ai2-digit-list drop">${(keeper.drop3 || []).map((d) => `<span>${ai2Esc(d)}</span>`).join("") || "—"}</div></td>
      <td><b>${ai2Esc(covered)}</b></td>
      <td><span class="ai2-score ${verdict.cls}">${ai2Esc(verdict.text)}</span></td>
    </tr>`;
  }).join("") : '<tr><td colspan="6">Belum ada settled history dari lock Phase 0.</td></tr>';
}

function ai2RenderHistory(data) {
  ai2HistoryData = {
    utama: Array.isArray(data?.bySource?.utama) ? data.bySource.utama : [],
    europe: Array.isArray(data?.bySource?.europe) ? data.bySource.europe : [],
  };
  ai2Render3dHistory("utama", "#ai2Utama3dHistory");
  ai2RenderKeeperHistory("utama", "#ai2UtamaKeeperHistory");
  ai2Render3dHistory("europe", "#ai2Europe3dHistory");
  ai2RenderKeeperHistory("europe", "#ai2EuropeKeeperHistory");
}

function ai2SetHistoryLimit(value) {
  ai2HistoryLimit = ["10", "25", "50", "all"].includes(String(value)) ? String(value) : "10";
  try { localStorage.setItem(AI2_HISTORY_LIMIT_KEY, ai2HistoryLimit); } catch {}
  document.querySelectorAll("[data-history-limit]").forEach((node) => node.classList.toggle("active", node.dataset.historyLimit === ai2HistoryLimit));
  ai2RenderHistory({ bySource: ai2HistoryData });
}

async function ai2LoadStatus() {
  const response = await ai2Fetch("/api/ai-v2", { headers: { accept: "application/json" }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `AI V2 status gagal (${response.status})`);
  ai2Render(data);
  return data;
}

async function ai2LoadHistory() {
  const response = await ai2Fetch("/api/ai-v2-history?limit=all", { headers: { accept: "application/json" }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `AI V2 history gagal (${response.status})`);
  ai2RenderHistory(data);
  return data;
}

async function ai2LoadAll() {
  try {
    await Promise.all([ai2LoadStatus(), ai2LoadHistory()]);
  } catch (error) {
    ai2SetText("#ai2StatusText", error?.message || "AI V2 status/history tidak dapat dibaca.");
  }
}

async function ai2Sync(userTriggered) {
  if (ai2Syncing) return;
  ai2Syncing = true;
  const button = document.querySelector("#ai2SyncBtn");
  if (button) button.disabled = true;
  if (userTriggered) ai2SetText("#ai2StatusText", "Snapshot pending locks + settle observations…");
  try {
    const response = await ai2Fetch("/api/ai-v2-sync", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `AI V2 sync gagal (${response.status})`);
    ai2Render(data);
    await ai2LoadHistory();
  } catch (error) {
    ai2SetText("#ai2StatusText", error?.message || "AI V2 sync gagal.");
    if (!userTriggered) await ai2LoadAll();
  } finally {
    if (button) button.disabled = false;
    ai2Syncing = false;
  }
}

function ai2StartTimer() {
  clearInterval(ai2Timer);
  ai2Timer = setInterval(() => {
    const workspace = document.querySelector("#aiV2Workspace");
    if (!document.hidden && workspace && !workspace.hidden) ai2LoadAll();
  }, 30_000);
}

function ai2Init() {
  if (!ai2CreateShell()) {
    setTimeout(ai2Init, 50);
    return;
  }
  try {
    const stored = localStorage.getItem(AI2_HISTORY_LIMIT_KEY);
    if (["10", "25", "50", "all"].includes(stored)) ai2HistoryLimit = stored;
  } catch {}
  ai2SetHistoryLimit(ai2HistoryLimit);
  ai2StartTimer();
  let active = false;
  try { active = localStorage.getItem(AI2_ACTIVE_KEY) === "1"; } catch {}
  if (active) ai2Switch(true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ai2Init, { once: true });
else ai2Init();
