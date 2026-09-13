// V0.8.2 background visibility hotfix.
// The atmosphere layer originally used a negative z-index, which placed it behind
// the opaque document canvas in some browsers. Keep it inside the page stacking
// context and place all UI content above it.

(function installV082BackgroundFix() {
  if (document.querySelector('#v082BackgroundFix')) return;

  const style = document.createElement('style');
  style.id = 'v082BackgroundFix';
  style.textContent = `
    html{
      min-height:100%;
      background:#030611!important;
    }

    body{
      position:relative!important;
      isolation:isolate!important;
      min-height:100vh;
      overflow-x:hidden;
      background:#030611!important;
    }

    .v082-atmosphere{
      z-index:0!important;
      opacity:1!important;
      display:block!important;
      background:
        radial-gradient(1050px 680px at 5% -6%,rgba(37,99,235,.28),transparent 61%),
        radial-gradient(900px 620px at 102% 3%,rgba(124,58,237,.27),transparent 62%),
        radial-gradient(760px 520px at 50% 104%,rgba(14,165,233,.12),transparent 68%),
        linear-gradient(180deg,#081226 0%,#050a18 48%,#030611 100%)!important;
    }

    .v082-aurora{
      opacity:.29!important;
      filter:blur(82px) saturate(135%)!important;
    }

    .v082-aurora.a{
      left:-12vw!important;
      top:-16vh!important;
    }

    .v082-aurora.b{
      right:-12vw!important;
      top:-13vh!important;
      opacity:.27!important;
    }

    .v082-aurora.c{
      bottom:-31vh!important;
      opacity:.16!important;
    }

    .v082-grid{
      opacity:.065!important;
    }

    .v082-grain{
      opacity:.026!important;
    }

    .v082-vignette{
      background:radial-gradient(circle at 50% 36%,transparent 0 28%,rgba(1,4,12,.08) 64%,rgba(1,4,12,.50) 125%)!important;
    }

    .shell,.topbar,main,.autopilot-shell{
      position:relative!important;
      z-index:2!important;
    }

    .autopilot-panel{
      background:linear-gradient(155deg,rgba(10,18,34,.82),rgba(5,11,23,.72))!important;
    }

    @media(max-width:760px){
      .v082-aurora{opacity:.22!important;filter:blur(64px) saturate(128%)!important}
      .v082-grid{opacity:.045!important}
    }
  `;
  document.head.appendChild(style);
})();
