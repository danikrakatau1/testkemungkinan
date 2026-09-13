const V091_VERSION = "0.9.1";
const nativeFetch091 = window.fetch.bind(window);
let keeperTimer091 = null;
window.__AUTOPILOT_UI_VERSION__ = V091_VERSION;

function esc091(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hour091(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${String(Number(value)).padStart(2, "0")}:00 WIB`;
}

function styles091() {
  if (document.querySelector("#v091Styles")) return;
  const style = document.createElement("style");
  style.id = "v091Styles";
  style.textContent = `
    .keeper7-wrap{padding:0 22px 18px}
    .keeper7-card{border:1px solid rgba(56,189,248,.18);border-radius:16px;background:linear-gradient(145deg,rgba(10,19,35,.78),rgba(7,13,25,.72));overflow:hidden}
    .keeper7-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:13px 15px 11px;border-bottom:1px solid rgba(148,163,184,.09)}
    .keeper7-title{font-size:12px;color:#eef6ff;font-weight:850;letter-spacing:-.01em}.keeper7-sub{margin-top:3px;font-size:9px;color:#70809a;line-height:1.45}
    .keeper7-lock{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid rgba(52,211,153,.2);border-radius:999px;background:rgba(16,185,129,.06);color:#86efac;font-size:8px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}.keeper7-lock::before{content:"";width:5px;height:5px;border-radius:50%;background:#4ade80}
    .keeper7-body{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(260px,.9fr);gap:12px;padding:13px 15px}
    .keeper7-pools{display:grid;grid-template-columns:minmax(0,1fr) 210px;gap:10px}
    .keeper7-block{border:1px solid rgba(148,163,184,.10);border-radius:12px;background:rgba(9,16,30,.52);padding:11px}
    .keeper7-label{font-size:8px;color:#687892;text-transform:uppercase;letter-spacing:.08em}.keeper7-label strong{color:#a5b4fc}
    .keeper7-digits{display:grid;grid-template-columns:repeat(7,minmax(34px,1fr));gap:5px;margin-top:8px}.keeper7-digits.drop{grid-template-columns:repeat(3,1fr)}
    .keeper7-digit{min-width:0;padding:8px 3px 7px;border-radius:9px;border:1px solid rgba(99,102,241,.16);background:#101a2d;text-align:center;color:#eef2ff;font-family:"SFMono-Regular",Consolas,monospace;font-size:18px;font-weight:900}.keeper7-digit small{display:block;font-size:6px;color:#64748b;margin-bottom:3px}
    .keeper7-digit.drop{border-color:rgba(251,113,133,.16);background:rgba(55,16,28,.34);color:#fecdd3}
    .keeper7-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
    .keeper7-metric{border:1px solid rgba(148,163,184,.09);border-radius:11px;padding:9px 10px;background:rgba(8,14,27,.45)}.keeper7-metric span{display:block;font-size:7px;color:#65748d;text-transform:uppercase;letter-spacing:.06em}.keeper7-metric strong{display:block;margin-top:4px;color:#dbeafe;font-size:12px}.keeper7-metric em{display:block;margin-top:2px;color:#64748b;font-size:7px;font-style:normal;line-height:1.35}
    .keeper7-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 15px;border-top:1px solid rgba(148,163,184,.08);font-size:8px;color:#66758d}.keeper7-foot strong{color:#cbd5e1}.keeper7-assist{color:#8fa4c4}.keeper7-assist b{color:#bae6fd}
    .keeper7-last.good{color:#86efac}.keeper7-last.warn{color:#facc15}.keeper7-last.bad{color:#fda4af}
    @media(max-width:800px){.keeper7-body{grid-template-columns:1fr}.keeper7-pools{grid-template-columns:1fr}.keeper7-digits{grid-template-columns:repeat(7,1fr)}.keeper7-wrap{padding:0 22px 18px}}
    @media(max-width:520px){.keeper7-digits{grid-template-columns:repeat(4,1fr)}.keeper7-digits.drop{grid-template-columns:repeat(3,1fr)}.keeper7-metrics{grid-template-columns:1fr}.keeper7-head{align-items:flex-start}}
  `;
  document.head.appendChild(style);
}

function panel091() {
  if (document.querySelector("#keeper7Panel")) return true;
  const latest = document.querySelector(".auto-latest");
  if (!latest) return false;
  const wrap = document.createElement("div");
  wrap.id = "keeper7Panel";
  wrap.className = "keeper7-wrap";
  wrap.innerHTML = `
    <section class="keeper7-card">
      <div class="keeper7-head">
        <div><div class="keeper7-title">7D Historical Keeper / 3D Eliminator</div><div class="keeper7-sub">Ratusan/ribuan histori + hour context + recent flow + transition + evidence model 3D → satu KEEP7 resmi.</div></div>
        <span id="keeper7Lock" class="keeper7-lock">Menunggu lock</span>
      </div>
      <div class="keeper7-body">
        <div class="keeper7-pools">
          <div class="keeper7-block"><div class="keeper7-label"><strong>KEEP 7</strong> · ranking digit #1–#7</div><div id="keeper7Digits" class="keeper7-digits"></div></div>
          <div class="keeper7-block"><div class="keeper7-label">DROP 3 · eliminasi</div><div id="keeper7Drop" class="keeper7-digits drop"></div></div>
        </div>
        <div class="keeper7-metrics">
          <div class="keeper7-metric"><span>Target</span><strong id="keeper7Target">—</strong><em id="keeper7Anchor">Menunggu anchor</em></div>
          <div class="keeper7-metric"><span>Historical OOS · All-3</span><strong id="keeper7Oos">—</strong><em id="keeper7Baseline">baseline —</em></div>
          <div class="keeper7-metric"><span>Forward · All-3</span><strong id="keeper7Forward">—</strong><em id="keeper7ForwardNote">belum ada settlement</em></div>
          <div class="keeper7-metric"><span>Coverage Mass</span><strong id="keeper7Mass">—</strong><em>bukan probabilitas menang</em></div>
        </div>
      </div>
      <div class="keeper7-foot"><span id="keeper7Last" class="keeper7-last">Belum ada forward 7D yang selesai.</span><span id="keeper7Assist" class="keeper7-assist">3D Assist: —</span></div>
    </section>`;
  latest.insertAdjacentElement("afterend", wrap);
  return true;
}

function version091() {
  window.__AUTOPILOT_UI_VERSION__ = V091_VERSION;
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.9.1 · AutoPilot · SAFE';
  const updated = document.querySelector("#autoUpdated");
  if (updated) updated.textContent = String(updated.textContent || "").replace(/V\d+\.\d+\.\d+/g, `V${V091_VERSION}`);
  document.title = `AutoPilot 3D · V${V091_VERSION}`;
}

function renderDigits091(pending) {
  const keepNode = document.querySelector("#keeper7Digits");
  const dropNode = document.querySelector("#keeper7Drop");
  if (!keepNode || !dropNode) return;
  const ranking = pending?.digitRanking || [];
  const keep = pending?.keep7 || [];
  const drop = pending?.drop3 || [];
  const rankMap = new Map(ranking.map((row) => [Number(row.digit), row]));
  keepNode.innerHTML = keep.length ? keep.map((digit, index) => {
    const row = rankMap.get(Number(digit));
    return `<div class="keeper7-digit" title="Relative digit score ${esc091(row?.relativeScore ?? "—")}"><small>#${index + 1}</small>${esc091(digit)}</div>`;
  }).join("") : Array.from({length:7},(_,i)=>`<div class="keeper7-digit"><small>#${i+1}</small>—</div>`).join("");
  dropNode.innerHTML = drop.length ? drop.map((digit, index) => `<div class="keeper7-digit drop"><small>DROP ${index + 1}</small>${esc091(digit)}</div>`).join("") : Array.from({length:3},(_,i)=>`<div class="keeper7-digit drop"><small>DROP ${i+1}</small>—</div>`).join("");
}

function render091(data) {
  const pending = data.pending;
  renderDigits091(pending);
  const lock = document.querySelector("#keeper7Lock");
  const target = document.querySelector("#keeper7Target");
  const anchor = document.querySelector("#keeper7Anchor");
  const oos = document.querySelector("#keeper7Oos");
  const baseline = document.querySelector("#keeper7Baseline");
  const forward = document.querySelector("#keeper7Forward");
  const forwardNote = document.querySelector("#keeper7ForwardNote");
  const mass = document.querySelector("#keeper7Mass");
  const last = document.querySelector("#keeper7Last");
  const assist = document.querySelector("#keeper7Assist");
  const validation = pending?.validation || {};
  const stats = data.forward || {};

  if (lock) lock.textContent = pending ? "LOCKED" : "Menunggu lock";
  if (target) target.textContent = pending ? hour091(pending.targetHour) : "—";
  if (anchor) anchor.textContent = pending ? `Anchor ${pending.anchorPeriod} = ${pending.anchorResult}` : "Menunggu anchor";
  if (oos) oos.textContent = validation.all3RatePct == null ? "—" : `${validation.all3RatePct}%`;
  if (baseline) baseline.textContent = validation.baselinePct == null ? "baseline sample-matched —" : `baseline sample-matched ${validation.baselinePct}% · n=${validation.targets ?? 0}`;
  if (forward) forward.textContent = stats.all3RatePct == null ? "—" : `${stats.all3RatePct}%`;
  if (forwardNote) forwardNote.textContent = stats.settled ? `${stats.settled} forward · avg ${stats.avgCovered ?? "—"}/3 posisi` : "belum ada settlement";
  if (mass) mass.textContent = pending?.subset?.positionMassProductPct == null ? "—" : `${pending.subset.positionMassProductPct}%`;

  if (last) {
    last.className = "keeper7-last";
    if (!data.last) last.textContent = "Belum ada forward 7D yang selesai.";
    else {
      const covered = Number(data.last.coveredPositions || 0);
      last.textContent = `${data.last.actualPeriod} = ${data.last.actualResult} · ${covered}/3 posisi masuk KEEP7${data.last.all3Covered ? " · ALL-3 ✅" : ""}`;
      last.classList.add(covered === 3 ? "good" : covered >= 2 ? "warn" : "bad");
    }
  }

  if (assist) {
    const top3 = (pending?.assistedTop3 || []).map((row) => row.number).filter(Boolean);
    assist.innerHTML = top3.length ? `3D Assist Challenger: <b>${top3.map(esc091).join(" · ")}</b>` : "3D Assist Challenger: —";
  }
  version091();
}

async function load091() {
  if (!panel091()) return;
  try {
    const response = await nativeFetch091("/api/keeper7", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Keeper7 gagal (${response.status})`);
    render091(data);
  } catch (error) {
    const lock = document.querySelector("#keeper7Lock");
    if (lock) lock.textContent = "ERROR";
    const last = document.querySelector("#keeper7Last");
    if (last) { last.className = "keeper7-last bad"; last.textContent = error.message || "7D Keeper tidak dapat dibaca."; }
  }
}

function hook091() {
  const button = document.querySelector("#autoRefreshBtn");
  if (!button || button.dataset.keeper7Hook) return;
  button.dataset.keeper7Hook = "1";
  button.addEventListener("click", () => {
    setTimeout(load091, 1400);
    setTimeout(load091, 4200);
  });
}

function init091() {
  styles091();
  if (!panel091()) { setTimeout(init091, 250); return; }
  version091();
  hook091();
  load091();
  clearInterval(keeperTimer091);
  keeperTimer091 = setInterval(() => {
    hook091();
    version091();
    if (!document.hidden) load091();
  }, 30_000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init091, { once:true });
else init091();
