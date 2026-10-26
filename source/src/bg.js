/* =====================================================================
   BG — WebGL-фон «арена»: объёмные прожекторы, пыль в лучах, боке,
   пол со световым пятном, плёночное зерно. Настроение (палитра)
   плавно перетекает при смене экрана. Фолбэк — CSS-градиенты.
   ===================================================================== */
const BG = (() => {
  let gl, prog, cv, u = {}, start = performance.now(), raf = 0, scale = .5, ok = false;
  const MOODS = {
    arena:  { a: [.25, .75, 1.0], b: [.14, .55, 1.0], base: [.035, .04, .11], floor: .55, beams: 1 },
    battle: { a: [1.0, .25, .2], b: [.15, .55, 1.0], base: [.02, .02, .06], floor: .25, beams: 1.3 },
    /* Лучи прожекторов больше не жёлтые — холодный сине-голубой свет арены */
    gold:   { a: [.35, .82, 1.0], b: [.12, .5, 1.0], base: [.04, .05, .1], floor: .8, beams: 1.4 },
    lose:   { a: [.45, .5, .7], b: [.3, .35, .5], base: [.03, .03, .05], floor: .2, beams: .5 },
    violet: { a: [.62, .42, 1.0], b: [.18, .9, 1.0], base: [.04, .03, .12], floor: .5, beams: 1 },
    shop:   { a: [.23, .96, .63], b: [1.0, .79, .23], base: [.03, .05, .09], floor: .5, beams: .8 }
  };
  let cur = structuredClone(MOODS.arena), tgt = MOODS.arena;
  const FS = `precision mediump float;
  uniform vec2 R; uniform float T; uniform vec3 CA, CB, BASE; uniform float FLOOR, BEAMS;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float beam(vec2 uv, vec2 o, float ang, float w){vec2 d=uv-o; float a=atan(d.x,-d.y)-ang; float fall=smoothstep(1.6,.0,length(d)); return exp(-a*a/(w*w))*fall;}
  void main(){
    vec2 uv=gl_FragCoord.xy/R; vec2 p=uv; p.x=(p.x-.5)*R.x/R.y+.5;
    vec3 col=BASE*(1.2-uv.y*.6);
    float t=T*.25;
    float b1=beam(p,vec2(.05,1.12),.55+sin(t*1.1)*.18,.13);
    float b2=beam(p,vec2(.95,1.12),-.55+sin(t*.9+2.)*.18,.13);
    float b3=beam(p,vec2(.5,1.2),sin(t*.7)*.25,.08)*.6;
    float dust=n(p*vec2(6.,3.)+vec2(0.,-T*.08))*n(p*14.+T*.05);
    col+=CA*b1*(.32+dust*.55)*BEAMS + CB*b2*(.32+dust*.55)*BEAMS + mix(CA,CB,.5)*b3*.35*BEAMS;
    float fl=exp(-pow((p.x-.5)*2.2,2.)-pow((uv.y-.16)*5.,2.));
    col+=mix(CB,CA,.35)*fl*.22*FLOOR;
    for(int i=0;i<10;i++){float fi=float(i); vec2 c=vec2(fract(h(vec2(fi,1.))+T*.004*(1.+fi*.1)), .25+.7*h(vec2(fi,7.)));
      c.x=(c.x-.5)*R.x/R.y+.5; float d=length(p-c); float r=.015+.03*h(vec2(fi,3.));
      col+=mix(CA,CB,h(vec2(fi,9.)))*smoothstep(r,r*.3,d)*.09*(.6+.4*sin(T+fi));}
    col*=1.-.55*pow(length((uv-vec2(.5,.55))*vec2(1.1,.9)),1.8);
    col+=(h(gl_FragCoord.xy+fract(T)*100.)-.5)*.025;
    gl_FragColor=vec4(col,1.);
  }`;
  const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  function init() {
    cv = $('#bg');
    try {
      gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
      if (!gl) throw 0;
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      ['R', 'T', 'CA', 'CB', 'BASE', 'FLOOR', 'BEAMS'].forEach((k) => (u[k] = gl.getUniformLocation(prog, k)));
      ok = true;
    } catch (e) { ok = false; cv.style.background = 'radial-gradient(120% 60% at 15% 0%,rgba(255,75,62,.25),transparent 60%),radial-gradient(120% 60% at 85% 0%,rgba(46,230,255,.22),transparent 60%),#05060F'; }
    resize(); window.addEventListener('resize', resize);
    setQuality(S.quality);
    if (ok) frame();
  }
  function resize() { const r = $('#device').getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * d * scale); cv.height = Math.max(1, r.height * d * scale); if (ok) gl.viewport(0, 0, cv.width, cv.height); }
  function setQuality(q) { scale = q === 'high' ? .5 : q === 'mid' ? .35 : .22; resize(); }
  let paused = false;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (paused) return;
    const k = .04;
    for (const key of ['a', 'b', 'base']) for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], tgt[key][i], k);
    cur.floor = lerp(cur.floor, tgt.floor, k); cur.beams = lerp(cur.beams, tgt.beams, k);
    gl.uniform2f(u.R, cv.width, cv.height); gl.uniform1f(u.T, (performance.now() - start) / 1000);
    gl.uniform3fv(u.CA, cur.a); gl.uniform3fv(u.CB, cur.b); gl.uniform3fv(u.BASE, cur.base);
    gl.uniform1f(u.FLOOR, cur.floor); gl.uniform1f(u.BEAMS, cur.beams);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return { init, resize, setQuality, mood(m) { tgt = MOODS[m] || MOODS.arena; }, pause(p) { paused = p; } };
})();
