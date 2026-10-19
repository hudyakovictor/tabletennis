/* =====================================================================
 *  HOST — the thing the game is running inside: a plain browser tab, an
 *  embedded WebView, or a Telegram Mini App.
 *
 *  Two problems live here, and they are not the same problem:
 *
 *  1. A vertical swipe can be *stolen by the browser* (pull-to-refresh,
 *     rubber-band, overscroll navigation). That is CSS and it is already
 *     solved globally: `html,body{overflow:hidden}`, `overscroll-behavior:
 *     none`, and `touch-action:none` on the canvas, which is the only place
 *     the game reads swipes from. Panels keep scrolling for themselves.
 *
 *  2. A vertical swipe can be *stolen by the host app*: Telegram iOS/Android
 *     close the Mini App when the user drags the whole sheet down. No amount
 *     of preventDefault() inside the page stops that, because the gesture is
 *     recognised natively, on the container, not by the page. The only real
 *     answer is to ask the client to switch it off —
 *     `web_app_setup_swipe_behavior { allow_vertical_swipe: false }`, which
 *     the SDK exposes as `setupSwipeBehavior()` (v7.7+) and, before that, as
 *     `disableVerticalSwipe()` (v7.2+).
 *
 *  Everything below is best-effort and silent: outside Telegram there is
 *  nothing to call, and a page that throws at boot is worse than a page
 *  where a swipe can still close the window.
 * ===================================================================== */
'use strict';

/** The Telegram WebApp object, or null when this is not a Mini App. */
function telegramWebApp(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const tg = w && w.Telegram && w.Telegram.WebApp;
  return tg && typeof tg === 'object' ? tg : null;
}

/** Version gate. Clients that do not report a version are treated as
 *  modern: the SDK only exists in clients that already have these methods. */
function telegramSupports(tg, version) {
  if (!tg) return false;
  if (typeof tg.isVersionAtLeast === 'function') {
    try { return !!tg.isVersionAtLeast(version); } catch (_) { return false; }
  }
  if (typeof tg.supportsVersion === 'function') {
    try { return !!tg.supportsVersion(version); } catch (_) { return false; }
  }
  return true;
}

/**
 * Tell Telegram not to close the app on a downward swipe, and take the whole
 * window while we are at it (a half-height sheet renders the table tiny).
 *
 * @returns {{telegram:boolean, swipe:string, expanded:boolean}} what happened,
 *   so the debug overlay can say which protection is actually active.
 */
function applyHostBehavior(win) {
  const report = { telegram: false, swipe: 'page only', expanded: false };
  const tg = telegramWebApp(win);
  if (!tg) return report;
  report.telegram = true;
  try { if (typeof tg.ready === 'function') tg.ready(); } catch (_) { /* ignore */ }
  try {
    if (typeof tg.expand === 'function') { tg.expand(); report.expanded = true; }
  } catch (_) { /* ignore */ }
  /* Both spellings of the option: the classic injected script forwards its
   * object to `web_app_setup_swipe_behavior` almost verbatim, while the typed
   * SDK reads camelCase. Unknown keys are ignored by the clients. */
  const OFF = { allowVerticalSwipe: false, allow_vertical_swipe: false };
  try {
    if (typeof tg.setupSwipeBehavior === 'function' && telegramSupports(tg, '7.7')) {
      tg.setupSwipeBehavior(OFF);
      report.swipe = 'setupSwipeBehavior';
    } else if (typeof tg.disableVerticalSwipe === 'function') {
      tg.disableVerticalSwipe();
      report.swipe = 'disableVerticalSwipe';
    }
  } catch (_) { /* an old client may not answer — the page guard still holds */ }
  return report;
}

/**
 * Pure: does this touch belong to something that scrolls for itself?
 *
 * A blanket `preventDefault()` on every document touchmove does stop the
 * browser-level pull gesture — and it also freezes the menu, the settings
 * card, the workshop, the moment list: every `.card{overflow-y:auto}` in the
 * app. So the guard asks the panel first. Only `Element`-shaped input is
 * needed, which keeps this testable without a DOM.
 */
function touchLandsInScroller(target, canScroll) {
  const scrolls = canScroll || defaultCanScroll;
  let el = target, steps = 0;
  while (el && el.nodeType !== 9 && steps++ < 64) {
    const tag = el.tagName;
    if (tag === 'HTML' || tag === 'BODY') return false;
    // an explicit opt-out, for containers a computed style cannot describe
    if (el.getAttribute && el.getAttribute('data-scroll-ok') !== null) return true;
    if (scrolls(el)) return true;
    el = el.parentElement || el.parentNode;
  }
  return false;
}

function defaultCanScroll(el) {
  const win = typeof window !== 'undefined' ? window : null;
  const inline = (el.style && (el.style.overflowY || el.style.overflow)) || '';
  const computed = !inline && win && win.getComputedStyle
    ? (win.getComputedStyle(el) || {}).overflowY || '' : '';
  if (!/auto|scroll/.test(String(inline || computed))) return false;
  return (el.scrollHeight | 0) - (el.clientHeight | 0) > 1;
}

/**
 * The in-page half of the fix: keep the play surface from doing anything a
 * browser would interpret as a gesture (scroll, refresh, back-swipe), and
 * leave every scrollable panel alone. Returns a detach function, which the
 * tests use; nothing else in the game needs it.
 */
function installHostTouchGuard(win, doc) {
  const d = doc || (win && win.document) || (typeof document !== 'undefined' ? document : null);
  if (!d || !d.addEventListener) return function () {};
  const onMove = function (e) {
    if (!e.cancelable) return;
    if (touchLandsInScroller(e.target)) return;
    e.preventDefault();
  };
  d.addEventListener('touchmove', onMove, { passive: false });
  /* iOS rubber-bands the *body* even with overflow:hidden, and it does that
   * from touchstart, so the overscroll rule is set here as well as in CSS. */
  try {
    if (d.body) d.body.style.overscrollBehavior = 'none';
    if (d.documentElement) d.documentElement.style.overscrollBehavior = 'none';
  } catch (_) { /* ignore */ }
  return function () { d.removeEventListener('touchmove', onMove); };
}
