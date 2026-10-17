/* =====================================================================
 *  Renderer — hand-written WebGL2/1 forward renderer
 *  Features: Blinn-Phong+GGX-ish specular, hemisphere IBL approximation,
 *  PCF shadow mapping, HDR offscreen, bright-pass bloom, ACES tonemap,
 *  vignette, chromatic aberration, film grain, radial speed blur.
 * ===================================================================== */
'use strict';

/* ------------------------- geometry builders ----------------------- */
function geoAlloc(vCount, iCount) {
  return {
    pos: new Float32Array(vCount * 3),
    nrm: new Float32Array(vCount * 3),
    uv: new Float32Array(vCount * 2),
    idx: iCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount),
    nv: 0, ni: 0,
  };
}
/** grow a typed array (geometry builders must never silently truncate) */
function geoGrow(arr, need) {
  if (need <= arr.length) return arr;
  let n = arr.length || 8;
  while (n < need) n *= 2;
  const out = new arr.constructor(n);
  out.set(arr);
  return out;
}
function geoPush(g, x, y, z, nx, ny, nz, u, v) {
  const i = g.nv;
  if ((i + 1) * 3 > g.pos.length) {
    g.pos = geoGrow(g.pos, (i + 1) * 3);
    g.nrm = geoGrow(g.nrm, (i + 1) * 3);
    g.uv = geoGrow(g.uv, (i + 1) * 2);
  }
  g.pos[i * 3] = x; g.pos[i * 3 + 1] = y; g.pos[i * 3 + 2] = z;
  g.nrm[i * 3] = nx; g.nrm[i * 3 + 1] = ny; g.nrm[i * 3 + 2] = nz;
  g.uv[i * 2] = u; g.uv[i * 2 + 1] = v;
  g.nv++;
  return i;
}
function geoTri(g, a, b, c) {
  if (g.ni + 3 > g.idx.length) {
    const big = (g.nv > 65535) || (g.idx instanceof Uint32Array);
    const next = geoGrow(big ? new Uint32Array(g.idx) : g.idx, g.ni + 3);
    g.idx = next;
  }
  g.idx[g.ni++] = a; g.idx[g.ni++] = b; g.idx[g.ni++] = c;
}
function geoQuad(g, a, b, c, d) { geoTri(g, a, b, c); geoTri(g, a, c, d); }

function makeBox(w, h, d, uvScale = 1, normUV = false) {
  const g = geoAlloc(24, 36);
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [
    [[x, -y, -z], [x, -y, z], [x, y, z], [x, y, -z], [1, 0, 0], d, h],
    [[-x, -y, z], [-x, -y, -z], [-x, y, -z], [-x, y, z], [-1, 0, 0], d, h],
    [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], [0, 1, 0], w, d],
    [[-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z], [0, -1, 0], w, d],
    [[-x, -y, z], [-x, y, z], [x, y, z], [x, -y, z], [0, 0, 1], w, h],
    [[x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, -z], [0, 0, -1], w, h],
  ];
  for (const f of faces) {
    const n = f[4];
    const su = normUV ? 1 : f[5] * uvScale, sv = normUV ? 1 : f[6] * uvScale;
    const uvs = [[0, 0], [su, 0], [su, sv], [0, sv]];
    const base = g.nv;
    for (let i = 0; i < 4; i++) geoPush(g, f[i][0], f[i][1], f[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1]);
    // NOTE: the vertex rings above are wound clockwise when seen from
    // outside, so the quad has to be emitted in reverse to stay CCW-front.
    geoQuad(g, base, base + 3, base + 2, base + 1);
  }
  return g;
}

function makeSphere(r, segU = 32, segV = 20) {
  const g = geoAlloc((segU + 1) * (segV + 1), segU * segV * 6);
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
    for (let u = 0; u <= segU; u++) {
      const th = (u / segU) * TAU, st = Math.sin(th), ct = Math.cos(th);
      const nx = sp * ct, ny = cp, nz = sp * st;
      geoPush(g, nx * r, ny * r, nz * r, nx, ny, nz, u / segU, 1 - v / segV);
    }
  }
  for (let v = 0; v < segV; v++) for (let u = 0; u < segU; u++) {
    const a = v * (segU + 1) + u, b = a + segU + 1;
    geoQuad(g, a, a + 1, b + 1, b);
  }
  return g;
}

function makeCylinder(rTop, rBot, h, seg = 24, caps = true) {
  const vc = (seg + 1) * 2 + (caps ? (seg + 2) * 2 : 0);
  const ic = seg * 6 + (caps ? seg * 6 : 0);
  const g = geoAlloc(vc, ic);
  const slope = (rBot - rTop) / h;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, a = t * TAU, c = Math.cos(a), s = Math.sin(a);
    const nl = Math.hypot(1, slope);
    geoPush(g, c * rTop, h / 2, s * rTop, c / nl, slope / nl, s / nl, t, 1);
    geoPush(g, c * rBot, -h / 2, s * rBot, c / nl, slope / nl, s / nl, t, 0);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; geoQuad(g, a, a + 2, a + 3, a + 1); }
  if (caps) {
    for (const [y, r, ny] of [[h / 2, rTop, 1], [-h / 2, rBot, -1]]) {
      const cI = geoPush(g, 0, y, 0, 0, ny, 0, 0.5, 0.5);
      const start = g.nv;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
        geoPush(g, c * r, y, s * r, 0, ny, 0, c * 0.5 + 0.5, s * 0.5 + 0.5);
      }
      for (let i = 0; i < seg; i++) {
        if (ny > 0) geoTri(g, cI, start + i, start + i + 1);
        else geoTri(g, cI, start + i + 1, start + i);
      }
    }
  }
  return g;
}

/** Table-tennis blade: elliptic disc with rounded rim, X=width Y=height Z=thickness */
function makePaddleBlade(rx, ry, thick, seg = 48) {
  const g = geoAlloc(seg * 4 + 8, seg * 24 + 24);
  const half = thick / 2, rim = thick * 0.5;
  const cF = geoPush(g, 0, 0, half, 0, 0, 1, 0.5, 0.5);
  const cB = geoPush(g, 0, 0, -half, 0, 0, -1, 0.5, 0.5);
  const fStart = g.nv;
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a); geoPush(g, c * rx, s * ry, half, 0, 0, 1, c * 0.5 + 0.5, s * 0.5 + 0.5); }
  const bStart = g.nv;
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a); geoPush(g, c * rx, s * ry, -half, 0, 0, -1, c * 0.5 + 0.5, s * 0.5 + 0.5); }
  const eF = g.nv;
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a); const nx = c, ny = s * (rx / ry); const l = Math.hypot(nx, ny); geoPush(g, c * (rx + rim * 0.15), s * (ry + rim * 0.15), half * 0.75, nx / l, ny / l, 0.3, i / seg, 1); }
  const eB = g.nv;
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a); const nx = c, ny = s * (rx / ry); const l = Math.hypot(nx, ny); geoPush(g, c * (rx + rim * 0.15), s * (ry + rim * 0.15), -half * 0.75, nx / l, ny / l, -0.3, i / seg, 0); }
  for (let i = 0; i < seg; i++) {
    geoTri(g, cF, fStart + i, fStart + i + 1);
    geoTri(g, cB, bStart + i + 1, bStart + i);
    geoQuad(g, fStart + i, eF + i, eF + i + 1, fStart + i + 1);
    geoQuad(g, eF + i, eB + i, eB + i + 1, eF + i + 1);
    geoQuad(g, eB + i, bStart + i, bStart + i + 1, eB + i + 1);
  }
  return g;
}

function makePlane(w, d, uvs = 1, subdiv = 1) {
  const n = subdiv, g = geoAlloc((n + 1) * (n + 1), n * n * 6);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    geoPush(g, (u - 0.5) * w, 0, (v - 0.5) * d, 0, 1, 0, u * uvs, v * uvs);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1;
    geoQuad(g, a, b, b + 1, a + 1);
  }
  return g;
}

/** Vertical quad facing +Z */
function makeQuad(w, h, uvs = 1) {
  const g = geoAlloc(4, 6);
  geoPush(g, -w / 2, -h / 2, 0, 0, 0, 1, 0, 0);
  geoPush(g, w / 2, -h / 2, 0, 0, 0, 1, uvs, 0);
  geoPush(g, w / 2, h / 2, 0, 0, 0, 1, uvs, uvs);
  geoPush(g, -w / 2, h / 2, 0, 0, 0, 1, 0, uvs);
  geoQuad(g, 0, 1, 2, 3);
  return g;
}

function makeQuadUV(w, h, ru, rv) {
  const g = geoAlloc(4, 6);
  geoPush(g, -w / 2, -h / 2, 0, 0, 0, 1, 0, 0);
  geoPush(g, w / 2, -h / 2, 0, 0, 0, 1, ru, 0);
  geoPush(g, w / 2, h / 2, 0, 0, 0, 1, ru, rv);
  geoPush(g, -w / 2, h / 2, 0, 0, 0, 1, 0, rv);
  geoQuad(g, 0, 1, 2, 3);
  return g;
}

function makeCapsule(r, h, seg = 16, rings = 8) {
  const parts = [];
  const cyl = makeCylinder(r, r, h, seg, false);
  parts.push(cyl);
  const sph = makeSphere(r, seg, rings);
  const top = { ...sph, pos: sph.pos.slice(), nrm: sph.nrm.slice(), uv: sph.uv.slice(), idx: sph.idx.slice() };
  for (let i = 0; i < top.nv; i++) top.pos[i * 3 + 1] += (top.pos[i * 3 + 1] >= 0 ? h / 2 : -h / 2);
  parts.push(top);
  return mergeGeo(parts);
}

function mergeGeo(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.nv; ni += g.ni; }
  const o = geoAlloc(nv, ni);
  let vo = 0;
  for (const g of list) {
    o.pos.set(g.pos.subarray(0, g.nv * 3), vo * 3);
    o.nrm.set(g.nrm.subarray(0, g.nv * 3), vo * 3);
    o.uv.set(g.uv.subarray(0, g.nv * 2), vo * 2);
    for (let i = 0; i < g.ni; i++) o.idx[o.ni++] = g.idx[i] + vo;
    vo += g.nv;
  }
  o.nv = vo;
  return o;
}

function transformGeo(g, fn) {
  for (let i = 0; i < g.nv; i++) {
    const p = { x: g.pos[i * 3], y: g.pos[i * 3 + 1], z: g.pos[i * 3 + 2] };
    const n = { x: g.nrm[i * 3], y: g.nrm[i * 3 + 1], z: g.nrm[i * 3 + 2] };
    fn(p, n, i);
    g.pos[i * 3] = p.x; g.pos[i * 3 + 1] = p.y; g.pos[i * 3 + 2] = p.z;
    g.nrm[i * 3] = n.x; g.nrm[i * 3 + 1] = n.y; g.nrm[i * 3 + 2] = n.z;
  }
  return g;
}

/* ----------------------------- shaders ----------------------------- */
const VS_MAIN = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
uniform mat4 uModel, uViewProj, uLightVP;
uniform mat3 uNrmMat;
out vec3 vWorld; out vec3 vNrm; out vec2 vUv; out vec4 vLightPos;
void main(){
  vec4 wp = uModel * vec4(aPos,1.0);
  vWorld = wp.xyz;
  vNrm = normalize(uNrmMat * aNrm);
  vUv = aUv;
  vLightPos = uLightVP * wp;
  gl_Position = uViewProj * wp;
}`;

const FS_MAIN = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNrm; in vec2 vUv; in vec4 vLightPos;
out vec4 oColor;

uniform vec3 uCam;
uniform vec3 uAlbedo;
uniform float uRough, uMetal, uSpecTint;
uniform vec3 uEmissive;
uniform float uUseTex, uAlphaTest, uOpacity, uUnlit;
uniform sampler2D uTex;
uniform sampler2D uShadow;
uniform float uShadowOn, uShadowTexel;
uniform vec3 uLightDir, uLightCol;
uniform vec3 uSkyCol, uGroundCol;
uniform vec3 uFill1Pos, uFill1Col, uFill2Pos, uFill2Col;
uniform float uFogDensity; uniform vec3 uFogCol;
uniform float uRimPower, uRimStrength; uniform vec3 uRimCol;

float distributionGGX(vec3 N, vec3 H, float a){
  float a2=a*a; float NdH=max(dot(N,H),0.0); float d=(NdH*NdH*(a2-1.0)+1.0);
  return a2/(3.14159265*d*d+1e-7);
}
float geomSchlick(float NdV, float k){ return NdV/(NdV*(1.0-k)+k); }
vec3 fresnel(float c, vec3 F0){ return F0 + (1.0-F0)*pow(1.0-c,5.0); }

float shadowFactor(){
  if(uShadowOn < 0.5) return 1.0;
  vec3 p = vLightPos.xyz / vLightPos.w;
  p = p*0.5+0.5;
  if(p.z>1.0||p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 1.0;
  float ndl = max(dot(normalize(vNrm), -uLightDir),0.0);
  float bias = max(0.0022*(1.0-ndl), 0.0006);
  float s=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    float d = texture(uShadow, p.xy + vec2(float(x),float(y))*uShadowTexel).r;
    s += (p.z - bias > d) ? 0.0 : 1.0;
  }
  return s/9.0;
}

void main(){
  vec4 texc = vec4(1.0);
  if(uUseTex > 0.5){ texc = texture(uTex, vUv); if(texc.a < uAlphaTest) discard; }
  vec3 albedo = uAlbedo * texc.rgb;
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCam - vWorld);
  if(!gl_FrontFacing) N = -N;
  float rough = clamp(uRough, 0.04, 1.0);
  float a = rough*rough;
  vec3 F0 = mix(vec3(0.04)*uSpecTint, albedo, uMetal);

  vec3 Lo = vec3(0.0);
  // key directional
  {
    vec3 L = normalize(-uLightDir);
    vec3 H = normalize(V+L);
    float NdL = max(dot(N,L),0.0);
    float NdV = max(dot(N,V),0.0);
    float k = (rough+1.0)*(rough+1.0)/8.0;
    float G = geomSchlick(NdV,k)*geomSchlick(NdL,k);
    float D = distributionGGX(N,H,a);
    vec3 F = fresnel(max(dot(H,V),0.0), F0);
    vec3 spec = (D*G*F)/(4.0*NdV*NdL+1e-4);
    vec3 kd = (1.0-F)*(1.0-uMetal);
    Lo += (kd*albedo/3.14159265 + spec) * uLightCol * NdL * shadowFactor();
  }
  // two point fills (no shadow)
  for(int i=0;i<2;i++){
    vec3 lp = i==0?uFill1Pos:uFill2Pos;
    vec3 lc = i==0?uFill1Col:uFill2Col;
    vec3 d = lp - vWorld; float dist = length(d); vec3 L = d/max(dist,1e-4);
    float att = 1.0/(1.0+0.12*dist*dist);
    float NdL = max(dot(N,L),0.0);
    vec3 H = normalize(V+L);
    float D = distributionGGX(N,H,a);
    vec3 F = fresnel(max(dot(H,V),0.0), F0);
    float NdV = max(dot(N,V),0.0);
    float k = (rough+1.0)*(rough+1.0)/8.0;
    float G = geomSchlick(NdV,k)*geomSchlick(NdL,k);
    vec3 spec=(D*G*F)/(4.0*NdV*NdL+1e-4);
    Lo += ((1.0-uMetal)*albedo/3.14159265 + spec)*lc*NdL*att;
  }
  // hemisphere ambient
  float hemi = N.y*0.5+0.5;
  if (uUnlit > 0.5) { oColor = vec4(uEmissive, uOpacity * texc.a); return; }
  vec3 amb = mix(uGroundCol, uSkyCol, hemi) * albedo * (1.0 - uMetal*0.6);
  // crude specular occlusion from ambient
  float NdV = max(dot(N,V),0.0);
  vec3 ambSpec = mix(uGroundCol,uSkyCol, 0.75) * fresnel(NdV,F0) * (1.0-rough)*0.6;
  vec3 col = Lo + amb + ambSpec + uEmissive;

  // rim
  float rim = pow(1.0 - NdV, uRimPower);
  col += uRimCol * rim * uRimStrength;

  // distance fog
  float dist = length(uCam - vWorld);
  float f = 1.0 - exp(-uFogDensity*dist*dist);
  col = mix(col, uFogCol, clamp(f,0.0,1.0));

  oColor = vec4(col, uOpacity * texc.a);
}`;

const VS_SHADOW = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUv;
uniform mat4 uModel, uLightVP;
out vec2 vUv;
void main(){ vUv=aUv; gl_Position = uLightVP * uModel * vec4(aPos,1.0); }`;
const FS_SHADOW = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uUseTex, uAlphaTest;
void main(){ if(uUseTex>0.5 && texture(uTex,vUv).a < uAlphaTest) discard; o=vec4(1.0); }`;

const VS_FULL = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform float uThreshold, uSoft;
void main(){
  vec3 c = texture(uSrc,vUv).rgb;
  float b = max(c.r,max(c.g,c.b));
  float k = clamp((b-uThreshold)/max(uSoft,1e-4),0.0,1.0);
  o = vec4(c*k*k, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec3 c = texture(uSrc,vUv).rgb*0.227027;
  c += texture(uSrc,vUv+uDir*1.3846).rgb*0.316216;
  c += texture(uSrc,vUv-uDir*1.3846).rgb*0.316216;
  c += texture(uSrc,vUv+uDir*3.2307).rgb*0.070270;
  c += texture(uSrc,vUv-uDir*3.2307).rgb*0.070270;
  o = vec4(c,1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom;
uniform float uBloomAmt, uExposure, uTime, uVignette, uGrain, uCA, uRadial, uSat, uFlash;
uniform vec2 uFocus;

vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
float rand(vec2 co){ return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453); }

void main(){
  vec2 uv = vUv;
  vec2 d = uv - uFocus;
  float r = length(d);
  vec3 col;
  if(uRadial > 0.001){
    vec3 acc = vec3(0.0); float wsum=0.0;
    for(int i=0;i<8;i++){
      float t = float(i)/7.0;
      float s = 1.0 - uRadial*t*0.12;
      vec2 suv = uFocus + d*s;
      float w = 1.0-t*0.5;
      acc += texture(uScene,suv).rgb*w; wsum+=w;
    }
    col = acc/wsum;
  } else col = texture(uScene,uv).rgb;

  // Chromatic aberration, applied as a DELTA on top of the colour we
  // already have. Replacing R and B outright while G stays radially
  // blurred paints a green halo along every bright edge.
  float ca = uCA*(0.00004 + r*r*0.00055);
  if(ca>0.00005){
    vec3 c0 = texture(uScene, uv).rgb;
    col.r += texture(uScene, uv + d*ca).r - c0.r;
    col.b += texture(uScene, uv - d*ca).b - c0.b;
  }
  col += texture(uBloom, uv).rgb * uBloomAmt;
  col *= uExposure;
  col += uFlash;
  col = aces(col);
  float l = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(l), col, uSat);
  // vignette
  float vig = smoothstep(0.95, 0.25, r*1.25);
  col *= mix(1.0, vig, uVignette);
  // grain
  float g = rand(uv*vec2(1920.0,1080.0) + fract(uTime)*vec2(31.7,17.3)) - 0.5;
  col += g*uGrain;
  // subtle s-curve
  col = pow(col, vec3(0.9825));
  o = vec4(col,1.0);
}`;

/* ---------------------- WebGL1 shader downgrade --------------------- */
function toGLSL1(src, isFrag) {
  let s = src.replace('#version 300 es\n', '');
  if (isFrag) {
    s = s.replace(/\bin\s+(vec[234]|float|mat[234])\b/g, 'varying $1')
      .replace(/out\s+vec4\s+(\w+);/, '')
      .replace(/\btexture\s*\(/g, 'texture2D(');
    const outName = (src.match(/out\s+vec4\s+(\w+);/) || [, 'oColor'])[1];
    s = s.replace(new RegExp('\\b' + outName + '\\b', 'g'), 'gl_FragColor');
  } else {
    s = s.replace(/layout\(location=\d+\)\s+in\s+/g, 'attribute ')
      .replace(/^\s*in\s+/gm, 'attribute ')
      .replace(/\bout\s+(vec[234]|float)\b/g, 'varying $1')
      .replace(/\btexture\s*\(/g, 'texture2D(');
  }
  return s;
}

/* ------------------------------ Renderer --------------------------- */
class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const attribs = { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, desynchronized: true };
    let gl = canvas.getContext('webgl2', attribs);
    this.isGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', attribs) || canvas.getContext('experimental-webgl', attribs);
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    this.quality = opts.quality || 'high';
    // Shadow mapping is OFF by design: at this scale a 2k map gives blocky,
    // crawling penumbrae on the table. Analytic contact shadows look better
    // and cost one quad each.
    this.useShadowMap = false;
    this.dprCap = opts.dprCap || 2;

    if (!this.isGL2) {
      this.extDepth = gl.getExtension('WEBGL_depth_texture');
      this.extEl = gl.getExtension('OES_element_index_uint');
      this.extHF = gl.getExtension('OES_texture_half_float');
      this.extHFL = gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('EXT_shader_texture_lod');
      gl.getExtension('OES_standard_derivatives');
    } else {
      this.extCBF = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
      gl.getExtension('OES_texture_float_linear');
    }
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.maxAniso = this.aniso ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

    this.progMain = this.program(VS_MAIN, FS_MAIN);
    this.progShadow = this.program(VS_SHADOW, FS_SHADOW);
    this.progBright = this.program(VS_FULL, FS_BRIGHT);
    this.progBlur = this.program(VS_FULL, FS_BLUR);
    this.progComp = this.program(VS_FULL, FS_COMPOSITE);

    this.fsQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.white = this.texFromPixel([255, 255, 255, 255]);
    this.shadowSize = this.quality === 'low' ? 1024 : 2048;
    // Nothing is ever drawn into this target while the analytic contact
    // shadows are in use, so a 2048² depth texture is not allocated at boot
    // (16 MB and a GPU allocation on every start-up, for nothing).
    this.shadowFBO = null;
    this.rtScene = null; this.rtA = null; this.rtB = null;
    this._w = 0; this._h = 0;

    // matrices
    this.view = M4.create(); this.proj = M4.create(); this.viewProj = M4.create();
    this.lightVP = M4.create();
    this.nrmMat = new Float32Array(9);
    this._tmpM = M4.create();

    this.env = {
      lightDir: V3.new(-0.42, -0.86, -0.3),
      lightCol: V3.new(3.45, 3.32, 3.08),
      sky: V3.new(0.098, 0.118, 0.158),
      ground: V3.new(0.030, 0.028, 0.027),
      fill1: { p: V3.new(-2.5, 2.5, 1.9), c: V3.new(0.80, 0.90, 1.45) },
      fill2: { p: V3.new(2.5, 2.5, -1.9), c: V3.new(1.40, 0.76, 0.50) },
      fogDensity: 0.0032,
      fogCol: V3.new(0.020, 0.024, 0.034),
    };
    this.post = { bloom: 0.52, exposure: 1.02, vignette: 0.86, grain: 0.014, ca: 1.0, radial: 0, sat: 1.05, flash: 0, focus: [0.5, 0.52], threshold: 1.14, soft: 0.55 };
    this.drawCalls = 0; this.tris = 0;
  }

  program(vs, fs) {
    const gl = this.gl;
    if (!this.isGL2) { vs = toGLSL1(vs, false); fs = toGLSL1(fs, true); }
    const c = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
        throw new Error('shader compile: ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, c(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNrm'); gl.bindAttribLocation(p, 2, 'aUv');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  mesh(geo) {
    const gl = this.gl;
    const m = { vbo: gl.createBuffer(), nbo: gl.createBuffer(), tbo: gl.createBuffer(), ibo: gl.createBuffer(), count: geo.ni, type: geo.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferData(gl.ARRAY_BUFFER, geo.pos.subarray(0, geo.nv * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nbo); gl.bufferData(gl.ARRAY_BUFFER, geo.nrm.subarray(0, geo.nv * 3), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.tbo); gl.bufferData(gl.ARRAY_BUFFER, geo.uv.subarray(0, geo.nv * 2), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx.subarray(0, geo.ni), gl.STATIC_DRAW);
    return m;
  }

  /** dynamic mesh for trails / ribbons */
  dynMesh(maxVerts) {
    const gl = this.gl;
    const m = {
      vbo: gl.createBuffer(), nbo: gl.createBuffer(), tbo: gl.createBuffer(), ibo: gl.createBuffer(),
      count: 0, type: gl.UNSIGNED_SHORT, dynamic: true, max: maxVerts,
      pos: new Float32Array(maxVerts * 3), nrm: new Float32Array(maxVerts * 3), uv: new Float32Array(maxVerts * 2), idx: new Uint16Array(maxVerts * 3),
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferData(gl.ARRAY_BUFFER, m.pos.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nbo); gl.bufferData(gl.ARRAY_BUFFER, m.nrm.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.tbo); gl.bufferData(gl.ARRAY_BUFFER, m.uv.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx.byteLength, gl.DYNAMIC_DRAW);
    return m;
  }
  uploadDyn(m, nv, ni) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.pos.subarray(0, nv * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.nrm.subarray(0, nv * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, m.tbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.uv.subarray(0, nv * 2));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, m.idx.subarray(0, ni));
    m.count = ni;
  }

  texFromPixel(rgba) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  texFromCanvas(cv, { wrap = 'repeat', mips = true, srgbish = true } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    const w = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const pow2 = (n) => (n & (n - 1)) === 0;
    if (mips && (this.isGL2 || (pow2(cv.width) && pow2(cv.height)))) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.maxAniso));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return t;
  }

  makeShadowFBO(size) {
    const gl = this.gl;
    if (!this.isGL2 && !this.extDepth) return null;
    const fbo = gl.createFramebuffer();
    const depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    if (this.isGL2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (this.isGL2) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    else {
      const cb = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, cb);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cb, 0);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? { fbo, depth, size } : null;
  }

  makeRT(w, h, hdr) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer(), tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    let ok = true;
    if (hdr && this.isGL2 && this.extCBF) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else if (hdr && !this.isGL2 && this.extHF && this.extHFL) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, this.extHF.HALF_FLOAT_OES, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (hdr !== 'nodepth') {
      rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok && hdr && hdr !== 'nodepth') return this.makeRT(w, h, false);
    return { fbo, tex, rb, w, h };
  }

  resize(w, h, dpr) {
    const gl = this.gl;
    const sc = this.quality === 'low' ? 0.72 : this.quality === 'medium' ? 0.88 : 1;
    const pw = Math.max(2, Math.round(w * dpr * sc)), ph = Math.max(2, Math.round(h * dpr * sc));
    if (pw === this._w && ph === this._h) return;
    this._w = pw; this._h = ph;
    this.canvas.width = pw; this.canvas.height = ph;
    const del = (rt) => { if (rt) { gl.deleteFramebuffer(rt.fbo); gl.deleteTexture(rt.tex); if (rt.rb) gl.deleteRenderbuffer(rt.rb); } };
    del(this.rtScene); del(this.rtA); del(this.rtB);
    this.rtScene = this.makeRT(pw, ph, true);
    const bw = Math.max(2, pw >> 2), bh = Math.max(2, ph >> 2);
    this.rtA = this.makeRT(bw, bh, 'nodepth'); this.rtB = this.makeRT(bw, bh, 'nodepth');
    this.bw = bw; this.bh = bh;
  }

  bindMesh(prog, m) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    if (prog !== this.progShadow) { gl.bindBuffer(gl.ARRAY_BUFFER, m.nbo); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0); }
    gl.bindBuffer(gl.ARRAY_BUFFER, m.tbo); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
  }

  aspect() { return this._w / Math.max(1, this._h); }

  setCamera(eye, target, up, fovDeg, near, far, shiftY = 0) {
    const aspect = this._w / this._h;
    // The authored FOV is a VERTICAL one tuned for a 16:9 frame. On narrow
    // or portrait screens a fixed vertical FOV would zoom in brutally, so
    // below 16:9 we lock the HORIZONTAL field of view instead.
    const REF = 16 / 9;
    let vf = fovDeg * DEG;
    if (aspect < REF) {
      const hf = 2 * Math.atan(Math.tan(vf / 2) * REF);        // the authored width
      const need = 2 * Math.atan(Math.tan(hf / 2) / Math.max(aspect, 0.30));
      vf = Math.min(need, vf * 1.55, 84 * DEG);                // never fish-eye
    }
    M4.perspective(this.proj, vf, aspect, near, far);
    this.proj[9] = 2 * shiftY;
    M4.lookAt(this.view, eye, target, up);
    M4.mul(this.viewProj, this.proj, this.view);
    this.camPos = eye;
  }

  setLightFrustum(center, dist, extent, near, far) {
    const d = this.env.lightDir;
    const eye = { x: center.x - d.x * dist, y: center.y - d.y * dist, z: center.z - d.z * dist };
    const lp = M4.create(), lv = M4.create();
    M4.ortho(lp, -extent, extent, -extent, extent, near, far);
    M4.lookAt(lv, eye, center, { x: 0, y: 1, z: 0 });
    M4.mul(this.lightVP, lp, lv);
  }

  beginShadow() {
    if (!this.useShadowMap) return false;
    const gl = this.gl;
    if (!this.shadowFBO) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO.fbo);
    gl.viewport(0, 0, this.shadowFBO.size, this.shadowFBO.size);
    // depthMask MUST be true before clear(), otherwise the depth clear is a no-op
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.useProgram(this.progShadow.p);
    gl.uniformMatrix4fv(this.progShadow.u.uLightVP, false, this.lightVP);
    this._cur = this.progShadow;
    return true;
  }

  drawShadow(mesh, model, tex, alphaTest) {
    const gl = this.gl, u = this.progShadow.u;
    gl.uniformMatrix4fv(u.uModel, false, model);
    if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uTex, 0); gl.uniform1f(u.uUseTex, 1); gl.uniform1f(u.uAlphaTest, alphaTest || 0.5); }
    else gl.uniform1f(u.uUseTex, 0);
    this.bindMesh(this.progShadow, mesh);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
  }

  beginScene(clearCol) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtScene.fbo);
    gl.viewport(0, 0, this._w, this._h);
    // depthMask MUST be true before clear(), otherwise the depth clear is a no-op
    // and the buffer keeps last frame's (or uninitialised) depths.
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clearColor(clearCol[0], clearCol[1], clearCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    const p = this.progMain, u = p.u, e = this.env;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3f(u.uCam, this.camPos.x, this.camPos.y, this.camPos.z);
    const ld = V3.norm({}, e.lightDir);
    gl.uniform3f(u.uLightDir, ld.x, ld.y, ld.z);
    gl.uniform3f(u.uLightCol, e.lightCol.x, e.lightCol.y, e.lightCol.z);
    gl.uniform3f(u.uSkyCol, e.sky.x, e.sky.y, e.sky.z);
    gl.uniform3f(u.uGroundCol, e.ground.x, e.ground.y, e.ground.z);
    gl.uniform3f(u.uFill1Pos, e.fill1.p.x, e.fill1.p.y, e.fill1.p.z);
    gl.uniform3f(u.uFill1Col, e.fill1.c.x, e.fill1.c.y, e.fill1.c.z);
    gl.uniform3f(u.uFill2Pos, e.fill2.p.x, e.fill2.p.y, e.fill2.p.z);
    gl.uniform3f(u.uFill2Col, e.fill2.c.x, e.fill2.c.y, e.fill2.c.z);
    gl.uniform1f(u.uFogDensity, e.fogDensity);
    gl.uniform3f(u.uFogCol, e.fogCol.x, e.fogCol.y, e.fogCol.z);
    if (this.shadowFBO && this.useShadowMap) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowFBO.depth);
      gl.uniform1i(u.uShadow, 1); gl.uniform1f(u.uShadowOn, 1); gl.uniform1f(u.uShadowTexel, 1 / this.shadowFBO.size);
    } else gl.uniform1f(u.uShadowOn, 0);
    this.drawCalls = 0; this.tris = 0;
  }

  draw(mesh, model, mat) {
    const gl = this.gl, u = this.progMain.u;
    gl.uniformMatrix4fv(u.uModel, false, model);
    M4.normalFromMat4(this.nrmMat, model);
    gl.uniformMatrix3fv(u.uNrmMat, false, this.nrmMat);
    const c = mat.color || [1, 1, 1];
    gl.uniform3f(u.uAlbedo, c[0], c[1], c[2]);
    gl.uniform1f(u.uRough, mat.rough !== undefined ? mat.rough : 0.6);
    gl.uniform1f(u.uMetal, mat.metal || 0);
    gl.uniform1f(u.uSpecTint, mat.specTint !== undefined ? mat.specTint : 1);
    const em = mat.emissive || [0, 0, 0];
    gl.uniform3f(u.uEmissive, em[0], em[1], em[2]);
    gl.uniform1f(u.uOpacity, mat.opacity !== undefined ? mat.opacity : 1);
    gl.uniform1f(u.uUnlit, mat.unlit ? 1 : 0);
    gl.uniform1f(u.uRimPower, mat.rimPower || 3);
    gl.uniform1f(u.uRimStrength, mat.rim || 0);
    const rc = mat.rimCol || [0.5, 0.7, 1];
    gl.uniform3f(u.uRimCol, rc[0], rc[1], rc[2]);
    if (mat.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mat.tex); gl.uniform1i(u.uTex, 0); gl.uniform1f(u.uUseTex, 1); gl.uniform1f(u.uAlphaTest, mat.alphaTest || 0); }
    else { gl.uniform1f(u.uUseTex, 0); gl.uniform1f(u.uAlphaTest, 0); }

    if (mat.blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, mat.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    else { gl.disable(gl.BLEND); gl.depthMask(true); }
    if (mat.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);

    this.bindMesh(this.progMain, mesh);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    this.drawCalls++; this.tris += mesh.count / 3;
  }

  blit(prog, setup, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this._w, target ? target.h : this._h);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(prog.p);
    setup(prog.u, gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsQuad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  present(time) {
    const gl = this.gl, P = this.post;
    const doBloom = this.quality !== 'low' && P.bloom > 0.001;
    if (doBloom) {
      this.blit(this.progBright, (u) => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtScene.tex); gl.uniform1i(u.uSrc, 0);
        gl.uniform1f(u.uThreshold, P.threshold); gl.uniform1f(u.uSoft, P.soft);
      }, this.rtA);
      for (let i = 0; i < 2; i++) {
        this.blit(this.progBlur, (u) => {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtA.tex); gl.uniform1i(u.uSrc, 0);
          gl.uniform2f(u.uDir, (1 + i) / this.bw, 0);
        }, this.rtB);
        this.blit(this.progBlur, (u) => {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtB.tex); gl.uniform1i(u.uSrc, 0);
          gl.uniform2f(u.uDir, 0, (1 + i) / this.bh);
        }, this.rtA);
      }
    }
    this.blit(this.progComp, (u) => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.rtScene.tex); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, doBloom ? this.rtA.tex : this.white); gl.uniform1i(u.uBloom, 1);
      gl.uniform1f(u.uBloomAmt, doBloom ? P.bloom : 0);
      gl.uniform1f(u.uExposure, P.exposure);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uVignette, P.vignette);
      gl.uniform1f(u.uGrain, P.grain);
      gl.uniform1f(u.uCA, P.ca);
      gl.uniform1f(u.uRadial, P.radial);
      gl.uniform1f(u.uSat, P.sat);
      gl.uniform1f(u.uFlash, P.flash);
      gl.uniform2f(u.uFocus, P.focus[0], P.focus[1]);
    }, null);
  }
}
