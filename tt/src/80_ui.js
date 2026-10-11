/* =====================================================================
 *  UI — HUD, menus, the 2D coaching layer.
 *
 *  Design rule for this file: the screen must never explain with text what
 *  it can show with a shape. One transient badge, one score, and the
 *  strike ring drawn straight onto the ball.
 * ===================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

class UI {
  constructor() {
    this.game = null;
    this.fx = $('#fx');
    this.fxg = this.fx.getContext('2d');
    this.shotTimer = 0;
    this.noteTimer = 0;
    this.ripples = [];
    this.ghostT = 0;
    this._pv = {};
    this._pv2 = {};
    this._cur = '';
    this.hasFinePointer = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    this.bindMenu();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  attach(game) {
    this.game = game;
    this.syncSettings();
    this.refreshMenuBits();
    this.game.analytics && this.game.analytics.send('session:start', {
      platform: this.game.platform.label, touch: this.game.platform.touch,
      level: this.game.profile.data.level, coins: this.game.profile.data.coins,
    });
  }

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    this.fx.width = Math.floor(window.innerWidth * d);
    this.fx.height = Math.floor(window.innerHeight * d);
    this.fx.style.width = window.innerWidth + 'px';
    this.fx.style.height = window.innerHeight + 'px';
    this.dpr = d;
  }

  /* ------------------------------ menu ---------------------------- */
  bindMenu() {
    $$('#menu .opt[data-diff]').forEach((b) => b.addEventListener('click', () => {
      $$('#menu .opt[data-diff]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      this.pendingDiff = +b.dataset.diff;
      if (this.game) this.game.audio.ui('click');
    }));
    $$('.opt[data-set]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.set, v = b.dataset.val;
      $$(`.opt[data-set="${k}"]`).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      this.applySetting(k, v);
    }));
    $$('input[type=range][data-set]').forEach((r) => r.addEventListener('input', () => {
      this.applySetting(r.dataset.set, +r.value);
    }));
    const startMatch = () => {
      const d = this.pendingDiff !== undefined ? this.pendingDiff : 2;
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.trainHide();
      this.game.training = null;
      this.game.analytics && this.game.analytics.send('match:start', { diff: d, mode: 'casual', assist: this.game.settings.assist });
      this.game.startMatch(d);
    };
    const startTrain = () => {
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.game.analytics && this.game.analytics.send('tutorial:start', {});
      this.game.startTraining();
    };
    $('#play').addEventListener('click', startMatch);
    $('#tdPlay').addEventListener('click', startMatch);
    $('#train0').addEventListener('click', startTrain);
    $('#tdAgain').addEventListener('click', startTrain);
    $('#trSkip').addEventListener('click', () => { const t = this.game.training; if (t) { t.skip(); this.game.audio.ui('click'); } });
    $('#trExit').addEventListener('click', () => {
      this.game.stopTraining();
      $('#menu').classList.add('on');
    });
    /* --- workshop / shop / daily --- */
    const wsOpen = (tab) => {
      this.game.audio.ui('click');
      this.game.analytics && this.game.analytics.send('ui:workshop', { tab: tab || 'racket' });
      $$('.screen').forEach((x) => x.classList.remove('on'));
      this.pick = null;                       // a fresh visit starts from what is fitted
      this.showWorkshop(tab || 'racket');
    };
    $('#wsOpen').addEventListener('click', () => wsOpen('racket'));
    $('#dailyOpen').addEventListener('click', () => wsOpen('daily'));
    $('#wsClose').addEventListener('click', () => {
      $('#workshop').classList.remove('on');
      $('#menu').classList.add('on');
      this.game.audio.ui('click');
    });
    $$('#workshop .tab').forEach((b) => b.addEventListener('click', () => this.showWorkshop(b.dataset.tab)));
    $('#wsEquip').addEventListener('click', () => this.equipSelection());
    $('#wsBuyCry').addEventListener('click', () => this.buySelectionCrystals());
    $('#adCoins').addEventListener('click', () => this.watchAd());
    $('#btnSettings').addEventListener('click', () => $('#settings').classList.toggle('on'));
    $('#setClose').addEventListener('click', () => $('#settings').classList.remove('on'));
    $('#camReset').addEventListener('click', () => this.game.camReset());
    $('#btnMenu').addEventListener('click', () => { this.game.stopTraining(); $('#menu').classList.add('on'); });
    $('#btnSound').addEventListener('click', () => {
      const g = this.game; g.settings.sound = !g.settings.sound;
      g.audio.setMuted(!g.settings.sound);
      $('#btnSound').innerHTML = g.settings.sound ? ICON.sound : ICON.mute;
    });
    /* slow-mo: press and hold, on a phone or on the keyboard */
    const slow = $('#slow');
    const hold = (v) => (e) => {
      if (e && e.cancelable) e.preventDefault();
      this.game && this.game.setSlowmoHold(v);
      if (v) this.game && this.game.audio.init();
    };
    slow.addEventListener('pointerdown', hold(true));
    slow.addEventListener('pointerup', hold(false));
    slow.addEventListener('pointerleave', hold(false));
    slow.addEventListener('pointercancel', hold(false));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' || e.key === ' ') this.game && this.game.setSlowmoHold(false);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Shift' || e.key === ' ') && !e.repeat && this.game && this.game.replayer.on) {
        this.game.skipReplay(); e.preventDefault(); return;
      }
      if ((e.key === 'Shift' || e.key === ' ') && !e.repeat) this.game && this.game.setSlowmoHold(true);
      if ((e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь')) this.showMoments();
    });
    $('#reelSkip').addEventListener('pointerdown', () => this.game && this.game.skipReplay());
    $('#reelsClose').addEventListener('click', () => { $('#reels').classList.remove('on'); this.game && this.game.audio.ui('click'); });
    $('#again').addEventListener('click', () => { $('#over').classList.remove('on'); this.game.restart(); });
    $('#backMenu').addEventListener('click', () => { $('#over').classList.remove('on'); $('#menu').classList.add('on'); });
  }

  /* -------------------------- best moments ------------------------- */

  /** A rally just got into the top list: say so, briefly, without pause. */
  flashMoment(m, idx) {
    const t = $('#mnToast');
    if (!t) return;
    const n = this.game.moments.kept.length;
    t.textContent = idx === 0 && n > 1 ? '\u2605 ЛУЧШИЙ МОМЕНТ МАТЧА'
      : '\u2605 В КОПИЛКУ МОМЕНТОВ \u00b7 ' + m.shots + ' УДАРОВ';
    t.classList.add('on');
    clearTimeout(this._mnT);
    this._mnT = setTimeout(() => t.classList.remove('on'), 1700);
    if (idx === 0) this.game.audio.crowd && this.game.audio.crowd(0.5);
  }

  /** Cinematic chrome: letterbox, title card, "skip". */
  replayShow(on, moment, hero) {
    const r = $('#reel');
    if (!r) return;
    r.classList.toggle('on', !!on);
    r.classList.toggle('hero', !!hero);
    document.body.classList.toggle('is-reel', !!on);
    if (!on || !moment) return;
    const names = { SMASH: 'СМЕШ', LOOP: 'ТОПСПИН', COUNTER: 'КОНТРАТАКА', DRIVE: 'НАКАТ',
      FLICK: 'ФЛИК', LOB: 'СВЕЧА', CHOP: 'ПОДРЕЗКА', PUSH: 'ТОЛЧОК', BLOCK: 'БЛОК',
      SIDE: 'БОКОВАЯ', HOOK: 'КРЮК', FADE: 'ФЕЙД', DROP: 'КОРОТКИЙ', SERVE_TOP: 'ПОДАЧА',
      SERVE_FAST: 'ПОДАЧА', SERVE_SIDE: 'ПОДАЧА', SERVE_BACK: 'ПОДАЧА' };
    $('#reelTag').textContent = hero ? 'ЛУЧШИЙ МОМЕНТ МАТЧА' : 'МОМЕНТ МАТЧА';
    $('#reelTitle').textContent = (names[moment.finish] || moment.finish || 'РОЗЫГРЫШ')
      + (moment.winner > 0 ? ' \u00b7 ОЧКО ВАШЕ' : '');
    $('#reelMeta').textContent = moment.shots + ' УДАРОВ \u00b7 ' + Math.round(moment.speed) + ' КМ/Ч \u00b7 '
      + Math.round(moment.spin) + ' ОБ/С \u00b7 РЕПЛЕЙ 0.35\u00d7';
  }

  /** The library: three best rallies of the match, newest score first. */
  showMoments() {
    const g = this.game; if (!g) return;
    const kept = g.moments.kept.slice(0, 3);
    if (!kept.length) return;
    const list = $('#momentList');
    list.innerHTML = kept.map((m, i) => {
      const bars = Math.round(clamp(m.score / 0.85, 0, 1) * 5);
      const st = Array.from({ length: 5 }, (_, k) => `<i class="${k < bars ? 'f' : ''}"></i>`).join('');
      const names = { SMASH: 'смеш', LOOP: 'топспин', COUNTER: 'контратака', DRIVE: 'накат', FLICK: 'флик',
        LOB: 'свеча', CHOP: 'подрезка', PUSH: 'толчок', BLOCK: 'блок', SIDE: 'боковая', HOOK: 'крюк', FADE: 'фейд', DROP: 'короткий' };
      const why = [m.meta.matchPoint ? 'матчбол' : '', m.meta.deuce ? 'счёт 10-10' : '', m.meta.netClip ? 'по краю сетки' : '',
        m.meta.deficit >= 2 ? 'отставал ' + m.meta.deficit + ':' + 0 : '', m.shots >= 12 ? 'долгий розыгрыш' : ''].filter(Boolean)[0] || 'чисто исполнено';
      return `<button class="mrow" data-i="${i}"><span class="num">${i + 1}</span>
        <span class="d"><b>${(names[m.finish] || m.finish)} · ${m.shots} ударов</b>
        <s>${Math.round(m.speed)} км/ч · ${Math.round(m.spin)} об/с · ${why}</s></span>
        <span class="st">${st}</span><span class="go">СМОТРЕТЬ \u203a</span></button>`;
    }).join('');
    Array.from(list.querySelectorAll('.mrow')).forEach((b) => b.addEventListener('click', () => {
      $('#reels').classList.remove('on');
      g.watchMoment(g.moments.kept[+b.dataset.i], true);
    }));
    $('#reels').classList.add('on');
  }

  /* --------------------- workshop · shop · daily ------------------- */

  showWorkshop(tab) {
    const g = this.game, p = g.profile;
    if (!p) return;
    $$('#workshop .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $$('#workshop .pane').forEach((x) => x.classList.remove('on'));
    $('#pane' + (tab === 'racket' ? 'Racket' : tab === 'shop' ? 'Shop' : 'Daily')).classList.add('on');
    $('#wsBal').textContent = p.data.coins;
    $('#wsCry').textContent = p.data.crystals;
    if (!this.pick) this.pick = { blade: p.data.equip.blade, fh: p.data.equip.fh, bh: p.data.equip.bh };
    this.drawItemList('listBlade', 'blade', this.pick.blade);
    this.drawItemList('listFh', 'rubber', this.pick.fh);
    this.drawItemList('listBh', 'rubber', this.pick.bh);
    this.drawStatCard();
    this.drawShop();
    this.drawDaily();
    $('#workshop').classList.add('on');
  }

  drawItemList(sel, kind, current) {
    const p = this.game.profile;
    const box = $('#' + sel);
    box.innerHTML = ITEMS_ORDER.filter((it) => it.kind === kind).map((it) => {
      const owned = p.owns(it.id);
      const sw = it.kind === 'blade' ? it.wood : it.col;
      const col = `rgb(${sw.map((c) => Math.round(c * 255)).join(',')})`;
      const price = it.price ? `<span class="pr">${it.price}</span>` : '';
      const cry = !owned && it.crystals ? ` <em class="cry">${it.crystals} \u25c8</em>` : '';
      return `<button class="irow${it.id === current ? ' sel' : ''}${owned ? '' : ' locked'}" data-id="${it.id}">
        <span class="sw" style="background:${col}"></span>
        <span class="d"><b>${it.name}</b><s>${it.ru}${owned ? '' : ' · не куплено'}</s></span>${cry}${price}</button>`;
    }).join('');
    Array.from(box.querySelectorAll('.irow')).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id, it = ITEMS[id];
      if (!it) return;                 // a stale row from a previous render
      /* the list is re-rendered on every action, so a click that arrives
         after a re-render has a detached button: ask the DOM carefully */
      const owner = b.parentElement || b.closest('.ilist');
      const slot = it.kind === 'blade' ? 'blade' : (owner && owner.id === 'listBh' ? 'bh' : 'fh');
      if (!this.game.profile.owns(id)) {
        const ok = this.game.shop.buyRacket(id);
        if (!ok) { this.toast('НЕ ХВАТАЕТ МОНЕТ · ' + it.price); this.game.audio.ui('deny'); return; }
        this.toast('КУПЛЕНО · ' + it.name);
        this.game.audio.ui('buy');
        $('#wsBal').textContent = this.game.profile.data.coins;
        this.drawShop();
      }
      this.pick[slot] = id;
      this.showWorkshop('racket');
    }));
  }

  drawStatCard() {
    const t = racketStats(this.pick.blade, this.pick.fh, this.pick.bh);
    const eq = new Equipment(this.pick.blade, this.pick.fh, this.pick.bh);
    const cur = this.game.equip;
    const fitted = this.game.profile.data.equip;
    const dirty = this.pick.blade !== fitted.blade || this.pick.fh !== fitted.fh || this.pick.bh !== fitted.bh;
    $('#wsEquip').textContent = dirty ? 'ПОСТАВИТЬ В ИГРУ' : 'ЭТА РАКЕТКА УЖЕ В ИГРЕ';
    $('#wsEquip').disabled = !dirty;
    const bladeItem = ITEMS[this.pick.blade];
    const buyCry = $('#wsBuyCry');
    if (buyCry) {
      const show = !this.game.profile.owns(this.pick.blade) && !!bladeItem.crystals;
      buyCry.style.display = show ? '' : 'none';
      /* keep a real name on the button even while it is hidden: an empty
         button is what screen readers announce as "button" */
      buyCry.textContent = show ? '\u041a\u0423\u041f\u0418\u0422\u042c \u0417\u0410 ' + bladeItem.crystals + ' \u25c8'
        : '\u041a\u0423\u041f\u0418\u0422\u042c \u0417\u0410 \u041a\u0420\u0418\u0421\u0422\u0410\u041b\u041b\u042b';
      buyCry.setAttribute('aria-label', show ? '\u041a\u0443\u043f\u0438\u0442\u044c \u0437\u0430 ' + bladeItem.crystals + ' \u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u043e\u0432'
        : '\u041a\u0443\u043f\u0438\u0442\u044c \u0440\u0430\u043a\u0435\u0442\u043a\u0443 \u0437\u0430 \u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u044b');
    }
    const rows = STAT_KEYS.map((k) => {
      const v = t[k];
      const d = v - cur.stats[k];
      return `<div class="sbar"><s>${STAT_RU[k]}</s><span class="gr"><i style="width:${v}%"></i></span>
        <b style="color:${d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'var(--dim2)'}">${v}${d ? (d > 0 ? ' ▲' : ' ▼') : ''}</b></div>`;
    }).join('');
    $('#statCard').innerHTML = rows;
    const sp = (eq.fhParams.e / PH.E_RACKET);
    const describe = t.speed > 70 ? 'быстрая, требует короткого замаха' : t.control > 72 ? 'прощает промах по центру'
      : t.spin > 70 ? 'собирает вращение с кисти' : 'ровная, предсказуемая';
    $('#statNote').innerHTML = `<b>${ITEMS[this.pick.blade].name} · ${ITEMS[this.pick.fh].name}</b><br>`
      + `${describe}. Отскок ${(sp * 100).toFixed(0)}% от базы, пятно контакта ${(eq.sweetK * 100).toFixed(0)}%.`;
  }

  /** Buy the racket that is being tried on, with crystals. */
  buySelectionCrystals() {
    const p = this.game.profile, it = ITEMS[this.pick.blade];
    if (p.owns(it.id)) { this.toast('УЖЕ КУПЛЕНО'); return; }
    if (!it.crystals) { this.toast('ЭТУ РАКЕТКУ БЕРУТ МОНЕТАМИ'); return; }
    if (!this.game.shop.buyRacket(it.id, 'crystals')) {
      this.toast('НУЖНО ' + it.crystals + ' КРИСТАЛЛОВ'); this.game.audio.ui('deny'); return;
    }
    this.toast('КУПЛЕНО ЗА ' + it.crystals + ' \u25c8 · ' + it.name);
    this.game.audio.ui('buy');
    $('#wsBal').textContent = p.data.coins;
    $('#wsCry').textContent = p.data.crystals;
    this.showWorkshop('racket');
  }

  equipSelection() {
    const p = this.game.profile;
    const k = this.pick;
    if (!p.equipRacket(k.blade, k.fh, k.bh)) { this.toast('ЧТО-ТО НЕ КУПЛЕНО'); return; }
    this.game.applyEquipment();
    this.toast('РАКЕТКА В ИГРЕ · ' + this.game.equip.name);
    this.game.audio.ui('buy');
    this.drawStatCard();
    this.refreshMenuBits();
  }

  drawShop() {
    const g = this.game, p = g.profile, shop = g.shop;
    const rackets = shop.racketOffers().filter((o) => !o.owned);
    $('#shopRackets').innerHTML = rackets.length ? rackets.map((o) => {
      const it = o.item;
      const s = itemStats(it);
      const line = STAT_KEYS.map((k) => `${STAT_RU[k].slice(0, 4)} ${Math.round(s[k])}`).join(' · ');
      return `<div class="sitem"><b>${it.name} · ${it.ru}</b><s>${line}</s>
        <span class="buy"><span class="price">${o.price} монет</span>
        <button data-buy="${it.id}">КУПИТЬ</button></span></div>`;
    }).join('') : '<div class="snote">Все ракетки открыты. Играйте.</div>';
    Array.from($('#shopRackets').querySelectorAll('button[data-buy]')).forEach((b) => b.addEventListener('click', () => {
      if (g.shop.buyRacket(b.dataset.buy)) { this.game.audio.ui('buy'); this.toast('КУПЛЕНО'); }
      else { this.game.audio.ui('deny'); this.toast('НЕ ХВАТАЕТ МОНЕТ'); }
      $('#wsBal').textContent = p.data.coins; this.drawShop(); this.refreshMenuBits();
    }));

    const cos = shop.cosmeticOffers();
    $('#shopCosmetics').innerHTML = cos.map((c) => {
      const price = c.cur === 'coins' ? `${c.price} монет` : c.cur === 'crystals' ? `${c.price} кр.` : 'за карьеру';
      return `<div class="sitem ${c.owned ? 'owned' : ''}"><b>${c.ru}</b>
        <s>${c.owned ? 'открыто' : c.cur === 'career' ? 'награда за кубок мира' : 'косметика'}</s>
        <span class="buy"><span class="price">${c.owned ? '—' : price}</span>
        <button data-cos="${c.id}" ${c.owned ? 'disabled' : ''}>${c.owned ? 'ЕСТЬ' : 'КУПИТЬ'}</button></span></div>`;
    }).join('');
    Array.from($('#shopCosmetics').querySelectorAll('button[data-cos]')).forEach((b) => b.addEventListener('click', () => {
      if (g.shop.buyCosmetic(b.dataset.cos)) { this.game.audio.ui('buy'); this.toast('КУПЛЕНО'); }
      else { this.game.audio.ui('deny'); this.toast('НЕ ХВАТАЕТ КРИСТАЛЛОВ'); }
      $('#wsCry').textContent = p.data.crystals; this.drawShop();
    }));

    /* Real-money shelves exist only where IAP is allowed at all. On Poki
       the whole block is hidden and the page stays ads-only, as required. */
    const iap = shop.iapOffers();
    $('#shopIapWrap').style.display = iap.length ? 'block' : 'none';
    $('#shopIap').innerHTML = iap.map((b) => `<div class="sitem ${b.owned ? 'owned' : ''}">
      <b>${b.ru}</b><s>${b.note || (b.crystals ? b.crystals + ' кристаллов' : '')}</s>
      <span class="buy"><span class="price">${b.price} €</span>
      <button data-iap="${b.id}" ${b.owned && b.once ? 'disabled' : ''}>${b.owned && b.once ? 'КУПЛЕНО' : 'КУПИТЬ'}</button></span></div>`).join('');
    Array.from($('#shopIap').querySelectorAll('button[data-iap]')).forEach((b) => b.addEventListener('click', () => {
      /* The store call belongs to the mobile wrapper. Here we only take the
         entitlement, and say so honestly instead of pretending. */
      if (g.platform.canIAP && g.iap) { g.iap(b.dataset.iap); }
      else if (g.shop.grant(b.dataset.iap, false)) {
        this.toast('ПОКУПКА ЗАЧТЕНА · ' + b.dataset.iap.toUpperCase());
        $('#wsBal').textContent = p.data.coins; $('#wsCry').textContent = p.data.crystals;
        this.drawShop();
      }
    }));

    const s = p.data.season;
    const lv = p.seasonLevel();
    $('#seasonBox').innerHTML = `<div class="sl"><span>СЕЗОН ${s.n + 1} · УРОВЕНЬ ${lv}/60</span>
      <span>${s.premium ? 'ПРОПУСК АКТИВЕН' : 'БЕСПЛАТНАЯ ДОРОЖКА'}</span></div>
      <div class="track"><i style="width:${(p.seasonProgress() * 100).toFixed(0)}%"></i></div>
      <div class="snote">Опыт сезона дают матчи и задания. Пропуск добавляет косметику, арены и 400 кристаллов.</div>`;
  }

  drawDaily() {
    const p = this.game.profile;
    const d = p.data.daily;
    $('#dailyHead').innerHTML = `Серия <b>${p.data.streak}</b> ${p.data.streak >= 7 ? '· +50% к награде'
      : p.data.streak >= 3 ? '· +25% к награде' : '· три дня подряд дают +25%'}`;
    $('#taskList').innerHTML = DAILY_TASKS.map((t) => {
      const cur = Math.min(d.tasks[t.id] || 0, t.need);
      const done = d.done.indexOf(t.id) >= 0, claimed = d.claimed.indexOf(t.id) >= 0;
      return `<div class="trow"><span class="d"><b>${t.ru}</b><s>${cur}/${t.need} · ${t.coins} монет</s></span>
        <button data-claim="${t.id}" ${done && !claimed ? '' : 'disabled'}>${claimed ? 'ПОЛУЧЕНО' : done ? 'ЗАБРАТЬ' : 'В ПРОЦЕССЕ'}</button></div>`;
    }).join('');
    Array.from($('#taskList').querySelectorAll('button[data-claim]')).forEach((b) => b.addEventListener('click', () => {
      const got = p.claimTask(b.dataset.claim);
      if (got) { this.toast('+' + got + ' МОНЕТ'); this.game.audio.ui('buy'); }
      $('#wsBal').textContent = p.data.coins;
      this.drawDaily(); this.drawShop(); this.refreshMenuBits();
    }));
  }

  watchAd() {
    const r = this.game.shop.rewardAd('dailyWheel');
    if (r.ok) { this.toast('+' + r.coins + ' МОНЕТ · СПАСИБО'); this.game.audio.ui('buy'); }
    else if (r.why === 'no-ads') this.toast('РЕКЛАМА ОТКЛЮЧЕНА');
    else if (r.why === 'daily') this.toast('ЛИМИТ НА СЕГОДНЯ · ЗАВТРА ЕЩЁ ' + r.cap);
    else this.toast('ПОДОЖДИТЕ ' + (r.left || 45) + ' С');
    const cap = this.game.shop.adsLeft;
    const btn = $('#adCoins');
    if (btn) btn.textContent = cap > 0 ? 'СМОТРЕТЬ РЕКЛАМУ · +120 МОНЕТ · ОСТАЛОСЬ ' + cap : 'РЕКЛАМА · ЛИМИТ НА СЕГОДНЯ ИСЧЕРПАН';
    $('#wsBal').textContent = this.game.profile.data.coins;
    this.drawShop(); this.refreshMenuBits();
  }

  refreshMenuBits() {
    const p = this.game.profile; if (!p) return;
    $('#wsCoins').textContent = p.data.coins + ' монет';
    $('#wsStreak').textContent = 'серия ' + p.data.streak + ' · ' + p.data.daily.done.length + '/6';
  }

  toast(text) {
    const t = $('#mnToast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this._tT);
    this._tT = setTimeout(() => t.classList.remove('on'), 1500);
  }

  applySetting(k, v) {
    const g = this.game; if (!g) return;
    const s = g.settings;
    switch (k) {
      case 'assist': s.assist = v / 100; $('#vAssist').textContent = v + '%'; break;
      case 'posAssist': s.posAssist = v / 100; $('#vPos').textContent = v + '%'; break;
      case 'sens': s.sensitivity = v / 100; $('#vSens').textContent = (v / 100).toFixed(2) + '×'; break;
      case 'vol': s.volume = v / 100; g.audio.setVolume(v / 100); $('#vVol').textContent = v + '%'; break;
      case 'cam': s.camera = v; break;
      case 'quality': s.quality = v; g.R.quality = v; g.resize(); break;
      case 'hand': s.hand = v; break;
      case 'trail': s.showTrail = v === 'on'; break;
      case 'predict': s.showPredict = v === 'on'; break;
      case 'zone': s.showZone = v === 'on'; break;
      case 'tele': s.showTele = v === 'on'; $('#spin').classList.toggle('on', s.showTele); break;
      case 'coach': s.coach = v === 'on'; if (!s.coach) this.hideNote(); break;
      case 'adaptive':
        s.adaptive = v === 'on';
        if (g.director) { g.director.enabled = s.adaptive; if (!s.adaptive) { g.director.reset(); g.ai.setHandicap(1); } }
        break;
      case 'haptics': s.haptics = v === 'on'; if (s.haptics) g.buzz(12); break;
      case 'slowmoPlayer':
        s.slowmoPlayer = v === 'on';
        if (!s.slowmoPlayer) g.setSlowmoHold(false);
        $('#slow').classList.toggle('off', !s.slowmoPlayer);
        break;
      case 'target': s.targetScore = +v; $('#toWin').textContent = v; break;
      default: break;
      case 'camYaw': g.camAdj.yaw = (-v) * Math.PI / 180; g.camAdjT = 1.2; this.syncCam(); return;
      case 'camPitch': g.camAdj.pitch = v * Math.PI / 180; g.camAdjT = 1.2; this.syncCam(); return;
      case 'camDist': g.camAdj.zoom = v / 100; g.camAdjT = 1.2; this.syncCam(); return;
    }
    g.saveSettings();
    g.audio.ui('click');
  }

  /** Keep the three camera sliders and the live orbit in step, whichever
   *  one the player actually touched. */
  syncCam() {
    const A = this.game.camAdj;
    const yaw = Math.round(-A.yaw * 180 / Math.PI);
    const pit = Math.round(A.pitch * 180 / Math.PI);
    const dst = Math.round(A.zoom * 100);
    const set = (id, vid, val, txt) => {
      const el = $(id); if (!el) return;
      if (document.activeElement !== el) el.value = val;
      $(vid).textContent = txt;
    };
    set('#rYaw', '#vYaw', yaw, (yaw > 0 ? '+' : '') + yaw + '°');
    set('#rPitch', '#vPitch', pit, (pit > 0 ? '+' : '') + pit + '°');
    set('#rDist', '#vDist', dst, dst + '%');
  }

  syncSettings() {
    const s = this.game.settings;
    const sel = (k, v) => $$(`.opt[data-set="${k}"]`).forEach((x) => x.classList.toggle('sel', x.dataset.val === String(v)));
    sel('cam', s.camera); sel('quality', s.quality); sel('hand', s.hand);
    sel('trail', s.showTrail ? 'on' : 'off'); sel('predict', s.showPredict ? 'on' : 'off');
    sel('zone', s.showZone ? 'on' : 'off'); sel('tele', s.showTele ? 'on' : 'off');
    sel('coach', s.coach ? 'on' : 'off'); sel('adaptive', s.adaptive ? 'on' : 'off');
    sel('slowmoPlayer', s.slowmoPlayer !== false ? 'on' : 'off');
    $('#slow').classList.toggle('off', s.slowmoPlayer === false);
    sel('haptics', s.haptics ? 'on' : 'off');
    sel('target', s.targetScore);
    $('#spin').classList.toggle('on', !!s.showTele);
    $('#toWin').textContent = s.targetScore;
    $('#rAssist').value = Math.round(s.assist * 100); $('#vAssist').textContent = Math.round(s.assist * 100) + '%';
    $('#rPos').value = Math.round(s.posAssist * 100); $('#vPos').textContent = Math.round(s.posAssist * 100) + '%';
    $('#rSens').value = Math.round(s.sensitivity * 100); $('#vSens').textContent = s.sensitivity.toFixed(2) + '×';
    $('#rVol').value = Math.round(s.volume * 100); $('#vVol').textContent = Math.round(s.volume * 100) + '%';
    this.syncCam();
  }

  /* ------------------------------ HUD ----------------------------- */
  syncScore() {
    const g = this.game;
    const a = $('#ptsA'), b = $('#ptsB');
    if (a.textContent !== String(g.score[0])) { a.textContent = g.score[0]; a.classList.add('bump'); setTimeout(() => a.classList.remove('bump'), 220); }
    if (b.textContent !== String(g.score[1])) { b.textContent = g.score[1]; b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 220); }
    $('#servA').classList.toggle('on', g.server === 1);
    $('#servB').classList.toggle('on', g.server === -1);
    $('#oppName').textContent = g.ai.L.name;
  }

  showShot(info) {
    const el = $('#shot');
    el.classList.add('on');
    this.shotTimer = 1.5;
    const n = $('#shotName');
    n.textContent = info.stroke.short || info.stroke.name;
    n.style.color = info.stroke.col;
    $('#shotMeta').textContent = `${info.speed.toFixed(0)} км/ч · ${info.spin.toFixed(0)} об/с`;
  }
  showAiShot() { /* the opponent's choice is readable from the ball itself */ }

  /** One sentence about the point that just ended. A coach does not
   *  recite statistics at you, he tells you the single thing you got
   *  wrong — so this shows exactly one line and then gets out of the way. */
  showNote(note) {
    if (!note || !this.game || !this.game.settings.coach) return;
    const el = $('#note');
    el.querySelector('span').textContent = note.text;
    el.querySelector('i').style.background = note.col || 'var(--acc)';
    el.classList.add('on');
    this.noteTimer = note.text.length > 58 ? 3.4 : 2.6;
  }

  hideNote() { this.noteTimer = 0; const el = $('#note'); el && el.classList.remove('on'); }

  /* --------------------------- coach panel ------------------------ */
  trainShow() { $('#train').classList.add('on'); $('#score').style.opacity = '0'; }
  trainHide() { $('#train').classList.remove('on'); $('#score').style.opacity = ''; $('#tdone').classList.remove('on'); }
  trainSync(t) {
    const S = t.S;
    $('#trStep').textContent = (t.step + 1) + ' / ' + TRAIN_STEPS.length;
    $('#trTitle').textContent = S.title;
    $('#trTip').textContent = S.tip;
    $('#trWhy').textContent = S.why;
    const m = $('#trMsg');
    m.textContent = t.msg || '';
    m.style.color = t.msgCol || 'var(--good)';
    let pips = '';
    for (let i = 0; i < S.need; i++) pips += `<i class="${i < t.done ? 'on' : ''}"></i>`;
    $('#trPips').innerHTML = pips;
  }
  trainDone() { $('#train').classList.remove('on'); $('#tdone').classList.add('on'); }

  showMatchEnd(won) {
    const g = this.game, s = g.stats;
    $('#overTitle').textContent = won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    $('#overTitle').style.color = won ? 'var(--good)' : 'var(--bad)';
    $('#overScore').textContent = g.score[0] + ' : ' + g.score[1];
    const avgSpin = s.shots ? (s.totalSpin / s.shots) : 0;
    $('#stShots').textContent = s.shots;
    $('#stMaxSpeed').textContent = s.maxSpeed.toFixed(0) + ' км/ч';
    $('#stMaxSpin').textContent = s.maxSpin.toFixed(0) + ' об/с';
    $('#stAvgSpin').textContent = avgSpin.toFixed(0) + ' об/с';
    $('#stRally').textContent = g.bestRally;
    const top = Object.entries(s.byStroke).sort((a, b) => b[1] - a[1])[0];
    $('#stFav').textContent = top ? (STROKES[top[0]] ? STROKES[top[0]].short : top[0]) + ' ×' + top[1] : '—';
    // the match is over, so lead with the thing worth remembering: the
    // best rally, played back before the numbers
    const row = $('#overMoments');
    row.innerHTML = '';
    /* what the match paid, in one line, next to the score */
    if (g.lastReward) {
      const r = g.lastReward;
      const line = document.createElement('div');
      line.className = 'snote';
      line.innerHTML = `+<b>${r.coins}</b> монет · +<b>${r.xp}</b> опыта`
        + (r.seasonLevels ? ` · сезон +${r.seasonLevels}` : '')
        + (g.moments.kept.length ? ` · моментов в копилке: ${g.moments.kept.length}` : '');
      row.appendChild(line);
      g.lastReward = null;
    }
    const best = g.moments.best;
    const kept = g.moments.kept.slice(0, 3);
    if (kept.length) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '\u25b6 ЛУЧШИЕ МОМЕНТЫ \u00b7 ' + kept.length;
      b.addEventListener('click', () => this.showMoments());
      row.appendChild(b);
    }
    if (best && !this.suppressCinema) {
      this.suppressCinema = true;
      setTimeout(() => { this.suppressCinema = false; }, 400);   // one auto-play per match
      g.watchMoment(best, true, () => { $('#over').classList.add('on'); });
      return;
    }
    this.suppressCinema = false;
    $('#over').classList.add('on');
  }

  /* ==================================================================
   *  2D coaching layer
   * ================================================================== */

  /** The strike ring: a circle that closes onto the ball and flashes
   *  white at the exact moment the swipe should leave your finger. */
  drawStrikeRing(c, W, H, d) {
    const g = this.game;
    const w = g._strike;
    if (!w || !w.on || w.k < 0.02) return;
    if (!g.settings.showZone) return;
    const p = g.project({ x: w.x, y: w.y, z: w.z }, this._pv);
    if (!p.ok) return;
    const x = p.x * W, y = p.y * H;
    const r0 = 15 * d;                       // closed radius
    const tt = clamp(w.t, 0, 0.85);
    const R = r0 + tt * 150 * d;
    const hot = w.ready;                     // 0..1 — inside the window
    const a = w.k * (0.30 + 0.60 * hot);
    const col = hot > 0.82 ? [255, 236, 140] : hot > 0.4 ? [120, 222, 255] : [110, 150, 190];
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    c.lineWidth = (1.6 + 2.0 * hot) * d;
    c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
    // the fixed target ring you are closing onto
    c.globalAlpha = a * 0.55;
    c.lineWidth = 1.2 * d;
    c.setLineDash([5 * d, 6 * d]);
    c.beginPath(); c.arc(x, y, r0, 0, TAU); c.stroke();
    c.setLineDash([]);
    if (hot > 0.82) {
      const txt = w.kind === 'serve' ? 'СВАЙП ВВЕРХ' : 'БЕЙ!';
      c.globalAlpha = w.k * (0.70 + 0.30 * Math.sin(g.time * 26));
      c.font = `900 ${14 * d}px ${CSSFONT}`;
      c.textAlign = 'center';
      c.lineWidth = 4 * d; c.strokeStyle = 'rgba(3,7,13,.85)'; c.lineJoin = 'round';
      c.strokeText(txt, x, y - R - 14 * d);
      c.fillStyle = '#ffe98a';
      c.fillText(txt, x, y - R - 14 * d);
    }
    c.restore();
  }

  /** The ghost gesture: an animated finger path drawn where the player's
   *  hand actually has to move. Worth a thousand words of cheat-sheet.
   *  Everything is stroked twice — dark outline first — so it stays legible
   *  over the bright table as well as over the dark floor. */
  drawGhost(c, W, H, d, pts, speed, col) {
    const CYCLE = 2.0;
    const T = (this.ghostT * speed) % CYCLE;
    const play = clamp(T / 0.95, 0, 1);
    const fade = T > 1.40 ? clamp((CYCLE - T) / 0.42, 0, 1) : clamp(T / 0.12, 0, 1);
    if (fade <= 0.01) return;

    let P = pts.map((q) => [q[0] * W, q[1] * H]);
    if (P.length > 2) {                       // Catmull-Rom: no dog-legs
      const sm = [];
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
        for (let k = 0; k < 12; k++) {
          const t = k / 12, t2 = t * t, t3 = t2 * t;
          sm.push([
            0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ]);
        }
      }
      sm.push(P[P.length - 1]);
      P = sm;
    }
    const seg = [];
    let total = 0;
    for (let i = 1; i < P.length; i++) {
      const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      seg.push(l); total += l;
    }
    const at = (u) => {
      let want = u * total, i = 0;
      while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
      const f = seg[i] ? clamp(want / seg[i], 0, 1) : 0;
      return [lerp(P[i][0], P[i + 1][0], f), lerp(P[i][1], P[i + 1][1], f)];
    };
    const trace = () => {
      c.beginPath();
      for (let i = 0; i <= 48; i++) { const q = at(i / 48); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    };

    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';

    // 1. the whole route: dark halo + dashed bright line
    c.globalAlpha = 0.38 * fade; c.strokeStyle = '#040a12'; c.lineWidth = 11 * d;
    trace(); c.stroke();
    c.globalAlpha = 0.50 * fade; c.strokeStyle = col; c.lineWidth = 3.4 * d;
    c.setLineDash([9 * d, 9 * d]); trace(); c.stroke(); c.setLineDash([]);

    // 2. the part the finger has already covered, solid and bright
    c.globalAlpha = 0.95 * fade; c.strokeStyle = col; c.lineWidth = 6 * d;
    c.beginPath();
    const n = Math.max(2, Math.round(play * 40));
    for (let i = 0; i < n; i++) { const q = at((i / (n - 1)) * play); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    c.stroke();

    // 3. the finger
    const h = at(play), hb = at(Math.max(0, play - 0.07));
    c.globalAlpha = fade;
    const rg = c.createRadialGradient(h[0], h[1], 0, h[0], h[1], 30 * d);
    rg.addColorStop(0, 'rgba(255,255,255,.95)');
    rg.addColorStop(0.3, col + 'cc'); rg.addColorStop(1, col + '00');
    c.fillStyle = rg; c.beginPath(); c.arc(h[0], h[1], 30 * d, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(h[0], h[1], 7 * d, 0, TAU); c.fill();

    // 4. arrow head pointing the way out, at the end of the route
    const e = at(1), eb = at(0.86);
    const ang = Math.atan2(e[1] - eb[1], e[0] - eb[0]);
    const ah = 16 * d;
    const tip = [e[0] + Math.cos(ang) * ah * 0.5, e[1] + Math.sin(ang) * ah * 0.5];
    c.globalAlpha = fade * (0.45 + 0.45 * play);
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(tip[0], tip[1]);
    c.lineTo(tip[0] - Math.cos(ang - 0.42) * ah, tip[1] - Math.sin(ang - 0.42) * ah);
    c.lineTo(tip[0] - Math.cos(ang + 0.42) * ah, tip[1] - Math.sin(ang + 0.42) * ah);
    c.closePath(); c.fill();

    // 5. where the finger starts
    const s0 = at(0);
    c.globalAlpha = fade * 0.75; c.strokeStyle = col; c.lineWidth = 2.4 * d;
    c.beginPath(); c.arc(s0[0], s0[1], 15 * d, 0, TAU); c.stroke();
    c.globalAlpha = fade * 0.30; c.fillStyle = col;
    c.beginPath(); c.arc(s0[0], s0[1], 15 * d, 0, TAU); c.fill();
    c.restore();
  }

  /** Tie the two things that used to float apart: the OS cursor (which draws
   *  your SWIPE) and the 3D bat (which auto-steps to the ball). While you are
   *  playing we hide the stray arrow and draw one clear hand-reticle under the
   *  pointer, a marker on the real bat, and a dashed tether between them, so it
   *  is obvious: aim/time by the ball + ring, the bat follows on its own. */
  drawHand(c, W, H, d) {
    const g = this.game;
    const st = g.state;
    const play = st === 'RALLY' || st === 'SERVE_READY' || st === 'SERVE_TOSS';
    if (g.canvas) {
      const want = (this.hasFinePointer && play) ? 'none' : '';
      if (this._cur !== want) { g.canvas.style.cursor = want; this._cur = want; }
    }
    if (!play || !this.hasFinePointer || !g.pointer) return;

    const hx = g.pointer.x * W, hy = g.pointer.y * H;
    const pp = g.project(g.player.pos, this._pv2);

    if (pp.ok) {
      const bx = pp.x * W, by = pp.y * H;
      c.save();
      c.setLineDash([4 * d, 6 * d]);
      c.strokeStyle = 'rgba(160,210,255,.40)';
      c.lineWidth = 1.3 * d;
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(bx, by); c.stroke();
      c.setLineDash([]);
      c.globalAlpha = 0.9;
      c.strokeStyle = 'rgba(255,180,90,.92)';
      c.lineWidth = 2 * d;
      c.beginPath(); c.arc(bx, by, 12 * d, 0, TAU); c.stroke();
      c.beginPath();
      c.moveTo(bx - 19 * d, by); c.lineTo(bx - 13 * d, by);
      c.moveTo(bx + 13 * d, by); c.lineTo(bx + 19 * d, by);
      c.moveTo(bx, by - 19 * d); c.lineTo(bx, by - 13 * d);
      c.moveTo(bx, by + 13 * d); c.lineTo(bx, by + 19 * d);
      c.stroke();
      c.restore();
    }

    c.save();
    c.globalAlpha = 0.85;
    c.strokeStyle = 'rgba(57,198,255,.95)';
    c.lineWidth = 2 * d;
    c.beginPath(); c.arc(hx, hy, 9 * d, 0, TAU); c.stroke();
    c.globalAlpha = 0.45;
    c.beginPath(); c.arc(hx, hy, 16 * d, 0, TAU); c.stroke();
    c.globalAlpha = 1; c.fillStyle = 'rgba(57,198,255,.95)';
    c.beginPath(); c.arc(hx, hy, 2.5 * d, 0, TAU); c.fill();
    c.restore();
  }

  drawOverlay(dt) {
    const g = this.game, c = this.fxg, W = this.fx.width, H = this.fx.height, d = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!g) return;
    this.ghostT += dt;

    this.drawStrikeRing(c, W, H, d);
    this.drawHand(c, W, H, d);

    // coach's ghost gesture, only while the drill is waiting for you
    const tr = g.training;
    if (tr && tr.phase !== 'done') {
      const S = tr.S;
      const show = tr.phase === 'intro' || tr.phase === 'wait' ||
        (tr.phase === 'live' && !(g.swipe && g.swipe.active));
      if (show && S.gesture) this.drawGhost(c, W, H, d, S.gesture, S.speed || 1, '#39c6ff');
    }

    // live swipe ribbon
    const sw = g.swipe;
    if (sw.active && sw.samples.length > 1) {
      const pts = sw.samples;
      const n = pts.length;
      c.lineCap = 'round'; c.lineJoin = 'round';
      const st = g.liveStroke;
      const col = st ? st.stroke.col : '#39c6ff';
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        c.strokeStyle = col;
        c.globalAlpha = 0.07 + t * 0.5;
        c.lineWidth = (1.5 + t * 11) * d;
        c.beginPath();
        c.moveTo(pts[i - 1].x * W, pts[i - 1].y * H);
        c.lineTo(pts[i].x * W, pts[i].y * H);
        c.stroke();
      }
      c.globalAlpha = 1;
      const hx = pts[n - 1].x * W, hy = pts[n - 1].y * H;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
      rg.addColorStop(0, col + 'cc'); rg.addColorStop(1, col + '00');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();

      // the one label that matters: which shot this gesture is becoming
      if (st && sw.m.dist > 0.045) {
        c.font = `800 ${12.5 * d}px ${CSSFONT}`;
        c.textAlign = 'center';
        c.fillStyle = col;
        c.globalAlpha = 0.95;
        c.fillText(st.stroke.short || st.stroke.name, hx, hy - 34 * d);
        c.globalAlpha = 1;
      }
    }

    // contact ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      const a = 1 - r.t / r.life;
      if (a <= 0) { this.ripples.splice(i, 1); continue; }
      c.strokeStyle = r.col; c.globalAlpha = a * 0.7;
      c.lineWidth = 3 * d * a;
      c.beginPath(); c.arc(r.x * W, r.y * H, (12 + (1 - a) * 70) * d, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;

    // camera readout — only while you are actually moving the camera
    if (g.camAdjT > 0) {
      const A = g.camAdj;
      const a = clamp(g.camAdjT / 0.5, 0, 1) * 0.92;
      const yaw = Math.round(-A.yaw * 180 / Math.PI);
      const pit = Math.round(A.pitch * 180 / Math.PI);
      const txt = `${yaw > 0 ? '+' : ''}${yaw}°  ·  ${pit > 0 ? '+' : ''}${pit}°  ·  ${(A.zoom).toFixed(2)}×`;
      c.save();
      c.globalAlpha = a;
      c.font = `600 ${11.5 * d}px ui-monospace,Menlo,Consolas,monospace`;
      c.textAlign = 'center';
      const tw = c.measureText(txt).width + 26 * d;
      c.fillStyle = 'rgba(6,11,19,.74)';
      roundRect(c, W / 2 - tw / 2, H - 112 * d, tw, 26 * d, 13 * d);
      c.fill();
      c.strokeStyle = 'rgba(120,180,240,.22)'; c.lineWidth = 1 * d; c.stroke();
      c.fillStyle = '#bcd6f2';
      c.fillText(txt, W / 2, H - 94 * d);
      c.restore();
    }

    // match point
    if (!tr) {
      const T = g.settings.targetScore;
      const mp = (g.score[0] >= T - 1 && g.score[0] >= g.score[1] + 1) || (g.score[1] >= T - 1 && g.score[1] >= g.score[0] + 1);
      if (mp && (g.state === 'RALLY' || g.state === 'SERVE_READY' || g.state === 'SERVE_TOSS')) {
        c.font = `900 ${13 * d}px ${CSSFONT}`;
        c.textAlign = 'center';
        c.fillStyle = g.score[0] > g.score[1] ? 'rgba(78,227,154,.85)' : 'rgba(255,93,110,.85)';
        c.fillText(g.score[0] > g.score[1] ? 'МАТЧБОЛ' : 'МАТЧБОЛ СОПЕРНИКА', W / 2, 108 * d);
      }
    }
  }

  ripple(x, y, col) { this.ripples.push({ x, y, col, t: 0, life: 0.55 }); }

  /* ------------------------------ tick ----------------------------- */
  tick(dt) {
    const g = this.game; if (!g) return;
    this.drawOverlay(dt);

    const box = $('#msgs');
    if (g.messages.length !== this._nMsg || (g.messages[0] && g.messages[0].text !== this._m0)) {
      box.innerHTML = g.messages.map((m) =>
        `<div class="msg${m.big ? ' big' : ''}" style="color:${m.col}">${m.text}</div>`).join('');
      this._nMsg = g.messages.length;
      this._m0 = g.messages[0] ? g.messages[0].text : null;
    }

    const rb = $('#rally');
    const showRally = !g.training && g.rally > 2;
    rb.classList.toggle('on', showRally);
    if (showRally) rb.innerHTML = `РАЛЛИ <b>${g.rally}</b> · РЕКОРД <b>${Math.max(g.bestRally, g.rally)}</b>`;

    /* slow-mo meter: the ring fills back up while you wait, and drops
       while you hold — the one piece of state the player must feel */
    const sl = g.slowmo, slEl = $('#slow');
    if (slEl) {
      const avail = g.slowmoAvailable();
      slEl.classList.toggle('on', sl.active);
      slEl.classList.toggle('ready', !sl.active && sl.energy > 0.995);
      slEl.classList.toggle('off', g.settings.slowmoPlayer === false || !sl.allowed);
      $('#slowFill').style.height = (sl.energy * 100).toFixed(0) + '%';
      document.body.classList.toggle('is-slow', sl.active);
    }
    if (this.shotTimer > 0) { this.shotTimer -= dt; if (this.shotTimer <= 0) $('#shot').classList.remove('on'); }
    if (this.noteTimer > 0) { this.noteTimer -= dt; if (this.noteTimer <= 0) this.hideNote(); }

    if (g.training && g.training._uiStamp !== g.training.phase + g.training.done + g.training.step + g.training.msg) {
      g.training._uiStamp = g.training.phase + g.training.done + g.training.step + g.training.msg;
      this.trainSync(g.training);
    }

    if (g.settings.showTele) {
      const w = g.ball.w;
      const top = -w.x / TAU, side = w.y / TAU;
      const setG = (el, v, max, pc, nc) => {
        const f = clamp(v / max, -1, 1);
        if (f >= 0) { el.style.left = '50%'; el.style.right = (50 - f * 50) + '%'; el.style.background = pc; }
        else { el.style.right = '50%'; el.style.left = (50 + f * 50) + '%'; el.style.background = nc; }
      };
      setG($('#gTop'), top, 160, 'var(--acc2)', 'var(--acc)');
      setG($('#gSide'), side, 140, 'var(--good)', 'var(--good)');
      $('#gTopV').textContent = (top >= 0 ? '+' : '') + top.toFixed(0) + ' об/с';
      $('#gSideV').textContent = (side >= 0 ? '+' : '') + side.toFixed(0) + ' об/с';
      $('#ballKmh').textContent = (V3.len(g.ball.v) * 3.6).toFixed(0);
    }

    const dbg = $('#dbg');
    dbg.classList.toggle('on', g.settings.showDebug);
    if (g.settings.showDebug) {
      const b = g.ball, sp = V3.len(b.v), wl = V3.len(b.w);
      const Re = (sp * 2 * PH.R) / PH.NU;
      const S = PH.R * wl / Math.max(sp, 0.6);
      const a = aeroAccel(V3.new(), b.v, b.w);
      const magn = Math.hypot(a.x, a.y + PH.G, a.z) / PH.G;
      dbg.innerHTML =
        `<b>FPS</b> ${g.fps.toFixed(0)}  <b>DC</b> ${g.R.drawCalls}  <b>TRI</b> ${(g.R.tris / 1000).toFixed(1)}k\n` +
        `<b>GL</b> ${g.R.isGL2 ? 'WebGL2' : 'WebGL1'}\n` +
        `<b>state</b> ${g.state}  <b>ts</b> ${g.timeScale.toFixed(2)}\n` +
        `<b>ball</b> p(${b.p.x.toFixed(2)},${b.p.y.toFixed(2)},${b.p.z.toFixed(2)})\n` +
        `      v ${sp.toFixed(2)} m/s = ${(sp * 3.6).toFixed(0)} km/h\n` +
        `      w (${b.w.x.toFixed(0)},${b.w.y.toFixed(0)},${b.w.z.toFixed(0)}) = ${(wl / TAU).toFixed(0)} rev/s\n` +
        `<b>Re</b> ${(Re / 1000).toFixed(1)}k  <b>S</b> ${S.toFixed(2)}  <b>Magnus</b> ${magn.toFixed(2)} g\n` +
        `<b>paddle</b> v ${V3.len(g.player.vel).toFixed(2)} m/s\n` +
        `<b>swipe</b> sp ${g.swipe.m.speed.toFixed(2)} curl ${g.swipe.m.curl.toFixed(2)}\n` +
        `<b>assist</b> ${(g.settings.assist * 100) | 0}%  <b>pos</b> ${(g.settings.posAssist * 100) | 0}%`;
    }
  }

  /* ================================================================
   *  CAREER MODE UI (ported from PR #1, screens reuse .screen/.opt)
   * ================================================================ */
  bindCareer() {
    const g = this.game;
    $('#careerStart').addEventListener('click', () => {
      g.audio.init(); g.audio.resume(); g.audio.ui('click');
      if (g.career.load()) {
        this.showCareerIntro(g.career);
      } else {
        g.career.start();
        this.showCareerIntro(g.career);
      }
    });
    $('#crReady').addEventListener('click', () => {
      g.audio.ui('click');
      const c = g.career;
      c.readyForOpponentSelect();
      this.showCareerOpponentSelect(c);
    });
    $('#crEndRestart').addEventListener('click', () => {
      g.audio.ui('click');
      $('#careerEnd').classList.remove('on');
      g.career.start();
      this.showCareerIntro(g.career);
    });
    $('#crEndMenu').addEventListener('click', () => {
      g.audio.ui('click');
      $('#careerEnd').classList.remove('on');
      $('#menu').classList.add('on');
    });
  }

  showCareerIntro(career) {
    const t = career.currentTournamentInfo;
    $$('.screen').forEach(s => s.classList.remove('on'));
    $('#crTournName').textContent = `${t.icon} ${t.name}`;
    $('#crTournPlace').textContent = t.place;
    $('#crTournInfo').textContent = `Раундов: ${t.rounds} · ELO ${t.eloMin}–${t.eloMax} · Побед: ${career.totalWins}`;
    $('#careerIntro').classList.add('on');
  }

  showCareerOpponentSelect(career) {
    const g = this.game;
    $$('.screen').forEach(s => s.classList.remove('on'));
    const list = $('#crOppList');
    list.innerHTML = '';
    career.opponents.forEach((opp, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      btn.innerHTML = `<b>${opp.name}</b><s>${opp.style} · ELO ${opp.elo}</s>`;
      btn.addEventListener('click', () => {
        g.audio.ui('click');
        $$('.screen').forEach(s => s.classList.remove('on'));
        career.selectOpponent(i);
      });
      list.appendChild(btn);
    });
    const status = document.createElement('div');
    status.className = 'note';
    status.textContent = `Раунд ${career.currentRound + 1} из ${career.currentTournamentInfo.rounds} · Перков: ${career.perks.length}`;
    status.style.marginTop = '10px';
    list.appendChild(status);
    $('#careerIntro').classList.add('on');
  }

  showCareerPerks(career) {
    const g = this.game;
    $$('.screen').forEach(s => s.classList.remove('on'));
    const list = $('#crPerkList');
    list.innerHTML = '';
    career.pendingPerks.forEach((perk, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      const colors = { green: '#4ee39a', blue: '#39c6ff', gold: '#ffd34d' };
      btn.style.borderColor = colors[perk.rarity] || '#39c6ff';
      btn.innerHTML = `<b style="color:${colors[perk.rarity]}">${perk.name}</b><s>${perk.desc}</s>`;
      btn.addEventListener('click', () => {
        g.audio.ui('click');
        career.selectPerk(i);
        $$('.screen').forEach(s => s.classList.remove('on'));
        this.showCareerOpponentSelect(career);
      });
      list.appendChild(btn);
    });
    $('#careerPerk').classList.add('on');
  }

  showCareerTournamentEnd(career) {
    const t = career.currentTournamentInfo;
    this.showNote({ text: `${t.icon} ${t.name} ПОБЕЖДЁН!`, col: '#ffd34d', code: 'win' });
    setTimeout(() => {
      career.advanceTournament();
      if (career.state === 'RUN_END') {
        this.showCareerRunEnd(career);
      } else {
        this.showCareerIntro(career);
      }
    }, 2500);
  }

  showCareerRunEnd(career) {
    $$('.screen').forEach(s => s.classList.remove('on'));
    const t = TOURNAMENTS[Math.max(0, career.currentTournament - 1)] || TOURNAMENTS[0];
    const isVictory = career.currentTournament >= TOURNAMENTS.length;
    $('#crEndTitle').textContent = isVictory ? '👑 ЧЕМПИОН МИРА!' : `🏁 ${t.name}`;
    $('#crEndSub').textContent = isVictory
      ? 'Вы прошли все 12 турниров. Легенда.'
      : `Выбыли на турнире: ${t.name}`;
    const stats = $('#crEndStats');
    stats.innerHTML = `
      <div class="recap">
        <div class="rc"><i style="background:#4ee39a"></i><b>${career.totalWins}</b><s>побед</s></div>
        <div class="rc"><i style="background:#ff5d6e"></i><b>${career.totalLosses}</b><s>поражений</s></div>
        <div class="rc"><i style="background:#39c6ff"></i><b>${career.perks.length}</b><s>перков</s></div>
        <div class="rc"><i style="background:#ffd34d"></i><b>${Math.round(career.runStats.maxSpeed)}</b><s>км/ч макс</s></div>
      </div>
    `;
    career.active = false;
    try { localStorage.removeItem('topspin_career'); } catch(e) {}
    $('#careerEnd').classList.add('on');
  }

  /* ================================================================
   *  ONLINE MODE UI (relay; server picked via ?net= — see 27_network)
   * ================================================================ */
  bindOnline() {
    const g = this.game;
    const net = g.network;
    $('#onlineStart').addEventListener('click', () => {
      g.audio.init(); g.audio.resume(); g.audio.ui('click');
      $$('.screen').forEach(s => s.classList.remove('on'));
      $('#netStatus').textContent = 'Подключение...';
      $('#netRoomCode').style.display = 'none';
      $('#onlineLobby').classList.add('on');
      net.connect();
    });
    net.on('connected', () => {
      $('#netStatus').textContent = 'Подключено! Создайте комнату.';
      $('#netRoomCode').style.display = 'none';
    });
    net.on('assigned', (msg) => {
      $('#netRoomCode').textContent = msg.room;
      $('#netRoomCode').style.display = 'block';
      $('#netStatus').textContent = msg.side === 1
        ? 'Вы хост. Ждём соперника...'
        : 'Подключены к комнате.';
    });
    net.on('matchStart', () => {
      $$('.screen').forEach(s => s.classList.remove('on'));
      g.startMatch();
    });
    net.on('disconnected', () => {
      $('#netStatus').textContent = 'Отключено.';
    });
    net.on('error', (msg) => {
      $('#netStatus').textContent = `Ошибка: ${msg}`;
    });
    net.on('peerLeft', () => {
      g.msg('СОПЕРНИК ВЫШЕЛ', 2.0, '#ff8a8a');
    });
    $('#netCreate').addEventListener('click', () => {
      g.audio.ui('click');
      net.joinRoom();
    });
    $('#netJoin').addEventListener('click', () => {
      g.audio.ui('click');
      const code = prompt('Введите код комнаты:');
      if (code) net.joinRoom(code.toUpperCase().trim());
    });
    $('#netClose').addEventListener('click', () => {
      g.audio.ui('click');
      net.disconnect();
      $('#onlineLobby').classList.remove('on');
      $('#menu').classList.add('on');
    });
  }
}

const CSSFONT = '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const ICON = {
  sound: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
};
