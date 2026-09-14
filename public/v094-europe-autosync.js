const EUROPE_AUTOSYNC_VERSION = "0.9.4-europe-autosync";
const RETRY_MS = 20_000;
const CHECK_MS = 2_000;
const MAX_WINDOW_MS = 8 * 60_000;

let baselinePeriod = null;
let firstZeroAt = 0;
let lastAttemptAt = 0;

function europeWorkspaceActive() {
  const workspace = document.querySelector("#europeWorkspace");
  return Boolean(workspace && !workspace.hidden);
}

function readEuropePeriod() {
  const meta = String(document.querySelector("#europeLatestMeta")?.textContent || "");
  const match = meta.match(/Period\s+(\d+)/i);
  return match ? match[1] : null;
}

function countdownZero() {
  return String(document.querySelector("#europeCountdown")?.textContent || "").trim() === "00:00:00";
}

function resetWindow() {
  baselinePeriod = null;
  firstZeroAt = 0;
  lastAttemptAt = 0;
}

function markStatus(text) {
  const node = document.querySelector("#europeStatus span");
  if (node) node.textContent = text;
}

function tickEuropeAutoSync() {
  if (!europeWorkspaceActive()) return;

  if (!countdownZero()) {
    if (baselinePeriod && readEuropePeriod() !== baselinePeriod) resetWindow();
    else if (firstZeroAt) resetWindow();
    return;
  }

  const now = Date.now();
  const currentPeriod = readEuropePeriod();
  if (!firstZeroAt) {
    firstZeroAt = now;
    baselinePeriod = currentPeriod;
  }

  if (baselinePeriod && currentPeriod && currentPeriod !== baselinePeriod) {
    resetWindow();
    return;
  }

  if (now - firstZeroAt > MAX_WINDOW_MS) {
    markStatus("AUTO aktif · source belum berubah; fallback cron 5 menit tetap memantau.");
    return;
  }

  if (now - lastAttemptAt < RETRY_MS) return;
  const button = document.querySelector("#europeSyncBtn");
  if (!button || button.disabled) return;

  lastAttemptAt = now;
  markStatus("AUTO-SYNC Europe · mengecek First Place terbaru…");
  button.click();
}

setInterval(tickEuropeAutoSync, CHECK_MS);

console.debug(`Europe auto-sync ${EUROPE_AUTOSYNC_VERSION} active`);
