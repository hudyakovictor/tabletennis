/* ---------- синтез звука (WebAudio, без файлов) ---------- */
const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = .55;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * .5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }
  const ok = () => S.sfx && ensure();
  function tone(freq, dur, { type = 'sine', vol = .3, slide = 0, delay = 0, attack = .004 } = {}) {
    const t = ctx.currentTime + delay; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, { f = 2000, q = 1, vol = .3, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
    const t = ctx.currentTime + delay; const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(f * sweep, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + .02);
  }
  return {
    unlock: ensure,
    tap() { if (!ok()) return; tone(880, .06, { type: 'triangle', vol: .18, slide: 1.4 }); },
    soft() { if (!ok()) return; tone(520, .07, { type: 'sine', vol: .14, slide: 1.2 }); },
    tab() { if (!ok()) return; tone(660, .08, { type: 'triangle', vol: .16, slide: 1.5 }); tone(990, .06, { type: 'sine', vol: .08, delay: .03 }); },
    paddle(p = 1) { if (!ok()) return; noise(.05, { f: 2600 * p, q: 2.5, vol: .5 }); tone(1150 * p, .07, { type: 'sine', vol: .28, slide: .6 }); },
    table() { if (!ok()) return; noise(.03, { f: 3800, q: 3, vol: .32 }); tone(720, .06, { type: 'sine', vol: .22, slide: .7 }); },
    net() { if (!ok()) return; noise(.12, { f: 900, q: .8, vol: .3, type: 'lowpass' }); },
    whoosh() { if (!ok()) return; noise(.32, { f: 500, q: .9, vol: .35, sweep: 6 }); },
    smash() { if (!ok()) return; noise(.08, { f: 3000, q: 1.5, vol: .7 }); tone(160, .3, { type: 'sine', vol: .5, slide: .4 }); noise(.4, { f: 600, q: .7, vol: .3, sweep: 5, delay: .02 }); },
    coin(i = 0) { if (!ok()) return; const b = 1320 * Math.pow(1.06, i % 6); tone(b, .09, { type: 'square', vol: .06 }); tone(b * 1.5, .16, { type: 'triangle', vol: .12, delay: .05 }); },
    gem(i = 0) { if (!ok()) return; tone(1760 * Math.pow(1.05, i % 5), .2, { type: 'sine', vol: .14 }); tone(2640, .14, { type: 'sine', vol: .06, delay: .04 }); },
    impact() { if (!ok()) return; tone(110, .45, { type: 'sine', vol: .7, slide: .35 }); noise(.25, { f: 400, q: .6, vol: .45, type: 'lowpass' }); },
    point() { if (!ok()) return; [784, 988, 1318].forEach((f, i) => tone(f, .22, { type: 'triangle', vol: .2, delay: i * .07 })); },
    lose() { if (!ok()) return; [440, 370, 294].forEach((f, i) => tone(f, .26, { type: 'triangle', vol: .18, delay: i * .1 })); },
    win() { if (!ok()) return; [523, 659, 784, 1046, 1318].forEach((f, i) => { tone(f, .35, { type: 'triangle', vol: .2, delay: i * .09 }); tone(f / 2, .35, { type: 'sine', vol: .1, delay: i * .09 }); }); },
    tick() { if (!ok()) return; tone(1400, .03, { type: 'square', vol: .05 }); },
    count(n) { if (!ok()) return; tone(n ? 660 : 1320, n ? .18 : .45, { type: 'triangle', vol: .28 }); },
    rise(d = .8) { if (!ok()) return; tone(300, d, { type: 'sawtooth', vol: .05, slide: 4 }); noise(d, { f: 400, q: 2, vol: .1, sweep: 8 }); },
    reveal(r = 0) { if (!ok()) return; const base = [880, 988, 1175, 1568][r]; [0, .08, .16].forEach((d, i) => tone(base * [1, 1.25, 1.5][i], .4, { type: 'sine', vol: .16, delay: d })); noise(.6, { f: 6000, q: 1, vol: .12, type: 'highpass' }); },
    swoosh() { if (!ok()) return; noise(.22, { f: 1200, q: 1.2, vol: .25, sweep: .3 }); },
    hold(p) { if (!ok()) return; tone(400 + p * 800, .05, { type: 'triangle', vol: .06 }); },
    error() { if (!ok()) return; tone(220, .12, { type: 'square', vol: .1 }); tone(180, .16, { type: 'square', vol: .1, delay: .1 }); }
  };
})();
