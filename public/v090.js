const V090_VERSION = "0.9.0";
const nativeFetch = window.fetch.bind(window);
let v090Timer = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function injectStyles() {
  if (document.querySelector("#v090Styles")) return;
  const style = document.createElement("style");
  style.id = "v090Styles";
  style.textContent = `
    .v090-wrap{padding:0 22px 18px}
    .v090-card{position:relative;overflow:hidden;border:1px solid rgba(129,140,248,.18);border-radius:16px;background:linear-gradient(145deg,rgba(12,21,39,.72),rgba(8,15,29,.64));box-shadow:inset 0 1px rgba(255,255,255,.022)}
    .v090-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:15px 16px 12px;border-bottom:1px solid rgba(148,163,184,.10)}
    .v090-title{font-size:12px;font-weight:850;color:#eef2ff;letter-spacing:-.01em}.v090-sub{margin-top:3px;font-size:10px;color:#70809a;line-height:1.5}
    .v090-chip{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:5px 8px;border-radius:999px;border:1px solid rgba(129,140,248,.22);background:rgba(99,102,241,.07);color:#c7d2fe;font-size:9px;font-weight:850;text-transform:uppercase;letter-spacing:.06em}
    .v090-chip::before{content:"";width:5px;height:5px;border-radius:50%;background:#818cf8;box-shadow:0 0 12px rgba(129,140,248,.6)}
    .v090-body{display:grid;grid-template-columns:230px 1fr;gap:12px;padding:14px 16px 16px}
    .v090-top{border:1px solid rgba(148,163,184,.11);border-radius:13px;padding:12px;background:rgba(10,18,33,.48)}
    .v090-label{font-size:9px;color:#6f7d96;text-transform:uppercase;letter-spacing:.08em}.v090-numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}
    .v090-number{position:relative;padding:10px 4px 9px;text-align:center;border:1px solid rgba(129,140,248,.16);border-radius:9px;background:rgba(17,27,49,.72);font-family:"SFMono-Regular",Consolas,monospace;font-size:19px;font-weight:850;color:#eef2ff;transition:transform .22s cubic-bezier(.22,1,.36,1),border-color .22s ease,box-shadow .22s ease}
    .v090-number small{display:block;font-size:7px;color:#64748b;margin-bottom:4px}.v090-number:hover{transform:translateY(-2px);border-color:rgba(129,140,248,.34);box-shadow:0 10px 22px rgba(0,0,0,.15)}
    .v090-lock{margin-top:9px;font-size:9px;color:#71819b;line-height:1.5}.v090-lock strong{color:#a5b4fc}
    .v090-regimes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .v090-regime{border:1px solid rgba(148,163,184,.10);border-radius:12px;padding:10px;background:rgba(8,15,29,.42)}
    .v090-regime-top{display:flex;align-items:center;justify-content:space-between;gap:7px}.v090-pos{font-size:9px;color:#8c9ab1;font-weight:800}.v090-regime-name{font-size:8px;padding:3px 5px;border-radius:999px;background:rgba(99,102,241,.08);color:#a5b4fc;text-transform:uppercase;letter-spacing:.045em}
    .v090-seq{margin-top:8px;font-family:"SFMono-Regular",Consolas,monospace;color:#e2e8f0;font-size:14px;font-weight:800;letter-spacing:.01em;white-space:nowrap}.v090-arrow{color:#475569;padding:0 2px}
    .v090-conf{margin-top:7px;display:flex;align-items:center;gap:7px}.v090-bar{height:3px;flex:1;border-radius:99px;background:rgba(148,163,184,.10);overflow:hidden}.v090-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#6366f1,#38bdf8)}.v090-pct{font-size:8px;color:#64748b;min-width:28px;text-align:right}
    .v090-digits{margin-top:7px;font-size:8px;color:#64748b}.v090-digits strong{color:#a5b4fc;font-weight:800}
    .v090-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid rgba(148,163,184,.09);font-size:9px;color:#66758d}.v090-foot strong{color:#cbd5e1}.v090-good{color:#86efac!important}.v090-warn{color:#facc15!important}
    @media(max-width:760px){.v090-wrap{padding:0 22px 18px}.v090-body{grid-template-columns:1fr}.v090-regimes{grid-template-columns:1fr}.v090-head{align-items:flex-start}.v090-seq{font-size:13px}}
  `;
  document.head.appendChild(style);
}

function injectPanel() {
  if (document.querySelector("#v090Panel")) return true;
  const latest = document.querySelector(".auto-latest");
  if (!latest) return false;
  const wrap = document.createElement("div");
  wrap.id = "v090Panel";
  wrap.className = "v090-wrap";
  wrap.innerHTML = `
    <section class="v090-card">
      <div class="v090-head">
        <div><div class="v090-title">V0.9.0 · Two-Stage Pattern Flow</div><div class="v090-sub">Digit selector → regime map → pair/order reranker → forward lock.</div></div>
        <span class="v090-chip">Challenger</span>
      </div>
      <div class="v090-body">
        <div class="v090-top">
          <div class="v090-label">Top 3 berikutnya</div>
          <div id="v090Numbers" class="v090-numbers"><div class="v090-number">---</div><div class="v090-number">---</div><div class="v090-number">---</div></div>
          <div id="v090Lock" class="v090-lock">Menunggu lock V0.9.0…</div>
        </div>
        <div id="v090Regimes" class="v090-regimes"></div>
      </div>
      <div class="v090-foot"><span id="v090Last">Belum ada forward result V0.9.0.</span><span>Window <strong>4 · 8 · 12 · 20 · 40</strong></span></div>
    </section>
  `;
  latest.insertAdjacentElement("afterend", wrap);
  return true;
}

function markVersion() {
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.9.0 · AutoPilot';
  const updated = document.querySelector("#autoUpdated");
  if (updated) updated.textContent = String(updated.textContent || "").replace(/V\d+\.\d+\.\d+/g, `V${V090_VERSION}`);
  document.title = `AutoPilot 3D · V${V090_VERSION}`;
}

function renderNumbers(pending) {
  const node = document.querySelector("#v090Numbers");
  const lock = document.querySelector("#v090Lock");
  if (!node || !lock) return;
  const top3 = pending?.top3 || [];
  node.innerHTML = [0, 1, 2].map((index) => `<div class="v090-number"><small>#${index + 1}</small>${esc(top3[index] || "---")}</div>`).join("");
  lock.innerHTML = pending
    ? `Terkunci setelah period <strong>${esc(pending.anchorPeriod)}</strong> = ${esc(pending.anchorResult)}.`
    : "Belum ada lock aktif.";
}

function renderRegimes(pending) {
  const node = document.querySelector("#v090Regimes");
  if (!node) return;
  const flows = pending?.flows || [];
  const stage1 = pending?.stage1 || [];
  if (!flows.length) {
    node.innerHTML = '<div class="v090-regime"><div class="v090-pos">Pattern Flow</div><div class="v090-digits">Belum ada snapshot aktif.</div></div>';
    return;
  }
  node.innerHTML = flows.slice(0, 3).map((flow, index) => {
    const seq = (flow.sequence || []).map((digit) => esc(digit)).join('<span class="v090-arrow">→</span>');
    const digits = (stage1[index]?.digits || []).slice(0, 3).map((row) => `${esc(row.digit)} <strong>${esc(row.pct)}%</strong>`).join(" · ");
    const pct = Math.max(0, Math.min(100, Number(flow.confidencePct || 0)));
    return `
      <div class="v090-regime" title="${esc(flow.reason || "")}">
        <div class="v090-regime-top"><span class="v090-pos">${esc(flow.label)}</span><span class="v090-regime-name">${esc(flow.regime)}</span></div>
        <div class="v090-seq">${seq || "—"}</div>
        <div class="v090-conf"><span class="v090-bar"><i style="width:${pct}%"></i></span><span class="v090-pct">${pct.toFixed(0)}%</span></div>
        <div class="v090-digits">Top digit: ${digits || "—"}</div>
      </div>`;
  }).join("");
}

function renderLast(last) {
  const node = document.querySelector("#v090Last");
  if (!node) return;
  if (!last) {
    node.textContent = "Belum ada forward result V0.9.0.";
    return;
  }
  const parts = [];
  if (last.exactTop3) parts.push("Exact Top3");
  else if (last.top10Hit) parts.push("Top10");
  else if (last.permutationHit) parts.push("Permutation");
  else parts.push(`${last.bestDigitOverlap ?? 0}/3 digit`);
  parts.push(`${last.bestPositionHits ?? 0}/3 posisi`);
  parts.push(`rank #${last.actualRank ?? "—"}`);
  node.innerHTML = `<strong>${esc(last.actualPeriod)} = ${esc(last.actualResult)}</strong> · ${esc(parts.join(" · "))}`;
  node.className = last.exactTop3 || last.top10Hit ? "v090-good" : "";
}

function render(data) {
  renderNumbers(data.pending);
  renderRegimes(data.pending);
  renderLast(data.last);
  markVersion();
}

async function loadTwoStage() {
  if (!injectPanel()) return;
  try {
    const response = await nativeFetch("/api/two-stage", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `V0.9.0 gagal (${response.status})`);
    render(data);
  } catch (error) {
    const lock = document.querySelector("#v090Lock");
    if (lock) lock.textContent = error.message || "Two-Stage V0.9.0 tidak dapat dibaca.";
  }
}

function attachRefreshHook() {
  const button = document.querySelector("#autoRefreshBtn");
  if (!button || button.dataset.v090Hook) return;
  button.dataset.v090Hook = "1";
  button.addEventListener("click", () => {
    setTimeout(loadTwoStage, 1200);
    setTimeout(loadTwoStage, 3500);
  });
}

function init() {
  injectStyles();
  if (!injectPanel()) {
    setTimeout(init, 250);
    return;
  }
  markVersion();
  attachRefreshHook();
  loadTwoStage();
  clearInterval(v090Timer);
  v090Timer = setInterval(() => {
    markVersion();
    attachRefreshHook();
    if (!document.hidden) loadTwoStage();
  }, 30_000);
  setInterval(markVersion, 2000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
