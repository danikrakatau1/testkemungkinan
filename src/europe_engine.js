import { runModelArena } from "./arena.js";
import { runTwoStageEngine } from "./two_stage.js";

export const EUROPE_ENGINE_VERSION = "1.0.0";
export const EUROPE_DEFAULT_WEIGHTS = Object.freeze({
  recent: 0.36,
  global: 0.19,
  slot: 0.18,
  transition: 0.17,
  model: 0.10,
});

const DIGITS = 10;
const POSITIONS = 3;
const KEEP_SIZE = 7;
const EPS = 1e-9;
const RECENT_WINDOWS = [8, 20, 50, 120];
const RECENT_WEIGHTS = [0.34, 0.28, 0.22, 0.16];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  return Number(Number(value || 0).toFixed(digits));
}

export function normalizeEurope3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function digitAt(value, position) {
  return Number(String(value || "000")[position] || 0);
}

function parseClock(value) {
  const text = String(value || "");
  const match = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute, minuteOfDay: hour * 60 + minute };
}

export function europeSlotKey(value) {
  const clock = parseClock(value);
  if (!clock) return null;
  return Math.floor(clock.minuteOfDay / 45) % 32;
}

export function sanitizeEuropeRows(input) {
  const rows = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const result = normalizeEurope3(typeof raw === "object" ? raw?.result : raw);
    if (!result) continue;
    rows.push({
      period: Number(raw?.period || 0) || null,
      result,
      datetime: raw?.datetime ?? raw?.draw_datetime ?? null,
      nextDrawTime: raw?.nextDrawTime ?? raw?.next_draw_time ?? null,
    });
  }
  return rows;
}

function normalize(values) {
  const safe = values.map((value) => Math.max(EPS, Number(value) || 0));
  const total = safe.reduce((sum, value) => sum + value, 0) || 1;
  return safe.map((value) => value / total);
}

function normalizedWeights(input = {}) {
  const keys = ["recent", "global", "slot", "transition", "model"];
  const raw = {};
  for (const key of keys) {
    const value = Number(input[key] ?? EUROPE_DEFAULT_WEIGHTS[key]);
    raw[key] = Number.isFinite(value) && value >= 0 ? value : EUROPE_DEFAULT_WEIGHTS[key];
  }
  const total = keys.reduce((sum, key) => sum + raw[key], 0) || 1;
  return Object.fromEntries(keys.map((key) => [key, raw[key] / total]));
}

function positionDistribution(rows, position, limit, decay) {
  const counts = Array(DIGITS).fill(0.55);
  let total = 0.55 * DIGITS;
  for (let i = 0; i < Math.min(rows.length, limit); i += 1) {
    const weight = decay ** i;
    counts[digitAt(rows[i].result, position)] += weight;
    total += weight;
  }
  return counts.map((value) => value / total);
}

function recentDistribution(rows, position) {
  const mixed = Array(DIGITS).fill(0);
  RECENT_WINDOWS.forEach((window, index) => {
    const dist = positionDistribution(rows, position, window, 0.97);
    for (let digit = 0; digit < DIGITS; digit += 1) mixed[digit] += dist[digit] * RECENT_WEIGHTS[index];
  });
  return normalize(mixed);
}

function slotDistribution(rows, position, targetSlot, fallback) {
  if (!Number.isInteger(targetSlot)) return { distribution: fallback, samples: 0, reliability: 0 };
  const matched = rows.filter((row) => europeSlotKey(row.datetime) === targetSlot).slice(0, 240);
  if (!matched.length) return { distribution: fallback, samples: 0, reliability: 0 };
  const local = positionDistribution(matched, position, matched.length, 0.993);
  const reliability = clamp(matched.length / 18, 0, 0.82);
  return {
    distribution: normalize(local.map((value, digit) => value * reliability + fallback[digit] * (1 - reliability))),
    samples: matched.length,
    reliability,
  };
}

function transitionDistribution(rows, position, fallback) {
  const source = digitAt(rows[0]?.result, position);
  const counts = Array(DIGITS).fill(0.4);
  let matches = 0;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const newer = rows[i];
    const older = rows[i + 1];
    if (digitAt(older.result, position) !== source) continue;
    const weight = 0.993 ** i;
    counts[digitAt(newer.result, position)] += weight;
    matches += weight;
  }
  const local = normalize(counts);
  const reliability = clamp(matches / 16, 0, 0.72);
  return {
    distribution: normalize(local.map((value, digit) => value * reliability + fallback[digit] * (1 - reliability))),
    samples: round(matches, 2),
    reliability,
  };
}

function canonicalModelKey(model) {
  const text = `${model?.id || ""} ${model?.label || ""}`.toLowerCase();
  if (/two.?stage/.test(text)) return "two-stage";
  if (/hybrid/.test(text)) return "hybrid";
  if (/digit.?boost/.test(text)) return "digitboost";
  if (/legacy/.test(text)) return "legacy";
  return String(model?.id || model?.label || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function modelEvidence(models, modelTrust = {}) {
  const matrix = Array.from({ length: POSITIONS }, () => Array(DIGITS).fill(0.08));
  const consensus = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    const key = canonicalModelKey(model);
    const trust = clamp(Number(modelTrust[key] ?? 1), 0.65, 1.35);
    const top10 = (model.top10 || model.top3 || [])
      .map((row) => normalizeEurope3(row?.number ?? row))
      .filter(Boolean)
      .slice(0, 10);
    top10.forEach((number, index) => {
      const rankWeight = trust / (1 + index * 0.34);
      for (let pos = 0; pos < POSITIONS; pos += 1) matrix[pos][digitAt(number, pos)] += rankWeight;
      const current = consensus.get(number) || { score: 0, sources: [] };
      current.score += ((11 - (index + 1)) / 10) * trust;
      if (!current.sources.includes(key)) current.sources.push(key);
      consensus.set(number, current);
    });
  }
  const maxConsensus = Math.max(1, ...[...consensus.values()].map((row) => row.score));
  for (const row of consensus.values()) row.score /= maxConsensus;
  return { distributions: matrix.map(normalize), consensus };
}

function buildComponents(rows, targetSlot, models, weights, modelTrust) {
  const global = [];
  const recent = [];
  const slot = [];
  const transition = [];
  const model = modelEvidence(models, modelTrust);
  const final = [];
  const diagnostics = [];

  for (let pos = 0; pos < POSITIONS; pos += 1) {
    const globalDist = positionDistribution(rows, pos, Math.min(rows.length, 1500), 0.996);
    const recentDist = recentDistribution(rows, pos);
    const slotInfo = slotDistribution(rows, pos, targetSlot, globalDist);
    const transitionInfo = transitionDistribution(rows, pos, globalDist);
    const modelDist = model.distributions[pos];
    final.push(normalize(Array.from({ length: DIGITS }, (_, digit) => (
      recentDist[digit] * weights.recent +
      globalDist[digit] * weights.global +
      slotInfo.distribution[digit] * weights.slot +
      transitionInfo.distribution[digit] * weights.transition +
      modelDist[digit] * weights.model
    ))));
    global.push(globalDist);
    recent.push(recentDist);
    slot.push(slotInfo.distribution);
    transition.push(transitionInfo.distribution);
    diagnostics.push({
      position: pos,
      slotSamples: slotInfo.samples,
      slotReliability: round(slotInfo.reliability, 3),
      transitionSamples: transitionInfo.samples,
      transitionReliability: round(transitionInfo.reliability, 3),
    });
  }

  return { global, recent, slot, transition, model: model.distributions, consensus: model.consensus, final, diagnostics };
}

function combinations7() {
  const out = [];
  const current = [];
  const visit = (start) => {
    if (current.length === KEEP_SIZE) return void out.push([...current]);
    for (let digit = start; digit < DIGITS; digit += 1) {
      current.push(digit);
      visit(digit + 1);
      current.pop();
    }
  };
  visit(0);
  return out;
}

const ALL_KEEP7 = combinations7();

function covers(set, result) {
  const allowed = new Set(set);
  return [0, 1, 2].every((pos) => allowed.has(digitAt(result, pos)));
}

function empiricalCoverage(rows, set, limit, targetSlot = null) {
  const selected = targetSlot == null
    ? rows.slice(0, limit)
    : rows.filter((row) => europeSlotKey(row.datetime) === targetSlot).slice(0, limit);
  if (!selected.length) return { rate: 0.343, samples: 0 };
  let hits = 0;
  let total = 0;
  selected.forEach((row, index) => {
    const weight = 0.988 ** index;
    total += weight;
    if (covers(set, row.result)) hits += weight;
  });
  return { rate: total ? hits / total : 0.343, samples: selected.length };
}

function chooseKeeper(rows, final, targetSlot) {
  return ALL_KEEP7.map((set) => {
    const masses = final.map((dist) => set.reduce((sum, digit) => sum + dist[digit], 0));
    const massProduct = masses.reduce((product, value) => product * clamp(value, EPS, 1), 1);
    const recent = empiricalCoverage(rows, set, 80, null);
    const slot = empiricalCoverage(rows, set, 160, targetSlot);
    const slotWeight = slot.samples >= 8 ? 0.12 : slot.samples >= 3 ? 0.06 : 0.02;
    return {
      set,
      masses,
      massProduct,
      recent,
      slot,
      score: massProduct * (0.82 - slotWeight) + recent.rate * 0.16 + slot.rate * slotWeight,
    };
  }).sort((a, b) => b.score - a.score || b.massProduct - a.massProduct || a.set.join("").localeCompare(b.set.join("")))[0];
}

function rankDigits(final, keepSet) {
  const keep = new Set(keepSet);
  return Array.from({ length: DIGITS }, (_, digit) => {
    const avg = final.reduce((sum, dist) => sum + dist[digit], 0) / POSITIONS;
    const max = Math.max(...final.map((dist) => dist[digit]));
    return { digit, keep: keep.has(digit), score: avg * 0.78 + max * 0.22 };
  }).sort((a, b) => b.score - a.score || a.digit - b.digit);
}

function assisted3d(final, keepSet, consensus) {
  const keep = new Set(keepSet);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    const probs = [0, 1, 2].map((pos) => final[pos][digitAt(number, pos)]);
    const logMass = probs.reduce((sum, value) => sum + Math.log(value + EPS), 0);
    const keepCount = [0, 1, 2].reduce((sum, pos) => sum + Number(keep.has(digitAt(number, pos))), 0);
    const model = consensus.get(number) || { score: 0, sources: [] };
    rows.push({ number, logMass, keepCount, model: model.score, sources: model.sources });
  }
  const minLog = Math.min(...rows.map((row) => row.logMass));
  const maxLog = Math.max(...rows.map((row) => row.logMass));
  const span = Math.max(EPS, maxLog - minLog);
  rows.forEach((row) => {
    const mass = (row.logMass - minLog) / span;
    row.score = mass * 0.50 + (row.keepCount / 3) * 0.28 + row.model * 0.22;
  });
  rows.sort((a, b) => b.score - a.score || a.number.localeCompare(b.number));
  return rows.slice(0, 10).map((row, index) => ({
    rank: index + 1,
    number: row.number,
    keepDigits: row.keepCount,
    consensusSources: row.sources,
    score: round(row.score * 100, 2),
  }));
}

export function runEuropeKeeper7(rowsInput, options = {}) {
  const rows = sanitizeEuropeRows(rowsInput);
  if (rows.length < 40) throw new Error("Europe Keeper7 memerlukan minimal 40 draw.");
  const weights = normalizedWeights(options.weights);
  const models = Array.isArray(options.models) ? options.models : [];
  const modelTrust = options.modelTrust || {};
  const targetSlot = Number.isInteger(options.targetSlot)
    ? options.targetSlot
    : europeSlotKey(rows[0]?.nextDrawTime);
  const components = buildComponents(rows, targetSlot, models, weights, modelTrust);
  const winner = chooseKeeper(rows, components.final, targetSlot);
  const digitRanking = rankDigits(components.final, winner.set);
  const keep7 = digitRanking.filter((row) => row.keep).map((row) => row.digit);
  const drop3 = digitRanking.filter((row) => !row.keep).sort((a, b) => a.score - b.score || b.digit - a.digit).map((row) => row.digit);
  const assisted = assisted3d(components.final, winner.set, components.consensus);

  return {
    version: EUROPE_ENGINE_VERSION,
    engine: "Europe 45m Keeper7",
    anchorPeriod: rows[0]?.period ?? null,
    anchorResult: rows[0]?.result ?? null,
    targetSlot,
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value, 6)])),
    keep7,
    drop3,
    keepSetAscending: [...winner.set],
    coverageMassPct: round(winner.massProduct * 100, 2),
    recentCoveragePct: round(winner.recent.rate * 100, 2),
    slotCoveragePct: round(winner.slot.rate * 100, 2),
    slotSamples: winner.slot.samples,
    assistedTop3: assisted.slice(0, 3),
    assistedTop10: assisted,
    diagnostics: components.diagnostics,
    componentSnapshot: {
      targetSlot,
      weights,
      components: {
        recent: components.recent,
        global: components.global,
        slot: components.slot,
        transition: components.transition,
        model: components.model,
      },
    },
  };
}

export function buildEuropeModelStack(rowsInput, options = {}) {
  const rows = sanitizeEuropeRows(rowsInput);
  const history = rows.map((row) => row.result);
  if (history.length < 40) throw new Error("Europe model stack memerlukan minimal 40 draw.");
  const arena = runModelArena(history, { decay: Number(options.decay || 0.90) });
  const twoStage = runTwoStageEngine(history, { decay: Number(options.decay || 0.90) });
  const models = [
    ...(arena.models || []),
    {
      id: "two-stage",
      label: "Two-Stage Europe",
      top3: twoStage.top3 || [],
      top10: twoStage.top10 || [],
    },
  ];
  return { arena, twoStage, models };
}

function digitOverlap(actual, candidate) {
  const a = String(actual).split("");
  const b = String(candidate).split("");
  const counts = new Map();
  b.forEach((digit) => counts.set(digit, (counts.get(digit) || 0) + 1));
  let hits = 0;
  for (const digit of a) {
    const n = counts.get(digit) || 0;
    if (n > 0) {
      hits += 1;
      counts.set(digit, n - 1);
    }
  }
  return hits;
}

function positionHits(actual, candidate) {
  return [0, 1, 2].reduce((sum, pos) => sum + Number(actual[pos] === candidate[pos]), 0);
}

function permutationKey(value) {
  return String(value).split("").sort().join("");
}

export function scoreEuropeModels(actualInput, models = []) {
  const actual = normalizeEurope3(actualInput);
  if (!actual) return [];
  return (Array.isArray(models) ? models : []).map((model) => {
    const top3 = (model.top3 || []).map((row) => normalizeEurope3(row?.number ?? row)).filter(Boolean).slice(0, 3);
    const top10 = (model.top10 || model.top3 || []).map((row) => normalizeEurope3(row?.number ?? row)).filter(Boolean).slice(0, 10);
    const candidates = top10.length ? top10 : top3;
    let bestDigitOverlap = 0;
    let bestPositionHits = 0;
    let bestCandidate = null;
    for (const candidate of candidates) {
      const overlap = digitOverlap(actual, candidate);
      const positions = positionHits(actual, candidate);
      if (positions > bestPositionHits || (positions === bestPositionHits && overlap > bestDigitOverlap)) bestCandidate = candidate;
      bestDigitOverlap = Math.max(bestDigitOverlap, overlap);
      bestPositionHits = Math.max(bestPositionHits, positions);
    }
    const poolDigits = new Set(candidates.join("").split(""));
    const poolDigitCoverage = String(actual).split("").reduce((sum, digit) => sum + Number(poolDigits.has(digit)), 0);
    return {
      modelId: canonicalModelKey(model),
      label: model.label || model.id,
      exactTop3: top3.includes(actual),
      top10Hit: top10.includes(actual),
      permutationHit: candidates.some((value) => permutationKey(value) === permutationKey(actual)),
      bestDigitOverlap,
      bestPositionHits,
      poolDigitCoverage,
      bestCandidate,
    };
  });
}

export function scoreEuropeKeeper(actualInput, keeper) {
  const actual = normalizeEurope3(actualInput);
  if (!actual || !keeper) return null;
  const allowed = new Set(keeper.keepSetAscending || keeper.keep7 || []);
  const covered = [0, 1, 2].reduce((sum, pos) => sum + Number(allowed.has(Number(actual[pos]))), 0);
  return {
    covered,
    all3: covered === 3,
    atLeast2: covered >= 2,
  };
}
