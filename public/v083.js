const WEBGL_VERSION = "0.8.3";
const SCENE_HOLD_MS = 12000;
const TRANSITION_SECONDS = 1.65;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const compact = matchMedia("(max-width: 760px)").matches;

const sceneNames = [
  "Fluid Nebula",
  "Gravitational Black Hole",
  "Meteor Storm",
  "Spiral Galaxy",
  "Orbital World",
  "Hyperspace",
  "Supernova",
  "Aurora",
  "Cosmic Storm",
  "Eclipse",
  "Wormhole",
];

let canvas;
let gl;
let running = true;
let current = new Date().getHours() % sceneNames.length;
let previous = current;
let transition = 1;
let last = performance.now();
let elapsed = 0;
let sceneTimer = null;
const pointer = { x: .5, y: .5, tx: .5, ty: .5 };

function injectShell() {
  if (document.querySelector("#v083Webgl")) return;
  const wrap = document.createElement("div");
  wrap.id = "v083Webgl";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = '<canvas id="v083Cosmos"></canvas><div class="v083-scrim"></div><div class="v083-scene-label" id="v083SceneLabel"></div>';
  document.body.prepend(wrap);
  canvas = wrap.querySelector("#v083Cosmos");

  const style = document.createElement("style");
  style.id = "v083Styles";
  style.textContent = `
    body{position:relative!important;background:#030711!important;isolation:isolate}
    #v082Atmosphere{display:none!important}
    #v083Webgl{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#030711}
    #v083Cosmos{position:absolute;inset:0;width:100%;height:100%;display:block;transform:scale(1.015);filter:saturate(1.08) contrast(1.04) brightness(.72)}
    .v083-scrim{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,rgba(3,7,17,.02) 0 20%,rgba(3,7,17,.18) 58%,rgba(2,5,12,.58) 120%),linear-gradient(180deg,rgba(2,6,16,.16),rgba(2,6,16,.34));backdrop-filter:blur(.15px)}
    .v083-scene-label{position:fixed;right:18px;bottom:16px;padding:5px 8px;border:1px solid rgba(148,163,184,.12);border-radius:999px;background:rgba(3,7,18,.34);backdrop-filter:blur(10px);color:rgba(148,163,184,.56);font-size:9px;letter-spacing:.08em;text-transform:uppercase;opacity:.65;transition:opacity .35s ease,transform .45s cubic-bezier(.22,1,.36,1)}
    .v083-scene-label.bump{opacity:.92;transform:translateY(-2px)}
    .shell,.topbar,main,.autopilot-shell{position:relative!important;z-index:2!important}
    .autopilot-panel{background:linear-gradient(155deg,rgba(9,17,31,.82),rgba(5,11,22,.72))!important;backdrop-filter:blur(18px) saturate(112%)!important;-webkit-backdrop-filter:blur(18px) saturate(112%)!important}
    @media(max-width:760px){#v083Cosmos{filter:saturate(1.03) contrast(1.02) brightness(.60)}.v083-scene-label{display:none}}
    @media(prefers-reduced-motion:reduce){.v083-scene-label{display:none}}
  `;
  document.head.appendChild(style);
}

function shaderProgram() {
  const vertex = `#version 300 es
    in vec2 position;
    out vec2 vUv;
    void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}
  `;

  const fragment = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uTime;
    uniform float uScene;
    uniform float uPrevious;
    uniform float uTransition;
    #define PI 3.14159265359
    #define TAU 6.28318530718

    float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);}
    float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(.8,-.6,.6,.8);for(int i=0;i<5;i++){s+=a*noise(p);p=m*p*2.03+7.17;a*=.5;}return s;}
    mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    vec3 stars(vec2 uv,float t,float gain){vec3 c=vec3(0);for(int l=0;l<3;l++){float sc=90.+float(l)*61.;vec2 p=uv*sc+vec2(t*(.012+float(l)*.004),0);vec2 id=floor(p),cell=fract(p)-.5;vec2 pt=vec2(hash21(id),hash21(id+19.7))-.5;float d=length(cell-pt);float size=mix(.004,.025,pow(hash21(id+8.1),7.));float s=smoothstep(size,0.,d);vec3 tint=mix(vec3(.36,.58,1.),vec3(1.,.82,.63),hash21(id+3.));c+=tint*s*gain;}return c;}

    vec3 nebula(vec2 uv,float t){vec2 p=uv-.5;p.x*=uResolution.x/uResolution.y;p*=3.2;vec2 m=(uPointer-.5)*vec2(1.1,-.8);p=rot(.18*sin(t*.08)+.25*exp(-length(p-m)))*p;vec2 q=vec2(fbm(p+vec2(0,t*.04)),fbm(p+vec2(5,-t*.03)));float f=fbm(p+2.5*q);vec3 c=mix(vec3(.004,.008,.04),vec3(.025,.20,.66),smoothstep(.24,.72,f));c=mix(c,vec3(.48,.04,.77),smoothstep(.55,.88,q.x)*.66);c+=vec3(.02,.66,.84)*pow(max(0.,1.-abs(f-.52)*2.3),3.)*.18;c+=stars(uv,t,.55);return c;}

    vec3 blackhole(vec2 uv,float t){vec2 p=uv-.5-(uPointer-.5)*.035;p.x*=uResolution.x/uResolution.y;float r=length(p),a=atan(p.y,p.x);vec3 c=stars(uv+vec2(sin(a),cos(a))*.012/max(r,.08),t*.16,.28);float horizon=.105;float disk=exp(-abs(p.y)*55.)*smoothstep(.12,.18,r)*(1.-smoothstep(.25,.68,r));float swirl=.45+.55*sin(a*18.-log(r+.01)*24.+t*2.4);c+=mix(vec3(.18,.46,1.),vec3(1.,.34,.03),smoothstep(.55,.18,r))*disk*(.5+swirl)*1.2;c+=vec3(1.,.72,.34)*exp(-abs(r-horizon*1.18)*125.)*1.5;c*=smoothstep(horizon*.85,horizon,r);return c;}

    vec3 meteor(vec2 uv,float t){vec3 c=vec3(.002,.006,.025)+stars(uv,t*.08,.55);for(int i=0;i<13;i++){float fi=float(i);float cyc=fract(t*(.08+.009*mod(fi,4.))+hash21(vec2(fi,4.)));vec2 head=vec2(1.15-hash21(vec2(fi,1.))*1.2,1.15)-vec2(.82,1.)*cyc*1.7;vec2 q=uv-head;float side=abs(dot(q,normalize(vec2(1.,-.82))));float back=max(0.,dot(q,normalize(vec2(.82,1.))));float trail=exp(-side*330.)*exp(-back*8.)*step(back,.48);c+=mix(vec3(.22,.54,1.),vec3(1.,.78,.48),hash21(vec2(fi,7.)))*trail*.65;}return c;}

    vec3 galaxy(vec2 uv,float t){vec2 p=uv-.5;p.x*=uResolution.x/uResolution.y;p=rot(-.27)*p;p.y*=2.35;float r=length(p),a=atan(p.y,p.x);float arms=pow(.5+.5*cos(a*4.-log(r+.02)*8.+t*.12),7.);float dust=fbm(vec2(a*2.4-t*.025,r*17.));vec3 c=vec3(.002,.004,.018)+stars(uv,t*.04,.32);float body=exp(-r*4.6)*(.26+arms*1.35);c+=mix(vec3(.11,.14,.72),vec3(.72,.27,1.),dust)*body;c+=vec3(1.,.78,.54)*exp(-r*19.)*2.;return c;}

    vec3 orbit(vec2 uv,float t){vec2 p=uv-.5;p.x*=uResolution.x/uResolution.y;vec3 c=vec3(.002,.006,.02)+stars(uv,t*.06,.44);vec2 pp=p-vec2(.27,-.04);float r=length(pp);float sphere=smoothstep(.25,.238,r);float light=clamp(dot(normalize(vec3(pp,sqrt(max(.001,.058-r*r)))),normalize(vec3(-.7,.45,.6))),0.,1.);c=mix(c,mix(vec3(.015,.06,.18),vec3(.05,.54,.82),light),sphere);c+=vec3(.05,.61,1.)*exp(-abs(r-.25)*90.)*.55;vec2 rp=rot(-.23)*p;float ring=exp(-abs(length(vec2(rp.x,rp.y*5.1))-.48)*230.);c+=vec3(.4,.74,1.)*ring*.5;return c;}

    vec3 hyperspace(vec2 uv,float t){vec2 p=uv-.5-(uPointer-.5)*.03;p.x*=uResolution.x/uResolution.y;float r=length(p),a=atan(p.y,p.x);vec3 c=vec3(.001,.004,.018);for(int i=0;i<5;i++){float fi=float(i);float lanes=abs(fract(a/TAU*42.+hash21(vec2(fi,2.)))-.5);float z=fract(t*(.16+fi*.01)+hash21(vec2(fi,9.)));float streak=exp(-lanes*145.)*exp(-abs(r-z*.86)*18.)*smoothstep(.03,.55,r);c+=mix(vec3(.08,.32,1.),vec3(.7,.88,1.),z)*streak*(.35+z);}c+=vec3(.25,.5,1.)*exp(-r*23.)*.55;return c;}

    vec3 supernova(vec2 uv,float t){vec2 p=uv-.5;p.x*=uResolution.x/uResolution.y;float r=length(p),a=atan(p.y,p.x);float n=fbm(vec2(a*3.-t*.24,r*15.-t*.5));float shell=.18+.04*n;float blast=exp(-abs(r-shell)*50.)*(.55+n);vec3 c=vec3(.004,.003,.013)+stars(uv,t*.03,.22);c+=mix(vec3(1.,.08,.02),vec3(1.,.86,.5),smoothstep(.33,0.,r))*blast*1.8;c+=vec3(1.,.9,.72)*exp(-r*28.)*2.8;c+=vec3(.15,.34,1.)*exp(-abs(r-.33-.012*sin(t*.6))*95.)*.28;return c;}

    vec3 aurora(vec2 uv,float t){vec3 c=vec3(.002,.009,.026)+stars(uv,t*.02,.28);float y=uv.y;for(int i=0;i<6;i++){float fi=float(i);float x=uv.x+sin(t*.08+fi)*.02;float band=.19+fi*.105+.045*sin(x*7.+t*(.15+fi*.02))+fbm(vec2(x*2.5+fi,t*.035))*.08;float curtain=exp(-abs(y-band)*32.)*(.35+.65*smoothstep(.08,.72,y));vec3 tint=mix(vec3(.05,1.,.62),vec3(.12,.42,1.),fi/5.);c+=tint*curtain*.34;}return c;}

    vec3 storm(vec2 uv,float t){vec2 p=uv*vec2(2.2,1.7);float n=fbm(p+vec2(t*.035,-t*.025));vec3 c=mix(vec3(.002,.005,.025),vec3(.08,.025,.28),n*.75)+stars(uv,t*.02,.18);float x=.5+.16*sin(t*.22);float bolt=exp(-abs(uv.x-x-.035*sin(uv.y*19.+t*2.))*210.)*smoothstep(.15,.95,uv.y);float flick=.25+.75*step(.84,fract(sin(floor(t*2.4)*91.7)*43758.5));c+=vec3(.56,.72,1.)*bolt*flick*1.3;c+=vec3(.24,.16,.72)*pow(n,3.)*.3;return c;}

    vec3 eclipse(vec2 uv,float t){vec2 p=uv-.5;p.x*=uResolution.x/uResolution.y;float r=length(p);vec3 c=vec3(.002,.004,.012)+stars(uv,t*.03,.28);float corona=exp(-abs(r-.215)*55.)*(.7+.3*fbm(vec2(atan(p.y,p.x)*4.,t*.06)));c+=mix(vec3(1.,.45,.08),vec3(1.,.92,.68),smoothstep(.28,.19,r))*corona*1.3;float disk=1.-smoothstep(.202,.211,r);c*=1.-disk*.98;float bead=exp(-length(p-vec2(.205,.02))*180.);c+=vec3(1.,.92,.7)*bead*1.8;return c;}

    vec3 wormhole(vec2 uv,float t){vec2 p=uv-.5-(uPointer-.5)*.025;p.x*=uResolution.x/uResolution.y;float r=length(p),a=atan(p.y,p.x);float tunnel=sin(a*9.-log(r+.015)*18.+t*2.2);float bands=pow(.5+.5*tunnel,6.)*exp(-r*1.7);vec3 c=mix(vec3(.002,.003,.02),vec3(.20,.05,.52),bands);c+=mix(vec3(.18,.34,1.),vec3(.72,.32,1.),.5+.5*sin(a*3.+t*.4))*bands*.65;c+=vec3(.55,.72,1.)*exp(-r*23.)*.8;c+=stars(uv+normalize(p)*.02/max(r,.05),t*.06,.22);return c;}

    vec3 renderScene(float s,vec2 uv,float t){
      if(s<.5)return nebula(uv,t);
      if(s<1.5)return blackhole(uv,t);
      if(s<2.5)return meteor(uv,t);
      if(s<3.5)return galaxy(uv,t);
      if(s<4.5)return orbit(uv,t);
      if(s<5.5)return hyperspace(uv,t);
      if(s<6.5)return supernova(uv,t);
      if(s<7.5)return aurora(uv,t);
      if(s<8.5)return storm(uv,t);
      if(s<9.5)return eclipse(uv,t);
      return wormhole(uv,t);
    }

    void main(){
      float e=uTransition*uTransition*(3.-2.*uTransition);
      vec2 center=vUv-.5;
      float warp=(1.-e)*e;
      vec2 oldUv=.5+center*(1.+warp*.20);
      vec2 newUv=.5+center*(1.-warp*.10);
      vec3 oldC=renderScene(uPrevious,oldUv,uTime);
      vec3 newC=renderScene(uScene,newUv,uTime);
      vec3 color=mix(oldC,newC,e);
      color+=vec3(.18,.30,.62)*warp*exp(-length(center)*2.2)*.22;
      float vig=1.-smoothstep(.34,.88,length(center*vec2(.88,1.)));
      color*=.58+.42*vig;
      color=1.-exp(-color*1.16);
      color=pow(color,vec3(.9));
      float grain=(hash21(gl_FragCoord.xy+fract(uTime)*177.)-.5)*.016;
      color+=grain;
      outColor=vec4(color,1.);
    }
  `;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    return sh;
  };

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  return {
    program,
    uniforms: {
      resolution: gl.getUniformLocation(program, "uResolution"),
      pointer: gl.getUniformLocation(program, "uPointer"),
      time: gl.getUniformLocation(program, "uTime"),
      scene: gl.getUniformLocation(program, "uScene"),
      previous: gl.getUniformLocation(program, "uPrevious"),
      transition: gl.getUniformLocation(program, "uTransition"),
    },
  };
}

function updateLabel() {
  const label = document.querySelector("#v083SceneLabel");
  if (!label) return;
  label.textContent = `${String(current + 1).padStart(2, "0")} / ${sceneNames.length} · ${sceneNames[current]}`;
  label.classList.remove("bump");
  void label.offsetWidth;
  label.classList.add("bump");
  setTimeout(() => label.classList.remove("bump"), 700);
}

function nextScene() {
  previous = current;
  current = (current + 1) % sceneNames.length;
  transition = 0;
  updateLabel();
}

function startCycle() {
  clearInterval(sceneTimer);
  if (reducedMotion) return;
  sceneTimer = setInterval(nextScene, SCENE_HOLD_MS);
}

function initGL() {
  gl = canvas.getContext("webgl2", { alpha:false, antialias:false, depth:false, stencil:false, powerPreference:"high-performance", desynchronized:true });
  if (!gl) {
    canvas.style.display = "none";
    document.querySelector("#v083Webgl").style.background = "radial-gradient(circle at 20% 0%,#10265d 0,#071020 40%,#030711 100%)";
    return;
  }

  let runtime;
  try { runtime = shaderProgram(); }
  catch (error) {
    console.error("V0.8.3 WebGL init failed", error);
    canvas.style.display = "none";
    return;
  }

  const { uniforms } = runtime;
  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, compact ? 1.12 : 1.45);
    const w = Math.max(1, Math.round(innerWidth * ratio));
    const h = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };

  const frame = (now) => {
    if (!running) return;
    const delta = Math.min(.04, Math.max(0, (now - last) / 1000));
    last = now;
    elapsed += delta * (reducedMotion ? .18 : 1);
    transition = Math.min(1, transition + delta / TRANSITION_SECONDS);
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, delta * 4.2);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, delta * 4.2);
    resize();
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform1f(uniforms.scene, current);
    gl.uniform1f(uniforms.previous, previous);
    gl.uniform1f(uniforms.transition, transition);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };

  canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); running = false; });
  canvas.addEventListener("webglcontextrestored", () => location.reload());
  resize();
  updateLabel();
  startCycle();
  requestAnimationFrame(frame);
}

function markVersion() {
  const status = document.querySelector(".topbar .status");
  if (status) status.innerHTML = `<span class="status-dot"></span> V${WEBGL_VERSION} · AutoPilot`;
  const updated = document.querySelector("#autoUpdated");
  if (updated) updated.textContent = String(updated.textContent || "").replace(/V\d+\.\d+\.\d+/g, `V${WEBGL_VERSION}`);
  document.title = `AutoPilot 3D · V${WEBGL_VERSION}`;
}

function init() {
  injectShell();
  markVersion();
  window.addEventListener("pointermove", (event) => {
    pointer.tx = Math.max(0, Math.min(1, event.clientX / Math.max(1, innerWidth)));
    pointer.ty = Math.max(0, Math.min(1, 1 - event.clientY / Math.max(1, innerHeight)));
  }, { passive:true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) last = performance.now();
  });
  initGL();
  setInterval(markVersion, 5000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true });
else init();
