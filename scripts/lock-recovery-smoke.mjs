import fs from "node:fs";

const requiredFiles = [
  "src/forward_lock_recovery.js",
  "src/index_v101.js",
  "public/v101-recovery.js",
  "public/v101-recovery.css",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const engine = fs.readFileSync("src/forward_lock_recovery.js", "utf8");
const index = fs.readFileSync("src/index_v101.js", "utf8");
const ui = fs.readFileSync("public/v101-recovery.js", "utf8");
const wrangler = fs.readFileSync("wrangler.toml", "utf8");

for (const token of [
  "READ_ONLY_FORWARD_LOCK_RECOVERY_AUDIT",
  "VERIFIED_LOCK_NOT_OBSERVED",
  "TRULY_MISSING_LEARNER_LOCK",
  "noHistoricalPredictionGeneration",
  "observerAbsenceDoesNotInvalidateAnOriginalForwardLock",
]) {
  if (!engine.includes(token)) throw new Error(`Recovery engine missing token: ${token}`);
}
if (!index.includes("/api/lock-recovery")) throw new Error("Recovery endpoint missing");
if (!index.includes("v101-recovery.js") || !index.includes("v101-recovery.css")) throw new Error("Recovery UI injection missing");
if (!ui.includes("RECOVERY 🔬") || !ui.includes("NO HINDSIGHT")) throw new Error("Recovery UI guardrail missing");
if (!wrangler.includes('main = "src/index_v101.js"')) throw new Error("wrangler main is not V1.0.1");
console.log("lock-recovery smoke: PASS");
