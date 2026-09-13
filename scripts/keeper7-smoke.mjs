import { runKeeper7Engine, walkForwardKeeper7 } from "../src/keeper7.js";

const rows = Array.from({ length: 180 }, (_, index) => {
  const hour = (12 - (index % 24) + 24) % 24;
  const value = String((550 + index * 137 + index * index * 7) % 1000).padStart(3, "0");
  return {
    period: 26000 - index,
    result: value,
    drawTime: `${String(hour).padStart(2, "0")}:00`,
  };
});
rows[0] = { period: 25537, result: "550", drawTime: "12:00 PM" };

const models = [
  { label: "Legacy Ensemble", top3: ["220", "250", "420"], top10: ["220", "250", "420", "240", "150", "550", "229", "486", "572", "187"] },
  { label: "DigitBoost GBS", top3: ["550", "572", "187"], top10: ["550", "572", "187", "571", "579", "420", "240", "229", "150", "486"] },
  { label: "Hybrid Reranker", top3: ["240", "229", "150"], top10: ["240", "229", "150", "250", "420", "550", "486", "572", "187", "571"] },
];

const engine = runKeeper7Engine(rows, { models });
if (engine.keep7.length !== 7) throw new Error("Keeper7 must return exactly 7 kept digits.");
if (engine.drop3.length !== 3) throw new Error("Keeper7 must return exactly 3 dropped digits.");
if (new Set(engine.keep7).size !== 7 || new Set(engine.drop3).size !== 3) throw new Error("Keeper7 digits must be unique.");
const partition = [...engine.keep7, ...engine.drop3].map(Number).sort((a, b) => a - b).join("");
if (partition !== "0123456789") throw new Error(`Keeper7 partition invalid: ${partition}`);
if (engine.assistedTop3.length !== 3 || !engine.assistedTop3.every((row) => /^\d{3}$/.test(row.number))) throw new Error("Keeper7 3D assist invalid.");
if (engine.targetHour !== 13) throw new Error(`Keeper7 target hour invalid: ${engine.targetHour}`);

const validation = walkForwardKeeper7(rows, { minTrain: 80, maxTargets: 12 });
if (validation.targets !== 12) throw new Error(`Keeper7 walk-forward target count invalid: ${validation.targets}`);
if (!Number.isFinite(validation.all3RatePct) || !Number.isFinite(validation.baselinePct)) throw new Error("Keeper7 walk-forward metrics invalid.");

console.log(JSON.stringify({
  ok: true,
  version: engine.version,
  keep7: engine.keep7,
  drop3: engine.drop3,
  targetHour: engine.targetHour,
  assistedTop3: engine.assistedTop3.map((row) => row.number),
  validation,
}, null, 2));
