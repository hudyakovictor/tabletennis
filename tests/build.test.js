const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./helpers.cjs');
test('both published HTML files match a fresh lab build', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'topspin-build-'));
  try {
    const out=path.join(dir,'game.html');
    execFileSync('python3',[path.join(root,'tt/lab_build.py'),out]);
    const normalize=s=>s.replace(/built \d{4}-\d{2}-\d{2}/g,'built DATE');
    const expected=normalize(fs.readFileSync(out,'utf8'));
    for(const file of ['play/index.html','table-tennis-topspin.html'])
      assert.equal(normalize(fs.readFileSync(path.join(root,file),'utf8')),expected,`${file} is stale; run npm run build`);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('standalone bundle parses as a browser script (no duplicate declarations or broken class methods)', () => {
  const vm = require('node:vm');
  for (const file of ['play/index.html', 'table-tennis-topspin.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0);
    for (const [, source] of scripts) assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
});
