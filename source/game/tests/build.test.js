const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { root, repo, appPage } = require('./helpers.cjs');

const freshApp = () => fs.readFileSync(appPage(), 'utf8');
function embeddedFrame(html) {
  const declaration = html.match(/^const GAME_HTML = (".*");$/m);
  assert.ok(declaration, 'the full application must contain its canvas frame');
  return JSON.parse(declaration[1]);
}

test('canonical build contains the modern application and its self-contained canvas frame', () => {
  const html = freshApp(), frame = embeddedFrame(html);
  assert.ok(html.length > 200000);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(html, /\/\*__(?:CSS|JS)__\*\/|<!--__PRELOADER__-->/);
  assert.match(html, /id="device"/);
  assert.match(html, /id="gamelayer"/);
  assert.match(html, /const GameHost =/);
  assert.match(frame, /<canvas\b[^>]*id="gl"/);
  assert.match(frame, /<canvas\b[^>]*id="fx"/);
  const markup = frame.slice(0, frame.indexOf('<script>'));
  const body = markup.match(/<body>([\s\S]*)/)?.[1];
  assert.ok(body, 'embedded frame body missing');
  assert.deepEqual([...body.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]).sort(), ['app', 'fx', 'gl']);
  assert.doesNotMatch(markup, /id=["'](?:menu|settings|loading|hud|playband|topright|shotLab|pauseInd|career|online)["']/);
  assert.doesNotMatch(markup, /brand-logo|splash-brand|TOPSPIN\s+ARENA/i);
});

test('application and embedded frame scripts parse without duplicate declarations', () => {
  const html = freshApp();
  for (const [name, document] of [['application', html], ['frame', embeddedFrame(html)]]) {
    const scripts = [...document.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, `${name} scripts missing`);
    for (const [, source] of scripts) assert.doesNotThrow(() => new vm.Script(source, { filename: name }));
  }
});

test('the embedded frame has exactly one copy of each physics configuration', () => {
  const frame = embeddedFrame(freshApp());
  for (const symbol of ['STROKE_CONFIG', 'MATCH_RULES', 'PH']) {
    assert.equal([...frame.matchAll(new RegExp(`\\bconst ${symbol}\\s*=`, 'g'))].length, 1, symbol);
  }
});

test('old and internal CLIs cannot produce a standalone engine artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-no-engine-'));
  try {
    for (const script of ['tt/build.py', 'tt/_bundle.py']) {
      const artifact = path.join(dir, 'engine.html');
      const result = spawnSync('python3', [path.join(root, script), artifact], { cwd: dir, encoding: 'utf8' });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0, `${script} must reject standalone builds`);
      assert.equal(fs.existsSync(artifact), false, `${script} wrote a standalone page`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('npm build invokes only the canonical application builder', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.build, 'python3 ../build.py');
});

/* ------------------------------------------------------------------ *
 * Свежесть закоммиченного бандла.
 *
 * Раньше сборка уезжала во временный файл и ни с чем не сверялась, из-за
 * чего устаревший `play/index.html` спокойно жил в репозитории и ломал e2e.
 * Теперь тест собирает приложение заново и сверяет байты и fingerprint
 * `SHELL_BUILD` с закоммиченным файлом.
 * ------------------------------------------------------------------ */
const COMMITTED = path.join(repo, 'play/index.html');

/* TT_API_BASE вшивается на деплое: при сверке нормализуем его, иначе тест
 * падал бы от одной переменной окружения. Всё остальное — побайтово. */
const normalize = (html) => html.replace(/const TT_API_BASE = [^\n]*;/, 'const TT_API_BASE = "";');

const fingerprint = (html) => {
  const m = html.match(/const SHELL_BUILD = "([^"]+)"/);
  return m ? m[1] : null;
};

test('committed play/index.html is byte-identical to a fresh build', () => {
  assert.ok(fs.existsSync(COMMITTED), 'play/index.html must be committed');
  const committed = fs.readFileSync(COMMITTED, 'utf8');
  const fresh = freshApp();
  const hi = crypto.createHash('sha256').update(normalize(committed)).digest('hex');
  const hf = crypto.createHash('sha256').update(normalize(fresh)).digest('hex');
  assert.equal(hi, hf,
    `play/index.html устарел: пересобери его из исходников (python3 source/build.py).\n` +
    `  закоммичен ${hi.slice(0, 16)} (${committed.length} байт)\n` +
    `  свежая сборка ${hf.slice(0, 16)} (${fresh.length} байт)`);
});

test('the shell fingerprint in the committed bundle matches the sources', () => {
  const committed = fs.readFileSync(COMMITTED, 'utf8');
  const fresh = freshApp();
  const a = fingerprint(committed), b = fingerprint(fresh);
  assert.match(a || '', /^shell [0-9a-f]{12}$/, 'SHELL_BUILD missing in play/index.html');
  assert.equal(a, b, 'SHELL_BUILD differs: the committed bundle was built from other sources');
});

test('every canvas-frame stylesheet, including technique preview, is in the application', () => {
  const html = embeddedFrame(freshApp());
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(css, 'engine style block is missing');
  const src = path.join(root, 'tt/src');
  for (const file of fs.readdirSync(src).filter(name => name.endsWith('.css'))) {
    assert.ok(css.includes(fs.readFileSync(path.join(src, file), 'utf8')), `${file} missing from bundled engine`);
  }
});
