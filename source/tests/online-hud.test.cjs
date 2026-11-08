'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');

test('online scores use the application HUD, including guest-side updates and stale-packet rejection', async t => {
  const browser = await launchBrowser();
  const { page, errors } = await pageFixture(t, browser, ['online']);
  t.after(() => browser.close());
  await page.evaluate(() => fixture.Router.go('online'));
  const result = await page.evaluate(() => {
    const send = fixture.emitHost;
    send({ type: 'net', st: 'match', room: 'ABCDE', side: -1, latency: 25 });
    const snapshot = { schema: 1, matchId: 'online-1', seq: 1, rallyId: 4, serveId: 5,
      visible: true, free: false, staminaEnabled: false, phase: 'RALLY', score: [7, 4],
      target: 11, server: -1, paused: false, players: [], contacts: [null, null], whiffs: [null, null] };
    send({ type: 'onlineHud', snapshot });
    const root = document.querySelector('.net-hud-slot .match-hud');
    const scores = () => [...document.querySelectorAll('.net-hud-slot .match-hud-score')].map(el => el.textContent);
    const first = scores();
    send({ type: 'onlineHud', snapshot: { ...snapshot, seq: 0, score: [0, 0] } });
    const stale = scores();
    send({ type: 'onlineHud', snapshot: { ...snapshot, seq: 2, score: [8, 4], server: 1 } });
    send({ type: 'net', st: 'match', room: 'ABCDE', side: -1, latency: 31 });
    const next = scores(), stable = root === document.querySelector('.net-hud-slot .match-hud');
    const interactive = getComputedStyle(document.querySelector('.net-exit')).pointerEvents;
    send({ type: 'matchEnd', won: true, score: [11, 4] });
    return { first, stale, next, stable, interactive,
      goneAfterResult: !document.querySelector('.net-hud-slot'),
      legacy: !!document.querySelector('#score,#rally,#mpInd') };
  });
  assert.deepEqual(result.first, ['7', '4']);
  assert.deepEqual(result.stale, ['7', '4']);
  assert.deepEqual(result.next, ['8', '4']);
  assert.equal(result.stable, true, 'status polls must not rebuild or replay the score HUD');
  assert.equal(result.interactive, 'auto', 'exit remains usable over the game canvas');
  assert.equal(result.goneAfterResult, true);
  assert.equal(result.legacy, false);
  assert.deepEqual(errors, []);
});
