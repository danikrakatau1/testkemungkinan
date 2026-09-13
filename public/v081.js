const COUNTDOWN_VERSION = "0.8.1";
const DRAW_ZONE = "Asia/Jakarta";
const RETRY_AFTER_DRAW_MS = [12_000, 45_000, 90_000, 180_000];

let countdownTimer = null;
let scheduledBoundary = null;
let retryTimers = [];
let anchorPeriodAtBoundary = null;

function readCurrentPeriod() {
  const meta = document.querySelector("#autoLatestMeta");
  const match = String(meta?.textContent || "").match(/Period\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function nextHourBoundary(nowMs = Date.now()) {
  const hour = 60 * 60 * 1000;
  return Math.floor(nowMs / hour) * hour + hour;
}

function formatCountdown(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDrawTime(timestamp) {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: DRAW_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return "--:--";
  }
}

function injectStyles() {
  if (document.querySelector("#v081Styles")) return;
  const style = document.createElement("style");
  style.id = "v081Styles";
  style.textContent = `
    .draw-countdown{margin:0 22px 16px;padding:11px 13px;border:1px solid rgba(148,163,184,.12);border-radius:12px;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:42px}
    .draw-countdown-copy{display:flex;align-items:baseline;gap:8px;min-width:0}.draw-countdown-label{font-size:10px;color:#71819b;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}.draw-countdown-time{font-family:"SFMono-Regular",Consolas,monospace;font-size:13px;color:#cbd5e1;white-space:nowrap}
    .draw-countdown-clock{font-family:"SFMono-Regular",Consolas,monospace;font-size:23px;line-height:1;font-weight:900;letter-spacing:-.03em;color:#f8fafc;white-space:nowrap}.draw-countdown-clock.checking{color:#93c5fd}
    @media(max-width:520px){.draw-countdown{align-items:flex-start}.draw-countdown-copy{flex-direction:column;gap:3px}.draw-countdown-clock{font-size:21px}}
  `;
  document.head.appendChild(style);
}

function injectCountdown() {
  if (document.querySelector("#drawCountdown")) return true;
  const status = document.querySelector("#autoStatus");
  if (!status) return false;
  const node = document.createElement("div");
  node.id = "drawCountdown";
  node.className = "draw-countdown";
  node.innerHTML = `
    <div class="draw-countdown-copy">
      <span class="draw-countdown-label">Undian berikutnya</span>
      <span id="drawNextTime" class="draw-countdown-time">--:-- WIB</span>
    </div>
    <div id="drawCountdownClock" class="draw-countdown-clock">--:--:--</div>
  `;
  status.insertAdjacentElement("afterend", node);
  return true;
}

function clearRetryTimers() {
  retryTimers.forEach((timer) => clearTimeout(timer));
  retryTimers = [];
}

function triggerAutoRefreshIfStillSamePeriod() {
  const current = readCurrentPeriod();
  if (anchorPeriodAtBoundary != null && current != null && current !== anchorPeriodAtBoundary) {
    clearRetryTimers();
    return;
  }
  const button = document.querySelector("#autoRefreshBtn");
  if (button && !button.disabled) button.click();
}

function schedulePostDrawChecks(boundary) {
  if (scheduledBoundary === boundary) return;
  scheduledBoundary = boundary;
  anchorPeriodAtBoundary = readCurrentPeriod();
  clearRetryTimers();

  const now = Date.now();
  for (const delay of RETRY_AFTER_DRAW_MS) {
    const wait = Math.max(0, boundary + delay - now);
    retryTimers.push(setTimeout(triggerAutoRefreshIfStillSamePeriod, wait));
  }
}

function tick() {
  if (!injectCountdown()) return;
  const now = Date.now();
  const boundary = nextHourBoundary(now);
  const remaining = boundary - now;
  const clock = document.querySelector("#drawCountdownClock");
  const label = document.querySelector("#drawNextTime");

  if (label) label.textContent = `${formatDrawTime(boundary)} WIB`;
  if (clock) {
    clock.textContent = formatCountdown(remaining);
    clock.classList.toggle("checking", remaining <= 15_000);
  }

  if (remaining <= 15_000) schedulePostDrawChecks(boundary);
}

function startCountdown() {
  injectStyles();
  if (!injectCountdown()) {
    setTimeout(startCountdown, 250);
    return;
  }
  clearInterval(countdownTimer);
  tick();
  countdownTimer = setInterval(tick, 250);
}

function markVersion() {
  const topStatus = document.querySelector(".topbar .status");
  if (topStatus) topStatus.innerHTML = `<span class="status-dot"></span> V${COUNTDOWN_VERSION} · AutoPilot`;
  document.title = `AutoPilot 3D · V${COUNTDOWN_VERSION}`;
}

function init() {
  startCountdown();
  markVersion();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
