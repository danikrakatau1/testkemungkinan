export const RANDOMNESS_FORENSICS_MC_VERSION = "1.1.0";

const DEFAULT_SIMULATIONS = 1000;
const MAX_SIMULATIONS = 2500;
const MAX_DRAWS = 5000;
const MAX_LAG = 24;
const ROLLING_WINDOW = 50;
const ROLLING_STEP = 10;

function normalize3(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) return null;
  return raw.padStart(3, "0");
}

function datasetSeed(rows) {
  let hash = 2166136261 >>> 0;
  for (const row of rows) {
    const text = `${row.period}:${row.result}|`;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash || 0x9e3779b9;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledIndices(n, random) {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function pearsonLag(values, lag) {
  const n = values.length - lag;
  if (n < 8) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += values[i];
    sy += values[i + lag];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = values[i] - mx;
    const dy = values[i + lag] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den > 0 ? sxy / den : 0;
}

function maxLagStatistic(values) {
  const limit = Math.min(MAX_LAG, Math.max(0, values.length - 8));
  let bestLag = null;
  let bestR = 0;
  for (let lag = 1; lag <= limit; lag += 1) {
    const r = pearsonLag(values, lag);
    if (Math.abs(r) > Math.abs(bestR)) {
      bestR = r;
      bestLag = lag;
    }
  }
  return { lag: bestLag, r: bestR, absR: Math.abs(bestR) };
}

function transitionStatistic(results) {
  const matrix = Array.from({ length: 10 }, () => Array(10).fill(0));
  for (let i = 1; i < results.length; i += 1) {
    const prev = results[i - 1];
    const next = results[i];
    for (let pos = 0; pos < 3; pos += 1) matrix[Number(prev[pos])][Number(next[pos])] += 1;
  }

  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = Array(10).fill(0);
  let total = 0;
  for (let r = 0; r < 10; r += 1) {
    total += rowTotals[r];
    for (let c = 0; c < 10; c += 1) colTotals[c] += matrix[r][c];
  }
  if (!total) return { cramersV: 0, chi2: 0 };

  let chi2 = 0;
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 10; c += 1) {
      const expected = (rowTotals[r] * colTotals[c]) / total;
      if (expected > 0) chi2 += ((matrix[r][c] - expected) ** 2) / expected;
    }
  }
  const cramersV = Math.sqrt(chi2 / (total * 9));
  return { cramersV, chi2 };
}

function distribution(results) {
  const counts = Array(10).fill(0);
  for (const result of results) for (let pos = 0; pos < 3; pos += 1) counts[Number(result[pos])] += 1;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return counts.map((count) => count / total);
}

function jsdBits(p, q) {
  let jsd = 0;
  for (let i = 0; i < p.length; i += 1) {
    const m = (p[i] + q[i]) / 2;
    if (p[i] > 0 && m > 0) jsd += 0.5 * p[i] * Math.log2(p[i] / m);
    if (q[i] > 0 && m > 0) jsd += 0.5 * q[i] * Math.log2(q[i] / m);
  }
  return jsd;
}

function rollingDriftStatistic(results) {
  if (results.length < ROLLING_WINDOW) return { maxJsdBits: 0, windows: 0 };
  const global = distribution(results);
  let maxJsdBits = 0;
  let windows = 0;
  for (let start = 0; start + ROLLING_WINDOW <= results.length; start += ROLLING_STEP) {
    const local = distribution(results.slice(start, start + ROLLING_WINDOW));
    const jsd = jsdBits(local, global);
    if (jsd > maxJsdBits) maxJsdBits = jsd;
    windows += 1;
  }
  return { maxJsdBits, windows };
}

function runsStatistic(values) {
  if (values.length < 10) return { absZ: 0, z: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const signs = values.map((v) => (v > median ? 1 : v < median ? 0 : null)).filter((v) => v != null);
  const n1 = signs.reduce((sum, v) => sum + v, 0);
  const n2 = signs.length - n1;
  if (!n1 || !n2 || signs.length < 4) return { absZ: 0, z: 0 };
  let runs = 1;
  for (let i = 1; i < signs.length; i += 1) if (signs[i] !== signs[i - 1]) runs += 1;
  const expected = 1 + (2 * n1 * n2) / (n1 + n2);
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / (((n1 + n2) ** 2) * (n1 + n2 - 1));
  const z = variance > 0 ? (runs - expected) / Math.sqrt(variance) : 0;
  return { absZ: Math.abs(z), z };
}

function statsForOrder(results) {
  const values = results.map((r) => Number(r));
  return {
    transition: transitionStatistic(results),
    serial: maxLagStatistic(values),
    drift: rollingDriftStatistic(results),
    runs: runsStatistic(values),
  };
}

function empiricalP(nullValues, observed) {
  let exceed = 0;
  for (const value of nullValues) if (value >= observed - 1e-15) exceed += 1;
  return (exceed + 1) / (nullValues.length + 1);
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] == null ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function round(value, digits = 6) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function summarizeNull(values, observed) {
  return {
    observed: round(observed),
    empiricalP: round(empiricalP(values, observed)),
    nullMean: round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)),
    nullP95: round(quantile(values, 0.95)),
    nullP99: round(quantile(values, 0.99)),
  };
}

export function calibrateRandomnessRows(inputRows, options = {}) {
  const rows = (Array.isArray(inputRows) ? inputRows : [])
    .map((row) => ({ ...row, result: normalize3(row.result) }))
    .filter((row) => row.result)
    .sort((a, b) => Number(a.period) - Number(b.period));

  const simulations = Math.max(100, Math.min(MAX_SIMULATIONS, Number(options.simulations || DEFAULT_SIMULATIONS) | 0));
  if (rows.length < 100) {
    return {
      ok: false,
      version: RANDOMNESS_FORENSICS_MC_VERSION,
      error: "Minimal 100 draw diperlukan untuk Monte Carlo permutation calibration.",
      dataset: { draws: rows.length },
    };
  }

  const results = rows.map((row) => row.result);
  const observed = statsForOrder(results);
  const seed = datasetSeed(rows) ^ simulations;
  const random = mulberry32(seed >>> 0);
  const nullTransition = [];
  const nullSerial = [];
  const nullDrift = [];
  const nullRuns = [];
  const started = Date.now();

  for (let s = 0; s < simulations; s += 1) {
    const order = shuffledIndices(results.length, random);
    const permuted = order.map((index) => results[index]);
    const stats = statsForOrder(permuted);
    nullTransition.push(stats.transition.cramersV);
    nullSerial.push(stats.serial.absR);
    nullDrift.push(stats.drift.maxJsdBits);
    nullRuns.push(stats.runs.absZ);
  }

  const calibration = {
    transitionCramersV: summarizeNull(nullTransition, observed.transition.cramersV),
    maxAbsSerialLag1To24: {
      ...summarizeNull(nullSerial, observed.serial.absR),
      observedLag: observed.serial.lag,
      observedR: round(observed.serial.r),
    },
    maxRollingJsdBits: {
      ...summarizeNull(nullDrift, observed.drift.maxJsdBits),
      windowSize: ROLLING_WINDOW,
      step: ROLLING_STEP,
      windows: observed.drift.windows,
    },
    runsAbsZ: {
      ...summarizeNull(nullRuns, observed.runs.absZ),
      observedZ: round(observed.runs.z),
    },
  };

  const pValues = Object.values(calibration).map((row) => Number(row.empiricalP)).filter(Number.isFinite);
  const under01 = pValues.filter((p) => p < 0.01).length;
  const under05 = pValues.filter((p) => p < 0.05).length;
  let verdictCode = "NO_CALIBRATED_ANOMALY";
  let verdict = "NO CALIBRATED TEMPORAL ANOMALY";
  if (under01 >= 2) {
    verdictCode = "STRONG_CALIBRATED_ANOMALY";
    verdict = "STRONG CALIBRATED TEMPORAL ANOMALY";
  } else if (under01 >= 1 || under05 >= 2) {
    verdictCode = "CALIBRATED_ANOMALY_SIGNAL";
    verdict = "CALIBRATED ANOMALY SIGNAL — INVESTIGATE";
  }

  return {
    ok: true,
    version: RANDOMNESS_FORENSICS_MC_VERSION,
    mode: "READ_ONLY_MONTE_CARLO_PERMUTATION",
    dataset: {
      draws: rows.length,
      firstPeriod: rows[0]?.period ?? null,
      lastPeriod: rows[rows.length - 1]?.period ?? null,
    },
    simulation: {
      count: simulations,
      seed: seed >>> 0,
      elapsedMs: Date.now() - started,
      nullModel: "Randomly permute the observed draw order. This preserves the exact empirical 3D multiset, digit marginals, position marginals, and within-draw structure while destroying temporal order.",
      pResolution: round(1 / (simulations + 1), 7),
      reproducible: true,
    },
    verdict: {
      code: verdictCode,
      label: verdict,
      pBelow01: under01,
      pBelow05: under05,
      interpretation: "Empirical p-values compare the observed temporal statistic with randomized orderings of the same draws. They test temporal dependence/drift, not whether the upstream generator is cryptographically random.",
    },
    calibration,
    policy: {
      databaseWrites: false,
      changesPredictionWeights: false,
      changesAiV2: false,
      changesKeeper7: false,
      changesAdaptive: false,
      provesTrueRandomness: false,
    },
  };
}

export async function getRandomnessMonteCarlo(env, options = {}) {
  if (!env?.DB) throw new Error("D1 binding DB diperlukan untuk Randomness Forensics Monte Carlo.");
  const query = await env.DB.prepare(`
    SELECT period, result, draw_date AS drawDate, draw_time AS drawTime
    FROM results_3d
    ORDER BY period ASC
    LIMIT ?
  `).bind(MAX_DRAWS).all();
  const report = calibrateRandomnessRows(query.results || [], options);
  return {
    ...report,
    generatedAt: new Date().toISOString(),
    source: "D1 results_3d · UTAMA only · SELECT only",
  };
}
