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
      const previous = totals.get(row.id) || { id: row.id, label: row.label, sum: 0 };
      previous.sum += Number(row.weightPct || 0);
      totals.set(row.id, previous);
    }
  }
  return [...totals.values()].map((row) => ({
    id: row.id,
    label: row.label,
    weightPct: row.sum / Math.max(1, windows.length),
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
    .slice(0, 6);
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
