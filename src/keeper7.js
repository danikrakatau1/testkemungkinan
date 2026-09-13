export const KEEPER7_VERSION = "0.9.1";

const DIGITS = 10;
const POSITIONS = 3;
const KEEP_SIZE = 7;
const RECENT_WINDOWS = [8, 20, 50, 120];
const RECENT_WEIGHTS = [0.34, 0.28, 0.22, 0.16];
const EPS = 1e-9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  return Number(Number(value || 0).toFixed(digits));
}

export function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function digitAt(value, position) {
  return Number(String(value || "000")[position] || 0);
}

export function parseHour(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  if (!Number.isFinite(hour)) return null;
  const meridiem = String(match[3] || "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return hour;
}

export function nextHourFromRow(row) {
  const hour = parseHour(row?.drawTime ?? row?.draw_time);
  return hour == null ? null : (hour + 1) % 24;
}

export function sanitizeRows(input) {
  const rows = [];
  for (const row of Array.isArray(input) ? input : []) {
    const result = normalize3(typeof row === "object" ? row?.result : row);
    if (!result) continue;
    rows.push({
      period: Number(row?.period ?? 0) || null,
      result,
      drawDate: row?.drawDate ?? row?.draw_date ?? null,
      drawTime: row?.drawTime ?? row?.draw_time ?? null,
    });
  }
  return rows;
}

function normalize(values) {
  const safe = values.map((value) => Math.max(EPS, Number(value) || 0));
  const total = safe.reduce((sum, value) => sum + value, 0) || 1;
  return safe.map((value) => value / total);
}

function weightedPositionDistribution(rows, position, limit, decay = 0.985) {
  const counts = Array(DIGITS).fill(0.55);
  let total = 0.55 * DIGITS;
  const size = Math.min(rows.length, Math.max(1, limit));
  for (let i = 0; i < size; i += 1) {
    const weight = decay ** i;
    counts[digitAt(rows[i].result, position)] += weight;
    total += weight;
  }
  return counts.map((value) => value / total);
}

function hourPositionDistribution(rows, position, targetHour, fallback) {
  if (targetHour == null) return { distribution: fallback, samples: 0, reliability: 0 };
  const matches = rows.filter((row) => parseHour(row.drawTime) === targetHour).slice(0, 240);
  if (!matches.length) return { distribution: fallback, samples: 0, reliability: 0 };
  const local = weightedPositionDistribution(matches, position, matches.length, 0.993);
  const reliability = clamp(matches.length / 28, 0, 0.82);
  return {
    distribution: normalize(local.map((value, digit) => value * reliability + fallback[digit] * (1 - reliability))),
    samples: matches.length,
    reliability,
  };
}

function transitionDistribution(rows, position, sourceDigit, fallback) {
  const counts = Array(DIGITS).fill(0.4);
  let matches = 0;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const newer = rows[i];
    const older = rows[i + 1];
    if (digitAt(older.result, position) !== sourceDigit) continue;
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

function recentPositionDistribution(rows, position) {
  const mixed = Array(DIGITS).fill(0);
  RECENT_WINDOWS.forEach((window, index) => {
    const dist = weightedPositionDistribution(rows, position, window, 0.97);
    for (let digit = 0; digit < DIGITS; digit += 1) mixed[digit] += dist[digit] * RECENT_WEIGHTS[index];
  });
  return normalize(mixed);
}

function modelPositionEvidence(models) {
  const matrix = Array.from({ length: POSITIONS }, () => Array(DIGITS).fill(0.08));
  const candidates = [];
  for (const model of Array.isArray(models) ? models : []) {
    const label = String(model?.label || model?.id || "model");
    const top10 = (model?.top10 || model?.top3 || []).map((item) => normalize3(item?.number ?? item)).filter(Boolean).slice(0, 10);
    const top3 = (model?.top3 || []).map((item) => normalize3(item?.number ?? item)).filter(Boolean).slice(0, 3);
    const modelWeight = /two.?stage/i.test(label) ? 1.05 : /hybrid/i.test(label) ? 1.02 : 1;
    top10.forEach((number, index) => {
      const rankWeight = modelWeight * (1 / (1 + index * 0.34));
      for (let position = 0; position < POSITIONS; position += 1) matrix[position][digitAt(number, position)] += rankWeight;
      candidates.push({ number, weight: rankWeight, source: label, rank: index + 1 });
    });
    top3.forEach((number, index) => candidates.push({ number, weight: modelWeight * (1.4 - index * 0.18), source: label, rank: index + 1 }));
  }
  return { distributions: matrix.map(normalize), candidates };
}

function buildPositionDistributions(rows, targetHour, models) {
  const global = [];
  const recent = [];
  const hourly = [];
  const transition = [];
  const model = modelPositionEvidence(models);
  const final = [];
  const diagnostics = [];

  for (let position = 0; position < POSITIONS; position += 1) {
    const globalDist = weightedPositionDistribution(rows, position, Math.min(rows.length, 1500), 0.996);
    const recentDist = recentPositionDistribution(rows, position);
    const hour = hourPositionDistribution(rows, position, targetHour, globalDist);
    const sourceDigit = digitAt(rows[0]?.result, position);
    const trans = transitionDistribution(rows, position, sourceDigit, globalDist);
    const modelDist = model.distributions[position];

    const combined = Array(DIGITS).fill(0).map((_, digit) => (
      recentDist[digit] * 0.36 +
      globalDist[digit] * 0.19 +
      hour.distribution[digit] * 0.18 +
      trans.distribution[digit] * 0.17 +
      modelDist[digit] * 0.10
    ));

    global.push(globalDist);
    recent.push(recentDist);
    hourly.push(hour.distribution);
    transition.push(trans.distribution);
    final.push(normalize(combined));
    diagnostics.push({
      position,
      sourceDigit,
      hourSamples: hour.samples,
      hourReliability: round(hour.reliability, 3),
      transitionSamples: trans.samples,
      transitionReliability: round(trans.reliability, 3),
    });
  }

  return { final, global, recent, hourly, transition, model: model.distributions, modelCandidates: model.candidates, diagnostics };
}

function generateCombinations() {
  const out = [];
  const current = [];
  const visit = (start) => {
    if (current.length === KEEP_SIZE) {
      out.push([...current]);
      return;
    }
    for (let digit = start; digit < DIGITS; digit += 1) {
      current.push(digit);
      visit(digit + 1);
      current.pop();
    }
  };
  visit(0);
  return out;
}

const ALL_KEEP7 = generateCombinations();

function setCoversResult(set, result) {
  const allowed = new Set(set);
  return [0, 1, 2].every((position) => allowed.has(digitAt(result, position)));
}

function empiricalCoverage(rows, set, limit, targetHour = null) {
  const allowedRows = targetHour == null
    ? rows.slice(0, Math.min(limit, rows.length))
    : rows.filter((row) => parseHour(row.drawTime) === targetHour).slice(0, Math.min(limit, rows.length));
  if (!allowedRows.length) return { rate: 0.343, samples: 0 };
  let hitWeight = 0;
  let totalWeight = 0;
  for (let i = 0; i < allowedRows.length; i += 1) {
    const weight = 0.988 ** i;
    totalWeight += weight;
    if (setCoversResult(set, allowedRows[i].result)) hitWeight += weight;
  }
  return { rate: totalWeight ? hitWeight / totalWeight : 0.343, samples: allowedRows.length };
}

function evaluateSubsets(rows, positionDist, targetHour) {
  const evaluated = ALL_KEEP7.map((set) => {
    const masses = positionDist.map((dist) => set.reduce((sum, digit) => sum + dist[digit], 0));
    const positionMassProduct = masses.reduce((product, value) => product * clamp(value, EPS, 1), 1);
    const recent = empiricalCoverage(rows, set, 80, null);
    const hourly = empiricalCoverage(rows, set, 180, targetHour);
    const hourWeight = hourly.samples >= 8 ? 0.13 : hourly.samples >= 3 ? 0.07 : 0.02;
    const score = positionMassProduct * (0.81 - hourWeight) + recent.rate * 0.17 + hourly.rate * hourWeight;
    return {
      set,
      score,
      positionMassProduct,
      positionMasses: masses,
      recentCoverage: recent.rate,
      recentSamples: recent.samples,
      hourCoverage: hourly.rate,
      hourSamples: hourly.samples,
    };
  }).sort((a, b) => b.score - a.score || b.positionMassProduct - a.positionMassProduct || a.set.join("").localeCompare(b.set.join("")));

  const max = evaluated[0]?.score ?? 1;
  const min = evaluated.at(-1)?.score ?? 0;
  const span = Math.max(EPS, max - min);
  return evaluated.map((row, index) => ({
    rank: index + 1,
    ...row,
    relativeScore: round(((row.score - min) / span) * 100, 2),
    positionMassProductPct: round(row.positionMassProduct * 100, 2),
    recentCoveragePct: round(row.recentCoverage * 100, 2),
    hourCoveragePct: round(row.hourCoverage * 100, 2),
  }));
}

function digitRanking(positionDist, keepSet) {
  const keep = new Set(keepSet);
  const raw = Array.from({ length: DIGITS }, (_, digit) => {
    const strength = positionDist.reduce((sum, dist) => sum + dist[digit], 0) / POSITIONS;
    const maxPosition = Math.max(...positionDist.map((dist) => dist[digit]));
    return { digit, strength: strength * 0.78 + maxPosition * 0.22, keep: keep.has(digit) };
  }).sort((a, b) => b.strength - a.strength || a.digit - b.digit);
  const max = raw[0]?.strength ?? 1;
  const min = raw.at(-1)?.strength ?? 0;
  const span = Math.max(EPS, max - min);
  return raw.map((row, index) => ({
    rank: index + 1,
    digit: row.digit,
    keep: row.keep,
    relativeScore: round(((row.strength - min) / span) * 100, 1),
  }));
}

function buildConsensusMap(models) {
  const map = new Map();
  for (const model of Array.isArray(models) ? models : []) {
    const label = String(model?.label || model?.id || "model");
    const top10 = (model?.top10 || model?.top3 || []).map((item) => normalize3(item?.number ?? item)).filter(Boolean).slice(0, 10);
    top10.forEach((number, index) => {
      const bonus = (11 - (index + 1)) / 10;
      const current = map.get(number) || { score: 0, sources: [] };
      current.score += bonus;
      if (!current.sources.includes(label)) current.sources.push(label);
      map.set(number, current);
    });
  }
  const max = Math.max(1, ...[...map.values()].map((row) => row.score));
  for (const value of map.values()) value.score /= max;
  return map;
}

function assisted3DRanking(positionDist, keepSet, models) {
  const keep = new Set(keepSet);
  const consensus = buildConsensusMap(models);
  const rows = [];
  for (let n = 0; n <= 999; n += 1) {
    const number = String(n).padStart(3, "0");
    const p = [0, 1, 2].map((position) => positionDist[position][digitAt(number, position)]);
    const logMass = p.reduce((sum, value) => sum + Math.log(value + EPS), 0);
    const keepCount = [0, 1, 2].reduce((sum, position) => sum + Number(keep.has(digitAt(number, position))), 0);
    const model = consensus.get(number);
    rows.push({ number, logMass, keepCount, consensus: model?.score || 0, sources: model?.sources || [] });
  }
  const logValues = rows.map((row) => row.logMass);
  const minLog = Math.min(...logValues);
  const maxLog = Math.max(...logValues);
  const logSpan = Math.max(EPS, maxLog - minLog);
  rows.forEach((row) => {
    const massNorm = (row.logMass - minLog) / logSpan;
    const keepNorm = row.keepCount / 3;
    row.raw = massNorm * 0.50 + keepNorm * 0.28 + row.consensus * 0.22;
  });
  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));
  const max = rows[0]?.raw ?? 1;
  const min = rows.at(-1)?.raw ?? 0;
  const span = Math.max(EPS, max - min);
  return rows.slice(0, 10).map((row, index) => ({
    rank: index + 1,
    number: row.number,
    relativeScore: round(((row.raw - min) / span) * 100, 2),
    keepDigits: row.keepCount,
    consensusSources: row.sources,
  }));
}

function conditionalRandomBaseline(result) {
  const unique = new Set(String(result || "").split("")).size;
  if (unique <= 0 || unique > 3) return 0.343;
  let numerator = 1;
  let denominator = 1;
  for (let i = 0; i < unique; i += 1) {
    numerator *= 7 - i;
    denominator *= 10 - i;
  }
  return numerator / denominator;
}

export function runKeeper7Engine(rowsInput, options = {}) {
  const rows = sanitizeRows(rowsInput);
  if (rows.length < 40) throw new Error("7D Keeper memerlukan minimal 40 result historis.");
  const targetHour = Number.isInteger(options.targetHour) ? options.targetHour : nextHourFromRow(rows[0]);
  const models = Array.isArray(options.models) ? options.models : [];
  const distributions = buildPositionDistributions(rows, targetHour, models);
  const subsets = evaluateSubsets(rows, distributions.final, targetHour);
  const winner = subsets[0];
  const digitRanks = digitRanking(distributions.final, winner.set);
  const keepRanked = digitRanks.filter((row) => row.keep).map((row) => row.digit);
  const dropRanked = digitRanks.filter((row) => !row.keep).sort((a, b) => a.relativeScore - b.relativeScore || b.rank - a.rank).map((row) => row.digit);
  const assisted = options.skipAssisted ? [] : assisted3DRanking(distributions.final, winner.set, models);

  return {
    version: KEEPER7_VERSION,
    engine: "7D Historical Keeper / 3D Eliminator",
    historySize: rows.length,
    anchorPeriod: rows[0]?.period ?? null,
    anchorResult: rows[0]?.result ?? null,
    targetHour,
    keep7: keepRanked,
    drop3: dropRanked,
    keepSetAscending: [...winner.set],
    digitRanking: digitRanks,
    subset: {
      relativeScore: winner.relativeScore,
      positionMassProductPct: winner.positionMassProductPct,
      positionMassesPct: winner.positionMasses.map((value) => round(value * 100, 2)),
      recentCoveragePct: winner.recentCoveragePct,
      recentSamples: winner.recentSamples,
      hourCoveragePct: winner.hourCoveragePct,
      hourSamples: winner.hourSamples,
    },
    assistedTop3: assisted.slice(0, 3),
    assistedTop10: assisted,
    diagnostics: distributions.diagnostics,
    modelEvidenceSources: [...new Set((distributions.modelCandidates || []).map((row) => row.source))],
    randomUniformAll3BaselinePct: 34.3,
  };
}

export function walkForwardKeeper7(rowsInput, options = {}) {
  const newestFirst = sanitizeRows(rowsInput);
  const chronological = [...newestFirst].reverse();
  const minTrain = Math.max(60, Number(options.minTrain || 100));
  const maxTargets = Math.min(80, Math.max(12, Number(options.maxTargets || 48)));
  if (chronological.length <= minTrain) return { targets: 0, all3RatePct: null, atLeast2RatePct: null, avgCovered: null, baselinePct: null };
  const start = Math.max(minTrain, chronological.length - maxTargets);
  let all3 = 0;
  let atLeast2 = 0;
  let coveredTotal = 0;
  let baselineTotal = 0;
  let targets = 0;

  for (let index = start; index < chronological.length; index += 1) {
    const actualRow = chronological[index];
    const training = chronological.slice(0, index).reverse();
    if (training.length < minTrain) continue;
    const targetHour = parseHour(actualRow.drawTime);
    const engine = runKeeper7Engine(training, { targetHour, models: [], skipAssisted: true });
    const allowed = new Set(engine.keepSetAscending);
    const actual = actualRow.result;
    const covered = [0, 1, 2].reduce((sum, position) => sum + Number(allowed.has(digitAt(actual, position))), 0);
    coveredTotal += covered;
    if (covered === 3) all3 += 1;
    if (covered >= 2) atLeast2 += 1;
    baselineTotal += conditionalRandomBaseline(actual);
    targets += 1;
  }

  return {
    targets,
    all3RatePct: targets ? round(all3 / targets * 100, 2) : null,
    atLeast2RatePct: targets ? round(atLeast2 / targets * 100, 2) : null,
    avgCovered: targets ? round(coveredTotal / targets, 3) : null,
    baselinePct: targets ? round(baselineTotal / targets * 100, 2) : null,
    uniformPositionBaselinePct: 34.3,
    method: "chronological rolling-origin; intrinsic 7D engine only; no future model evidence",
  };
}
