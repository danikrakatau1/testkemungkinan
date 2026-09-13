const PREMIUM_CLEAN_VERSION = "0.9.1";

function moveForwardIntoFooter() {
  const foot = document.querySelector('.auto-foot');
  const last = document.querySelector('#autoLast');
  const oldWrap = document.querySelector('.auto-last');
  if (!foot || !last) return false;
  if (last.parentElement !== foot) {
    last.classList.add('premium-last');
    const updated = document.querySelector('#autoUpdated');
    foot.insertBefore(last, updated || null);
  }
  if (oldWrap && !oldWrap.contains(last)) oldWrap.remove();
  return true;
}

function markPremium() {
  document.documentElement.classList.add('premium-clean-v091');
  const status = document.querySelector('.topbar .status');
  if (status) status.innerHTML = '<span class="status-dot"></span> V0.9.1 · AutoPilot · SAFE';
  const updated = document.querySelector('#autoUpdated');
  if (updated) {
    const text = String(updated.textContent || '');
    updated.textContent = text.match(/V\d+\.\d+\.\d+/)
      ? text.replace(/V\d+\.\d+\.\d+/g, `V${PREMIUM_CLEAN_VERSION}`)
      : `${text} · V${PREMIUM_CLEAN_VERSION}`;
  }
}

function organize() {
  markPremium();
  moveForwardIntoFooter();
}

function initPremiumClean() {
  organize();
  [200, 500, 1000, 2000, 4000].forEach((delay) => setTimeout(organize, delay));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPremiumClean, { once: true });
else initPremiumClean();
