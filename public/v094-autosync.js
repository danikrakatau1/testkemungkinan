const MAIN_AUTOSYNC_VERSION = "0.9.4-draw-window";
const MAIN_AUTOSYNC_TZ = "Asia/Jakarta";
const MAIN_AUTOSYNC_WINDOW_MINUTES = 5;
const MAIN_AUTOSYNC_RETRY_MS = 20_000;
const MAIN_AUTOSYNC_TICK_MS = 10_000;
const mainAutoFetch = window.fetch.bind(window);

let mainAutoRunning = false;
let mainAutoLastAttempt = 0;
let mainAutoTimer = null;

function jakartaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MAIN_AUTOSYNC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function currentHourKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}`;
}

function completedStorageKey(parts) {
  return `testkemungkinan-main-autosync:${currentHourKey(parts)}`;
}

function parseDrawHour(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = String(match[3] || "").toUpperCase();
  if (!Number.isInteger(hour)) return null;
  if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
  if (meridiem === "PM") hour = hour === 12 ? 12 : hour + 12;
  if (hour < 0 || hour > 23) return null;
  return hour;
}

function ensureBadge() {
  let badge = document.querySelector("#mainAutoSyncBadge");
  if (badge) return badge;
  const host = document.querySelector(".autopilot-head") || document.querySelector("#autopilotPanel");
  if (!host) return null;
  badge = document.createElement("span");
  badge.id = "mainAutoSyncBadge";
  badge.textContent = "AUTO-SYNC ARMED";
  badge.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "min-height:24px",
    "padding:0 8px",
    "margin-left:8px",
    "border:1px solid rgba(56,189,248,.22)",
    "border-radius:999px",
    "font:800 8px/1 system-ui,sans-serif",
    "letter-spacing:.06em",
    "color:#93c5fd",
    "background:rgba(14,165,233,.06)",
    "white-space:nowrap",
  ].join(";");
  const existing = host.querySelector(".auto-badge");
  if (existing?.parentNode) existing.parentNode.insertBefore(badge, existing.nextSibling);
  else host.appendChild(badge);
  return badge;
}

function setBadge(text, mode = "armed") {
  const badge = ensureBadge();
  if (!badge) return;
  badge.textContent = text;
  const palette = {
    armed: ["#93c5fd", "rgba(56,189,248,.22)", "rgba(14,165,233,.06)"],
    checking: ["#fde68a", "rgba(245,158,11,.24)", "rgba(245,158,11,.06)"],
    synced: ["#86efac", "rgba(34,197,94,.24)", "rgba(34,197,94,.06)"],
    error: ["#fda4af", "rgba(244,63,94,.24)", "rgba(244,63,94,.06)"],
  }[mode] || ["#93c5fd", "rgba(56,189,248,.22)", "rgba(14,165,233,.06)"];
  badge.style.color = palette[0];
  badge.style.borderColor = palette[1];
  badge.style.background = palette[2];
}

function alreadyCompleted(parts) {
  try { return sessionStorage.getItem(completedStorageKey(parts)) === "1"; }
  catch { return false; }
}

function markCompleted(parts) {
  try { sessionStorage.setItem(completedStorageKey(parts), "1"); } catch {}
}

async function readMainStatus() {
  const response = await mainAutoFetch("/api/autopilot", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `AutoPilot status gagal (${response.status})`);
  return data;
}

function statusIsCurrent(status, parts) {
  const latest = status?.latest || {};
  const latestHour = parseDrawHour(latest.drawTime);
  const pending = status?.pendingArena || null;
  const sameHour = latestHour === parts.hour;
  const lockReady = Boolean(pending && Number(pending.anchorPeriod) === Number(latest.period));
  return sameHour && lockReady;
}

async function fullMainSync() {
  const response = await mainAutoFetch("/api/main-sync", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Main auto-sync gagal (${response.status})`);
  return data;
}

async function mainAutoSyncTick(force = false) {
  if (mainAutoRunning) return;
  const parts = jakartaParts();
  const inWindow = parts.minute <= MAIN_AUTOSYNC_WINDOW_MINUTES;
  if (!force && !inWindow) {
    setBadge("AUTO-SYNC ARMED", "armed");
    return;
  }
  if (!force && alreadyCompleted(parts)) {
    setBadge("AUTO-SYNC SYNCED", "synced");
    return;
  }
  const now = Date.now();
  if (!force && now - mainAutoLastAttempt < MAIN_AUTOSYNC_RETRY_MS) return;

  mainAutoRunning = true;
  mainAutoLastAttempt = now;
  setBadge("AUTO-SYNC CHECKING", "checking");

  try {
    let status = await readMainStatus();
    if (!statusIsCurrent(status, parts)) {
      await fullMainSync();
      status = await readMainStatus();
    }

    if (statusIsCurrent(status, parts)) {
      markCompleted(parts);
      setBadge("AUTO-SYNC SYNCED", "synced");
      window.dispatchEvent(new CustomEvent("autopilot:autosynced", { detail: { period: status.latest?.period, version: MAIN_AUTOSYNC_VERSION } }));
    } else {
      setBadge("AUTO-SYNC WAITING SOURCE", "checking");
    }
  } catch (error) {
    console.warn("Main AutoPilot draw-window sync failed", error);
    setBadge("AUTO-SYNC RETRY", "error");
  } finally {
    mainAutoRunning = false;
  }
}

function initMainAutoSync() {
  ensureBadge();
  clearInterval(mainAutoTimer);
  mainAutoTimer = setInterval(() => mainAutoSyncTick(false), MAIN_AUTOSYNC_TICK_MS);
  mainAutoSyncTick(false);

  // When a sleeping/background tab becomes visible near draw time, catch up immediately.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) mainAutoSyncTick(true);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMainAutoSync, { once: true });
else initMainAutoSync();
