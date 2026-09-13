import assert from "node:assert/strict";
import {
  buildEuropeModelStack,
  europeSlotKey,
  runEuropeKeeper7,
  scoreEuropeKeeper,
  scoreEuropeModels,
} from "../src/europe_engine.js";
import { runEuropePilot } from "../src/europe_pilot.js";

assert.equal(typeof runEuropePilot, "function");
assert.equal(europeSlotKey("2026-09-13 14:15:01"), 19);

const rows = [];
let minute = 14 * 60 + 15;
for (let i = 0; i < 180; i += 1) {
  const period = 16084 - i;
  const value = (137 + i * 73 + (i % 11) * 17) % 1000;
  const dayOffset = Math.floor((minute - i * 45) / 1440);
  let minuteOfDay = (minute - i * 45) % 1440;
  if (minuteOfDay < 0) minuteOfDay += 1440;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  const date = new Date(Date.UTC(2026, 8, 13 + dayOffset));
  const yyyy = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const nextMinute = (minuteOfDay + 45) % 1440;
  const nh = String(Math.floor(nextMinute / 60)).padStart(2, "0");
  const nm = String(nextMinute % 60).padStart(2, "0");
  rows.push({
    period,
    result: String(value).padStart(3, "0"),
    datetime: `${yyyy}-${mo}-${dd} ${hh}:${mm}:01`,
    nextDrawTime: i === 0 ? `${yyyy}-${mo}-${dd} ${nh}:${nm}:00` : null,
  });
}

const stack = buildEuropeModelStack(rows);
assert.equal(stack.models.length, 4);
assert.equal(stack.models.every((model) => model.top3.length === 3), true);

const keeper = runEuropeKeeper7(rows, { models: stack.models });
assert.equal(keeper.keep7.length, 7);
assert.equal(keeper.drop3.length, 3);
assert.equal(new Set([...keeper.keep7, ...keeper.drop3]).size, 10);
assert.equal(keeper.assistedTop3.length, 3);
assert.equal(Object.keys(keeper.componentSnapshot.components).includes("slot"), true);

const modelScores = scoreEuropeModels("137", stack.models);
assert.equal(modelScores.length, 4);
const keeperScore = scoreEuropeKeeper("137", keeper);
assert.equal(Number.isInteger(keeperScore.covered), true);
assert.equal(keeperScore.covered >= 0 && keeperScore.covered <= 3, true);

console.log("Europe V1 smoke PASS");
