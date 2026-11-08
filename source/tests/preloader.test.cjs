const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const source = read('ui/preloader.js');

function element() {
  const attrs = new Map(), listeners = new Map();
  return {
    style: {}, dataset: {}, hidden: false, attrs, listeners,
    setAttribute: (key, value) => attrs.set(key, value),
    getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key),
    addEventListener(event, fn) { const set = listeners.get(event) || new Set(); set.add(fn); listeners.set(event, set); },
    removeEventListener: (event, fn) => listeners.get(event)?.delete(fn),
    emit(event) { [...(listeners.get(event) || [])].forEach(fn => fn()); },
    appendChild(child) { child.parentElement = this; },
  };
}

function fixture() {
  let now = 0, serial = 0, resolveFonts, rejectFonts, dispose;
  const root = element(), body = element(), document = element();
  const nodes = Object.fromEntries(['readout', 'progress', 'percent', 'status', 'retry'].map(key => ['.pl-' + key, element()]));
  const frames = new Map(), timers = new Map(), subscribers = new Set(), messages = [], routes = [], samples = [];
  document.body = body; document.hidden = false;
  document.fonts = { ready: new Promise((resolve, reject) => { resolveFonts = resolve; rejectFonts = reject; }) };
  const host = {
    ready: true, ensure() {}, reload() { messages.push({ type: 'reload' }); }, show(on) { messages.push({ type: 'show', on }); },
    send(type, data) { messages.push({ type, ...data }); },
    on(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
  const router = { busy: false, go(id, options) {
    routes.push({ id, options, at: now }); dispose?.();
    if (id === 'splash') dispose = preloader.mount(); else host.send('lobby');
  } };
  const context = vm.createContext({
    document, GameHost: host, Router: router, t: key => key,
    $: selector => selector === '#preloader' ? root : nodes[selector],
    performance: { now: () => now },
    requestAnimationFrame: fn => { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source + '\nglobalThis.Preloader = Preloader;', context);
  const preloader = context.Preloader;
  function sample() {
    const s = preloader.session;
    samples.push({ at: now, value: Number(nodes['.pl-readout'].getAttribute('aria-valuenow')),
      arc: Number(nodes['.pl-progress'].style.strokeDashoffset), phase: root.dataset.phase,
      opacity: Number(root.style.opacity), hidden: root.hidden, ready: s?.sceneReady });
  }
  function step(ms = 16) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.fn();
    const pending = [...frames];
    for (const [id, fn] of pending) if (frames.delete(id)) fn(now);
    assert.ok(frames.size <= 1, 'at most one owned RAF'); sample();
  }
  function until(predicate, limit = 2000) {
    for (let i = 0; i < limit && !predicate(); i++) step();
    assert.ok(predicate(), 'lifecycle reached expected state');
  }
  return { preloader, root, body, document, nodes, host, router, frames, timers, subscribers, messages, routes, samples,
    mount() { dispose = preloader.mount(); sample(); return preloader.session; },
    get dispose() { return dispose; }, step, until, emit: m => [...subscribers].forEach(fn => fn(m)),
    ready() { this.emit({ type: 'lobbyReady', requestId: preloader.session.id }); },
    async fonts(fail = false) { if (fail) rejectFonts(Error('fonts unavailable')); else resolveFonts(); await Promise.resolve(); },
  };
}

function monotonic(samples) {
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].value >= samples[i - 1].value, 'percentage never decreases');
    assert.ok(samples[i].arc <= samples[i - 1].arc + 1e-9, 'arc never moves backwards');
    assert.ok(samples[i - 1].arc - samples[i].arc <= 477.522 * 50 / 1200 + 1e-9, 'stalls cannot skip the ramp');
  }
}

function disposed(f, s) {
  assert.equal(s.alive, false); assert.equal(s.raf, 0); assert.equal(s.timers.size, 0);
  assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.subscribers.size, 0);
  assert.equal(f.document.listeners.get('visibilitychange').size, 0);
  assert.equal(f.nodes['.pl-retry'].listeners.get('click').size, 0);
  assert.equal(f.preloader.session, null); assert.equal(f.root.hidden, true);
}

test('fast scene readiness ramps for >=1000ms, paints 100 before a short plain fade and disposes', async () => {
  const f = fixture(), s = f.mount(); await f.fonts();
  f.step(0); f.until(() => s.sceneStarted); f.ready();
  assert.equal(s.sceneReady, true); assert.equal(f.root.parentElement, f.body);
  f.until(() => s.phase === 'complete');
  const complete = f.samples.at(-1);
  assert.ok(complete.at >= 1000); assert.equal(complete.value, 100); assert.equal(complete.opacity, 1);
  assert.equal(f.routes.length, 0); assert.equal(f.root.hidden, false);
  f.until(() => s.phase === 'fade');
  assert.ok(f.samples.at(-1).at - complete.at >= 100, '100 is held on separate painted frames');
  assert.equal(f.routes.length, 1); assert.equal(f.routes[0].id, 'hub');
  assert.deepEqual(f.messages.filter(m => ['lobby', 'attract'].includes(m.type)).map(m => m.type), ['lobby', 'attract', 'lobby']);
  f.step(); assert.ok(Number(f.root.style.opacity) > 0 && Number(f.root.style.opacity) < 1);
  f.until(() => !f.preloader.session);
  assert.ok(f.samples.at(-1).at - f.routes[0].at >= 180);
  assert.ok(f.samples.at(-1).at - f.routes[0].at < 250);
  monotonic(f.samples); disposed(f, s);
  assert.ok(f.samples.filter(x => x.value === 100 && !x.hidden).every(x => x.ready));
  assert.ok(!f.messages.some(m => m.type === 'lobbyLaunch'));
});

test('slow scene or fonts, duplicate/stale ready and a busy router cannot race or bypass the gate', async () => {
  for (const slow of ['scene', 'fonts']) {
    const f = fixture(), s = f.mount(); f.step(240);
    if (slow === 'scene') await f.fonts(); else f.ready();
    f.emit({ type: 'ready' }); f.emit({ type: 'lobbyReady', requestId: s.id + 1 });
    f.until(() => s.displayedProgress === 99);
    for (let i = 0; i < 180; i++) f.step();
    assert.equal(s.phase, 'loading'); assert.equal(f.routes.length, 0); assert.equal(f.root.hidden, false);
    assert.ok(f.samples.every(x => x.value < 100));
    f.router.busy = true;
    if (slow === 'scene') { f.ready(); f.ready(); } else await f.fonts();
    f.until(() => s.phase === 'complete');
    for (let i = 0; i < 20; i++) { f.ready(); f.step(); }
    assert.equal(f.routes.length, 0); assert.equal(f.frames.size, 1); assert.equal(f.timers.size, 0);
    f.router.busy = false; f.until(() => !f.preloader.session);
    assert.equal(f.routes.length, 1); monotonic(f.samples); disposed(f, s);
  }
});

test('hidden tabs and long frame stalls cannot skip progress or the visible completed frame', async () => {
  const f = fixture(), s = f.mount(); await f.fonts(); f.step(240); f.ready(); f.step();
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(f.frames.size, 0); const progress = s.displayedProgress;
  f.step(60000); assert.equal(s.displayedProgress, progress); assert.equal(s.phase, 'loading');
  f.document.hidden = false; f.document.emit('visibilitychange'); f.step(); f.step(5000);
  assert.ok(s.displayedProgress - progress <= 50 / 12 + 1e-9);
  f.until(() => s.phase === 'complete');
  f.document.hidden = true; f.document.emit('visibilitychange'); f.step(60000);
  assert.equal(s.phase, 'complete'); assert.equal(f.routes.length, 0);
  f.document.hidden = false; f.document.emit('visibilitychange'); f.step();
  for (let i = 0; i < 6; i++) f.step();
  assert.equal(s.phase, 'complete'); assert.equal(f.root.style.opacity, '1');
  f.until(() => s.phase === 'fade');
  f.document.hidden = true; f.document.emit('visibilitychange'); f.step(60000);
  assert.equal(f.root.hidden, false); assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.document.emit('visibilitychange');
  f.until(() => !f.preloader.session); monotonic(f.samples); disposed(f, s);
});

test('cancel, remount, errors and retry release RAFs/timers and ignore old callbacks', async () => {
  const f = fixture(), old = f.mount(), oldDispose = f.dispose;
  const staleFrame = [...f.frames.values()][0], staleTimer = [...f.timers.values()][0].fn;
  f.dispose(); disposed(f, old); await f.fonts(); staleFrame(5000); staleTimer();
  assert.equal(f.messages.length, 0); assert.equal(f.frames.size, 0);
  const current = f.mount(); oldDispose();
  assert.equal(f.preloader.session, current);
  f.emit({ type: 'lobbyReady', requestId: old.id }); assert.equal(current.sceneReady, false);
  f.preloader.cancel(); disposed(f, current);

  for (const failure of ['fonts', 'ensure', 'timeout', 'glLost']) {
    const g = fixture(); if (failure === 'ensure') g.host.ensure = () => { throw Error('engine unavailable'); };
    const s = g.mount();
    if (failure === 'fonts') await g.fonts(true);
    else {
      await g.fonts(); g.step(240);
      if (failure === 'glLost') { g.ready(); g.emit({ type: 'glLost' }); }
      if (failure === 'timeout') g.until(() => s.phase === 'error');
    }
    assert.equal(s.phase, 'error'); assert.equal(g.frames.size, 0); assert.equal(g.timers.size, 0);
    assert.equal(s.raf, 0); assert.equal(s.timers.size, 0); assert.equal(g.nodes['.pl-retry'].hidden, false);
    g.ready(); g.document.emit('visibilitychange'); g.step(1000);
    assert.equal(s.phase, 'error'); assert.equal(g.routes.length, 0); assert.equal(g.frames.size, 0);
    g.host.ensure = () => {}; g.nodes['.pl-retry'].emit('click');
    assert.equal(s.alive, false); assert.notEqual(g.preloader.session.id, s.id);
    assert.equal(g.subscribers.size, 1); assert.equal(g.frames.size, 1); assert.equal(g.timers.size, 1);
    const retry = g.preloader.session; g.dispose(); disposed(g, retry);
  }

  const g = fixture(), s = g.mount(); await g.fonts(); g.step(240); g.ready();
  g.until(() => s.phase === 'fade'); const fadingFrame = [...g.frames.values()][0];
  g.preloader.cancel(); disposed(g, s); fadingFrame(5000); g.step(5000);
  assert.equal(g.routes.length, 1); assert.equal(g.frames.size, 0);
});

test('one viewport-anchored CSS group centers percentage inside the small ring, with no legacy intro', () => {
  const html = read('ui/preloader.html'), css = read('css/screens_misc.css');
  const rule = selector => css.match(new RegExp('(?:^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]+)\\}'))?.[1];
  const group = html.match(/<div class="pl-readout"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group); assert.equal((html.match(/class="pl-readout"/g) || []).length, 1);
  assert.match(group, /<svg class="pl-ring"/); assert.match(group, /<b class="pl-percent num">/);
  assert.match(rule('#preloader'), /position:fixed;inset:0;/);
  assert.match(rule('.pl-readout'), /left:50%;bottom:100px;/);
  assert.match(rule('.pl-readout'), /width:clamp\(74px,24vw,92px\);aspect-ratio:1;/);
  assert.match(rule('.pl-readout'), /display:grid;place-items:center;transform:translateX\(-50%\)/);
  assert.match(rule('.pl-ring'), /position:absolute;inset:0;width:100%;height:100%/);
  assert.doesNotMatch(rule('.pl-percent'), /position:|transform:|bottom:|top:/);
  assert.match(rule('.pl-backdrop'), /url\("preloaderr\.png"\) center\/cover/);
  assert.doesNotMatch(html + source + css, /pl-(?:paddle|burst|ball|sheet|glass|fallback|stage|wordmark)|preloader-ball|has-sprites|plArrive/);
  assert.doesNotMatch(source, /Sfx\.|haptic\(|new Image|\.animate\(|send\('lobbyLaunch'/);
  const f = fixture(), s = f.mount(); assert.equal(f.root.parentElement, f.body); f.preloader.cancel(); disposed(f, s);
});
