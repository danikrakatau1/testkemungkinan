export const RANDOMNESS_FORENSICS_VERSION = "1.0.0";
const MAX_DRAWS = 5000;
const LOG2_10 = Math.log2(10);
const LN2 = Math.log(2);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function logGamma(z) {
  const p = [
    0.9999999999998099,
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = p[0];
  for (let i = 1; i < p.length; i += 1) x += p[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaQ(a, x) {
  if (!(a > 0) || x < 0) return NaN;
  if (x === 0) return 1;
  const ITMAX = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const gln = logGamma(a);

  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= ITMAX; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return clamp01(1 - p);
  }

  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return clamp01(Math.exp(-x + a * Math.log(x) - gln) * h);
}

function chiSquareP(chi2, df) {
  if (!(df > 0) || !(chi2 >= 0)) return null;
  return gammaQ(df / 2, chi2 / 2);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalTwoSidedP(z) {
  return clamp01(1 - erf(Math.abs(z) / Math.SQRT2));
}

function chiSquareUniform(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  const k = counts.length;
  if (!total || k < 2) return { chi2: 0, df: Math.max(0, k - 1), p: null, counts, expected: 0 };
  const expected = total / k;
  const chi2 = counts.reduce((sum, value) => sum + ((value - expected) ** 2) / expected, 0);
  return { chi2, df: k - 1, p: chiSquareP(chi2, k - 1), counts, expected };
}

function contingencyTest(matrix) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, j) => matrix.reduce((sum, row) => sum + row[j], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);
  if (!total || rows < 2 || cols < 2) return { chi2: 0, df: 0, p: null, cramersV: 0, sparseCellsPct: 100, total };
  let chi2 = 0;
  let sparse = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const expected = rowTotals[i] * colTotals[j] / total;
      if (expected < 5) sparse += 1;
      if (expected > 0) chi2 += ((matrix[i][j] - expected) ** 2) / expected;
    }
  }
  const df = (rows - 1) * (cols - 1);
  const denom = total * Math.min(rows - 1, cols - 1);
  return {
    chi2,
    df,
    p: chiSquareP(chi2, df),
    cramersV: denom > 0 ? Math.sqrt(chi2 / denom) : 0,
    sparseCellsPct: 100 * sparse / (rows * cols),
    total,
    rowTotals,
    colTotals,
  };
}

function shannonEntropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return { bits: 0, normalized: 0 };
  let bits = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / total;
    bits -= p * Math.log2(p);
  }
  return { bits, normalized: bits / LOG2_10 };
}

function pearsonLag(values, lag) {
  const n = values.length - lag;
  if (n < 4) return { lag, r: 0, p: null, n };
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = lag; i < values.length; i += 1) {
    const x = values[i - lag];
    const y = values[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = sxy - sx * sy / n;
  const vx = sxx - sx * sx / n;
  const vy = syy - sy * sy / n;
  const r = vx > 0 && vy > 0 ? Math.max(-0.999999, Math.min(0.999999, cov / Math.sqrt(vx * vy))) : 0;
  const z = n > 4 ? Math.atanh(r) * Math.sqrt(n - 3) : 0;
  return { lag, r, p: normalTwoSidedP(z), n };
}

function runsTest(values) {
  if (values.length < 20) return { p: null, z: null, runs: 0, n1: 0, n2: 0, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const signs = values.filter((v) => v !== median).map((v) => v > median ? 1 : 0);
  let n1 = 0, n2 = 0, runs = signs.length ? 1 : 0;
  for (let i = 0; i < signs.length; i += 1) {
    if (signs[i]) n1 += 1; else n2 += 1;
    if (i > 0 && signs[i] !== signs[i - 1]) runs += 1;
  }
  if (!n1 || !n2) return { p: 0, z: Infinity, runs, n1, n2, median };
  const mean = 1 + (2 * n1 * n2) / (n1 + n2);
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / (((n1 + n2) ** 2) * (n1 + n2 - 1));
  const z = variance > 0 ? (runs - mean) / Math.sqrt(variance) : 0;
  return { p: normalTwoSidedP(z), z, runs, n1, n2, median, expectedRuns: mean };
}

function mutualInformation(matrix) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, j) => matrix.reduce((sum, row) => sum + row[j], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);
  if (!total) return { rawBits: 0, correctedBits: 0, normalized: 0, n: 0 };
  let mi = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const count = matrix[i][j];
      if (!count || !rowTotals[i] || !colTotals[j]) continue;
      const pxy = count / total;
      const px = rowTotals[i] / total;
      const py = colTotals[j] / total;
      mi += pxy * Math.log2(pxy / (px * py));
    }
  }
  const bias = ((rows - 1) * (cols - 1)) / (2 * total * LN2);
  const corrected = Math.max(0, mi - bias);
  return { rawBits: mi, correctedBits: corrected, normalized: corrected / LOG2_10, biasBits: bias, n: total };
}

function poissonUpperTail(k, lambda) {
  if (k <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term *= lambda / i;
    cdf += term;
  }
  return clamp01(1 - cdf);
}

function jsDivergence(p, q) {
  let value = 0;
  for (let i = 0; i < p.length; i += 1) {
    const m = (p[i] + q[i]) / 2;
    if (p[i] > 0 && m > 0) value += 0.5 * p[i] * Math.log2(p[i] / m);
    if (q[i] > 0 && m > 0) value += 0.5 * q[i] * Math.log2(q[i] / m);
  }
  return value;
}

function classifyMultiplicity(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) || 0) + 1);
  const max = Math.max(...counts.values());
  if (max === 3) return "triple";
  if (max === 2) return "pair";
  return "unique";
}

function permutationCount(text) {
  const kind = classifyMultiplicity(text);
  return kind === "unique" ? 6 : kind === "pair" ? 3 : 1;
}

function parseHour(drawTime) {
  const text = String(drawTime || "").trim();
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = String(match[3] || "").toUpperCase();
  if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
  if (meridiem === "PM") hour = hour === 12 ? 12 : hour + 12;
  return hour >= 0 && hour <= 23 ? hour : null;
}

function parseWeekday(drawDate) {
  const text = String(drawDate || "").trim();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let i = 0; i < names.length; i += 1) if (text.toLowerCase().includes(names[i].toLowerCase())) return i;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getDay();
}

function temporalGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, Array(10).fill(0));
    const counts = groups.get(key);
    for (const ch of row.result) counts[Number(ch)] += 1;
  }
  const keys = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
  const matrix = keys.map((key) => groups.get(key));
  const test = matrix.length >= 2 ? contingencyTest(matrix) : { chi2: 0, df: 0, p: null, cramersV: 0, sparseCellsPct: 100, total: 0 };
  return { keys, matrix, ...test };
}

function rollingDrift(rows, globalCounts, windowSize = 50, step = 10) {
  if (rows.length < windowSize) return { windowSize, step, windows: [], minP: null, correctedMinP: null, maxJsdBits: 0 };
  const globalTotal = globalCounts.reduce((a, b) => a + b, 0);
  const globalP = globalCounts.map((v) => v / globalTotal);
  const windows = [];
  for (let start = 0; start + windowSize <= rows.length; start += step) {
    const subset = rows.slice(start, start + windowSize);
    const counts = Array(10).fill(0);
    subset.forEach((row) => [...row.result].forEach((ch) => { counts[Number(ch)] += 1; }));
    const test = chiSquareUniform(counts);
    const total = counts.reduce((a, b) => a + b, 0);
    const p = counts.map((v) => v / total);
    windows.push({
      startPeriod: subset[0].period,
      endPeriod: subset[subset.length - 1].period,
      p: test.p,
      chi2: test.chi2,
      jsdBits: jsDivergence(p, globalP),
    });
  }
  const valid = windows.map((w) => w.p).filter((p) => p != null);
  const minP = valid.length ? Math.min(...valid) : null;
  return {
    windowSize,
    step,
    windows,
    minP,
    correctedMinP: minP == null ? null : Math.min(1, minP * windows.length),
    maxJsdBits: windows.length ? Math.max(...windows.map((w) => w.jsdBits)) : 0,
  };
}

function pRound(value) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toPrecision(6));
}

function nRound(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

export function analyzeRandomnessRows(inputRows) {
  const rows = (Array.isArray(inputRows) ? inputRows : [])
    .map((row) => ({ ...row, result: normalize3(row.result) }))
    .filter((row) => row.result)
    .sort((a, b) => Number(a.period) - Number(b.period));

  const n = rows.length;
  const values = rows.map((row) => Number(row.result));
  const combinedCounts = Array(10).fill(0);
  const positionCounts = Array.from({ length: 3 }, () => Array(10).fill(0));
  const multiplicityCounts = { unique: 0, pair: 0, triple: 0 };

  rows.forEach((row) => {
    [...row.result].forEach((ch, pos) => {
      const d = Number(ch);
      combinedCounts[d] += 1;
      positionCounts[pos][d] += 1;
    });
    multiplicityCounts[classifyMultiplicity(row.result)] += 1;
  });

  const uniform = chiSquareUniform(combinedCounts);
  const positions = positionCounts.map((counts, index) => ({ position: index, ...chiSquareUniform(counts), entropy: shannonEntropy(counts) }));
  const entropy = shannonEntropy(combinedCounts);

  const observedMultiplicity = [multiplicityCounts.unique, multiplicityCounts.pair, multiplicityCounts.triple];
  const expectedMultiplicity = [0.72 * n, 0.27 * n, 0.01 * n];
  let multChi2 = 0;
  for (let i = 0; i < 3; i += 1) if (expectedMultiplicity[i] > 0) multChi2 += ((observedMultiplicity[i] - expectedMultiplicity[i]) ** 2) / expectedMultiplicity[i];
  const multiplicity = { counts: multiplicityCounts, expected: { unique: expectedMultiplicity[0], pair: expectedMultiplicity[1], triple: expectedMultiplicity[2] }, chi2: multChi2, df: 2, p: n ? chiSquareP(multChi2, 2) : null };

  const transitionMatrix = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (let i = 1; i < rows.length; i += 1) {
    for (let pos = 0; pos < 3; pos += 1) transitionMatrix[Number(rows[i - 1].result[pos])][Number(rows[i].result[pos])] += 1;
  }
  const transition = { matrix: transitionMatrix, ...contingencyTest(transitionMatrix) };
  const temporalMi = mutualInformation(transitionMatrix);

  const withinMatrices = [
    Array.from({ length: 10 }, () => Array(10).fill(0)),
    Array.from({ length: 10 }, () => Array(10).fill(0)),
    Array.from({ length: 10 }, () => Array(10).fill(0)),
  ];
  rows.forEach((row) => {
    const d = [...row.result].map(Number);
    withinMatrices[0][d[0]][d[1]] += 1;
    withinMatrices[1][d[0]][d[2]] += 1;
    withinMatrices[2][d[1]][d[2]] += 1;
  });
  const withinMi = withinMatrices.map((m, index) => ({ pair: ["H-T", "H-U", "T-U"][index], ...mutualInformation(m) }));

  const serial = Array.from({ length: Math.min(24, Math.max(0, n - 4)) }, (_, i) => pearsonLag(values, i + 1));
  const minSerialP = serial.length ? Math.min(...serial.map((r) => r.p ?? 1)) : null;
  const bestSerial = serial.length ? [...serial].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0] : null;
  const serialAdjustedP = minSerialP == null ? null : Math.min(1, minSerialP * serial.length);
  const runs = runsTest(values);

  let exactRepeats = 0;
  let permutationTransitions = 0;
  let permutationExpected = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].result === rows[i - 1].result) exactRepeats += 1;
    const a = [...rows[i - 1].result].sort().join("");
    const b = [...rows[i].result].sort().join("");
    if (a === b) permutationTransitions += 1;
    permutationExpected += permutationCount(rows[i - 1].result) / 1000;
  }
  const exactExpected = Math.max(0, n - 1) / 1000;
  const repeats = {
    consecutiveExact: exactRepeats,
    exactExpected,
    exactExcessP: poissonUpperTail(exactRepeats, exactExpected),
    consecutivePermutation: permutationTransitions,
    permutationExpected,
    permutationExcessP: poissonUpperTail(permutationTransitions, permutationExpected),
  };

  const gaps = [];
  let maxGap = 0;
  for (let pos = 0; pos < 3; pos += 1) {
    for (let digit = 0; digit < 10; digit += 1) {
      let last = null;
      for (let i = 0; i < rows.length; i += 1) {
        if (Number(rows[i].result[pos]) !== digit) continue;
        if (last != null) {
          const gap = i - last;
          gaps.push(gap);
          if (gap > maxGap) maxGap = gap;
        }
        last = i;
      }
    }
  }
  const gapMean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const gapVariance = gaps.length && gapMean != null ? gaps.reduce((sum, g) => sum + (g - gapMean) ** 2, 0) / gaps.length : null;
  const gapDistribution = { observations: gaps.length, mean: gapMean, expectedMean: 10, sd: gapVariance == null ? null : Math.sqrt(gapVariance), maxGap };

  const hourBias = temporalGroups(rows, (row) => parseHour(row.drawTime ?? row.draw_time));
  const weekdayBias = temporalGroups(rows, (row) => parseWeekday(row.drawDate ?? row.draw_date));
  const drift = rollingDrift(rows, combinedCounts, 50, 10);

  const positionMinP = positions.length ? Math.min(...positions.map((p) => p.p ?? 1)) : null;
  const positionAdjustedP = positionMinP == null ? null : Math.min(1, positionMinP * 3);

  const core = [
    { id: "digit-uniformity", p: uniform.p, effect: uniform.chi2 / Math.max(1, 3 * n), reliable: n >= 100 },
    { id: "position-uniformity", p: positionAdjustedP, effect: 0, reliable: n >= 100 },
    { id: "repeat-structure", p: multiplicity.p, effect: 0, reliable: n >= 100 },
    { id: "runs", p: runs.p, effect: Math.abs(runs.z || 0) / Math.sqrt(Math.max(1, n)), reliable: n >= 100 },
    { id: "transition", p: transition.p, effect: transition.cramersV, reliable: n >= 200 && transition.sparseCellsPct <= 20 },
    { id: "serial", p: serialAdjustedP, effect: Math.abs(bestSerial?.r || 0), reliable: n >= 200 },
    { id: "rolling-drift", p: drift.correctedMinP, effect: drift.maxJsdBits, reliable: n >= 200 },
    { id: "weekday-bias", p: weekdayBias.p, effect: weekdayBias.cramersV, reliable: n >= 200 && weekdayBias.sparseCellsPct <= 20 },
    { id: "hour-bias", p: hourBias.p, effect: hourBias.cramersV, reliable: n >= 300 && hourBias.sparseCellsPct <= 20 },
  ].filter((t) => t.p != null);

  const reliable = core.filter((t) => t.reliable);
  const strongSerial = Boolean(
    (serialAdjustedP != null && serialAdjustedP < 0.01 && Math.abs(bestSerial?.r || 0) >= 0.12) ||
    (transition.p != null && transition.p < 0.01 && transition.cramersV >= 0.10 && transition.sparseCellsPct <= 20) ||
    (runs.p != null && runs.p < 0.01 && Math.abs(runs.z || 0) >= 2.6)
  );
  const veryStrong = reliable.filter((t) => t.p < 0.001);
  const notable = reliable.filter((t) => t.p < 0.01);

  let verdict = "INCONCLUSIVE — MORE DATA NEEDED";
  let verdictCode = "INCONCLUSIVE";
  if (n >= 200) {
    if (strongSerial) {
      verdict = "STRONG SERIAL DEPENDENCE — POSSIBLY NON-IID";
      verdictCode = "STRONG_SERIAL_DEPENDENCE";
    } else if (veryStrong.length >= 1 || notable.length >= 2) {
      verdict = "ANOMALY DETECTED — INVESTIGATION NEEDED";
      verdictCode = "ANOMALY_DETECTED";
    } else {
      verdict = "CONSISTENT WITH RANDOMNESS";
      verdictCode = "CONSISTENT_WITH_RANDOMNESS";
    }
  }

  return {
    ok: true,
    version: RANDOMNESS_FORENSICS_VERSION,
    mode: "READ_ONLY_FORENSICS",
    policy: {
      databaseWrites: false,
      changesPredictionWeights: false,
      changesAiV2: false,
      provesTrueRandomness: false,
      interpretation: "Statistical tests can detect departures from simple IID/uniform behavior; passing them does not prove a cryptographic or physical RNG.",
    },
    dataset: {
      draws: n,
      firstPeriod: rows[0]?.period ?? null,
      lastPeriod: rows[n - 1]?.period ?? null,
      firstDate: rows[0]?.drawDate ?? rows[0]?.draw_date ?? null,
      lastDate: rows[n - 1]?.drawDate ?? rows[n - 1]?.draw_date ?? null,
    },
    verdict: {
      code: verdictCode,
      label: verdict,
      reliableTests: reliable.length,
      notableTests: notable.map((t) => ({ id: t.id, p: pRound(t.p), effect: nRound(t.effect) })),
      strongestTests: veryStrong.map((t) => ({ id: t.id, p: pRound(t.p), effect: nRound(t.effect) })),
      sampleNote: n >= 500 ? "Good for broad statistical screening; still not proof of true RNG." : n >= 200 ? "Usable for broad anomaly screening; subtle structure may require much more data." : "Too small for a strong IID/randomness conclusion.",
    },
    tests: {
      digitUniformity: { counts: combinedCounts, chi2: nRound(uniform.chi2), df: uniform.df, p: pRound(uniform.p), entropyBits: nRound(entropy.bits), entropyNormalized: nRound(entropy.normalized) },
      positionUniformity: positions.map((row) => ({ position: row.position, counts: row.counts, chi2: nRound(row.chi2), df: row.df, p: pRound(row.p), entropyBits: nRound(row.entropy.bits), entropyNormalized: nRound(row.entropy.normalized) })),
      transition: { matrix: transitionMatrix, chi2: nRound(transition.chi2), df: transition.df, p: pRound(transition.p), cramersV: nRound(transition.cramersV), sparseCellsPct: nRound(transition.sparseCellsPct, 2) },
      serialCorrelation: { lags: serial.map((r) => ({ lag: r.lag, r: nRound(r.r), p: pRound(r.p) })), bestLag: bestSerial ? { lag: bestSerial.lag, r: nRound(bestSerial.r), p: pRound(bestSerial.p) } : null, bonferroniP: pRound(serialAdjustedP) },
      runs: { runs: runs.runs, expectedRuns: nRound(runs.expectedRuns), z: nRound(runs.z), p: pRound(runs.p), median: runs.median, nAbove: runs.n1, nBelow: runs.n2 },
      gapDistribution: { observations: gapDistribution.observations, mean: nRound(gapDistribution.mean), expectedMean: 10, sd: nRound(gapDistribution.sd), maxGap: gapDistribution.maxGap },
      entropy: { combinedBits: nRound(entropy.bits), maximumBits: nRound(LOG2_10), normalized: nRound(entropy.normalized), byPosition: positions.map((r) => nRound(r.entropy.normalized)) },
      repeatedDigits: { observed: multiplicity.counts, expected: { unique: nRound(multiplicity.expected.unique, 2), pair: nRound(multiplicity.expected.pair, 2), triple: nRound(multiplicity.expected.triple, 2) }, chi2: nRound(multiplicity.chi2), df: 2, p: pRound(multiplicity.p) },
      exactRepeats: { consecutive: repeats.consecutiveExact, expected: nRound(repeats.exactExpected), excessP: pRound(repeats.exactExcessP) },
      hourBias: { hours: hourBias.keys, matrix: hourBias.matrix, chi2: nRound(hourBias.chi2), df: hourBias.df, p: pRound(hourBias.p), cramersV: nRound(hourBias.cramersV), sparseCellsPct: nRound(hourBias.sparseCellsPct, 2) },
      weekdayBias: { weekdays: weekdayBias.keys, matrix: weekdayBias.matrix, chi2: nRound(weekdayBias.chi2), df: weekdayBias.df, p: pRound(weekdayBias.p), cramersV: nRound(weekdayBias.cramersV), sparseCellsPct: nRound(weekdayBias.sparseCellsPct, 2) },
      mutualInformation: { temporal: { rawBits: nRound(temporalMi.rawBits), biasCorrectedBits: nRound(temporalMi.correctedBits), normalized: nRound(temporalMi.normalized), biasBits: nRound(temporalMi.biasBits) }, withinDraw: withinMi.map((row) => ({ pair: row.pair, rawBits: nRound(row.rawBits), biasCorrectedBits: nRound(row.correctedBits), normalized: nRound(row.normalized) })) },
      permutationRate: { consecutive: repeats.consecutivePermutation, expected: nRound(repeats.permutationExpected), excessP: pRound(repeats.permutationExcessP) },
      rollingDrift: { windowSize: drift.windowSize, step: drift.step, minP: pRound(drift.minP), bonferroniP: pRound(drift.correctedMinP), maxJsdBits: nRound(drift.maxJsdBits), windows: drift.windows.map((w) => ({ startPeriod: w.startPeriod, endPeriod: w.endPeriod, p: pRound(w.p), chi2: nRound(w.chi2), jsdBits: nRound(w.jsdBits) })) },
    },
  };
}

export async function getRandomnessForensics(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Randomness Forensics.");
  const limit = Math.max(100, Math.min(MAX_DRAWS, Number(options.limit || MAX_DRAWS)));
  // Intentionally SELECT-only. This audit must never mutate source/model state.
  const query = await env.DB.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime, collected_at AS collectedAt
    FROM results_3d
    ORDER BY period ASC
    LIMIT ?
  `).bind(limit).all();
  const report = analyzeRandomnessRows(query.results || []);
  return { ...report, generatedAt: new Date().toISOString(), source: "D1 results_3d · UTAMA only" };
}
