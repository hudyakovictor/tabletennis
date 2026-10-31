const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function webApp() {
  const events = new Map(), back = new Set(), calls = { ready: 0, expand: 0, show: 0, locks: 0 };
  const app = {
    platform: 'ios', initData: 'signed', initDataUnsafe: { user: { first_name: 'Test', username: 'test' } },
    safeAreaInset: { top: 20, bottom: 10 }, contentSafeAreaInset: { top: 30, bottom: 5 },
    ready: () => calls.ready++, expand: () => calls.expand++,
    onEvent: (event, fn) => { const set = events.get(event) || new Set(); set.add(fn); events.set(event, set); },
    offEvent: (event, fn) => events.get(event)?.delete(fn),
    BackButton: { onClick: (fn) => back.add(fn), offClick: (fn) => back.delete(fn), show: () => calls.show++, hide() {} },
    requestFullscreen() {}, lockOrientation: () => calls.locks++,
  };
  return { app, events, back, calls };
}

function load({ hash = '', app = null } = {}) {
  const scripts = [], timers = new Map(), insets = new Map(); let id = 0, backs = 0;
  const window = { innerWidth: 390, innerHeight: 844, ...(app ? { Telegram: { WebApp: app } } : {}) };
  const context = vm.createContext({
    window, location: { hash }, URLSearchParams, S: { name: 'Local', nick: '@local' },
    Router: { back: () => backs++ },
    setTimeout: (fn) => { const key = ++id; timers.set(key, fn); return key; }, clearTimeout: (key) => timers.delete(key),
    document: {
      documentElement: { style: { setProperty: (key, value) => insets.set(key, value) } },
      head: { appendChild: (script) => scripts.push(script) },
      createElement: () => ({
        listeners: new Map(), removed: false,
        addEventListener(event, fn) { this.listeners.set(event, fn); }, removeEventListener(event) { this.listeners.delete(event); },
        remove() { this.removed = true; }, emit(event) { this.listeners.get(event)?.(); },
      }),
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core/platform.js'), 'utf8') + '\nglobalThis.fixture = TGX;', context);
  return { TGX: context.fixture, window, scripts, timers, insets, backs: () => backs };
}

test('offline/browser launch never requests or waits for the Telegram SDK', async () => {
  for (const hash of ['', '#room=ABCDE', '#tgWebAppPlatform=unknown&tgWebAppData=', '#tgWebAppPlatform=ios']) {
    const f = load({ hash });
    assert.equal(await f.TGX.load(), false);
    assert.equal(f.scripts.length, 0); assert.equal(f.timers.size, 0);
  }
  const template = fs.readFileSync(path.join(__dirname, '../src/index.tpl.html'), 'utf8');
  assert.doesNotMatch(template, /<script[^>]+src=["']https:\/\/telegram\.org/);
});

test('repeated init owns exactly one callback per platform event and BackButton', () => {
  const w = webApp(), f = load({ app: w.app });
  f.TGX.init(); f.TGX.init(); f.TGX.init();
  assert.equal(w.calls.ready, 1); assert.equal(w.calls.expand, 1);
  for (const set of w.events.values()) assert.equal(set.size, 1);
  assert.equal(w.events.size, 4); assert.equal(w.back.size, 1);
  w.back.forEach((fn) => fn()); assert.equal(f.backs(), 1);
  assert.equal(f.insets.get('--tgt'), '50px'); assert.equal(f.insets.get('--tgb'), '15px');
  f.TGX.dispose(); f.TGX.dispose();
  for (const set of w.events.values()) assert.equal(set.size, 0);
  assert.equal(w.back.size, 0);
  f.TGX.init(); assert.equal(w.back.size, 1);
});

test('switching the SDK instance disposes the old callbacks before rebinding', () => {
  const first = webApp(), second = webApp(), f = load({ app: first.app });
  f.TGX.init(); f.window.Telegram.WebApp = second.app; f.TGX.init();
  assert.equal(first.back.size, 0); assert.equal(second.back.size, 1);
  for (const set of first.events.values()) assert.equal(set.size, 0);
  second.back.forEach((fn) => fn()); assert.equal(f.backs(), 1);
});

test('Telegram launch lazily shares one SDK load and binds only after it is available', async () => {
  const f = load({ hash: '#tgWebAppPlatform=ios&tgWebAppData=signed' });
  f.TGX.back(true);
  const first = f.TGX.load(), second = f.TGX.load();
  assert.equal(first, second); assert.equal(f.scripts.length, 1); assert.equal(f.timers.size, 1);
  const w = webApp(); f.window.Telegram = { WebApp: w.app }; f.scripts[0].emit('load');
  assert.equal(await first, true); assert.equal(f.timers.size, 0); assert.equal(f.scripts[0].listeners.size, 0);
  assert.equal(w.back.size, 1); assert.equal(w.calls.show, 1);
  assert.equal(await f.TGX.load(), true); assert.equal(f.scripts.length, 1); assert.equal(w.calls.ready, 1);
});

test('SDK failure/disposal resolve safely and release callbacks and timers', async () => {
  for (const event of ['error', 'dispose', 'timeout']) {
    const f = load({ hash: '#tgWebAppPlatform=android&tgWebAppData=signed' }), pending = f.TGX.load();
    if (event === 'error') f.scripts[0].emit('error');
    else if (event === 'dispose') f.TGX.dispose();
    else [...f.timers.values()][0]();
    assert.equal(await pending, false); assert.equal(f.scripts[0].removed, true);
    assert.equal(f.scripts[0].listeners.size, 0); assert.equal(f.timers.size, 0);
  }
});

test('dispose and fullscreen exit cancel a pending orientation lock', () => {
  const w = webApp(), f = load({ app: w.app }); f.TGX.init();
  f.TGX.fullscreen(true); assert.equal(f.timers.size, 1);
  f.TGX.fullscreen(false); assert.equal(f.timers.size, 0);
  f.TGX.fullscreen(true); f.TGX.dispose(); assert.equal(f.timers.size, 0); assert.equal(w.calls.locks, 0);
  const beforeInit = load({ app: webApp().app });
  beforeInit.TGX.fullscreen(true); beforeInit.TGX.dispose(); assert.equal(beforeInit.timers.size, 0);
});
