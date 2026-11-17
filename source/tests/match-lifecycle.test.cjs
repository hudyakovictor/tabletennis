const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const pending = [], commands = [], observers = [];
  let screen;
  const sheet = { cur: null, open() { this.cur = {}; } };
  const ctx = vm.createContext({
    Router: { def(_id, value) { screen = value; } },
    GameHost: { send(cmd) { commands.push(cmd); } },
    sleep: () => new Promise(resolve => pending.push(resolve)),
    Sfx: new Proxy({}, { get: () => () => {} }), haptic() {}, flash() {},
    S: { diff: 1, sfx: true }, MODE: { id: 'career' }, TARGET: { career: 11 },
    clamp: (n, lo, hi) => Math.min(hi, Math.max(lo, n)), aiTrend: () => 0,
    t: key => key, Art: { icon: () => '' }, Sheet: sheet, $: () => ({}),
    MutationObserver: class {
      constructor(fn) { this.callback = fn; observers.push(this); }
      observe() {} disconnect() {}
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/screens/match.js'), 'utf8'), ctx);
  const mount = () => {
    const nodes = Object.fromEntries(['.mx', '.mx-intro', '.mx-count'].map(selector =>
      [selector, { innerHTML: '', classList: { add() {}, remove() {} } }]));
    screen.el = { querySelector: selector => nodes[selector] };
    screen.st = { p: 0, o: 0, live: false, over: false };
    screen.alive = true;
    return screen.st;
  };
  const advance = async () => { assert.ok(pending.length); pending.shift()(); await new Promise(setImmediate); };
  const drain = async () => {
    for (let i = 0; pending.length; i++) { assert.ok(i < 30, 'intro must terminate'); await advance(); }
  };
  mount();
  return { screen, sheet, commands, observers, mount, advance, drain };
}

test('pausing during the intro keeps the newly started match paused until every sheet closes', async () => {
  const f = fixture(), run = f.screen.intro();
  f.screen.pause();
  await f.drain(); await run;
  assert.equal(f.screen.st.live, true);
  assert.equal(f.screen.st.paused, true);
  const start = f.commands.indexOf('match');
  assert.ok(start >= 0);
  assert.equal(f.commands[start + 1], 'pause');
  assert.equal(f.commands.includes('resume'), false);
  f.observers.at(-1).callback();
  assert.equal(f.commands.includes('resume'), false, 'an open settings or pause sheet must not resume play');
  f.sheet.cur = null; f.observers.at(-1).callback();
  assert.equal(f.screen.st.paused, false);
  assert.equal(f.commands.at(-1), 'resume');
});

test('closing the pause before the intro ends does not leave the match paused', async () => {
  const f = fixture(), run = f.screen.intro();
  f.screen.pause(); f.sheet.cur = null; f.observers.at(-1).callback();
  await f.drain(); await run;
  assert.equal(f.screen.st.live, true);
  assert.equal(f.screen.st.paused, false);
  assert.equal(f.commands.filter(cmd => cmd === 'pause').length, 1);
});

test('an intro from a departed screen never starts or resets the remounted match', async () => {
  for (let stage = 0; stage < 8; stage++) {
    const f = fixture(), oldState = f.screen.st, oldRun = f.screen.intro();
    for (let i = 0; i < stage; i++) await f.advance();
    f.screen.alive = false;
    const newState = f.mount(), newRun = f.screen.intro();
    await f.drain(); await Promise.all([oldRun, newRun]);
    assert.equal(f.commands.filter(cmd => cmd === 'match').length, 1, `remount at intro stage ${stage}`);
    assert.equal(oldState.live, false);
    assert.equal(newState.live, true);
  }
});

test('surrendering during the intro cancels its later match-start command', async () => {
  const f = fixture(), run = f.screen.intro();
  f.screen.st.over = true;
  await f.drain(); await run;
  assert.equal(f.commands.includes('match'), false);
  assert.equal(f.screen.st.live, false);
});
