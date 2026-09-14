import fs from "node:fs";

const requiredFiles = [
  "src/continuous_watchdog.js",
  "src/index_v102.js",
  "public/v102-watchdog.js",
  "public/v102-watchdog.css",
  "migrations/0011_continuous_draw_watchdog.sql",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const engine = fs.readFileSync("src/continuous_watchdog.js", "utf8");
const index = fs.readFileSync("src/index_v102.js", "utf8");
const ui = fs.readFileSync("public/v102-watchdog.js", "utf8");
const wrangler = fs.readFileSync("wrangler.toml", "utf8");

for (const token of [
  "CONTINUOUS_DRAW_WATCHDOG",
  "watchdog_started_at",
  "watchdog_cycles",
  "watchdog_daily",
  "LATEST_RESULT_HAS_NO_CURRENT_LOCK",
  "CURRENT_LOCK_NOT_OBSERVED",
  "browserNotRequired",
  "noHistoricalLockReconstruction",
]) {
  if (!engine.includes(token)) throw new Error(`Watchdog engine missing token: ${token}`);
}
if (!index.includes("/api/watchdog") || !index.includes("/api/watchdog/run")) throw new Error("Watchdog endpoint missing");
if (!index.includes('trigger: "scheduled"')) throw new Error("Scheduled watchdog authority missing");
if (!ui.includes("WATCHDOG 🛰️") || !ui.includes("Manual cycle tidak dihitung")) throw new Error("Watchdog UI guardrail missing");
if (!wrangler.includes('main = "src/index_v102.js"')) throw new Error("wrangler main is not V1.0.2");
if (!wrangler.includes('crons = ["* * * * *"]')) throw new Error("watchdog cron is not every minute");
console.log("watchdog smoke: PASS");
