const AI2_CLARITY_VERSION = "0.9.4-history-clarity";

function injectClarityStyle() {
  if (document.querySelector("#ai2HistoryClarityStyle")) return;
  const style = document.createElement("style");
  style.id = "ai2HistoryClarityStyle";
  style.textContent = `
    .ai2-target-proof{display:block;margin-top:5px;font:750 8px/1.3 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#7dd3fc!important}
    .ai2-lock-asli{display:block;margin-bottom:5px;font:800 7px/1 system-ui,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:#86efac}
    .ai2-prediction-cell{position:relative}
  `;
  document.head.appendChild(style);
}

function decorateActualCell(cell) {
  if (!cell || cell.querySelector(".ai2-target-proof")) return;
  const periodNode = cell.querySelector("small");
  if (!periodNode) return;
  const periodText = String(periodNode.textContent || "").trim();
  const match = periodText.match(/Period\s+(.+)/i);
  if (!match) return;
  const proof = document.createElement("small");
  proof.className = "ai2-target-proof";
  proof.textContent = `TEBAKAN UNTUK PERIOD ${match[1]}`;
  cell.appendChild(proof);
}

function decoratePredictionCell(cell) {
  if (!cell || cell.querySelector(".ai2-lock-asli")) return;
  const label = document.createElement("span");
  label.className = "ai2-lock-asli";
  label.textContent = "LOCK ASLI";
  cell.insertBefore(label, cell.firstChild);
}

function decorateHistory(root = document) {
  root.querySelectorAll?.(".ai2-history-table .ai2-actual-cell").forEach(decorateActualCell);
  root.querySelectorAll?.(".ai2-history-table .ai2-prediction-cell").forEach(decoratePredictionCell);
}

function watchHistoryBody(body) {
  if (!body || body.dataset.ai2ClarityWatch === "1") return;
  body.dataset.ai2ClarityWatch = "1";
  const observer = new MutationObserver(() => decorateHistory(body));
  observer.observe(body, { childList: true, subtree: true });
  decorateHistory(body);
}

function initHistoryClarity() {
  injectClarityStyle();
  const ids = [
    "ai2Utama3dHistory",
    "ai2UtamaKeeperHistory",
    "ai2Europe3dHistory",
    "ai2EuropeKeeperHistory",
  ];
  let found = 0;
  ids.forEach((id) => {
    const node = document.getElementById(id);
    if (node) {
      found += 1;
      watchHistoryBody(node);
    }
  });
  decorateHistory();
  if (found < ids.length) setTimeout(initHistoryClarity, 120);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHistoryClarity, { once: true });
} else {
  initHistoryClarity();
}

console.debug(`AI V2 history clarity ${AI2_CLARITY_VERSION} active`);
