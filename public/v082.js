const MOTION_VERSION = "0.8.2";
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

let pointerFrame = 0;
let lastClockValue = "";
let uiObserver = null;

function injectStyles() {
  if (document.querySelector("#v082Styles")) return;
  const style = document.createElement("style");
  style.id = "v082Styles";
  style.textContent = `
    :root{
      --v082-cyan:56 189 248;
      --v082-blue:99 102 241;
      --v082-violet:168 85 247;
      --v082-green:52 211 153;
      --v082-ease:cubic-bezier(.22,1,.36,1);
    }

    html,body,button,input,select,textarea{
      font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif!important;
      font-variant-numeric:tabular-nums;
      -webkit-font-smoothing:antialiased;
      text-rendering:optimizeLegibility;
    }

    body{
      background:#050914!important;
      min-height:100vh;
    }

    .v082-atmosphere{
      position:fixed;
      inset:0;
      z-index:-2;
      overflow:hidden;
      pointer-events:none;
      background:
        radial-gradient(1100px 720px at 8% -8%,rgba(37,99,235,.16),transparent 62%),
        radial-gradient(980px 640px at 103% 5%,rgba(124,58,237,.16),transparent 62%),
        linear-gradient(180deg,#07101f 0%,#050914 45%,#030711 100%);
      isolation:isolate;
    }
    .v082-aurora{
      position:absolute;
      width:min(58vw,920px);
      aspect-ratio:1.45;
      border-radius:50%;
      filter:blur(86px) saturate(125%);
      opacity:.17;
      will-change:transform;
      transform:translate3d(0,0,0);
    }
    .v082-aurora.a{left:-17vw;top:-20vh;background:radial-gradient(circle,rgba(56,189,248,.9),rgba(37,99,235,.38) 45%,transparent 72%);animation:v082DriftA 18s ease-in-out infinite alternate}
    .v082-aurora.b{right:-18vw;top:-15vh;background:radial-gradient(circle,rgba(168,85,247,.85),rgba(79,70,229,.35) 46%,transparent 72%);animation:v082DriftB 22s ease-in-out infinite alternate}
    .v082-aurora.c{left:30%;bottom:-38vh;background:radial-gradient(circle,rgba(14,165,233,.42),rgba(139,92,246,.3) 48%,transparent 73%);opacity:.11;animation:v082DriftC 26s ease-in-out infinite alternate}
    .v082-grid{
      position:absolute;inset:0;opacity:.055;
      background-image:linear-gradient(rgba(148,163,184,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.12) 1px,transparent 1px);
      background-size:72px 72px;
      mask-image:linear-gradient(to bottom,rgba(0,0,0,.7),transparent 75%);
    }
    .v082-grain{
      position:absolute;inset:-35%;opacity:.032;mix-blend-mode:soft-light;
      background-image:repeating-radial-gradient(circle at 18% 36%,rgba(255,255,255,.72) 0 1px,transparent 1px 5px),repeating-radial-gradient(circle at 78% 64%,rgba(255,255,255,.42) 0 1px,transparent 1px 6px);
      background-size:79px 73px,97px 91px;
      animation:v082Grain .7s steps(2) infinite;
    }
    .v082-vignette{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,transparent 0 24%,rgba(1,4,12,.15) 62%,rgba(1,4,12,.76) 125%)}

    .shell,.topbar,main,.autopilot-shell{position:relative;z-index:1}
    .topbar{background:transparent!important}

    .autopilot-panel{
      position:relative;
      background:linear-gradient(155deg,rgba(11,19,35,.87),rgba(6,12,24,.78))!important;
      border-color:rgba(148,163,184,.18)!important;
      box-shadow:0 28px 90px rgba(0,0,0,.34),inset 0 1px rgba(255,255,255,.025)!important;
      backdrop-filter:blur(22px) saturate(118%);
      -webkit-backdrop-filter:blur(22px) saturate(118%);
    }
    .autopilot-panel::after{
      content:"";position:absolute;left:-30%;top:-1px;width:35%;height:1px;pointer-events:none;
      background:linear-gradient(90deg,transparent,rgba(125,211,252,.75),rgba(196,181,253,.65),transparent);
      animation:v082EdgeSweep 9s ease-in-out infinite;
    }

    .autopilot-title,.brand-text{letter-spacing:-.035em!important;font-weight:650!important}
    .autopilot-sub{letter-spacing:-.01em}
    .latest-number{letter-spacing:-.055em!important;font-weight:650!important}
    .prediction-num{letter-spacing:-.035em!important;font-weight:650!important}
    .draw-countdown-clock{letter-spacing:-.045em!important;font-weight:650!important}

    .latest-card,.prediction-card,.last-card,.draw-countdown,.autopilot-status{
      position:relative;
      overflow:hidden;
      background:linear-gradient(145deg,rgba(15,25,44,.62),rgba(9,16,30,.52))!important;
      border-color:rgba(148,163,184,.14)!important;
      transition:transform .28s var(--v082-ease),border-color .28s ease,box-shadow .28s ease,background .28s ease;
    }
    .prediction-card,.latest-card{
      --spot-x:50%;--spot-y:50%;
    }
    .prediction-card::before,.latest-card::before{
      content:"";position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .28s ease;
      background:radial-gradient(280px circle at var(--spot-x) var(--spot-y),rgba(129,140,248,.13),transparent 65%);
    }
    .prediction-card:hover,.latest-card:hover{
      transform:translateY(-3px);
      border-color:rgba(129,140,248,.3)!important;
      box-shadow:0 16px 34px rgba(0,0,0,.18),0 0 0 1px rgba(99,102,241,.045);
    }
    .prediction-card:hover::before,.latest-card:hover::before{opacity:1}
    .prediction-num{
      background:linear-gradient(145deg,rgba(18,30,54,.78),rgba(11,20,38,.66))!important;
      transition:transform .22s var(--v082-ease),border-color .22s ease,box-shadow .22s ease,color .22s ease;
    }
    .prediction-num:hover{transform:translateY(-2px) scale(1.015);border-color:rgba(129,140,248,.34)!important;box-shadow:0 10px 24px rgba(0,0,0,.17),inset 0 1px rgba(255,255,255,.035)}

    .draw-countdown{box-shadow:inset 0 1px rgba(255,255,255,.025)}
    .draw-countdown-clock{transition:color .18s ease,text-shadow .18s ease}
    .draw-countdown-clock.checking{color:#bae6fd!important;text-shadow:0 0 24px rgba(56,189,248,.28)}
    .draw-countdown-clock.v082-tick{animation:v082DigitTick .22s var(--v082-ease)}

    .auto-badge,.status{
      backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);
    }
    .auto-dot,.status-dot{animation:v082StatusPulse 2.8s ease-in-out infinite}

    .auto-btn{
      position:relative;overflow:hidden;
      transition:transform .2s var(--v082-ease),border-color .2s ease,background .2s ease,box-shadow .2s ease!important;
    }
    .auto-btn::after{
      content:"";position:absolute;inset:-1px auto -1px -70%;width:52%;pointer-events:none;
      background:linear-gradient(105deg,transparent,rgba(255,255,255,.09),transparent);
      transform:skewX(-18deg);transition:left .55s var(--v082-ease);
    }
    .auto-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.2)}
    .auto-btn:hover::after{left:125%}
    .auto-btn:active{transform:translateY(0) scale(.985)}

    .table-wrap,.model-table-wrap{
      position:relative;
      border:1px solid rgba(148,163,184,.12)!important;
      border-radius:14px!important;
      background:linear-gradient(145deg,rgba(12,20,36,.66),rgba(7,13,25,.58))!important;
      box-shadow:inset 0 1px rgba(255,255,255,.018);
      transition:border-color .28s ease,box-shadow .28s ease,transform .28s var(--v082-ease);
    }
    .table-wrap:hover,.model-table-wrap:hover{border-color:rgba(129,140,248,.2)!important;box-shadow:0 18px 42px rgba(0,0,0,.16),inset 0 1px rgba(255,255,255,.025)}
    table{border-collapse:separate!important;border-spacing:0!important}
    thead th{background:rgba(11,18,32,.78)!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    tbody tr{transition:transform .2s var(--v082-ease),background .2s ease,box-shadow .2s ease,opacity .25s ease}
    tbody tr:hover{background:rgba(99,102,241,.065)!important;box-shadow:inset 2px 0 rgba(129,140,248,.55);transform:translateX(2px)}
    tbody td{transition:color .2s ease,background .2s ease,text-shadow .2s ease}
    tbody tr:hover td{color:#e8eef9}
    tbody tr.v082-row-enter{animation:v082RowEnter .42s var(--v082-ease) both}
    tbody tr.v082-row-update{animation:v082RowPulse .72s ease both}

    .panel,.validation-card,.arena-card,.forward-metric{
      transition:border-color .25s ease,box-shadow .25s ease,transform .25s var(--v082-ease);
    }
    body:not(.autopilot-simple) .panel:hover{border-color:rgba(129,140,248,.19)!important;box-shadow:0 18px 40px rgba(0,0,0,.12)}

    .v082-value-flash{animation:v082ValueFlash .52s var(--v082-ease)}

    @keyframes v082DriftA{0%{transform:translate3d(-2%,0,0) scale(.96) rotate(-3deg)}100%{transform:translate3d(15%,10%,0) scale(1.08) rotate(4deg)}}
    @keyframes v082DriftB{0%{transform:translate3d(4%,0,0) scale(1)}100%{transform:translate3d(-14%,13%,0) scale(1.08)}}
    @keyframes v082DriftC{0%{transform:translate3d(-5%,5%,0) scale(.95)}100%{transform:translate3d(12%,-8%,0) scale(1.12)}}
    @keyframes v082Grain{0%{transform:translate3d(-1%,1%,0)}33%{transform:translate3d(1%,-1%,0)}66%{transform:translate3d(1%,1%,0)}100%{transform:translate3d(-1%,-1%,0)}}
    @keyframes v082EdgeSweep{0%,24%{left:-35%;opacity:0}38%{opacity:.8}62%{opacity:.8}78%,100%{left:108%;opacity:0}}
    @keyframes v082StatusPulse{0%,100%{box-shadow:0 0 0 3px rgba(74,222,128,.07)}50%{box-shadow:0 0 0 7px rgba(74,222,128,.015),0 0 15px rgba(74,222,128,.22)}}
    @keyframes v082DigitTick{0%{transform:translateY(2px);opacity:.72;filter:blur(.25px)}100%{transform:translateY(0);opacity:1;filter:blur(0)}}
    @keyframes v082RowEnter{0%{opacity:0;transform:translateY(7px)}100%{opacity:1;transform:translateY(0)}}
    @keyframes v082RowPulse{0%{background:rgba(56,189,248,.12)}100%{background:transparent}}
    @keyframes v082ValueFlash{0%{transform:translateY(3px);opacity:.72;text-shadow:0 0 18px rgba(129,140,248,.5)}100%{transform:translateY(0);opacity:1;text-shadow:none}}

    @media(max-width:760px){
      .v082-grid{background-size:54px 54px}
      .v082-aurora{filter:blur(68px);opacity:.13}
      .autopilot-panel{backdrop-filter:blur(16px) saturate(112%);-webkit-backdrop-filter:blur(16px) saturate(112%)}
      .prediction-card:hover,.latest-card:hover{transform:none}
    }

    @media(prefers-reduced-motion:reduce){
      .v082-aurora,.v082-grain,.autopilot-panel::after,.auto-dot,.status-dot{animation:none!important}
      .prediction-card,.latest-card,.prediction-num,.auto-btn,tbody tr,.panel{transition:none!important;transform:none!important}
      .draw-countdown-clock.v082-tick,.v082-value-flash,tbody tr.v082-row-enter,tbody tr.v082-row-update{animation:none!important}
    }
  `;
  document.head.appendChild(style);
}

function injectAtmosphere() {
  if (document.querySelector("#v082Atmosphere")) return;
  const node = document.createElement("div");
  node.id = "v082Atmosphere";
  node.className = "v082-atmosphere";
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = '<i class="v082-aurora a"></i><i class="v082-aurora b"></i><i class="v082-aurora c"></i><i class="v082-grid"></i><i class="v082-grain"></i><i class="v082-vignette"></i>';
  document.body.prepend(node);
}

function markVersion() {
  const topStatus = document.querySelector(".topbar .status");
  if (topStatus) topStatus.innerHTML = `<span class="status-dot"></span> V${MOTION_VERSION} · AutoPilot`;
  document.title = `AutoPilot 3D · V${MOTION_VERSION}`;
  normalizeFooterVersion();
}

function normalizeFooterVersion() {
  const node = document.querySelector("#autoUpdated");
  if (!node) return;
  const current = String(node.textContent || "");
  const next = current.match(/V\d+\.\d+\.\d+/)
    ? current.replace(/V\d+\.\d+\.\d+/g, `V${MOTION_VERSION}`)
    : `${current} · V${MOTION_VERSION}`;
  if (next !== current) node.textContent = next;
}

function flashNode(node) {
  if (!node || REDUCED_MOTION.matches) return;
  node.classList.remove("v082-value-flash");
  void node.offsetWidth;
  node.classList.add("v082-value-flash");
  setTimeout(() => node.classList.remove("v082-value-flash"), 560);
}

function animateRows(root = document) {
  const rows = root.querySelectorAll ? root.querySelectorAll("tbody tr:not([data-v082-motion])") : [];
  rows.forEach((row, index) => {
    row.dataset.v082Motion = "1";
    if (REDUCED_MOTION.matches) return;
    row.style.animationDelay = `${Math.min(index, 12) * 34}ms`;
    row.classList.add("v082-row-enter");
    setTimeout(() => {
      row.classList.remove("v082-row-enter");
      row.style.animationDelay = "";
    }, 950);
  });
}

function installCardSpotlights(root = document) {
  const cards = root.querySelectorAll ? root.querySelectorAll(".prediction-card:not([data-v082-spot]),.latest-card:not([data-v082-spot])") : [];
  cards.forEach((card) => {
    card.dataset.v082Spot = "1";
    card.addEventListener("pointermove", (event) => {
      if (REDUCED_MOTION.matches) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
      card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    }, { passive: true });
  });
}

function decorate(root = document) {
  installCardSpotlights(root);
  animateRows(root);
  normalizeFooterVersion();
}

function installClockMotion() {
  const clock = document.querySelector("#drawCountdownClock");
  if (!clock || clock.dataset.v082Observed) return;
  clock.dataset.v082Observed = "1";
  lastClockValue = clock.textContent || "";
  const observer = new MutationObserver(() => {
    const value = clock.textContent || "";
    if (value === lastClockValue) return;
    lastClockValue = value;
    if (REDUCED_MOTION.matches) return;
    clock.classList.remove("v082-tick");
    void clock.offsetWidth;
    clock.classList.add("v082-tick");
  });
  observer.observe(clock, { childList: true, characterData: true, subtree: true });
}

function installUIObserver() {
  if (uiObserver) return;
  const target = document.querySelector("main") || document.body;
  uiObserver = new MutationObserver((mutations) => {
    let shouldDecorate = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList") shouldDecorate = true;
      if (mutation.type === "characterData") {
        const parent = mutation.target.parentElement;
        if (parent?.matches?.("#autoLatestNumber,.prediction-num,#autoLast td,#autoLast .last-main")) flashNode(parent);
      }
    }
    if (shouldDecorate) requestAnimationFrame(() => decorate(target));
    installClockMotion();
    normalizeFooterVersion();
  });
  uiObserver.observe(target, { childList: true, subtree: true, characterData: true });
}

function installPointerParallax() {
  window.addEventListener("pointermove", (event) => {
    if (REDUCED_MOTION.matches || pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const x = (event.clientX / Math.max(1, innerWidth) - .5) * 10;
      const y = (event.clientY / Math.max(1, innerHeight) - .5) * 8;
      const a = document.querySelector(".v082-aurora.a");
      const b = document.querySelector(".v082-aurora.b");
      if (a) a.style.margin = `${y * .18}px 0 0 ${x * .22}px`;
      if (b) b.style.margin = `${-y * .14}px ${-x * .18}px 0 0`;
    });
  }, { passive: true });
}

function init() {
  injectStyles();
  injectAtmosphere();
  markVersion();
  decorate();
  installClockMotion();
  installUIObserver();
  installPointerParallax();

  setInterval(() => {
    markVersion();
    installClockMotion();
    decorate();
  }, 5000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
