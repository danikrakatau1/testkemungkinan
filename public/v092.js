const V092_VERSION = "0.9.2";
const nativeFetch092 = window.fetch.bind(window);
let adaptiveTimer092 = null;
let adaptiveObserver092 = null;
let lastAdaptive092 = null;
window.__AUTOPILOT_UI_VERSION__ = V092_VERSION;

function version092() {
  window.__AUTOPILOT_UI_VERSION__ = V092_VERSION;

  const status = document.querySelector(".topbar .status");
  const desiredStatus = '<span class="status-dot"></span> V0.9.2 · AutoPilot · SAFE';
  if (status && status.innerHTML !== desiredStatus) status.innerHTML = desiredStatus;

  const updated = document.querySelector("#autoUpdated");
  if (updated) {
    const current = String(updated.textContent || "");
    const next = current.match(/V\d+\.\d+\.\d+/)
      ? current.replace(/V\d+\.\d+\.\d+/g, `V${V092_VERSION}`)
      : `${current}${current ? " · " : ""}V${V092_VERSION}`;
    if (current !== next) updated.textContent = next;
  }

  const desiredTitle = `AutoPilot 3D · V${V092_VERSION}`;
  if (document.title !== desiredTitle) document.title = desiredTitle;
}

function compactWeight(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—";
}

function adaptiveLabel092(data) {
  const n = Number(data?.keeperSettled || 0);
  const phase = String(data?.phase || "WARMUP").toUpperCase();
  const label = phase === "ADAPTIVE"
    ? "ADAPTIVE"
    : phase === "LEARNING"
      ? "LEARN"
      : phase === "COLD_START"
        ? "COLD"
        : "WARMUP";
  return { n, phase, label };
}

function renderAdaptive092(data) {
  const lock = document.querySelector("#keeper7Lock");
  if (!lock || !data) return;

  const { n, label } = adaptiveLabel092(data);
  const desiredText = `LOCKED · ${label} ${n}`;
  if (lock.textContent !== desiredText) lock.textContent = desiredText;

  const w = data?.weights || {};
  const trust = data?.modelTrust || {};
  const desiredTitle = [
    `Adaptive Error Learner ${data?.version || V092_VERSION}`,
    `settled forward: ${n}`,
    `recent ${compactWeight(w.recent)}`,
    `global ${compactWeight(w.global)}`,
    `hour ${compactWeight(w.hour)}`,
    `transition ${compactWeight(w.transition)}`,
    `model ${compactWeight(w.model)}`,
    Object.keys(trust).length
      ? `model trust: ${Object.entries(trust).map(([key, value]) => `${key} ${Number(value).toFixed(3)}`).join(" · ")}`
      : "model trust: warmup",
    "forward-only; old locks are never rewritten",
  ].join("\n");
  if (lock.title !== desiredTitle) lock.title = desiredTitle;
}

function enforceAdaptiveUi092() {
  version092();
  if (lastAdaptive092) renderAdaptive092(lastAdaptive092);
}

function observeLegacyOverwrite092() {
  if (adaptiveObserver092) return;
  const nodes = [
    document.querySelector(".topbar .status"),
    document.querySelector("#autoUpdated"),
    document.querySelector("#keeper7Lock"),
  ].filter(Boolean);
  if (!nodes.length) return;

  adaptiveObserver092 = new MutationObserver(() => {
    queueMicrotask(enforceAdaptiveUi092);
  });
  for (const node of nodes) {
    adaptiveObserver092.observe(node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

async function loadAdaptive092() {
  version092();
  try {
    const response = await nativeFetch092("/api/adaptive", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return;
    lastAdaptive092 = data;
    renderAdaptive092(data);
    version092();
    observeLegacyOverwrite092();
  } catch {}
}

function init092() {
  version092();
  loadAdaptive092();
  setTimeout(observeLegacyOverwrite092, 500);
  setTimeout(enforceAdaptiveUi092, 900);

  clearInterval(adaptiveTimer092);
  adaptiveTimer092 = setInterval(() => {
    enforceAdaptiveUi092();
    if (!document.hidden) loadAdaptive092();
  }, 30_000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init092, { once: true });
} else {
  init092();
}
