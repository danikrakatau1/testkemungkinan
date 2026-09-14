import fs from "node:fs";

const requiredFiles = [
  "src/prediction_intelligence_score.js",
  "src/index_v103.js",
  "public/v103-intelligence.js",
  "public/v103-intelligence.css",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const engine = fs.readFileSync("src/prediction_intelligence_score.js", "utf8");
const index = fs.readFileSync("src/index_v103.js", "utf8");
const ui = fs.readFileSync("public/v103-intelligence.js", "utf8");
const wrangler = fs.readFileSync("wrangler.toml", "utf8");

for (const token of [
  "READ_ONLY_PREDICTION_INTELLIGENCE_SCORE",
  "scoreIsProbability: false",
  "scoreIsWinChance: false",
  "calibratedEdgeClaimStillRequiresEdgeAudit",
  "rollingLiftMax: 35",
  "rollingStabilityMax: 20",
]) {
  if (!engine.includes(token)) throw new Error(`Intelligence engine missing token: ${token}`);
}
if (!index.includes("/api/intelligence-score")) throw new Error("Intelligence endpoint missing");
if (!index.includes("v103-intelligence.js") || !index.includes("v103-intelligence.css")) throw new Error("Intelligence UI injection missing");
if (!ui.includes("INTELLIGENCE 🧠") || !ui.includes("NOT WIN PROBABILITY")) throw new Error("Intelligence UI guardrail missing");
if (!wrangler.includes('main = "src/index_v103.js"')) throw new Error("wrangler main is not V1.0.3");
if (!wrangler.includes('crons = ["* * * * *"]')) throw new Error("1-minute cron was lost");
console.log("prediction-intelligence smoke: PASS");
