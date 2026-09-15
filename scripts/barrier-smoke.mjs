import fs from "node:fs";

const requiredFiles = [
  "src/sequential_lock_barrier.js",
  "src/index_v105.js",
  "public/v105-barrier.js",
  "public/v105-barrier.css",
  "migrations/0012_sequential_lock_barrier.sql",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const engine = fs.readFileSync("src/sequential_lock_barrier.js", "utf8");
const index = fs.readFileSync("src/index_v105.js", "utf8");
const ui = fs.readFileSync("public/v105-barrier.js", "utf8");
const wrangler = fs.readFileSync("wrangler.toml", "utf8");

for (const token of [
  "SOURCE_TO_LOCK_SEQUENTIAL_BARRIER",
  "SOURCE_ADVANCED_BEFORE_CURRENT_CHAIN_LOCKED",
  "SOURCE_JUMP",
  "transitionPass",
  "sequential_barrier_gaps",
  "noHistoricalPredictionReconstruction",
]) {
  if (!engine.includes(token)) throw new Error(`Barrier engine missing token: ${token}`);
}
if (!index.includes("/api/sequential-barrier") || !index.includes("runSequentialLockBarrierCycle")) throw new Error("Barrier endpoints/scheduled authority missing");
if (!index.includes('trigger: "scheduled"')) throw new Error("V1.0.5 scheduled authority missing");
if (!ui.includes("BARRIER 🛡️") || !ui.includes("Manual check tidak dihitung")) throw new Error("Barrier UI guardrail missing");
if (!/main = "src\/index_v105\.js"/.test(wrangler)) throw new Error("wrangler main is not V1.0.5");
if (!wrangler.includes('crons = ["* * * * *"]')) throw new Error("1-minute cron was lost");
console.log("sequential-lock-barrier smoke: PASS");
