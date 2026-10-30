const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./helpers.cjs');

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
