import fs from "node:fs";

const requiredFiles = [
  "src/learner_continuity_guard.js",
  "src/index_v104.js",
  "public/v104-continuity.js",
  "public/v104-continuity.css",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const engine = fs.readFileSync("src/learner_continuity_guard.js", "utf8");
const index = fs.readFileSync("src/index_v104.js", "utf8");
const ui = fs.readFileSync("public/v104-continuity.js", "utf8");
const wrangler = fs.readFileSync("wrangler.toml", "utf8");

for (const token of [
  "FORWARD_LOCK_CONTINUITY_GUARD",
  "rawResultIsDenominator",
  "noHistoricalPredictionReconstruction",
  "missingKeeperPeriods",
  "missingForwardPeriods",
  "learnerShortfall",
]) {
  if (!engine.includes(token)) throw new Error(`Continuity engine missing token: ${token}`);
}
if (!index.includes("/api/learner-continuity")) throw new Error("Continuity endpoint missing");
if (!index.includes("v104-continuity.js") || !index.includes("v104-continuity.css")) throw new Error("Continuity UI injection missing");
if (!ui.includes("CONTINUITY 🔗") || !ui.includes("NO HINDSIGHT")) throw new Error("Continuity UI guardrail missing");
if (!/main = "src\/index_v10[4-9]\.js"/.test(wrangler)) throw new Error("active worker no longer includes V1.0.4+ continuity lineage");
if (!wrangler.includes('crons = ["* * * * *"]')) throw new Error("1-minute cron was lost");
console.log("learner-continuity smoke: PASS");
