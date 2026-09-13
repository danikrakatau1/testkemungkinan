const DIGITS = 10;
const POSITIONS = 3;
const DEFAULT_DECAY = 0.90;

function normalizeNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function matrix(rows, cols, initial = 0) {
  return Array.from({ length: rows }, () => Array(cols).fill(initial));
}

function cube(a, b, c, initial = 0) {
  return Array.from({ length: a }, () => matrix(b, c, initial));
}

function safeProb(count, total, buckets, alpha = 0.25) {
  return (count + alpha) / (total + alpha * buckets);
}

export function sanitizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeNumber).filter(Boolean);
}

export function buildModel(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  const decay = Number(options.decay ?? DEFAULT_DECAY);
  const safeDecay = Number.isFinite(decay) && decay > 0 && decay <= 1 ? decay : DEFAULT_DECAY;

  const positionCounts = matrix(POSITIONS, DIGITS);
  const positionTotals = Array(POSITIONS).fill(0);
  const globalCounts = Array(DIGITS).fill(0);
  let globalTotal = 0;

  const pair01 = Array(100).fill(0);
  const pair12 = Array(100).fill(0);
  let pairTotal = 0;

  // transitionCounts[pos][sourceDigit][targetDigit]
  // History is newest -> oldest. For pair (history[i+1] -> history[i]),
  // history[i+1] is the older/source draw and history[i] is the next/target draw.
  const transitionCounts = cube(POSITIONS, DIGITS, DIGITS);
  const transitionTotals = matrix(POSITIONS, DIGITS);

  history.forEach((value, index) => {
    const weight = safeDecay ** index;
    const digits = value.split("").map(Number);

    digits.forEach((digit, pos) => {
      positionCounts[pos][digit] += weight;
      positionTotals[pos] += weight;
      globalCounts[digit] += weight;
      globalTotal += weight;
    });

    pair01[digits[0] * 10 + digits[1]] += weight;
    pair12[digits[1] * 10 + digits[2]] += weight;
    pairTotal += weight;
  });

  for (let i = 0; i < history.length - 1; i += 1) {
    const target = history[i].split("").map(Number);
    const source = history[i + 1].split("").map(Number);
    const weight = safeDecay ** i;

    for (let pos = 0; pos < POSITIONS; pos += 1) {
      transitionCounts[pos][source[pos]][target[pos]] += weight;
      transitionTotals[pos][source[pos]] += weight;
    }
  }

  return {
    history,
    decay: safeDecay,
    positionCounts,
    positionTotals,
    globalCounts,
    globalTotal,
    pair01,
    pair12,
    pairTotal,
    transitionCounts,
    transitionTotals,
  };
}

function scoreCandidate(candidate, model) {
  const digits = candidate.split("").map(Number);

  let positionScore = 0;
  let globalScore = 0;
  let transitionScore = 0;

  for (let pos = 0; pos < POSITIONS; pos += 1) {
    const d = digits[pos];
    positionScore += safeProb(model.positionCounts[pos][d], model.positionTotals[pos], DIGITS);
    globalScore += safeProb(model.globalCounts[d], model.globalTotal, DIGITS);

    if (model.history.length > 0) {
      const latestDigit = Number(model.history[0][pos]);
      const tCount = model.transitionCounts[pos][latestDigit][d];
      const tTotal = model.transitionTotals[pos][latestDigit];
      transitionScore += safeProb(tCount, tTotal, DIGITS);
    } else {
      transitionScore += 1 / DIGITS;
    }
  }

  positionScore /= POSITIONS;
  globalScore /= POSITIONS;
  transitionScore /= POSITIONS;

  const p01 = digits[0] * 10 + digits[1];
  const p12 = digits[1] * 10 + digits[2];
  const pairScore = (
    safeProb(model.pair01[p01], model.pairTotal, 100, 0.05) +
    safeProb(model.pair12[p12], model.pairTotal, 100, 0.05)
  ) / 2;

  const repeatIndex = model.history.indexOf(candidate);
  const recentRepeatPenalty = repeatIndex === -1 ? 0 : 0.04 * (model.decay ** repeatIndex);

  const raw = (
    positionScore * 0.46 +
    transitionScore * 0.29 +
    pairScore * 0.15 +
    globalScore * 0.10 -
    recentRepeatPenalty
  );

  return {
    number: candidate,
    raw,
    components: {
      position: positionScore,
      transition: transitionScore,
      pair: pairScore,
      global: globalScore,
      repeatPenalty: recentRepeatPenalty,
    },
  };
}

function rankAll(model) {
  const rows = [];

  for (let n = 0; n <= 999; n += 1) {
    const candidate = String(n).padStart(3, "0");
    rows.push(scoreCandidate(candidate, model));
  }

  rows.sort((a, b) => b.raw - a.raw || a.number.localeCompare(b.number));

  const max = rows[0]?.raw ?? 1;
  const min = rows.at(-1)?.raw ?? 0;
  const span = Math.max(max - min, Number.EPSILON);

  return rows.map((row, index) => ({
    rank: index + 1,
    number: row.number,
    score: Number((((row.raw - min) / span) * 100).toFixed(2)),
    components: Object.fromEntries(
      Object.entries(row.components).map(([key, value]) => [key, Number(value.toFixed(6))]),
    ),
  }));
}

export function summarizeHistory(historyInput) {
  const history = sanitizeHistory(historyInput);
  const byPosition = matrix(POSITIONS, DIGITS);
  const overall = Array(DIGITS).fill(0);

  history.forEach((value) => {
    value.split("").forEach((char, pos) => {
      const digit = Number(char);
      byPosition[pos][digit] += 1;
      overall[digit] += 1;
    });
  });

  return {
    draws: history.length,
    newest: history[0] ?? null,
    oldest: history.at(-1) ?? null,
    byPosition,
    overall,
  };
}

export function analyzeHistory(historyInput, options = {}) {
  const history = sanitizeHistory(historyInput);
  if (history.length < 3) {
    throw new Error("Minimal 3 hasil valid diperlukan untuk analisis awal.");
  }

  const model = buildModel(history, options);
  const ranking = rankAll(model);

  return {
    meta: {
      model: "baseline-recency-position-transition-v0.1",
      historyOrder: "newest-to-oldest",
      draws: history.length,
      decay: model.decay,
      disclaimer: "Ranking adalah skor statistik eksploratif dan tidak menjamin hasil berikutnya jika proses sumber bersifat acak.",
    },
    history: summarizeHistory(history),
    top10: ranking.slice(0, 10),
    top3: ranking.slice(0, 3),
  };
}
