const ARENA_UI_VERSION = "0.7.0";
const arenaFetch = window.fetch.bind(window);
let latestArena = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseHistory() {
  return String(document.querySelector("#historyInput")?.value || "")
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter((item) => /^\d{1,3}$/.test(item) && Number(item) <= 999)
    .map((item) => item.padStart(3, "0"));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fmtTime(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function setStatus(message, tone = "") {
  const node = document.querySelector("#arenaStatus");
  if (!node) return;
  node.textContent = message;
  node.className = `arena-status ${tone}`;
}

function pill(label, tone = "neutral") {
  return `<span class="arena-pill ${tone}">${esc(label)}</span>`;
}

function injectStyles() {
  if (document.querySelector("#v070Styles")) return;
  const style = document.createElement("style");
  style.id = "v070Styles";
  style.textContent = `
    .arena-panel{position:relative;overflow:hidden}.arena-panel::before{content:"";position:absolute;inset:0 0 auto;height:1px;background:linear-gradient(90deg,transparent,rgba(167,139,250,.85),transparent)}
    .arena-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:12px 0}.arena-actions{display:flex;gap:8px;flex-wrap:wrap}
    .arena-btn{border:1px solid rgba(167,139,250,.38);background:rgba(124,58,237,.11);color:#ddd6fe;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer}.arena-btn.secondary{border-color:rgba(148,163,184,.22);background:#0b1221;color:#cbd5e1}.arena-btn:disabled{opacity:.45;cursor:not-allowed}
    .arena-status{font-size:12px;color:#94a3b8}.arena-status.running{color:#93c5fd}.arena-status.good{color:#6ee7b7}.arena-status.bad{color:#fda4af}.arena-status.warn{color:#fde68a}
    .arena-disclaimer{padding:11px 13px;border:1px solid rgba(251,191,36,.18);border-radius:11px;background:rgba(120,53,15,.08);color:#aab6ca;font-size:11px;line-height:1.55;margin-bottom:13px}.arena-disclaimer strong{color:#fde68a}
    .arena-models{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}.arena-model-card{padding:14px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(15,23,42,.46)}.arena-model-card h3{margin:0 0 5px;font-size:14px;color:#edf2fb}.arena-model-card p{margin:0 0 12px;color:#7f8da8;font-size:10px;line-height:1.45}.arena-top3{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.arena-number{padding:10px 6px;border:1px solid rgba(129,140,248,.20);border-radius:10px;text-align:center;background:rgba(30,41,59,.45)}.arena-number span{display:block;color:#73819a;font-size:9px}.arena-number strong{font-family:"SFMono-Regular",Consolas,monospace;font-size:21px;color:#f1f5f9}.arena-number small{display:block;color:#a5b4fc;font-size:9px;margin-top:3px}
    .arena-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:10px;margin:12px 0}.arena-card{padding:13px;border:1px solid rgba(148,163,184,.16);border-radius:13px;background:rgba(15,23,42,.42)}.arena-card-title{font-size:11px;font-weight:800;color:#cbd5e1;margin-bottom:10px}
    .digit-dist{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.digit-dist-col{padding:10px;border:1px solid rgba(148,163,184,.12);border-radius:10px}.digit-dist-col>strong{display:block;font-size:10px;color:#94a3b8;margin-bottom:8px}.digit-chip{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,.08);font-family:"SFMono-Regular",Consolas,monospace;font-size:10px}.digit-chip:last-child{border-bottom:0}.digit-chip b{color:#e5e7eb}.digit-chip span{color:#a5b4fc}
    .feature-row{display:grid;grid-template-columns:110px 1fr 52px;gap:8px;align-items:center;margin:7px 0;font-size:10px;color:#94a3b8}.feature-track{height:6px;border-radius:999px;background:#20293a;overflow:hidden}.feature-track i{display:block;height:100%;background:linear-gradient(90deg,#818cf8,#c084fc);border-radius:inherit}.feature-row strong{text-align:right;color:#ddd6fe;font-family:"SFMono-Regular",Consolas,monospace}
    .arena-agree{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.arena-pill{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid rgba(148,163,184,.2);color:#cbd5e1;background:rgba(148,163,184,.07)}.arena-pill.good{border-color:rgba(52,211,153,.3);color:#6ee7b7;background:rgba(52,211,153,.07)}.arena-pill.warn{border-color:rgba(251,191,36,.3);color:#fde68a;background:rgba(251,191,36,.07)}.arena-pill.bad{border-color:rgba(248,113,113,.3);color:#fda4af;background:rgba(248,113,113,.07)}
    .arena-forward-box{margin-top:14px;padding-top:14px;border-top:1px solid rgba(148,163,184,.12)}.arena-forward-current{padding:11px 12px;border:1px solid rgba(167,139,250,.16);border-radius:11px;color:#9aa8bd;font-size:11px;margin:9px 0}.arena-forward-current strong{color:#e9e5ff}.arena-forward-table{min-width:1250px}.arena-forward-table td,.arena-forward-table th{white-space:nowrap}
    @media(max-width:900px){.arena-models{grid-template-columns:1fr}.arena-grid{grid-template-columns:1fr}.digit-dist{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  if (document.querySelector("#arenaPanel")) return;
  const results = document.querySelector(".results");
  if (!results) return;
  const panel = document.createElement("section");
  panel.className = "panel arena-panel";
  panel.id = "arenaPanel";
  panel.innerHTML = `
    <div class="panel-title-row">
      <div>
        <h2>Model Arena · DigitBoost vs Legacy</h2>
        <p class="panel-subtitle">V0.7.0 memisahkan Stage-1 pemilihan digit dan Stage-2 ordering/rerank, lalu menandingkannya dengan Legacy Ensemble pada snapshot yang sama.</p>
      </div>
      <span class="small-badge">V0.7.0</span>
    </div>
    <div class="arena-disclaimer"><strong>Penting:</strong> DigitBoost GBS adalah gradient-boosted decision stumps buatan khusus yang Worker-native, <strong>bukan</strong> library resmi XGBoost/CatBoost. Kita pakai ini sebagai challenger yang ringan dan deterministic; pemenang hanya ditentukan lewat forward test, bukan karena nama modelnya keren.</div>
    <div class="arena-toolbar">
      <div id="arenaStatus" class="arena-status">Muat D1 lalu klik Run Model Arena.</div>
      <div class="arena-actions">
        <button id="arenaRunBtn" class="arena-btn" type="button">Run Model Arena</button>
        <button id="arenaLockBtn" class="arena-btn" type="button">Lock Arena Forward</button>
        <button id="arenaRefreshBtn" class="arena-btn secondary" type="button">Refresh forward</button>
      </div>
    </div>
    <div id="arenaModels" class="arena-models"></div>
    <div class="arena-grid">
      <div class="arena-card"><div class="arena-card-title">Stage-1 digit distribution</div><div id="arenaDigits" class="digit-dist"></div></div>
      <div class="arena-card"><div class="arena-card-title">Boost feature importance</div><div id="arenaFeatures"></div><div id="arenaAgreement" class="arena-agree"></div></div>
    </div>
    <div class="arena-forward-box">
      <div class="arena-card-title">Arena Forward Scorecard</div>
      <div id="arenaForwardCurrent" class="arena-forward-current">Belum ada Arena Forward lock.</div>
      <div class="table-wrap model-table-wrap">
        <table class="model-table arena-forward-table">
          <thead><tr><th>Test</th><th>Locked</th><th>Anchor</th><th>Actual</th><th>Model</th><th>Top3 locked</th><th>Exact Top3</th><th>Top10</th><th>Permutation</th><th>Digit overlap</th><th>Position hit</th><th>Pool 3/3</th><th>Closest</th></tr></thead>
          <tbody id="arenaForwardBody"></tbody>
        </table>
      </div>
    </div>
  `;
  const forward = document.querySelector("#forwardPanel");
  if (forward) forward.insertAdjacentElement("afterend", panel);
  else results.appendChild(panel);
  document.querySelector("#arenaRunBtn")?.addEventListener("click", runArena);
  document.querySelector("#arenaLockBtn")?.addEventListener("click", lockArenaForward);
  document.querySelector("#arenaRefreshBtn")?.addEventListener("click", () => loadArenaForward(true));
}

function renderArena(data) {
  latestArena = data;
  const models = document.querySelector("#arenaModels");
  const digits = document.querySelector("#arenaDigits");
  const features = document.querySelector("#arenaFeatures");
  const agreement = document.querySelector("#arenaAgreement");
  if (!models || !digits || !features || !agreement) return;

  models.innerHTML = (data.models || []).map((model) => `
    <article class="arena-model-card">
      <h3>${esc(model.label)}</h3>
      <p>${esc(model.description)}</p>
      <div class="arena-top3">${(model.top3 || []).map((row) => `
        <div class="arena-number"><span>#${row.rank}</span><strong>${esc(row.number)}</strong><small>${Number(row.score).toFixed(2)}</small></div>
      `).join("")}</div>
    </article>
  `).join("");

  digits.innerHTML = (data.digitDistributions || []).map((position) => `
    <div class="digit-dist-col"><strong>${esc(position.label)}</strong>${(position.digits || []).map((row) => `
      <div class="digit-chip"><b>${row.digit}</b><span>${Number(row.pct).toFixed(2)}%</span></div>
    `).join("")}</div>
  `).join("");

  features.innerHTML = (data.featureImportance || []).slice(0, 6).map((row) => `
    <div class="feature-row"><span>${esc(row.feature)}</span><div class="feature-track"><i style="width:${Math.max(1, Number(row.pct))}%"></i></div><strong>${Number(row.pct).toFixed(1)}%</strong></div>
  `).join("");
  agreement.innerHTML = `
    ${pill(`Legacy ↔ Boost ${data.agreement?.legacyVsDigitBoostTop3 ?? 0}/3`, Number(data.agreement?.legacyVsDigitBoostTop3 || 0) >= 2 ? "good" : "neutral")}
    ${pill(`Legacy ↔ Hybrid ${data.agreement?.legacyVsHybridTop3 ?? 0}/3`, Number(data.agreement?.legacyVsHybridTop3 || 0) >= 2 ? "good" : "neutral")}
    ${pill(`Boost ↔ Hybrid ${data.agreement?.digitBoostVsHybridTop3 ?? 0}/3`, Number(data.agreement?.digitBoostVsHybridTop3 || 0) >= 2 ? "good" : "neutral")}
  `;
}

async function runArena() {
  const button = document.querySelector("#arenaRunBtn");
  if (button) button.disabled = true;
  setStatus("Melatih DigitBoost + menyusun 1.000 kandidat…", "running");
  try {
    const history = parseHistory();
    if (history.length < 40) throw new Error("Muat minimal 40 draw D1.");
    const decay = Number(document.querySelector("#decay")?.value || 0.9);
    const response = await arenaFetch("/api/arena", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history, decay }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Arena gagal (${response.status})`);
    renderArena(data);
    setStatus(`Arena selesai · ${data.meta.trainingRows} training rows · ${data.meta.boostRoundsPerPosition} rounds/position.`, "good");
  } catch (error) {
    setStatus(error.message || "Model Arena gagal.", "bad");
  } finally {
    if (button) button.disabled = false;
  }
}

async function lockArenaForward() {
  const button = document.querySelector("#arenaLockBtn");
  if (button) button.disabled = true;
  setStatus("Membekukan tiga engine untuk result berikutnya…", "running");
  try {
    const history = parseHistory();
    if (history.length < 40) throw new Error("Muat D1 terlebih dahulu.");
    const decay = Number(document.querySelector("#decay")?.value || 0.9);
    const fingerprint = await sha256(JSON.stringify(history));
    const response = await arenaFetch("/api/arena-forward", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history, decay, fingerprint }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Arena lock gagal (${response.status})`);
    setStatus(`Arena Forward #${data.run.id} terkunci pada period ${data.run.anchorPeriod}.`, "good");
    await loadArenaForward(false);
  } catch (error) {
    setStatus(error.message || "Arena Forward lock gagal.", "bad");
  } finally {
    if (button) button.disabled = false;
  }
}

function renderArenaForward(runs = []) {
  const current = document.querySelector("#arenaForwardCurrent");
  const body = document.querySelector("#arenaForwardBody");
  if (!current || !body) return;
  const pending = runs.find((run) => run.status === "pending");
  current.innerHTML = pending
    ? `<strong>Arena Forward #${pending.id} aktif.</strong> Anchor <span class="mono">${pending.anchorPeriod} = ${esc(pending.anchorResult)}</span> · tiga engine dikunci sebelum result berikutnya.`
    : `Tidak ada Arena Forward pending. Jalankan Model Arena bila ingin melihat kandidat, lalu klik <strong>Lock Arena Forward</strong> sebelum result berikutnya.`;

  const rows = [];
  for (const run of runs) {
    if (run.status === "pending") {
      for (const model of run.predictions || []) {
        rows.push(`<tr><td>#${run.id}</td><td>${fmtTime(run.createdAt)}</td><td class="mono">${run.anchorPeriod} · ${esc(run.anchorResult)}</td><td>menunggu</td><td><strong>${esc(model.label)}</strong></td><td class="mono">${(model.top3 || []).map(esc).join(" · ")}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
      }
      continue;
    }
    for (const score of run.scores || []) {
      const poolTone = Number(score.poolDigitCoverage) === 3 ? "good" : Number(score.poolDigitCoverage) === 2 ? "warn" : "bad";
      rows.push(`<tr>
        <td>#${run.id}</td><td>${fmtTime(run.createdAt)}</td><td class="mono">${run.anchorPeriod} · ${esc(run.anchorResult)}</td><td class="mono">${run.actualPeriod} · <strong>${esc(run.actualResult)}</strong></td>
        <td><strong>${esc(score.label)}</strong></td><td class="mono">${(score.top3 || []).map(esc).join(" · ")}</td>
        <td>${pill(score.exactTop3 ? "HIT" : "MISS", score.exactTop3 ? "good" : "bad")}</td>
        <td>${pill(score.top10Hit ? "HIT" : "MISS", score.top10Hit ? "good" : "bad")}</td>
        <td>${pill(score.permutationHit ? "3/3" : "MISS", score.permutationHit ? "good" : "neutral")}</td>
        <td class="mono">${score.bestDigitOverlap}/3</td><td class="mono">${score.bestPositionHits}/3</td>
        <td>${pill(`${score.poolDigitCoverage}/3`, poolTone)}</td><td class="mono">${esc(score.bestCandidate || "—")}</td>
      </tr>`);
    }
  }
  body.innerHTML = rows.join("") || `<tr><td colspan="13" style="color:#718096">Belum ada Arena Forward test.</td></tr>`;
}

async function loadArenaForward(showLoading = false) {
  if (showLoading) setStatus("Mengecek Arena Forward dan result baru di D1…", "running");
  try {
    const response = await arenaFetch("/api/arena-forward?limit=20", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Arena Forward gagal (${response.status})`);
    renderArenaForward(data.runs || []);
    if (showLoading) {
      const pending = (data.runs || []).filter((run) => run.status === "pending").length;
      setStatus(pending ? `${pending} Arena Forward masih menunggu result.` : "Arena Forward sudah ter-refresh.", pending ? "warn" : "good");
    }
  } catch (error) {
    setStatus(error.message || "Arena Forward gagal dimuat.", "bad");
  }
}

function updateVisibleVersion() {
  const status = document.querySelector(".topbar .status");
  if (status && !status.textContent.includes("V0.7.0")) status.innerHTML = '<span class="status-dot"></span> V0.7.0 · Model Arena';
}

function init() {
  injectStyles();
  injectPanel();
  updateVisibleVersion();
  loadArenaForward(false);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
