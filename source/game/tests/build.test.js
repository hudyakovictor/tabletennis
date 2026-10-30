const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { root } = require('./helpers.cjs');
const repo = path.resolve(root, '../..');

/* В новой версии игра не публикуется отдельным файлом: её собирает
 * ttu-v2/build.py и вшивает в мини-приложение. Поэтому проверяем свежую
 * сборку из исходников, а не закоммиченные копии. */
function freshBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-build-'));
  const out = path.join(dir, 'game.html');
  execFileSync('python3', [path.join(root, 'tt/build.py'), out], { stdio: 'pipe' });
  const html = fs.readFileSync(out, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return html;
}

test('fresh source build is self-contained (no template placeholders left)', () => {
  const html = freshBuild();
  assert.ok(html.length > 200000);
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /id="gl"/);
});

test('standalone bundle parses as a browser script (no duplicate declarations or broken class methods)', () => {
  const vm = require('node:vm');
  const html = freshBuild();
  const firstModule = html.indexOf('/* ====== ');
  assert.ok(firstModule > 0);
  assert.equal(html.indexOf('/* ====== 05_stroke_config.js ====== */'), firstModule);
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) assert.doesNotThrow(() => new vm.Script(source, { filename: 'game.html' }));
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

function freshApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-app-'));
  const out = path.join(dir, 'index.html');
  execFileSync('python3', [path.join(repo, 'source/build.py'), out],
    { stdio: 'pipe', env: { ...process.env, TT_API_BASE: '' } });
  const html = fs.readFileSync(out, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return html;
}

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
