const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./helpers.cjs');

const PUBLISHED = ['play/index.html', 'table-tennis-topspin.html'];

/** Pull the inline <script> out of a built page. */
function inlineScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no inline <script> found in the page');
  return m[1];
}

/** Parse-check a script with node itself. */
function parses(script, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-parse-'));
  const file = path.join(dir, 'bundle.js');
  try {
    fs.writeFileSync(file, script, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      const out = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
      assert.fail(`${label} does not parse as JavaScript:\n${out.trim()}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('both published HTML files match a fresh source build', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'topspin-build-'));
  try {
    const out=path.join(dir,'game.html');
    execFileSync('python3',[path.join(root,'tt/build.py'),out]);
    const normalize=s=>s.replace(/self-contained build \d{4}-\d{2}-\d{2}/g,'self-contained build DATE');
    const expected=normalize(fs.readFileSync(out,'utf8'));
    for(const file of PUBLISHED)
      assert.equal(normalize(fs.readFileSync(path.join(root,file),'utf8')),expected,`${file} is stale; run npm run build`);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

/* The bundle is ONE script. A single syntax error in a single source file
 * therefore takes down the whole page, and boot() turns the resulting
 * ReferenceError into the "WebGL недоступен" screen — which is exactly
 * what three files managed to do at once. The test above cannot see it:
 * it compares two copies of the same broken artifact. This one parses the
 * artifact that is actually published. */
test('every published page contains a script that parses', () => {
  for (const file of PUBLISHED) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    parses(inlineScript(html), file);
  }
});

test('a fresh build contains a script that parses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-build-'));
  try {
    const out = path.join(dir, 'game.html');
    execFileSync('python3', [path.join(root, 'tt/build.py'), out]);
    parses(inlineScript(fs.readFileSync(out, 'utf8')), 'fresh build');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* The builder must not be able to publish an unparseable page even when
 * it is run by hand. */
test('the builder refuses to write a bundle that does not parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-broken-'));
  try {
    const src = path.join(dir, 'src');
    const assets = path.join(dir, 'assets');
    fs.cpSync(path.join(root, 'tt/src'), src, { recursive: true });
    fs.cpSync(path.join(root, 'tt/assets'), assets, { recursive: true });
    fs.copyFileSync(path.join(root, 'tt/build.py'), path.join(dir, 'build.py'));
    // a duplicated top-level const is a parse error, and the exact class
    // of bug that shipped three times in a row
    fs.appendFileSync(path.join(src, '70_game.js'), '\nconst DEG = Math.PI / 180;\n');
    const out = path.join(dir, 'broken.html');
    let failed = false;
    try {
      execFileSync('python3', [path.join(dir, 'build.py'), out], { stdio: 'pipe' });
    } catch (err) {
      failed = true;
      const stderr = err.stderr ? err.stderr.toString() : '';
      assert.match(stderr, /does not parse/, 'the builder should explain why it refused');
    }
    assert.ok(failed, 'the builder must fail on an unparseable bundle');
    assert.equal(fs.existsSync(out), false, 'the builder must not write a broken artifact');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
