const sampleHistory = [
  "572", "187", "900", "240", "571", "840",
  "828", "983", "236", "620", "161", "717",
];

const els = {
  historyInput: document.querySelector("#historyInput"),
  decay: document.querySelector("#decay"),
  minTrain: document.querySelector("#minTrain"),
  maxTrials: document.querySelector("#maxTrials"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  backtestBtn: document.querySelector("#backtestBtn"),
  liveBtn: document.querySelector("#liveBtn"),
  syncBtn: document.querySelector("#syncBtn"),
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
  };
}

function setBusy(busy) {
  [els.analyzeBtn, els.backtestBtn, els.liveBtn, els.syncBtn]
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
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request gagal (${response.status})`);
  }
  return data;
}

async function getJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request gagal (${response.status})`);
  }
  return data;
}

function renderTop3(rows = []) {
  els.top3.innerHTML = rows.map((row) => `
    <article class="candidate">
      <div class="rank">Peringkat #${row.rank}</div>
      <div class="candidate-number">${row.number}</div>
      <div class="score">Skor relatif <strong>${row.score.toFixed(2)}</strong> / 100</div>
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
  els.modelName.textContent = "V0.3";
  renderTop3(data.top3);
  renderTop10(data.top10);
  renderDigitStats(data.history.byPosition);
}

function renderBacktest(data) {
  const s = data.summary;
  els.backtestEmpty.hidden = true;
  els.backtestMetrics.innerHTML = `
    <div class="metric"><span>Trials</span><strong>${s.trials}</strong></div>
    <div class="metric"><span>Top 3 hit</span><strong>${s.top3HitRatePct.toFixed(2)}%</strong></div>
    <div class="metric"><span>Top 10 hit</span><strong>${s.top10HitRatePct.toFixed(2)}%</strong></div>
    <div class="metric"><span>Mean rank</span><strong>${s.meanTargetRank.toFixed(1)}</strong></div>
  `;

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

async function runAnalysis() {
  showError();
  setBusy(true);
  try {
    const history = parseHistory();
    const data = await postJson("/api/analyze", { history, decay: options().decay });
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
      postJson("/api/analyze", { history, decay: opts.decay }),
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

async function loadLiveSource() {
  showError();
  setBusy(true);
  setCollectorStatus("sedang mengambil hasil terbaru dari source…", "Live collector");
  try {
    const data = await getJson("/api/source?pages=5");
    els.historyInput.value = data.history.join("\n");
    const latest = data.latest;
    const pageNote = data.failedPages?.length ? ` · ${data.failedPages.length} page gagal` : "";
    setCollectorStatus(
      `${data.count} draw dimuat. Latest period ${latest?.period ?? "-"} = ${latest?.result ?? "---"}${pageNote}`,
      "Live collector sukses",
    );
    const analysis = await postJson("/api/analyze", { history: data.history, decay: options().decay });
    renderAnalysis(analysis);
  } catch (error) {
    setCollectorStatus(error.message || "gagal mengambil source.", "Live collector gagal");
    showError(error.message || "Live collector gagal.");
  } finally {
    setBusy(false);
  }
}

async function syncCollector() {
  showError();
  setBusy(true);
  setCollectorStatus("mengambil dua halaman terbaru dan mencoba menyimpan ke D1…", "Sync collector");
  try {
    const data = await postJson("/api/collect", { pages: 2 });
    els.historyInput.value = data.history.join("\n");
    if (data.storage?.configured) {
      setCollectorStatus(
        `${data.count} draw diperiksa; ${data.storage.inserted} period baru masuk D1. Latest ${data.latest?.period} = ${data.latest?.result}.`,
        "Sync + D1 sukses",
      );
    } else {
      setCollectorStatus(
        `${data.count} draw berhasil diambil, tetapi D1 belum dibinding. Data live tetap dimuat ke input.`,
        "Source sukses · D1 belum aktif",
      );
    }
    const analysis = await postJson("/api/analyze", { history: data.history, decay: options().decay });
    renderAnalysis(analysis);
  } catch (error) {
    setCollectorStatus(error.message || "sync gagal.", "Sync collector gagal");
    showError(error.message || "Sync collector gagal.");
  } finally {
    setBusy(false);
  }
}

els.analyzeBtn.addEventListener("click", runAnalysis);
els.backtestBtn.addEventListener("click", runBacktest);
els.liveBtn?.addEventListener("click", loadLiveSource);
els.syncBtn?.addEventListener("click", syncCollector);
els.sampleBtn.addEventListener("click", () => {
  els.historyInput.value = sampleHistory.join("\n");
  setCollectorStatus("contoh lokal dimuat. Klik Ambil Live 30 untuk source terbaru.", "Sample");
  showError();
  runAnalysis();
});
els.clearBtn.addEventListener("click", () => {
  els.historyInput.value = "";
  els.historyInput.focus();
  showError();
});

els.historyInput.value = sampleHistory.join("\n");
runAnalysis();
