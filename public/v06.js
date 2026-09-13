const RANDOM_MEAN_RANK = 500.5;
const RANDOM_RANK_VARIANCE = (1000 ** 2 - 1) / 12;
const RANDOM_TOP10 = 0.01;
const WINDOW_TARGETS = 18;
const WINDOW_HOLDOUT = 6;
const WINDOWS_DEFAULT = 8;
const WINDOW_DELAY_MS = 350;

const els = {
  button: document.querySelector("#multiValidateBtn"),
  historyInput: document.querySelector("#historyInput"),
  decay: document.querySelector("#decay"),
  minTrain: document.querySelector("#minTrain"),
  empty: document.querySelector("#multiWindowEmpty"),
  gate: document.querySelector("#multiWindowGate"),
  metrics: document.querySelector("#multiWindowMetrics"),
  body: document.querySelector("#multiWindowBody"),
  weights: document.querySelector("#multiWindowWeights"),
  comparison: document.querySelector("#multiWindowComparison"),
  stability: document.querySelector("#multiWindowStability"),
  progress: document.querySelector("#multiWindowProgress"),
  error: document.querySelector("#errorBox"),
  regimeEmpty: document.querySelector("#regimeEmpty"),
  regimeSummary: document.querySelector("#regimeSummary"),
  regimeMetrics: document.querySelector("#regimeMetrics"),
  regimeBody: document.querySelector("#regimeBody"),
  regimePersistence: document.querySelector("#regimePersistence"),
  regimeWeights: document.querySelector("#regimeWeights"),
  regimeNote: document.querySelector("#regimeNote"),
};

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function stddev(values = []) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((Number(value || 0) - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function binomialTail(n, atLeast, probability) {
  if (!n || atLeast <= 0) return 1;
  if (atLeast > n) return 0;
  const p = Number(probability);
  const q = 1 - p;
  let term = q ** n;
  let total = 0;
  for (let k = 0; k <= n; k += 1) {
    if (k >= atLeast) total += term;
    if (k === n) break;
    term *= ((n - k) / (k + 1)) * (p / q);
  }
  return clamp(total, 0, 1);
}

function parseHistory() {
  const tokens = String(els.historyInput?.value || "")
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = tokens.filter((token) => !/^\d{1,3}$/.test(token) || Number(token) > 999);
  if (invalid.length) throw new Error(`Ada input tidak valid: ${invalid.slice(0, 4).join(", ")}`);
  return tokens.map((token) => token.padStart(3, "0"));
}

async function postWindow(payload, attempt = 0) {
  const response = await fetch("/api/validate-window", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.ok) return data;

  const message = data.error || `Request gagal (${response.status})`;
  if (response.status === 503 && attempt < 2) {
    await sleep(900 * (attempt + 1));
    return postWindow(payload, attempt + 1);
  }
  throw new Error(message);
}

function summarizeRanks(ranks = []) {
  const trials = ranks.length;
  const top3Hits = ranks.filter((rank) => rank <= 3).length;
  const top10Hits = ranks.filter((rank) => rank <= 10).length;
  const top25Hits = ranks.filter((rank) => rank <= 25).length;
  const meanTargetRank = trials ? ranks.reduce((sum, rank) => sum + rank, 0) / trials : 1000;
  const meanRankDelta = RANDOM_MEAN_RANK - meanTargetRank;
  const se = trials ? Math.sqrt(RANDOM_RANK_VARIANCE / trials) : Infinity;
  const pMeanRank = trials ? 1 - normalCdf(meanRankDelta / se) : 1;
  const pTop10 = binomialTail(trials, top10Hits, RANDOM_TOP10);
  return {
    trials,
    top3Hits,
    top10Hits,
    top25Hits,
    top3HitRatePct: trials ? (top3Hits / trials) * 100 : 0,
    top10HitRatePct: trials ? (top10Hits / trials) * 100 : 0,
    top25HitRatePct: trials ? (top25Hits / trials) * 100 : 0,
    meanTargetRank,
    meanRankDelta,
    pMeanRank,
    pTop10,
  };
}

function aggregateWeights(windows) {
  const totals = new Map();
  for (const window of windows) {
    for (const row of window.weights || []) {
      const previous = totals.get(row.id) || { id: row.id, label: row.label, values: [] };
      previous.values.push(Number(row.weightPct || 0));
      totals.set(row.id, previous);
    }
  }
  return [...totals.values()].map((row) => ({
    id: row.id,
    label: row.label,
    weightPct: mean(row.values),
    volatility: stddev(row.values),
    min: Math.min(...row.values),
    max: Math.max(...row.values),
  }));
}

function top3Stability(windows) {
  const counts = new Map();
  for (const window of windows) {
    for (const row of window.currentWeighted?.top3 || []) {
      counts.set(row.number, (counts.get(row.number) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([number, count]) => ({ number, count, pct: (count / windows.length) * 100 }))
    .sort((a, b) => b.count - a.count || a.number.localeCompare(b.number))
    .slice(0, 8);
}

function top3Numbers(window) {
  return (window.currentWeighted?.top3 || []).map((row) => row.number);
}

function snapshotOverlap(a = [], b = []) {
  if (!a.length || !b.length) return { intersection: 0, jaccard: 0, pctOfTop3: 0 };
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((value) => setB.has(value)).length;
  const union = new Set([...setA, ...setB]).size || 1;
  return {
    intersection,
    jaccard: intersection / union,
    pctOfTop3: intersection / 3,
  };
}

function classifyWindow(window) {
  const weighted = window.holdout?.weighted;
  const delta = Number(weighted?.evidence?.meanRankDelta || 0);
  const hits = Number(weighted?.top10Hits || 0);
  if (delta >= 100 || (delta >= 50 && hits > 0)) {
    return { key: "strong", label: "STRONG +", className: "regime-strong" };
  }
  if (delta > 0) {
    return { key: "positive", label: "POSITIVE", className: "regime-positive" };
  }
  if (delta <= -100) {
    return { key: "deep-negative", label: "DEEP −", className: "regime-deep-negative" };
  }
  return { key: "negative", label: "NEGATIVE", className: "regime-negative" };
}

function longestStreak(signs, wanted) {
  let best = 0;
  let current = 0;
  for (const sign of signs) {
    if (sign === wanted) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function regimeDiagnostics(windows) {
  const deltas = windows.map((window) => Number(window.holdout?.weighted?.evidence?.meanRankDelta || 0));
  const top10Hits = windows.map((window) => Number(window.holdout?.weighted?.top10Hits || 0));
  const signs = deltas.map((delta) => (delta > 0 ? 1 : -1));
  const transitions = signs.slice(1).filter((sign, index) => sign !== signs[index]).length;
  const positiveWindows = deltas.filter((delta) => delta > 0).length;
  const strongWindows = windows.filter((window) => classifyWindow(window).key === "strong").length;
  const overlapRows = windows.map((window, index) => {
    const current = top3Numbers(window);
    const previous = index > 0 ? top3Numbers(windows[index - 1]) : [];
    return index === 0 ? null : snapshotOverlap(current, previous);
  }).filter(Boolean);
  const averageTop3Overlap = mean(overlapRows.map((row) => row.pctOfTop3)) * 100;
  const averageJaccard = mean(overlapRows.map((row) => row.jaccard)) * 100;
  const persistence = top3Stability(windows);
  const dominant = persistence[0] || { number: "---", count: 0, pct: 0 };
  const recentWindowCount = Math.min(2, windows.length);
  const recentDelta = mean(deltas.slice(0, recentWindowCount));
  const olderDelta = mean(deltas.slice(recentWindowCount));
  const recentHits = top10Hits.slice(0, recentWindowCount).reduce((sum, value) => sum + value, 0);
  const olderHits = top10Hits.slice(recentWindowCount).reduce((sum, value) => sum + value, 0);
  const weights = aggregateWeights(windows);
  const averageWeightVolatility = mean(weights.map((row) => row.volatility));
  const maxWeightVolatility = Math.max(0, ...weights.map((row) => row.volatility));

  let verdict = "MIXED REGIME";
  let verdictClass = "gate-lock";
  let reason = "Performa berganti antara window positif dan negatif; belum ada edge yang konsisten lintas waktu.";

  if (recentDelta > 50 && olderDelta <= 0) {
    verdict = "RECENT-ONLY EDGE";
    reason = "Window terbaru terlihat kuat, tetapi edge tidak bertahan pada window yang lebih lama. Sinyal sangat bergantung regime terbaru.";
  } else if (positiveWindows >= Math.ceil(windows.length * 0.75) && mean(deltas) > 25) {
    verdict = "BROAD POSITIVE REGIME";
    verdictClass = "gate-pass";
    reason = "Mayoritas besar window berada di atas random dengan delta rata-rata positif. Tetap perlu konfirmasi pada data baru.";
  } else if (positiveWindows <= Math.floor(windows.length * 0.25)) {
    verdict = "MOSTLY NEGATIVE REGIME";
    reason = "Sebagian besar window berada di bawah baseline random; model tidak menunjukkan stabilitas historis yang memadai.";
  }

  return {
    deltas,
    signs,
    transitions,
    positiveWindows,
    strongWindows,
    deltaMean: mean(deltas),
    deltaVolatility: stddev(deltas),
    averageTop3Overlap,
    averageJaccard,
    dominant,
    longestPositive: longestStreak(signs, 1),
    longestNegative: longestStreak(signs, -1),
    recentDelta,
    olderDelta,
    recentHits,
    olderHits,
    weights,
    averageWeightVolatility,
    maxWeightVolatility,
    verdict,
    verdictClass,
    reason,
  };
}

function setError(message = "") {
  if (!els.error) return;
  els.error.textContent = message;
  els.error.classList.toggle("show", Boolean(message));
}

function setBusy(busy) {
  if (!els.button) return;
  els.button.disabled = busy;
  els.button.textContent = busy ? "Running Windows…" : "Run Multi-Window";
}

function renderProgress(done, total) {
  if (!els.progress) return;
  const pct = total ? (done / total) * 100 : 0;
  els.progress.innerHTML = `<span style="width:${pct}%"></span>`;
  els.progress.classList.toggle("show", done < total && total > 0);
}

function renderRegimeAnalysis(windows) {
  if (!windows.length) return;
  if (els.regimeEmpty) els.regimeEmpty.hidden = true;
  const diagnostics = regimeDiagnostics(windows);

  if (els.regimeSummary) {
    els.regimeSummary.className = `validation-gate ${diagnostics.verdictClass}`;
    els.regimeSummary.innerHTML = `
      <div>
        <span>Regime verdict</span>
        <strong>${diagnostics.verdict}</strong>
        <p>${diagnostics.reason}</p>
      </div>
      <div class="gate-confidence">
        <span>Δ volatility</span>
        <strong>σ ${diagnostics.deltaVolatility.toFixed(1)}</strong>
        <small>lebih kecil = lebih stabil</small>
      </div>
    `;
  }

  if (els.regimeMetrics) {
    els.regimeMetrics.innerHTML = `
      <div class="metric"><span>Average Δ random</span><strong>${diagnostics.deltaMean >= 0 ? "+" : ""}${diagnostics.deltaMean.toFixed(1)}</strong><small>across ${windows.length} windows</small></div>
      <div class="metric"><span>Positive windows</span><strong>${diagnostics.positiveWindows}/${windows.length}</strong><small>${diagnostics.strongWindows} strong</small></div>
      <div class="metric"><span>Regime transitions</span><strong>${diagnostics.transitions}</strong><small>sign changes</small></div>
      <div class="metric"><span>Top3 overlap</span><strong>${diagnostics.averageTop3Overlap.toFixed(1)}%</strong><small>adjacent snapshots</small></div>
      <div class="metric"><span>Dominant snapshot number</span><strong class="mono">${diagnostics.dominant.number}</strong><small>${diagnostics.dominant.count}/${windows.length} windows</small></div>
      <div class="metric"><span>Longest + streak</span><strong>${diagnostics.longestPositive}</strong><small>negative ${diagnostics.longestNegative}</small></div>
    `;
  }

  if (els.regimeBody) {
    els.regimeBody.innerHTML = windows.map((window, index) => {
      const weighted = window.holdout.weighted;
      const regime = classifyWindow(window);
      const snapshot = top3Numbers(window);
      const previous = index > 0 ? top3Numbers(windows[index - 1]) : [];
      const overlap = index === 0 ? null : snapshotOverlap(snapshot, previous);
      return `
        <tr>
          <td class="rank-cell">W${index + 1}</td>
          <td><span class="regime-pill ${regime.className}">${regime.label}</span></td>
          <td class="mono ${weighted.evidence.meanRankDelta > 0 ? "hit" : "miss"}">${weighted.evidence.meanRankDelta > 0 ? "+" : ""}${weighted.evidence.meanRankDelta.toFixed(1)}</td>
          <td class="mono">${weighted.top10Hits}/${weighted.trials}</td>
          <td class="mono">#${weighted.meanTargetRank.toFixed(1)}</td>
          <td class="mono current-top3">${snapshot.join(" · ")}</td>
          <td class="mono">${overlap ? `${overlap.intersection}/3` : "—"}</td>
        </tr>
      `;
    }).join("");
  }

  if (els.regimePersistence) {
    const persistence = top3Stability(windows);
    els.regimePersistence.innerHTML = persistence.map((row) => `
      <div class="stability-row"><strong class="mono">${row.number}</strong><span>${row.count}/${windows.length} snapshots</span><em>${row.pct.toFixed(0)}%</em></div>
    `).join("");
  }

  if (els.regimeWeights) {
    els.regimeWeights.innerHTML = diagnostics.weights.map((row) => `
      <div class="weight-stability-row">
        <span>${row.label}</span>
        <strong>${row.weightPct.toFixed(2)}%</strong>
        <em>σ ${row.volatility.toFixed(2)} · ${row.min.toFixed(1)}–${row.max.toFixed(1)}%</em>
      </div>
    `).join("");
  }

  if (els.regimeNote) {
    const recentSign = diagnostics.recentDelta >= 0 ? "+" : "";
    const olderSign = diagnostics.olderDelta >= 0 ? "+" : "";
    els.regimeNote.innerHTML = `
      <div class="regime-note-row"><span>2 newest windows</span><strong>${recentSign}${diagnostics.recentDelta.toFixed(1)} Δ</strong><em>${diagnostics.recentHits} Top10 hit</em></div>
      <div class="regime-note-row"><span>Older windows</span><strong>${olderSign}${diagnostics.olderDelta.toFixed(1)} Δ</strong><em>${diagnostics.olderHits} Top10 hit</em></div>
      <div class="regime-note-row"><span>Weight volatility</span><strong>σ ${diagnostics.averageWeightVolatility.toFixed(2)}</strong><em>max σ ${diagnostics.maxWeightVolatility.toFixed(2)}</em></div>
      <div class="regime-note-row"><span>Adjacent Jaccard</span><strong>${diagnostics.averageJaccard.toFixed(1)}%</strong><em>Top3 identity stability</em></div>
    `;
  }
}

function renderMultiWindow(windows) {
  if (els.empty) els.empty.hidden = true;

  const weightedRanks = windows.flatMap((window) => (window.holdout?.trials || []).map((row) => row.weightedRank));
  const bordaRanks = windows.flatMap((window) => (window.holdout?.trials || []).map((row) => row.bordaRank));
  const weighted = summarizeRanks(weightedRanks);
  const borda = summarizeRanks(bordaRanks);
  const positiveMeanWindows = windows.filter((window) => Number(window.holdout?.weighted?.evidence?.meanRankDelta || 0) > 0).length;
  const gatePassWindows = windows.filter((window) => window.gate?.passed).length;
  const minStableWindows = Math.ceil(windows.length * 0.6);

  const aggregatePassed = (
    weighted.trials >= 42 &&
    weighted.meanRankDelta > 0 &&
    weighted.pTop10 <= 0.10 &&
    weighted.pMeanRank <= 0.20 &&
    positiveMeanWindows >= minStableWindows
  );

  if (els.gate) {
    els.gate.className = `validation-gate ${aggregatePassed ? "gate-pass" : "gate-lock"}`;
    els.gate.innerHTML = `
      <div>
        <span>Multi-window status</span>
        <strong>${aggregatePassed ? "MULTI-WINDOW VALIDATED" : "LOCKED · belum stabil lintas window"}</strong>
        <p>${aggregatePassed
          ? "Aggregate locked-holdout melewati gate evidence dan mayoritas window memiliki mean rank lebih baik dari random. Tetap bukan jaminan hasil berikutnya."
          : "Belum ada bukti lintas-window yang cukup kuat. Sistem mempertahankan weighted ensemble sebagai eksperimen."}</p>
      </div>
      <div class="gate-confidence">
        <span>Out-of-sample</span>
        <strong>${weighted.trials} target</strong>
        <small>${windows.length} window × ${WINDOW_HOLDOUT} holdout</small>
      </div>
    `;
  }

  if (els.metrics) {
    els.metrics.innerHTML = `
      <div class="metric"><span>Windows</span><strong>${windows.length}</strong><small>${windows.length * WINDOW_TARGETS} evaluated targets</small></div>
      <div class="metric"><span>Locked holdout</span><strong>${weighted.trials}</strong><small>aggregate OOS targets</small></div>
      <div class="metric"><span>Weighted Top10</span><strong>${weighted.top10HitRatePct.toFixed(2)}%</strong><small>${weighted.top10Hits} hit</small></div>
      <div class="metric"><span>Weighted mean rank</span><strong>${weighted.meanTargetRank.toFixed(1)}</strong><small>Δ ${weighted.meanRankDelta >= 0 ? "+" : ""}${weighted.meanRankDelta.toFixed(1)}</small></div>
      <div class="metric"><span>Stable windows</span><strong>${positiveMeanWindows}/${windows.length}</strong><small>mean rank &lt; 500.5</small></div>
      <div class="metric"><span>p Top10</span><strong>${weighted.pTop10.toFixed(3)}</strong><small>gate ≤ 0.10</small></div>
    `;
  }

  if (els.body) {
    els.body.innerHTML = windows.map((window, index) => {
      const w = window.holdout.weighted;
      const offset = window._offset;
      return `
        <tr>
          <td class="rank-cell">W${index + 1}</td>
          <td class="mono">${offset}–${offset + WINDOW_TARGETS - 1}</td>
          <td class="mono">${w.trials}</td>
          <td class="mono">${w.top10HitRatePct.toFixed(2)}% (${w.top10Hits})</td>
          <td class="mono">#${w.meanTargetRank.toFixed(1)}</td>
          <td class="mono ${w.evidence.meanRankDelta > 0 ? "hit" : "miss"}">${w.evidence.meanRankDelta > 0 ? "+" : ""}${w.evidence.meanRankDelta.toFixed(1)}</td>
          <td><span class="evidence-pill ${window.gate.passed ? "evidence-good" : "evidence-bad"}">${window.gate.passed ? "pass" : "locked"}</span></td>
          <td class="mono current-top3">${(window.currentWeighted?.top3 || []).map((row) => row.number).join(" · ")}</td>
        </tr>
      `;
    }).join("");
  }

  const weights = aggregateWeights(windows);
  if (els.weights) {
    els.weights.innerHTML = weights.map((row) => `
      <div class="weight-row">
        <span>${row.label}</span>
        <div class="weight-track"><i style="width:${Math.max(2, row.weightPct)}%"></i></div>
        <strong>${row.weightPct.toFixed(2)}%</strong>
      </div>
    `).join("");
  }

  if (els.comparison) {
    els.comparison.innerHTML = `
      <div class="holdout-row"><span>Weighted aggregate</span><strong>Top10 ${weighted.top10HitRatePct.toFixed(2)}%</strong><em>Mean #${weighted.meanTargetRank.toFixed(1)}</em></div>
      <div class="holdout-row"><span>Equal Borda aggregate</span><strong>Top10 ${borda.top10HitRatePct.toFixed(2)}%</strong><em>Mean #${borda.meanTargetRank.toFixed(1)}</em></div>
      <div class="holdout-row"><span>Random reference</span><strong>Top10 1.00%</strong><em>Mean #500.5</em></div>
      <div class="holdout-row"><span>Diagnostic window gates</span><strong>${gatePassWindows}/${windows.length} pass</strong><em>aggregate tetap evaluator utama</em></div>
    `;
  }

  const stability = top3Stability(windows);
  if (els.stability) {
    els.stability.innerHTML = stability.map((row) => `
      <div class="stability-row"><strong class="mono">${row.number}</strong><span>${row.count}/${windows.length} snapshots</span><em>${row.pct.toFixed(0)}%</em></div>
    `).join("");
  }

  renderRegimeAnalysis(windows);
}

async function runMultiWindow() {
  setError();
  setBusy(true);
  try {
    const history = parseHistory();
    const minTrain = Number(els.minTrain?.value || 8);
    const decay = Number(els.decay?.value || 0.9);
    const available = Math.floor((history.length - minTrain) / WINDOW_TARGETS);
    const windowCount = Math.min(WINDOWS_DEFAULT, available);

    if (windowCount < 2) {
      throw new Error("Multi-Window membutuhkan histori lebih panjang. Muat D1 dan gunakan minimal sekitar 50 draw.");
    }

    const windows = [];
    renderProgress(0, windowCount);

    for (let index = 0; index < windowCount; index += 1) {
      const offset = index * WINDOW_TARGETS;
      if (els.gate) {
        els.gate.className = "validation-gate gate-running";
        els.gate.innerHTML = `<div><span>Multi-window progress</span><strong>Window ${index + 1}/${windowCount}</strong><p>Menjalankan lightweight walk-forward window. Tiap request lebih kecil agar aman dari CPU 503.</p></div>`;
      }

      const data = await postWindow({
        history: history.slice(offset),
        decay,
        minTrain,
      });
      data._offset = offset;
      windows.push(data);
      renderProgress(index + 1, windowCount);

      if (index < windowCount - 1) await sleep(WINDOW_DELAY_MS);
    }

    renderMultiWindow(windows);
  } catch (error) {
    setError(error.message || "Multi-Window Validation gagal.");
    if (els.gate) {
      els.gate.className = "validation-gate gate-lock";
      els.gate.innerHTML = `<div><span>Multi-window error</span><strong>Validation berhenti</strong><p>${error.message || "Request gagal."}</p></div>`;
    }
  } finally {
    setBusy(false);
    if (els.progress) els.progress.classList.remove("show");
  }
}

function init() {
  els.button?.addEventListener("click", runMultiWindow);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
