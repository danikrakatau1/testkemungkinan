const PERF_WEBGL_VERSION = "0.8.3-perf";
const HOLD_MS = 12000;
const TRANSITION_MS = 1200;
const TARGET_FPS = 24;
const FRAME_MS = 1000 / TARGET_FPS;
const compact = matchMedia("(max-width: 760px)").matches;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const names = [
  "Fluid Nebula","Gravitational Black Hole","Meteor Storm","Spiral Galaxy","Orbital World",
  "Hyperspace","Supernova","Aurora","Cosmic Storm","Eclipse","Wormhole"
];

let canvas, gl, program, raf = 0, lastFrame = 0, start = performance.now();
let uniforms = null;
let current = new Date().getHours() % names.length;
let previous = current;
let transitionStart = 0;
let cycleTimer = 0;
const pointer = { x:.5, y:.5, tx:.5, ty:.5 };

function shell(){
  if(document.querySelector("#v083Perf")) return;
  const wrap=document.createElement("div");
  wrap.id="v083Perf";
  wrap.setAttribute("aria-hidden","true");
  wrap.innerHTML='<canvas id="v083PerfCanvas"></canvas><div class="v083p-scrim"></div><div id="v083PerfLabel" class="v083p-label"></div>';
  document.body.prepend(wrap);
  canvas=wrap.querySelector("canvas");
  const s=document.createElement("style");
  s.textContent=`
    body{position:relative!important;background:#030711!important;isolation:isolate}
    #v082Atmosphere,#v083Webgl{display:none!important}
    #v083Perf{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:#040816}
    #v083PerfCanvas{position:absolute;inset:0;width:100%;height:100%;display:block;filter:saturate(1.05) brightness(.78)}
    .v083p-scrim{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,rgba(3,7,17,.04),rgba(3,7,17,.26) 62%,rgba(2,5,12,.58) 118%)}
    .v083p-label{position:absolute;right:18px;bottom:16px;padding:5px 8px;border:1px solid rgba(148,163,184,.11);border-radius:999px;background:rgba(3,7,18,.42);color:rgba(148,163,184,.58);font-size:9px;letter-spacing:.07em;text-transform:uppercase;opacity:.75}
    .shell,.topbar,main,.autopilot-shell{position:relative!important;z-index:2!important}
    .autopilot-panel{background:linear-gradient(155deg,rgba(9,17,31,.84),rgba(5,11,22,.76))!important;backdrop-filter:blur(12px) saturate(108%)!important;-webkit-backdrop-filter:blur(12px) saturate(108%)!important}
    @media(max-width:760px){.v083p-label{display:none}#v083PerfCanvas{filter:saturate(1.02) brightness(.68)}}
  `;
  document.head.appendChild(s);
}

function fallback(){
  if(!document.querySelector("#v083Perf")) shell();
  const wrap=document.querySelector("#v083Perf");
  if(!wrap) return;
  if(canvas && canvas.isConnected) canvas.remove();
  wrap.style.background="radial-gradient(900px 600px at 20% 15%,rgba(29,78,216,.35),transparent 65%),radial-gradient(800px 560px at 82% 15%,rgba(124,58,237,.26),transparent 68%),linear-gradient(180deg,#071226,#030711)";
}

function compile(type,src){
  const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);
  if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)||"shader compile failed");
  return sh;
}

function initGL(){
  gl=canvas.getContext("webgl2",{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:"low-power"});
  if(!gl){fallback();return false;}
  const vs=`#version 300 es
    in vec2 p;out vec2 uv;
    void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
  const fs=`#version 300 es
    precision mediump float;
    in vec2 uv;out vec4 outColor;
    uniform vec2 res;uniform vec2 mouse;uniform float time;uniform float scene;uniform float prevScene;uniform float blend;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.)),f.x),f.y);}
    float fb(vec2 p){return .57*n(p)+.28*n(p*2.03+3.1)+.15*n(p*4.07+7.3);}
    vec2 q(vec2 u){vec2 p=u-.5;p.x*=res.x/max(res.y,1.);return p;}
    vec3 stars(vec2 u,float gain){vec2 g=u*vec2(120.,70.);vec2 id=floor(g);vec2 f=fract(g)-.5;float d=length(f-(vec2(h(id),h(id+vec2(13.7)))-.5));float s=smoothstep(.035,0.,d)*step(.965,h(id+vec2(4.)));return vec3(.55,.72,1.)*s*gain;}
    vec3 draw(float s,vec2 u){
      vec2 p=q(u);float r=length(p);float a=atan(p.y,p.x);vec3 c=vec3(.002,.006,.02);float t=time;
      if(s<.5){float f=fb(p*2.5+vec2(t*.025,-t*.018));c+=mix(vec3(.01,.08,.35),vec3(.42,.05,.65),f)*f*.8;c+=stars(u,.45);}
      else if(s<1.5){float ring=exp(-abs(r-.19)*46.);c+=vec3(.15,.45,1.)*ring*.65+vec3(1.,.38,.05)*ring*max(0.,sin(a*3.+t));c+=stars(u,.28);c*=smoothstep(.10,.14,r);}
      else if(s<2.5){c+=stars(u,.45);float lane=abs(fract((u.x+u.y*.82+t*.11)*8.)-.5);c+=vec3(.25,.65,1.)*exp(-lane*42.)*.28;}
      else if(s<3.5){float arm=pow(.5+.5*cos(a*4.-log(r+.03)*7.+t*.12),5.);c+=mix(vec3(.12,.18,.8),vec3(.65,.18,1.),arm)*arm*exp(-r*2.9);c+=stars(u,.3);}
      else if(s<4.5){vec2 pp=p-vec2(.22,-.02);float pr=length(pp);float body=1.-smoothstep(.225,.24,pr);c=mix(c,vec3(.02,.28,.58)+vec3(.04,.35,.35)*max(0.,1.-pr*3.),body);float ring=exp(-abs(length(vec2(p.x,p.y*4.2))-.44)*90.);c+=vec3(.35,.72,1.)*ring*.34;c+=stars(u,.26);}
      else if(s<5.5){float rays=pow(.5+.5*cos(a*34.+t*1.8),9.)*smoothstep(.08,.8,r);c+=vec3(.18,.48,1.)*rays*max(0.,1.-r)*.8;c+=stars(u,.18);}
      else if(s<6.5){float shell=exp(-abs(r-(.17+.012*sin(t*.8)))*35.);c+=mix(vec3(1.,.08,.02),vec3(1.,.82,.42),clamp(1.-r,0.,1.))*shell*1.2;c+=vec3(1.,.75,.45)*exp(-r*18.);}
      else if(s<7.5){float band=0.;for(int i=0;i<3;i++){float fi=float(i);float y=.28+fi*.18+.05*sin(u.x*7.+t*.2+fi);band+=exp(-abs(u.y-y)*27.);}c+=mix(vec3(.02,.85,.48),vec3(.08,.35,1.),u.y)*band*.42;c+=stars(u,.22);}
      else if(s<8.5){float cloud=fb(u*3.+vec2(t*.025));c+=vec3(.05,.03,.22)*cloud;float bolt=exp(-abs(u.x-(.55+.03*sin(u.y*18.+t*2.)))*120.)*step(.25,u.y);c+=vec3(.55,.7,1.)*bolt*.8;}
      else if(s<9.5){c+=stars(u,.28);float corona=exp(-abs(r-.205)*42.);c+=vec3(1.,.55,.16)*corona*.9;float disk=1.-smoothstep(.19,.205,r);c*=1.-disk*.97;}
      else {float bands=pow(.5+.5*sin(a*8.-log(r+.03)*13.+t*1.5),6.)*exp(-r*1.8);c+=mix(vec3(.1,.22,.85),vec3(.58,.18,1.),.5+.5*sin(a))*bands*.72;c+=vec3(.18,.35,1.)*exp(-r*14.);}
      return c;
    }
    void main(){
      vec2 u=uv+(mouse-.5)*.018;
      float e=smoothstep(0.,1.,blend);vec3 c;
      if(e>.995)c=draw(scene,u);else c=mix(draw(prevScene,u),draw(scene,u),e);
      float vig=1.-smoothstep(.28,.84,length(uv-.5));c*=.62+.38*vig;
      c=1.-exp(-c*1.15);outColor=vec4(c,1.);
    }`;
  program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vs));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||"program link failed");
  gl.useProgram(program);
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(program,"p");gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  uniforms={
    res:gl.getUniformLocation(program,"res"),mouse:gl.getUniformLocation(program,"mouse"),time:gl.getUniformLocation(program,"time"),
    scene:gl.getUniformLocation(program,"scene"),prevScene:gl.getUniformLocation(program,"prevScene"),blend:gl.getUniformLocation(program,"blend")
  };
  return true;
}

function resize(){
  if(!gl||!canvas)return;
  const scale = compact ? 0.52 : 0.62;
  const w=Math.max(320,Math.round(innerWidth*scale));
  const h=Math.max(180,Math.round(innerHeight*scale));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}
}

function label(){const el=document.querySelector("#v083PerfLabel");if(el)el.textContent=names[current];}
function next(){previous=current;current=(current+1)%names.length;transitionStart=performance.now();label();}

function render(now){
  raf=requestAnimationFrame(render);
  if(document.hidden||!gl||!program||!uniforms)return;
  if(now-lastFrame<FRAME_MS)return;
  lastFrame=now;
  pointer.x+=(pointer.tx-pointer.x)*.06;pointer.y+=(pointer.ty-pointer.y)*.06;
  const mixv=transitionStart?Math.min(1,(now-transitionStart)/TRANSITION_MS):1;
  gl.useProgram(program);
  gl.uniform2f(uniforms.res,canvas.width,canvas.height);
  gl.uniform2f(uniforms.mouse,pointer.x,pointer.y);
  gl.uniform1f(uniforms.time,(now-start)/1000);
  gl.uniform1f(uniforms.scene,current);
  gl.uniform1f(uniforms.prevScene,previous);
  gl.uniform1f(uniforms.blend,reduced?1:mixv);
  gl.drawArrays(gl.TRIANGLES,0,3);
}

function init(){
  shell();
  try{if(!initGL())return;}catch(err){console.warn("perf WebGL fallback",err);fallback();return;}
  label();resize();
  addEventListener("resize",resize,{passive:true});
  addEventListener("pointermove",e=>{pointer.tx=e.clientX/Math.max(1,innerWidth);pointer.ty=1-e.clientY/Math.max(1,innerHeight);},{passive:true});
  canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();cancelAnimationFrame(raf);if(cycleTimer)clearInterval(cycleTimer);fallback();},{once:true});
  if(!reduced)cycleTimer=setInterval(next,HOLD_MS);
  raf=requestAnimationFrame(render);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
