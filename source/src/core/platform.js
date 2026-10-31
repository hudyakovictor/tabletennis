/* ---------- Telegram WebApp (по спецификации Mini Apps) ---------- */
const TGX = {
  _bound: null, _events: [], _backVisible: false, _orientationT: 0, _sdkPromise: null, _sdkCancel: null,
  get w() { return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null; },
  get inTG() { const w = this.w; return !!(w && w.platform && w.platform !== 'unknown'); },
  mob() { const w = this.w; return !!(w && ['android', 'ios'].includes(w.platform)); },
  /* safe-area = сумма системных вырезов (safeAreaInset) и интерфейса Telegram
     (contentSafeAreaInset); сверху и снизу считаем независимо */
  _insets() {
    const w = this.w; const c = (w && w.contentSafeAreaInset) || {}; const s = (w && w.safeAreaInset) || {};
    document.documentElement.style.setProperty('--tgt', ((c.top || 0) + (s.top || 0)) + 'px');
    document.documentElement.style.setProperty('--tgb', ((c.bottom || 0) + (s.bottom || 0)) + 'px');
    document.documentElement.style.setProperty('--tglr', ((c.left || 0) + (s.left || 0)) + 'px');
  },
  telegramEnv() {
    if (this.inTG) return true;
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      const platform = params.get('tgWebAppPlatform');
      return !!(platform && platform !== 'unknown' && params.has('tgWebAppData'));
    } catch (e) { return false; }
  },
  load() {
    if (this.w) { this.init(); return Promise.resolve(true); }
    if (!this.telegramEnv()) return Promise.resolve(false);
    if (this._sdkPromise) return this._sdkPromise;
    this._sdkPromise = new Promise((resolve) => {
      const script = document.createElement('script'); script.src = 'https://telegram.org/js/telegram-web-app.js'; script.async = true;
      let timer = 0;
      const finish = (loaded) => {
        if (!this._sdkCancel) return;
        this._sdkCancel = null; clearTimeout(timer); script.removeEventListener('load', ready); script.removeEventListener('error', failed);
        if (loaded) this.init(); else script.remove();
        resolve(loaded);
      };
      const ready = () => finish(!!this.w), failed = () => finish(false);
      this._sdkCancel = () => finish(false);
      script.addEventListener('load', ready); script.addEventListener('error', failed);
      timer = setTimeout(failed, 10000);
      document.head.appendChild(script);
    });
    return this._sdkPromise;
  },
  _disposeBindings() {
    clearTimeout(this._orientationT); this._orientationT = 0;
    const w = this._bound; if (!w) return;
    this._bound = null;
    this._events.forEach((event) => { try { w.offEvent && w.offEvent(event, this._onInsets); } catch (e) {} }); this._events = [];
    try { if (w.BackButton && w.BackButton.offClick) w.BackButton.offClick(this._onBack); } catch (e) {}
    this._onInsets = null; this._onBack = null;
  },
  dispose() {
    this._disposeBindings();
    if (this._sdkCancel) this._sdkCancel();
    this._sdkPromise = null;
  },
  init() {
    const w = this.w; if (!w) return false;
    if (this._bound === w) { this._insets(); return true; }
    this._disposeBindings(); this._bound = w;
    this._onInsets = () => { if (this._bound === w) this._insets(); };
    this._onBack = () => { if (this._bound === w) Router.back(); };
    try {
      w.ready(); w.expand();
      if (w.disableVerticalSwipes) w.disableVerticalSwipes();      // свайп-закрытие не должно ронять розыгрыш
      if (w.setHeaderColor) w.setHeaderColor('#05060F');
      if (w.setBackgroundColor) w.setBackgroundColor('#05060F');
      if (w.setBottomBarColor) w.setBottomBarColor('#05060F');
      const u = w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && u.first_name) { S.name = (u.first_name + ' ' + (u.last_name || '')).trim(); if (u.username) S.nick = '@' + u.username; }
    } catch (e) {}
    this._insets();
    ['contentSafeAreaChanged', 'safeAreaChanged', 'fullscreenChanged', 'viewportChanged'].forEach((event) => {
      try { if (w.onEvent) { w.onEvent(event, this._onInsets); this._events.push(event); } } catch (e) {}
    });
    try { if (w.BackButton) w.BackButton.onClick(this._onBack); } catch (e) {}
    this.back(this._backVisible);
    return true;
  },
  back(show) { this._backVisible = !!show; const w = this.w; if (!w || !w.BackButton) return; try { show ? w.BackButton.show() : w.BackButton.hide(); } catch (e) {} },
  /* иммерсивный полноэкранный режим. Вход — только по жесту пользователя
     (только так клиенты его принимают); вызываем из обработчика «В бой». */
  fullscreen(on) {
    const w = this.w; if (!w || !this.inTG) return;
    try {
      if (on) {
        if (!w.isFullscreen && w.requestFullscreen) w.requestFullscreen();
        // lockOrientation фиксирует ТЕКУЩУЮ ориентацию — лочим только в портрете,
        // иначе зафиксируем случайный ландшафт. Десктопу ориентацию не трогаем.
        if (this.mob() && w.lockOrientation && !w.isOrientationLocked && window.innerHeight >= window.innerWidth) {
          clearTimeout(this._orientationT);
          this._orientationT = setTimeout(() => { this._orientationT = 0; if (this.w === w) try { w.lockOrientation(); } catch (e) {} }, 150);
        }
      } else {
        clearTimeout(this._orientationT); this._orientationT = 0;
        if (this.mob() && w.unlockOrientation && w.isOrientationLocked) { try { w.unlockOrientation(); } catch (e) {} }
        if (w.isFullscreen && w.exitFullscreen) { try { w.exitFullscreen(); } catch (e) {} }
      }
    } catch (e) {}
  },
  /* десктопный браузер: настоящий fullscreen страницы (в Telegram полноэкранностью
     управляет клиент — там делегируем TGX.fullscreen). Матч на широком экране при
     этом растягивается CSS-правилом body.in-game (css/base.css). */
  toggleFullscreen() {
    if (this.inTG) { this.fullscreen(true); return; }
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    } catch (e) {}
  },
  /* защита от случайного закрытия во время матча/обучения (Bot API 7.10+) */
  guard(on) {
    const w = this.w; if (!w) return;
    try { if (on) { if (w.enableClosingConfirmation) w.enableClosingConfirmation(); } else if (w.disableClosingConfirmation) w.disableClosingConfirmation(); } catch (e) {}
  }
};

/* ---------- хаптика ---------- */
function haptic(kind = 'light') {
  if (!S.vibro) return;
  const w = TGX.w;
  try {
    if (w && w.HapticFeedback && TGX.inTG) {
      if (kind === 'success' || kind === 'error' || kind === 'warning') w.HapticFeedback.notificationOccurred(kind);
      else if (kind === 'select') w.HapticFeedback.selectionChanged();
      else w.HapticFeedback.impactOccurred(kind); // light | medium | heavy | rigid | soft
    } else if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
      // браузер блокирует вибрацию до первого касания и пишет предупреждение в консоль — не дёргаем зря
      navigator.vibrate({ light: 6, select: 4, soft: 8, medium: 14, rigid: 10, heavy: 24, success: [10, 40, 18], error: [24, 40, 24], warning: 16 }[kind] || 8);
    }
  } catch (e) {}
}
