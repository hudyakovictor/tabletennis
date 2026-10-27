const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* README contract: the root `play/index.html` IS the shell build
 * (`source/index.html`), copied verbatim. A bare engine build dropped there
 * looks like an older, unrelated interface — no hub, no shop, no career — and
 * that is exactly what shipped once. Pin it. */
const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';

test('play/index.html is the shell build, byte-identical to source/index.html', () => {
  const shell = read('source/index.html');
  const play = read('play/index.html');
  assert.equal(sha(play), sha(shell),
    'play/index.html diverged from source/index.html: rebuild with `python3 source/build.py && cp source/index.html play/index.html`');
  assert.match(title(shell.toString('utf8')), /Table Tennis Ultimate/);
});

test('the shipped shell embeds the current engine, not a stale copy', () => {
  const html = read('play/index.html').toString('utf8');
  // The engine is embedded as an escaped JSON string (one line), so count
  // occurrences, not matching lines.
  const count = (needle) => html.split(needle).length - 1;
  assert.ok(count('solveStrikeCorridor') >= 1, 'shell build carries no contact corridor engine');
  assert.ok(count('forceZ') >= 4, 'shell build predates press depth ownership (forceZ)');
  assert.ok(count('missReason') >= 4, 'shell build predates the miss-reason classifier');

  const engine = read('source/game/table-tennis-topspin.html').toString('utf8');
  assert.equal(count('forceZ'), engine.split('forceZ').length - 1,
    'the embedded engine and the standalone engine build disagree — rebuild both');
  assert.equal(count('missReason'), engine.split('missReason').length - 1,
    'the embedded engine and the standalone engine build disagree — rebuild both');
});
