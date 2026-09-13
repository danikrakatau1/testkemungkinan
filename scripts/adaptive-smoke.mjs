import assert from "node:assert/strict";
import { deriveAdaptiveWeightsFromLosses } from "../src/adaptive_learner.js";

const cold = deriveAdaptiveWeightsFromLosses({}, 0);
assert.ok(Math.abs(Object.values(cold).reduce((a, b) => a + b, 0) - 1) < 1e-4, "cold weights must sum to 1");
assert.ok(Math.abs(cold.recent - 0.36) < 0.01, "cold state should stay near base recent weight");
assert.ok(Math.abs(cold.global - 0.19) < 0.01, "cold state should stay near base global weight");

const learned = deriveAdaptiveWeightsFromLosses({
  recent: { samples: 24, avgLogLoss: 2.03 },
  global: { samples: 24, avgLogLoss: 2.28 },
  hour: { samples: 24, avgLogLoss: 2.42 },
  transition: { samples: 24, avgLogLoss: 2.55 },
  model: { samples: 24, avgLogLoss: 2.10 },
}, 24);

const sum = Object.values(learned).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(sum - 1) < 1e-4, "learned weights must sum to 1");
assert.ok(learned.recent > cold.recent, "lower-loss recent evidence should earn more weight");
assert.ok(learned.transition < cold.transition, "higher-loss transition evidence should lose weight");
assert.ok(learned.recent >= 0.24 && learned.recent <= 0.46, "recent stays bounded");
assert.ok(learned.global >= 0.12 && learned.global <= 0.28, "global stays bounded");
assert.ok(learned.hour >= 0.08 && learned.hour <= 0.28, "hour stays bounded");
assert.ok(learned.transition >= 0.08 && learned.transition <= 0.28, "transition stays bounded");
assert.ok(learned.model >= 0.04 && learned.model <= 0.18, "model stays bounded");

console.log("adaptive-smoke: PASS", learned);
