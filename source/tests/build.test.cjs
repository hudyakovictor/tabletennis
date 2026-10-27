const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* Layout contract (README «Запуск»):
 *
 *   play/index.html   — ЕДИНСТВЕННЫЙ готовый HTML: оболочка + встроенный движок
 *   source/…          — только исходники; собранных страниц там нет
 *
 * Раньше в репозитории лежали ещё три копии сборки (source/index.html,
 * source/game/table-tennis-topspin.html, source/game/play/index.html) и папка
 * старых версий play/_versions — 25 МБ дублей, в которых невозможно было
 * понять, какая версия настоящая. Эти тесты держат каталог чистым. */
const repo = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(repo, rel));
const exists = (rel) => fs.existsSync(path.join(repo, rel));
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const count = (hay, needle) => hay.split(needle).length - 1;

test('play/ holds exactly one HTML, and it is the shell build', () => {
  const html = fs.readdirSync(path.join(repo, 'play')).filter((f) => f.endsWith('.html'));
  assert.deepEqual(html, ['index.html'], 'play/ must contain only index.html — old builds belong in git history');

  const page = read('play/index.html').toString('utf8');
  assert.match(title(page), /Table Tennis Ultimate/,
    'play/index.html is not the shell build (title should be the TUI shell, not the bare engine page)');
  assert.ok(page.length > 2_000_000, `shell build is unexpectedly small: ${page.length} bytes`);
  // The shell embeds the engine as an escaped JSON string inside one line.
  assert.equal(count(page, 'const GAME_HTML = '), 1, 'shell build must embed exactly one engine');
});

test('source/ holds sources only — no generated HTML builds', () => {
  const leftovers = [
    'source/index.html',                       // build output of source/build.py
    'source/game/table-tennis-topspin.html',   // standalone engine build
    'source/game/play/index.html',             // old duplicate of the engine build
    'play/_versions',                          // archived versions
  ];
  for (const rel of leftovers) assert.equal(exists(rel), false, `${rel} must not exist`);
});

test('the shipped engine is the current one, not a stale copy', () => {
  const page = read('play/index.html').toString('utf8');
  assert.ok(count(page, 'solveStrikeCorridor') >= 1, 'shell build carries no contact corridor engine');
  assert.ok(count(page, 'forceZ') >= 4, 'shell build predates press depth ownership (forceZ)');
  assert.ok(count(page, 'missReason') >= 4, 'shell build predates the miss-reason classifier');
});

test('play/index.html is up to date with source/ (rebuild and compare)', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ttu-build-')), 'index.html');
  execFileSync('python3', [path.join(repo, 'source', 'build.py'), tmp], { stdio: 'pipe' });
  const clean = (s) => s.replace(/self-contained build \d{4}-\d{2}-\d{2}/g, 'self-contained build DATE');
  const built = clean(fs.readFileSync(tmp, 'utf8'));
  const shipped = clean(read('play/index.html').toString('utf8'));
  assert.equal(shipped.length, built.length, 'play/index.html differs in size from a fresh build');
  assert.equal(shipped === built, true,
    'play/index.html is stale: run `python3 source/build.py` after changing anything in source/');
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
