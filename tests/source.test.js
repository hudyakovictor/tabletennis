/* Source-level guards. The game ships as ONE concatenated <script>, so a typo
 * anywhere is not a local bug: it takes the whole bundle down and the page
 * shows "WebGL недоступен". These checks run before anyone opens a browser. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { root } = require('./helpers.cjs');

/* Read the build order from build.py itself: a hardcoded copy in the test
 * drifts the moment a module is added or removed. */
const buildPy = fs.readFileSync(path.join(root, 'tt/build.py'), 'utf8');
const orderBlock = buildPy.match(/JS_ORDER\s*=\s*\[([\s\S]*?)\]/);
if (!orderBlock) throw new Error('cannot find JS_ORDER in tt/build.py');
const ORDER = [...orderBlock[1].matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);

const read = (f) => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8');
const bundle = () => ORDER.map(read).join('\n\n');
const methodNames = (src, cls) => {
  const start = src.indexOf('class ' + cls);
  assert.ok(start >= 0, `class ${cls} not found`);
  const body = src.slice(start);
  const names = new Set();
  for (const m of body.matchAll(/^\s{2}(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  return names;
};

test('the source tree and JS_ORDER agree on which modules exist', () => {
  const onDisk = fs.readdirSync(path.join(root, 'tt/src')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual([...ORDER].sort(), onDisk,
    'a module on disk that is missing from JS_ORDER silently never ships');
});

test('the concatenated bundle is valid JavaScript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-syntax-'));
  try {
    const file = path.join(dir, 'bundle.js');
    fs.writeFileSync(file, bundle());
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }),
      'the shipped bundle does not parse — one typo in any module kills the whole game');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no module declares a global that another module already declared', () => {
  const seen = new Map();
  const dup = [];
  for (const f of ORDER) {
    for (const m of read(f).matchAll(/^(?:const|let|class|function)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      if (seen.has(name)) dup.push(`${name} (${seen.get(name)} + ${f})`);
      else seen.set(name, f);
    }
  }
  assert.deepEqual(dup, [], 'duplicate top-level declarations break the single-script bundle');
});

test('browser sources never use Node-only APIs', () => {
  for (const f of ORDER) {
    const src = read(f);
    assert.equal(/\brequire\s*\(/.test(src), false, `${f} calls require() — not defined in a page`);
    assert.equal(/\bmodule\.exports\b/.test(src), false, `${f} uses module.exports`);
    assert.equal(/\b__dirname\b|\bprocess\.env\b/.test(src), false, `${f} uses a Node global`);
  }
});

test('every V3/Q/M4 helper the game calls actually exists', () => {
  const ctx = vm.createContext({ Math });
  vm.runInContext(read('10_math.js') + '\n;globalThis.api={V3,Q,M4};', ctx);
  const { V3, Q, M4 } = ctx.api;
  const calls = { V3: new Map(), Q: new Map(), M4: new Map() };
  for (const f of ORDER) {
    for (const m of read(f).matchAll(/\b(V3|Q|M4)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      const [, ns, name] = m;
      if (!calls[ns].has(name)) calls[ns].set(name, f);
    }
  }
  for (const [ns, api] of Object.entries({ V3, Q, M4 })) {
    for (const [name, file] of calls[ns]) {
      assert.equal(typeof api[name], 'function', `${file} calls ${ns}.${name}(), which does not exist`);
    }
  }
});

test('every AudioEngine member the rest of the game calls is defined', () => {
  const audioSrc = read('50_audio.js');
  const defined = methodNames(audioSrc, 'AudioEngine');
  const used = new Map();
  for (const f of ORDER) {
    const src = read(f);
    for (const m of src.matchAll(/\baudio\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!used.has(m[1])) used.set(m[1], f);
    }
  }
  for (const [name, file] of used) {
    assert.ok(defined.has(name), `${file} calls audio.${name}(), but AudioEngine has no such method`);
  }
  // The accessors the music system depends on, named explicitly: they were
  // referenced for months without existing.
  for (const name of ['getCtx', 'getBus', 'slowIn', 'slowOut'])
    assert.ok(defined.has(name), `AudioEngine.${name}() is gone`);
});

test('emotion callbacks talk to the game, not to the state snapshot', () => {
  const src = read('76_emotion.js');
  for (const fn of ['_onWinner', '_onNetCord', '_onEdge']) {
    const start = src.indexOf(fn + '(g) {');
    assert.ok(start >= 0, `${fn} is missing`);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    assert.equal(/\bg\.(msg|hitFlash)\b/.test(body), false,
      `${fn} writes to the snapshot it receives instead of this.game`);
  }
});

test('bullet-time audio follows the slow-motion state, not the keypress', () => {
  const src = read('70_game.js');
  const hold = src.slice(src.indexOf('setSlowmoHold(v) {'), src.indexOf('slowmoAvailable() {'));
  assert.equal(/slowIn|slowOut/.test(hold), false,
    'setSlowmoHold() runs on every key event and latched the low-pass on for the whole match');
  const upd = src.slice(src.indexOf('updateSlowmo(dtReal) {'), src.indexOf('setSlowmoAllowed(v) {'));
  assert.match(upd, /slowIn/, 'updateSlowmo() must enable the bullet-time filter');
  assert.match(upd, /slowOut/, 'updateSlowmo() must release the bullet-time filter');
});
