const sampleHistory = [
  "226", "572", "187", "900", "240", "571",
  "840", "828", "983", "236", "620", "161", "717",
];

const els = {
  historyInput: document.querySelector("#historyInput"),
  decay: document.querySelector("#decay"),
  minTrain: document.querySelector("#minTrain"),
  maxTrials: document.querySelector("#maxTrials"),
  modelSelect: document.querySelector("#modelSelect"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  backtestBtn: document.querySelector("#backtestBtn"),
  labBtn: document.querySelector("#labBtn"),
  validateBtn: document.querySelector("#validateBtn"),
  liveBtn: document.querySelector("#liveBtn"),
  syncBtn: document.querySelector("#syncBtn"),
  storedBtn: document.querySelector("#storedBtn"),
  sampleBtn: document.querySelector("#sampleBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  collectorStatus: document.querySelector("#collectorStatus"),
  error: document.querySelector("#errorBox"),
  loading: document.querySelector("#loadingLine"),
  newest: document.querySelector("#newestNumber"),
  drawCount: document.querySelector("#drawCount"),
  modelName: document.querySelector("#modelName"),
  top3: document.querySelector("#top3"),
  top10Body: document.querySelector("#top10Body"),
  digitStats: document.querySelector("#digitStats"),
  backtestMetrics: document.querySelector("#backtestMetrics"),
  backtestBody: document.querySelector("#backtestBody"),
  backtestEmpty: document.querySelector("#backtestEmpty"),
  backtestModel: document.querySelector("#backtestModel"),
  backtestBaseline: document.querySelector("#backtestBaseline"),
  leaderboardBody: document.querySelector("#leaderboardBody"),
  leaderboardEmpty: document.querySelector("#leaderboardEmpty"),
  leaderWinner: document.querySelector("#leaderWinner"),
  leaderboardMeta: document.querySelector("#leaderboardMeta"),
  validationEmpty: document.querySelector("#validationEmpty"),
  validationGate: document.querySelector("#validationGate"),
  validationMetrics: document.querySelector("#validationMetrics"),
  validationWeights: document.querySelector("#validationWeights"),
  validationHoldout: document.querySelector("#validationHoldout"),
  validationTop3: document.querySelector("#validationTop3"),
};

function parseHistory() {
  const tokens = els.historyInput.value
    .split(/[\s,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const invalid = tokens.filter((token) => !/^\d{1,3}$/.test(token) || Number(token) > 999);
  const history = tokens
    .filter((token) => /^\d{1,3}$/.test(token) && Number(token) <= 999)
    .map((token) => token.padStart(3, "0"));

  if (invalid.length) {
    throw new Error(`Ada input tidak valid: ${invalid.slice(0, 4).join(", ")}${invalid.length > 4 ? " …" : ""}`);
  }
  if (history.length < 3) {
    throw new Error("Masukkan minimal 3 hasil 3 digit. Urutan: terbaru → terlama.");
  }
  return history;
}

function options() {
  return {
    decay: Number(els.decay.value),
    minTrain: Number(els.minTrain.value),
    maxTrials: Number(els.maxTrials.value),
    modelId: els.modelSelect?.value || "ensemble",
  };
}

function setBusy(busy) {
  [els.analyzeBtn, els.backtestBtn, els.labBtn, els.validateBtn, els.liveBtn, els.syncBtn, els.storedBtn]
    .filter(Boolean)
    .forEach((button) => { button.disabled = busy; });
  els.loading.classList.toggle("show", busy);
}

function showError(message = "") {
  els.error.textContent = message;
  els.error.classList.toggle("show", Boolean(message));
}

function setCollectorStatus(message, strong = "Collector") {
  if (!els.collectorStatus) return;
  els.collectorStatus.innerHTML = `<span>◎</span><span><strong>${strong}.</strong> ${message}</span>`;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}

async function getJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}

function consensusText(row) {
  if (!row?.consensus) return "";
  return `<span class="consensus">Top10 vote ${row.consensus.top10Votes}/${row.consensus.models}</span>`;
}

function statusClass(status = "") {
  if (status === "validated-edge" || status === "validated") return "evidence-good";
  if (status === "promising") return "evidence-warn";
  if (status === "below-random-rank" || status === "locked") return "evidence-bad";
  return "evidence-neutral";
}

function renderTop3(rows = []) {
  els.top3.innerHTML = rows.map((row) => `
    <article class="candidate">
      <div class="rank">Peringkat #${row.rank}</div>
      <div class="candidate-number">${row.number}</div>
      <div class="score">Skor relatif <strong>${row.score.toFixed(2)}</strong> / 100 ${consensusText(row)}</div>
    </article>
  `).join("");
}

function renderTop10(rows = []) {
  els.top10Body.innerHTML = rows.map((row) => `
    <tr>
      <td class="rank-cell">#${row.rank}</td>
      <td class="number-cell mono">${row.number}</td>
      <td>
        <span class="score-track"><span class="score-fill" style="width:${Math.max(1, row.score)}%"></span></span>
        <span class="mono">${row.score.toFixed(2)}</span>
        ${row.consensus ? `<span class="vote-mini">${row.consensus.top10Votes}/${row.consensus.models}</span>` : ""}
      </td>
      <td class="mono">${(row.components.position * 100).toFixed(2)}</td>
      <td class="mono">${(row.components.transition * 100).toFixed(2)}</td>
    </tr>
  `).join("");
}

function renderDigitStats(byPosition = []) {
  const labels = ["Ratusan", "Puluhan", "Satuan"];
  els.digitStats.innerHTML = byPosition.map((counts, pos) => {
    const max = Math.max(...counts, 0);
    const digits = counts.map((count, digit) => `
      <div class="digit ${count === max && max > 0 ? "hot" : ""}">
        <strong>${digit}</strong><span>${count}×</span>
      </div>
    `).join("");
    return `<div class="position-card"><div class="position-title">${labels[pos]}</div><div class="digit-grid">${digits}</div></div>`;
  }).join("");
}

function renderAnalysis(data) {
  els.newest.textContent = data.history.newest || "---";
  els.drawCount.textContent = String(data.history.draws ?? 0);
  els.modelName.textContent = data.meta?.modelLabel || "V0.5";
  renderTop3(data.top3);
  renderTop10(data.top10);
  renderDigitStats(data.history.byPosition);
}

function renderBacktest(data) {
  const s = data.summary;
  const evidence = data.evidence;
  els.backtestEmpty.hidden = true;
  if (els.backtestModel) els.backtestModel.textContent = data.meta?.modelLabel || data.meta?.model || "Model";
  els.backtestMetrics.innerHTML = `
    <div class="metric"><span>Trials</span><strong>${s.trials}</strong></div>
    <div class="metric"><span>Top 3 hit</span><strong>${s.top3HitRatePct.toFixed(2)}%</strong><small>${s.top3Hits} hit</small></div>
    <div class="metric"><span>Top 10 hit</span><strong>${s.top10HitRatePct.toFixed(2)}%</strong><small>${s.top10Hits} hit</small></div>
    <div class="metric"><span>Mean rank</span><strong>${s.meanTargetRank.toFixed(1)}</strong><small>random 500.5</small></div>
    <div class="metric"><span>Δ vs random</span><strong class="${evidence.meanRankDelta > 0 ? "hit" : "miss"}">${evidence.meanRankDelta > 0 ? "+" : ""}${evidence.meanRankDelta.toFixed(1)}</strong><small>lebih besar = lebih baik</small></div>
  `;

  if (els.backtestBaseline) {
    els.backtestBaseline.className = `baseline-banner ${statusClass(evidence.status)}`;
    els.backtestBaseline.innerHTML = `
      <strong>${evidence.label}</strong>
      <span>Confidence evidence ${evidence.confidenceScore.toFixed(1)}/100 · p(mean rank) ${evidence.pValues.meanRank.toFixed(3)} · p(Top10) ${evidence.pValues.top10.toFixed(3)}. Bukan probabilitas hasil.</span>
    `;
  }

  els.backtestBody.innerHTML = data.trials.map((trial, index) => `
    <tr>
      <td class="rank-cell">${index + 1}</td>
      <td class="number-cell mono">${trial.target}</td>
      <td class="mono">#${trial.rank}</td>
      <td class="${trial.hit3 ? "hit" : "miss"}">${trial.hit3 ? "HIT" : "—"}</td>
      <td class="${trial.hit10 ? "hit" : "miss"}">${trial.hit10 ? "HIT" : "—"}</td>
      <td class="mono">${trial.predictedTop3.join(" · ")}</td>
    </tr>
  `).join("");
}

function renderLeaderboard(data) {
  els.leaderboardEmpty.hidden = true;
  const winner = data.winner;
  if (els.leaderWinner) {
    els.leaderWinner.innerHTML = winner ? `
      <div><span>Model historis teratas</span><strong>${winner.label}</strong></div>
      <div><span>Leader score</span><strong>${winner.leaderScore.toFixed(2)}</strong></div>
      <div><span>Baseline verdict</span><strong class="${statusClass(winner.evidence.status)}">${winner.evidence.label}</strong></div>
      <div><span>Current Top 3</span><strong class="mono">${winner.currentTop3.join(" · ")}</strong></div>
    ` : "";
  }
  if (els.leaderboardMeta) {
    els.leaderboardMeta.textContent = `${data.meta.trials} rolling trials · ${data.meta.models} model · random mean rank 500.5 · skor historis, bukan probabilitas`;
  }

  els.leaderboardBody.innerHTML = data.leaderboard.map((row, index) => `
    <tr class="${index === 0 ? "leader-row" : ""}">
      <td class="rank-cell">#${index + 1}</td>
      <td><button class="model-link" type="button" data-model="${row.id}">${row.label}</button><div class="model-desc">${row.description}</div></td>
      <td class="mono"><strong>${row.leaderScore.toFixed(2)}</strong></td>
      <td class="mono">${row.top3HitRatePct.toFixed(2)}% <span class="tiny-hit">(${row.top3Hits})</span></td>
      <td class="mono">${row.top10HitRatePct.toFixed(2)}% <span class="tiny-hit">(${row.top10Hits})</span></td>
      <td class="mono">${row.top25HitRatePct.toFixed(2)}% <span class="tiny-hit">(${row.top25Hits})</span></td>
      <td class="mono">${row.meanTargetRank.toFixed(1)}</td>
      <td class="mono ${row.evidence.meanRankDelta > 0 ? "hit" : "miss"}">${row.evidence.meanRankDelta > 0 ? "+" : ""}${row.evidence.meanRankDelta.toFixed(1)}</td>
      <td><span class="evidence-pill ${statusClass(row.evidence.status)}">${row.evidence.status}</span></td>
      <td class="mono current-top3">${row.currentTop3.join(" · ")}</td>
    </tr>
  `).join("");
}

function renderValidation(data) {
  els.validationEmpty.hidden = true;
  const gate = data.gate;
  const weighted = data.holdout.weighted;
  const borda = data.holdout.borda;

  els.validationGate.className = `validation-gate ${gate.passed ? "gate-pass" : "gate-lock"}`;
  els.validationGate.innerHTML = `
    <div>
      <span>Validation status</span>
      <strong>${gate.label}</strong>
      <p>${gate.reason}</p>
    </div>
    <div class="gate-confidence">
      <span>Holdout evidence</span>
      <strong>${weighted.evidence.confidenceScore.toFixed(1)}/100</strong>
      <small>bukan win probability</small>
    </div>
  `;

  els.validationMetrics.innerHTML = `
    <div class="metric"><span>Calibration</span><strong>${data.meta.calibrationTrials}</strong><small>older targets</small></div>
    <div class="metric"><span>Locked holdout</span><strong>${data.meta.holdoutTrials}</strong><small>newest targets</small></div>
    <div class="metric"><span>Weighted Top10</span><strong>${weighted.top10HitRatePct.toFixed(2)}%</strong><small>${weighted.top10Hits} hit</small></div>
    <div class="metric"><span>Weighted mean rank</span><strong>${weighted.meanTargetRank.toFixed(1)}</strong><small>Δ ${weighted.evidence.meanRankDelta > 0 ? "+" : ""}${weighted.evidence.meanRankDelta.toFixed(1)}</small></div>
    <div class="metric"><span>p Top10</span><strong>${weighted.evidence.pValues.top10.toFixed(3)}</strong><small>gate ≤ 0.10</small></div>
  `;

  els.validationWeights.innerHTML = data.weights.map((row) => `
    <div class="weight-row">
      <span>${row.label}</span>
      <div class="weight-track"><i style="width:${Math.max(2, row.weightPct)}%"></i></div>
      <strong>${row.weightPct.toFixed(2)}%</strong>
    </div>
  `).join("");

  els.validationHoldout.innerHTML = `
    <div class="holdout-row"><span>Weighted Ensemble</span><strong>Top10 ${weighted.top10HitRatePct.toFixed(2)}%</strong><em>Mean #${weighted.meanTargetRank.toFixed(1)}</em></div>
    <div class="holdout-row"><span>Equal Borda</span><strong>Top10 ${borda.top10HitRatePct.toFixed(2)}%</strong><em>Mean #${borda.meanTargetRank.toFixed(1)}</em></div>
    <div class="holdout-row"><span>Random reference</span><strong>Top10 1.00%</strong><em>Mean #500.5</em></div>
  `;

  els.validationTop3.innerHTML = data.currentWeighted.top3
    .map((row, index) => `<span><small>#${index + 1}</small>${row.number}</span>`)
    .join("");
  els.validationTop3.classList.toggle("weighted-locked", !gate.passed);
}

async function runAnalysis() {
  showError();
  setBusy(true);
  try {
    const history = parseHistory();
    const opts = options();
    const data = await postJson("/api/analyze", { history, decay: opts.decay, modelId: opts.modelId });
    renderAnalysis(data);
  } catch (error) {
    showError(error.message || "Analisis gagal.");
  } finally {
    setBusy(false);
  }
}

async function runBacktest() {
  showError();
  setBusy(true);
  try {
    const history = parseHistory();
    const opts = options();
    const [analysis, backtest] = await Promise.all([
      postJson("/api/analyze", { history, decay: opts.decay, modelId: opts.modelId }),
      postJson("/api/backtest", { history, ...opts }),
    ]);
    renderAnalysis(analysis);
    renderBacktest(backtest);
  } catch (error) {
    showError(error.message || "Backtest gagal.");
  } finally {
    setBusy(false);
  }
}

async function runModelLab() {
  showError();
  setBusy(true);
  try {
    const history = parseHistory();
    const opts = options();
    const data = await postJson("/api/leaderboard", { history, ...opts });
    renderLeaderboard(data);
  } catch (error) {
    showError(error.message || "Model Lab gagal.");
  } finally {
    setBusy(false);
  }
}

async function runValidation() {
  showError();
  setBusy(true);
  try {
    const history = parseHistory();
    const opts = options();
    const data = await postJson("/api/validate", { history, ...opts });
    renderValidation(data);
  } catch (error) {
    showError(error.message || "Validation Gate gagal.");
  } finally {
    setBusy(false);
  }
}

async function analyzeLoadedHistory(history) {
  const opts = options();
  const analysis = await postJson("/api/analyze", { history, decay: opts.decay, modelId: opts.modelId });
  renderAnalysis(analysis);
}

async function loadLiveSource() {
  showError();
  setBusy(true);
  setCollectorStatus("sedang mengambil hasil terbaru dari source…", "Live collector");
  try {
    const data = await getJson("/api/source?pages=5");
    els.historyInput.value = data.history.join("\n");
    const pageNote = data.failedPages?.length ? ` · ${data.failedPages.length} page gagal` : "";
    setCollectorStatus(
      `${data.count} draw dimuat. Latest period ${data.latest?.period ?? "-"} = ${data.latest?.result ?? "---"}${pageNote}`,
      "Live collector sukses",
    );
    await analyzeLoadedHistory(data.history);
  } catch (error) {
    setCollectorStatus(error.message || "gagal mengambil source.", "Live collector gagal");
    showError(error.message || "Live collector gagal.");
  } finally {
    setBusy(false);
  }
}

async function loadStoredHistory({ quiet = false } = {}) {
  if (!quiet) {
    showError();
    setBusy(true);
    setCollectorStatus("membaca histori permanen dari D1…", "D1 history");
  }
  try {
    const data = await getJson("/api/history?limit=500");
    els.historyInput.value = data.history.join("\n");
    setCollectorStatus(
      `${data.count} draw dimuat dari D1. Latest ${data.latest?.period ?? "-"} = ${data.latest?.result ?? "---"}.`,
      "D1 history sukses",
    );
    await analyzeLoadedHistory(data.history);
    return data;
  } catch (error) {
    if (!quiet) {
      setCollectorStatus(error.message || "gagal membaca D1.", "D1 history gagal");
      showError(error.message || "D1 history gagal.");
    }
    throw error;
  } finally {
    if (!quiet) setBusy(false);
  }
}

async function syncCollector() {
  showError();
  setBusy(true);
  setCollectorStatus("mengambil hingga 20 halaman dan menyimpan period baru ke D1…", "Sync collector");
  try {
    const data = await postJson("/api/collect", { pages: 20 });
    if (data.storage?.configured) {
      const stored = await getJson("/api/history?limit=500");
      els.historyInput.value = stored.history.join("\n");
      setCollectorStatus(
        `${data.count} draw diperiksa; ${data.storage.inserted} period baru masuk D1. Total tersimpan ${stored.count}. Latest ${stored.latest?.period} = ${stored.latest?.result}.`,
        "Sync + D1 sukses",
      );
      await analyzeLoadedHistory(stored.history);
    } else {
      els.historyInput.value = data.history.join("\n");
      setCollectorStatus(
        `${data.count} draw berhasil diambil, tetapi D1 belum dibinding. Data live tetap dimuat ke input.`,
        "Source sukses · D1 belum aktif",
      );
      await analyzeLoadedHistory(data.history);
    }
  } catch (error) {
    setCollectorStatus(error.message || "sync gagal.", "Sync collector gagal");
    showError(error.message || "Sync collector gagal.");
  } finally {
    setBusy(false);
  }
}

async function loadModels() {
  try {
    const data = await getJson("/api/models");
    const current = els.modelSelect.value || "ensemble";
    els.modelSelect.innerHTML = data.models.map((model) => `
      <option value="${model.id}">${model.label}</option>
    `).join("");
    els.modelSelect.value = data.models.some((model) => model.id === current) ? current : "ensemble";
  } catch {
    // Static options remain usable when the models endpoint is temporarily unavailable.
  }
}

els.analyzeBtn.addEventListener("click", runAnalysis);
els.backtestBtn.addEventListener("click", runBacktest);
els.labBtn?.addEventListener("click", runModelLab);
els.validateBtn?.addEventListener("click", runValidation);
els.liveBtn?.addEventListener("click", loadLiveSource);
els.syncBtn?.addEventListener("click", syncCollector);
els.storedBtn?.addEventListener("click", () => loadStoredHistory());
els.modelSelect?.addEventListener("change", runAnalysis);
els.sampleBtn.addEventListener("click", () => {
  els.historyInput.value = sampleHistory.join("\n");
  setCollectorStatus("contoh lokal dimuat. Gunakan Sync Collector untuk menambah histori D1.", "Sample");
  showError();
  runAnalysis();
});
els.clearBtn.addEventListener("click", () => {
  els.historyInput.value = "";
  els.historyInput.focus();
  showError();
});
els.leaderboardBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-model]");
  if (!button) return;
  els.modelSelect.value = button.dataset.model;
  runAnalysis();
});

els.historyInput.value = sampleHistory.join("\n");
loadModels();
runAnalysis();
