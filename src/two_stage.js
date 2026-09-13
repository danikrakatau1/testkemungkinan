import { rankHistory, sanitizeHistory } from "./analyzer.js";

export const TWO_STAGE_VERSION = "0.9.0";

const POSITIONS = 3;
const DIGITS = 10;
const WINDOWS = [4, 8, 12, 20, 40];
const WINDOW_WEIGHTS = [0.30, 0.24, 0.19, 0.15, 0.12];
const LABELS = ["Ratusan", "Puluhan", "Satuan"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function digitAt(value, position) {
  return Number(String(value || "000")[position] || 0);
}

function normalizeDistribution(values) {
  const safe = values.map((value) => Math.max(1e-9, Number(value) || 0));
  const total = safe.reduce((sum, value) => sum + value, 0) || 1;
  return safe.map((value) => value / total);
}

function positionFrequency(history, position, digit, limit) {
  const rows = history.slice(0, Math.min(limit, history.length));
  if (!rows.length) return 0.1;
  let hits = 0;
  for (const value of rows) if (digitAt(value, position) === digit) hits += 1;
  return (hits + 0.35) / (rows.length + 3.5);
}

function transitionProbability(history, position, candidate) {
  if (history.length < 2) return 0.1;
  const source = digitAt(history[0], position);
  let total = 0;
  let hits = 0;
  for (let i = 0; i < history.length - 1; i += 1) {
    const newer = history[i];
    const older = history[i + 1];
    if (digitAt(older, position) !== source) continue;
    total += 1;
    if (digitAt(newer, position) === candidate) hits += 1;
  }
  return (hits + 0.35) / (total + 3.5);
}

function inverseGap(history, position, candidate) {
  for (let i = 0; i < Math.min(history.length, 80); i += 1) {
    if (digitAt(history[i], position) === candidate) return 1 / (1 + i);
  }
  return 0;
}

function latestStreak(history, position) {
  if (!history.length) return 0;
  const digit = digitAt(history[0], position);
  let count = 0;
  for (const value of history) {
    if (digitAt(value, position) !== digit) break;
    count += 1;
  }
  return count;
}

function entropyOfDigits(values) {
  if (!values.length) return 0;
  const counts = Array(DIGITS).fill(0);
  values.forEach((digit) => { counts[digit] += 1; });
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / values.length;
    entropy -= p * Math.log(p);
  }
  return entropy / Math.log(Math.min(DIGITS, values.length));
}

function classifyPosition(history, position) {
  const newest = history.slice(0, 8).map((value) => digitAt(value, position));
  const fourNewest = newest.slice(0, 4);
  const chronological = [...fourNewest].reverse();
  const streak = latestStreak(history, position);
  const unique = new Set(fourNewest).size;
  let changes = 0;
  for (let i = 1; i < fourNewest.length; i += 1) if (fourNewest[i] !== fourNewest[i - 1]) changes += 1;

  const freq8 = Array.from({ length: DIGITS }, (_, digit) => ({ digit, p: positionFrequency(history, position, digit, 8) }))
    .sort((a, b) => b.p - a.p || a.digit - b.digit);
  const dominance = clamp((freq8[0]?.p || 0) - (freq8[1]?.p || 0), 0, 1);
  const entropy = entropyOfDigits(newest);

  let regime = "transitioning";
  let reason = "recent sequence is changing without one dominant rule";
  if (streak >= 3) {
    regime = "persistent";
    reason = `digit ${fourNewest[0]} bertahan ${streak} draw pada posisi ini`;
  } else if (fourNewest.length >= 4 && fourNewest[0] === fourNewest[3] && unique >= 2) {
    regime = "returning";
    reason = `digit ${fourNewest[0]} kembali setelah ${fourNewest.slice(1, 3).join("→")}`;
  } else if (changes >= 3 && unique >= 3) {
    regime = "volatile";
    reason = "4 draw terakhir berubah hampir setiap draw";
  } else if (unique === fourNewest.length && fourNewest.length >= 4) {
    regime = "rotating";
    reason = "recent digits berputar tanpa pengulangan langsung";
  }

  const regimeConfidence = clamp(
    regime === "persistent" ? 0.58 + Math.min(streak, 5) * 0.07 + dominance * 0.25
      : regime === "returning" ? 0.54 + (1 - entropy) * 0.18 + dominance * 0.18
        : regime === "volatile" ? 0.50 + entropy * 0.28
          : regime === "rotating" ? 0.49 + entropy * 0.22
            : 0.46 + dominance * 0.24,
    0.42,
    0.92,
  );

  return {
    position,
    label: LABELS[position],
    regime,
    confidence: round(regimeConfidence, 4),
    confidencePct: round(regimeConfidence * 100, 1),
    sequence: chronological,
    latestDigit: fourNewest[0] ?? null,
    streak,
    entropy: round(entropy, 4),
    reason,
  };
}

function regimeBonus(flow, history, position, candidate) {
  const recent = history.slice(0, 5).map((value) => digitAt(value, position));
  if (!recent.length) return 0;
  if (flow.regime === "persistent") return candidate === recent[0] ? 0.28 : -0.035;
  if (flow.regime === "returning") {
    const returnTarget = recent[3] ?? recent[0];
    return candidate === returnTarget ? 0.18 : candidate === recent[0] ? 0.08 : 0;
  }
  if (flow.regime === "volatile") {
    return recent.slice(0, 2).includes(candidate) ? -0.018 : 0.035;
  }
  if (flow.regime === "rotating") {
    return recent.slice(0, 3).includes(candidate) ? -0.01 : 0.045;
  }
  return candidate === recent[0] ? 0.055 : 0;
}

function stageOne(history, flows) {
  return flows.map((flow, position) => {
    const raw = [];
    for (let candidate = 0; candidate < DIGITS; candidate += 1) {
      let multiWindow = 0;
      WINDOWS.forEach((window, index) => {
        multiWindow += positionFrequency(history, position, candidate, window) * WINDOW_WEIGHTS[index];
      });
      const transition = transitionProbability(history, position, candidate);
      const gap = inverseGap(history, position, candidate);
      const longFreq = positionFrequency(history, position, candidate, 80);
      const regime = regimeBonus(flow, history, position, candidate);
      const score = multiWindow * 0.55 + transition * 0.22 + gap * 0.08 + longFreq * 0.15 + regime;
      raw.push(Math.max(1e-7, score));
    }
    const distribution = normalizeDistribution(raw);
    const ranked = distribution
      .map((probability, digit) => ({ digit, probability: round(probability, 7), pct: round(probability * 100, 2) }))
      .sort((a, b) => b.probability - a.probability || a.digit - b.digit);
    return {
      position,
      label: LABELS[position],
      regime: flow.regime,
      digits: ranked.slice(0, 5),
      distribution,
    };
  });
}

function pairProbabilities(history) {
  const p01 = Array(100).fill(0.08);
  const p12 = Array(100).fill(0.08);
  let total = 8;
  history.slice(0, 100).forEach((value, index) => {
    const weight = 0.975 ** index;
    const a = digitAt(value, 0);
    const b = digitAt(value, 1);
    const c = digitAt(value, 2);
    p01[a * 10 + b] += weight;
    p12[b * 10 + c] += weight;
    total += weight;
  });
  return {
    p01: p01.map((value) => value / total),
    p12: p12.map((value) => value / total),
  };
}

function flowFit(number, flows, history) {
  let score = 0;
  for (let position = 0; position < POSITIONS; position += 1) {
    const candidate = digitAt(number, position);
    const latest = digitAt(history[0], position);
    const flow = flows[position];
    if (flow.regime === "persistent") score += candidate === latest ? 1 : 0.15;
    else if (flow.regime === "returning") {
      const target = history[3] ? digitAt(history[3], position) : latest;
      score += candidate === target ? 1 : candidate === latest ? 0.55 : 0.25;
    } else if (flow.regime === "volatile") score += candidate === latest ? 0.32 : 0.62;
    else if (flow.regime === "rotating") score += candidate === latest ? 0.35 : 0.68;
    else score += candidate === latest ? 0.68 : 0.5;
  }
  return score / POSITIONS;
}

function normalizeComponent(rows, key) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    min = Math.min(min, row[key]);
    max = Math.max(max, row[key]);
  }
  const span = Math.max(max - min, Number.EPSILON);
  rows.forEach((row) => { row[`${key}Norm`] = (row[key] - min) / span; });
}

function buildRanking(history, stage1, flows, legacyRanking) {
  const pairs = pairProbabilities(history);
  const legacyRank = new Map(legacyRanking.map((row) => [row.number, row.rank]));
  const rows = [];

  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    const a = digitAt(number, 0);
    const b = digitAt(number, 1);
    const c = digitAt(number, 2);
    const digitScore = (
      Math.log(stage1[0].distribution[a] + 1e-12) +
      Math.log(stage1[1].distribution[b] + 1e-12) +
      Math.log(stage1[2].distribution[c] + 1e-12)
    );
    const pairScore = Math.log(pairs.p01[a * 10 + b] + 1e-12) + Math.log(pairs.p12[b * 10 + c] + 1e-12);
    const legacyScore = (1001 - Number(legacyRank.get(number) || 1000)) / 1000;
    const flowScore = flowFit(number, flows, history);
    rows.push({ number, digitScore, pairScore, legacyScore, flowScore });
  }

  normalizeComponent(rows, "digitScore");
  normalizeComponent(rows, "pairScore");
  normalizeComponent(rows, "legacyScore");
  normalizeComponent(rows, "flowScore");

  rows.forEach((row) => {
    row.raw = row.digitScoreNorm * 0.50 + row.pairScoreNorm * 0.20 + row.legacyScoreNorm * 0.20 + row.flowScoreNorm * 0.10;
  });
  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));
  const max = rows[0]?.raw ?? 1;
  const min = rows.at(-1)?.raw ?? 0;
  const span = Math.max(max - min, Number.EPSILON);

  return rows.map((row, index) => ({
    rank: index + 1,
    number: row.number,
    score: round(((row.raw - min) / span) * 100, 2),
    components: {
      digit: round(row.digitScoreNorm * 100, 1),
      pairOrder: round(row.pairScoreNorm * 100, 1),
      legacy: round(row.legacyScoreNorm * 100, 1),
      flow: round(row.flowScoreNorm * 100, 1),
    },
  }));
}

function explanationFor(row, stage1, flows) {
  const positionReasons = [];
  for (let position = 0; position < POSITIONS; position += 1) {
    const digit = digitAt(row.number, position);
    const digitRow = stage1[position].digits.find((item) => item.digit === digit);
    const rank = stage1[position].digits.findIndex((item) => item.digit === digit);
    positionReasons.push({
      label: LABELS[position],
      digit,
      digitRank: rank >= 0 ? rank + 1 : null,
      digitPct: digitRow?.pct ?? round(stage1[position].distribution[digit] * 100, 2),
      regime: flows[position].regime,
    });
  }
  return {
    number: row.number,
    score: row.score,
    components: row.components,
    positions: positionReasons,
  };
}

export function runTwoStageEngine(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  if (history.length < 40) throw new Error("Two-Stage V0.9.0 memerlukan minimal 40 draw.");
  const decay = Number.isFinite(Number(options.decay)) ? Number(options.decay) : 0.90;
  const flows = Array.from({ length: POSITIONS }, (_, position) => classifyPosition(history, position));
  const stage1 = stageOne(history, flows);
  const { ranking: legacyRanking } = rankHistory(history, { decay, modelId: "ensemble" });
  const ranking = buildRanking(history, stage1, flows, legacyRanking);

  return {
    version: TWO_STAGE_VERSION,
    engine: "Two-Stage Pattern Flow + Permutation Reranker",
    historySize: history.length,
    latest: history[0],
    windows: WINDOWS,
    flows,
    stage1: stage1.map((row) => ({
      position: row.position,
      label: row.label,
      regime: row.regime,
      digits: row.digits,
    })),
    top3: ranking.slice(0, 3),
    top10: ranking.slice(0, 10),
    explanations: ranking.slice(0, 3).map((row) => explanationFor(row, stage1, flows)),
    ranking,
  };
}
