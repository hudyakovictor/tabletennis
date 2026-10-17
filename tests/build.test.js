const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { root } = require('./helpers.cjs');
test('both published HTML files match a fresh source build', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'topspin-build-'));
  try {
    const out=path.join(dir,'game.html');
    execFileSync('python3',[path.join(root,'tt/build.py'),out]);
    const normalize=s=>s.replace(/self-contained build \d{4}-\d{2}-\d{2}/g,'self-contained build DATE');
    const expected=normalize(fs.readFileSync(out,'utf8'));
    for(const file of ['play/index.html','table-tennis-topspin.html'])
      assert.equal(normalize(fs.readFileSync(path.join(root,file),'utf8')),expected,`${file} is stale; run npm run build`);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
