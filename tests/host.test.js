const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./helpers.cjs');
const src = (f) => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8');

/* ===================== removed, not hidden ============================== *
 * Slow motion and the «ЗАЩИТА» button were both workarounds: one for the
 * feel of a hard shot, one for a gesture Telegram steals. A button that is
 * merely hidden still occupies the corner, still ships its CSS, and still
 * invites somebody to wire it back up. So the rule here is the rule the
 * replay code already follows: the API is gone.
 * ======================================================================== */
test('slow-motion mode is gone from the game, the UI and the bundle', () => {
  for (const f of ['70_game.js', '80_ui.js', '25_career.js', '02_body.html', '05_style.css'])
    assert.ok(!/slowmo|slow-mo|setSlowmoHold|is-slow/i.test(src(f)), `${f} still mentions slow motion`);
  assert.ok(!/timeScale|targetTimeScale/.test(src('70_game.js')), 'a scaled clock is a slow-mo mode by another name');
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '70_game.js', '80_ui.js'],
    ['Game', 'UI']);
  for (const name of ['punchSlowmo', 'setSlowmoHold', 'slowmoAvailable', 'updateSlowmo', 'setSlowmoAllowed'])
    assert.equal(typeof lib.Game.prototype[name], 'undefined', `${name} must not exist`);
  assert.equal(typeof lib.Game.prototype.update, 'function', 'the game itself is intact');
});

test('the defend button is gone; the swipe is not replaced by a fake gesture', () => {
  const body = src('02_body.html');
  assert.ok(!body.includes('id="defend"'), 'the button is not in the markup');
  assert.ok(!/defend-btn/.test(src('05_style.css')), 'nor is its styling');
  assert.ok(!/defendHeld/.test(src('70_game.js')), 'no synthetic BLOCK gesture is injected');
  assert.ok(!/defendHeld|defendBtn/.test(src('80_ui.js')));
  /* The synthetic gesture it fed the pipeline was also dead on arrival: `m`
   * is a const, so holding the button threw "Assignment to constant variable"
   * in the strict-mode bundle. Nothing was ever lost by deleting it. */
  assert.ok(/const sw = this\.swipe, m = this\.playerStrokeIntent\(serveCtx\)/.test(src('70_game.js')));
});

/* ===================== the host: Telegram and the page guard ============ */
function hostLib() {
  return load(['10_math.js', '44_host.js'],
    ['telegramWebApp', 'telegramSupports', 'applyHostBehavior', 'touchLandsInScroller', 'installHostTouchGuard']);
}

test('outside Telegram the host layer does nothing and says so', () => {
  const { applyHostBehavior, telegramWebApp } = hostLib();
  assert.equal(telegramWebApp({}), null);
  const r = applyHostBehavior({});
  assert.equal(r.telegram, false);
  assert.equal(r.swipe, 'page only');
  assert.equal(r.expanded, false);
  assert.doesNotThrow(() => applyHostBehavior(undefined));
});

test('a Mini App is asked to stop closing on a vertical swipe', () => {
  const { applyHostBehavior } = hostLib();
  const calls = [];
  const win = { Telegram: { WebApp: {
    version: '8.2', ready: () => calls.push('ready'), expand: () => calls.push('expand'),
    setupSwipeBehavior: (o) => calls.push(['swipe', o]),
  } } };
  const r = applyHostBehavior(win);
  assert.equal(r.telegram, true);
  assert.equal(r.expanded, true);
  assert.equal(r.swipe, 'setupSwipeBehavior');
  assert.deepEqual(calls[0], 'ready');
  assert.deepEqual(calls[1], 'expand');
  const opts = calls[2][1];
  assert.equal(opts.allowVerticalSwipe, false, 'camelCase for the typed SDK');
  assert.equal(opts.allow_vertical_swipe, false, 'snake_case for the injected script');
});

test('an older client gets the deprecated call, and a broken SDK cannot break boot', () => {
  const { applyHostBehavior, telegramSupports } = hostLib();
  const legacy = { Telegram: { WebApp: {
    isVersionAtLeast: (v) => v !== '7.7',      // too old for setupSwipeBehavior
    disableVerticalSwipe: () => { legacy.used = true; },
  }, } };
  const report = applyHostBehavior(legacy);
  assert.equal(legacy.used, true, 'disableVerticalSwipe is the pre-7.7 route');
  assert.equal(report.swipe, 'disableVerticalSwipe');
  assert.equal(telegramSupports({ isVersionAtLeast: () => { throw new Error('nope'); } }, '7.7'), false);
  // an SDK that throws on every call must still leave a working page
  const broken = { Telegram: { WebApp: { ready() { throw new Error('x'); }, expand() { throw new Error('x'); },
    setupSwipeBehavior() { throw new Error('x'); } } } };
  assert.doesNotThrow(() => applyHostBehavior(broken));
});

const el = (props) => ({ nodeType: 1, getAttribute: (k) => (props.attrs || {})[k] ?? null, ...props });

test('the touch guard blocks the play surface and never a scrollable panel', () => {
  const { touchLandsInScroller, installHostTouchGuard } = hostLib();
  const scroller = el({ tagName: 'DIV', style: { overflowY: 'auto' }, scrollHeight: 900, clientHeight: 300 });
  const card = el({ tagName: 'DIV', parentElement: scroller });
  assert.equal(touchLandsInScroller(card), true, 'a touch inside a scrolling card scrolls the card');
  assert.equal(touchLandsInScroller(el({ tagName: 'CANVAS', parentElement: el({ tagName: 'BODY' }) })), false);
  assert.equal(touchLandsInScroller(el({ tagName: 'DIV', style: { overflowY: 'auto' }, scrollHeight: 100, clientHeight: 100 })),
    false, 'overflow:auto that cannot scroll is not a reason to unblock');
  assert.equal(touchLandsInScroller(el({ tagName: 'DIV', attrs: { 'data-scroll-ok': '' }, style: {} })), true,
    'the markup can opt a subtree in explicitly');

  const listeners = [];
  const doc = {
    addEventListener: (t, fn, o) => listeners.push({ t, fn, o }),
    removeEventListener: (t, fn) => { const i = listeners.findIndex(l => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    body: { style: {} }, documentElement: { style: {} },
  };
  let prevented = 0;
  const event = (target, cancelable = true) => ({ target, cancelable, preventDefault: () => prevented++ });
  const detach = installHostTouchGuard({ document: doc }, doc);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].o.passive, false, 'a passive listener cannot preventDefault');
  doc.listeners = listeners;
  listeners[0].fn.call(null, event(el({ tagName: 'CANVAS' })));
  assert.equal(prevented, 1, 'the play surface is guarded');
  listeners[0].fn.call(null, event(card));
  assert.equal(prevented, 1, 'the settings card still scrolls');
  listeners[0].fn.call(null, event(el({ tagName: 'CANVAS' }), false));
  assert.equal(prevented, 1, 'a non-cancelable event is not touched');
  assert.equal(doc.body.style.overscrollBehavior, 'none');
  detach();
  assert.equal(listeners.length, 0, 'the guard is detachable');
});
