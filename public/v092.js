const V092_VERSION = "0.9.2";
const nativeFetch092 = window.fetch.bind(window);
let adaptiveTimer092 = null;
window.__AUTOPILOT_UI_VERSION__ = V092_VERSION;

function version092() {
  window.__AUTOPILOT_UI_VERSION__ = V092_VERSION;
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.9.2 · AutoPilot · SAFE';
  const updated = document.querySelector("#autoUpdated");
  if (updated) updated.textContent = String(updated.textContent || "").replace(/V\d+\.\d+\.\d+/g, `V${V092_VERSION}`);
  document.title = `AutoPilot 3D · V${V092_VERSION}`;
}

function compactWeight(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

function renderAdaptive092(data) {
  const lock = document.querySelector("#keeper7Lock");
  if (!lock) return;
  const n = Number(data?.keeperSettled || 0);
  const phase = String(data?.phase || "WARMUP").toUpperCase();
  const label = phase === "ADAPTIVE" ? "ADAPTIVE" : phase === "LEARNING" ? "LEARN" : phase === "COLD_START" ? "COLD" : "WARMUP";
  const base = /LOCKED/i.test(lock.textContent || "") ? "LOCKED" : String(lock.textContent || "LOCKED").split("·")[0].trim();
  lock.textContent = `${base} · ${label} ${n}`;
  const w = data?.weights || {};
  const trust = data?.modelTrust || {};
  lock.title = [
    `Adaptive Error Learner ${data?.version || V092_VERSION}`,
    `settled forward: ${n}`,
    `recent ${compactWeight(w.recent)}`,
    `global ${compactWeight(w.global)}`,
    `hour ${compactWeight(w.hour)}`,
    `transition ${compactWeight(w.transition)}`,
    `model ${compactWeight(w.model)}`,
    Object.keys(trust).length ? `model trust: ${Object.entries(trust).map(([key,value]) => `${key} ${Number(value).toFixed(3)}`).join(" · ")}` : "model trust: warmup",
    "forward-only; old locks are never rewritten",
  ].join("\n");
}

async function loadAdaptive092() {
  version092();
  try {
    const response = await nativeFetch092("/api/adaptive", { headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return;
    renderAdaptive092(data);
  } catch {}
}

function init092() {
  version092();
  loadAdaptive092();
  clearInterval(adaptiveTimer092);
  adaptiveTimer092 = setInterval(() => {
    if (!document.hidden) loadAdaptive092();
    else version092();
  }, 30_000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init092, { once: true });
else init092();
