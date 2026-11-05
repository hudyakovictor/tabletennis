/* =====================================================================
 *  RALLY RECORDER · POINT ANALYST · MATCH DIRECTOR
 *
 *  Losing a point and not knowing why is the single worst feeling a
 *  sports game can give you. The physics here is detailed enough to say
 *  exactly what went wrong — the contact angle, the spin, the pace, the
 *  recovery position — so it would be a waste not to say it.
 *
 *  Three small systems live here:
 *
 *  · RallyRecorder — remembers every contact and every bounce of the
 *    current point. Cheap: flat objects, reused arrays, no allocation
 *    in the hot path.
 *
 *  · PointAnalyst — turns that log plus the fault reason into ONE short
 *    sentence that is actually actionable. Never more than one. It also
 *    returns a machine-readable `code` so the UI can colour it.
 *
 *  · MatchDirector — watches the score and quietly keeps the match in
 *    the zone: a long losing streak softens the opponent by a few per
 *    cent, a long winning streak hands some of it back. It never
 *    changes the rules, only the opponent's handicap multiplier, and it
 *    can be switched off.
 * ===================================================================== */
'use strict';

/* ------------------------------------------------------------------ */
/*  RALLY RECORDER                                                      */
/* ------------------------------------------------------------------ */
class RallyRecorder {
  constructor() {
    this.shots = [];
    this.bounces = [];
    this.startT = 0;
    this.serveBy = 1;
  }

  begin(time, server) {
    this.shots.length = 0;
    this.bounces.length = 0;
    this.startT = time;
    this.serveBy = server;
  }

  /** @param by  +1 player, -1 opponent */
  addShot(by, info) {
    this.shots.push({
      by,
      t: info.t,
      stroke: info.stroke ? info.stroke.id : '?',
      name: info.stroke ? (info.stroke.short || info.stroke.name) : '?',
      speed: info.speed || 0,            // km/h
      spin: info.spin || 0,              // rev/s magnitude
      topspin: info.topspin || 0,        // rad/s, + = topspin
      sidespin: info.sidespin || 0,
      contact: info.contact || 0,        // degrees
      elev: info.elev || 0,
      quality: info.quality !== undefined ? info.quality : 1,
      x: info.x || 0, y: info.y || 0, z: info.z || 0,
      slip: !!info.slip,
    });
  }

  addBounce(side, x, z, by) {
    this.bounces.push({ side, x, z, by, i: this.shots.length });
  }

  last(by) {
    for (let i = this.shots.length - 1; i >= 0; i--) if (this.shots[i].by === by) return this.shots[i];
    return null;
  }

  /** bounces that happened after the player's last shot */
  bouncesAfterLast(by) {
    let k = -1;
    for (let i = this.shots.length - 1; i >= 0; i--) if (this.shots[i].by === by) { k = i; break; }
    if (k < 0) return [];
    return this.bounces.filter((b) => b.i > k);
  }

  get length() { return this.shots.length; }
}

/* ------------------------------------------------------------------ */
/*  POINT ANALYST                                                       */
/* ------------------------------------------------------------------ */

/** Reasons the engine can award a point with, mapped to a diagnosis.
 *  Everything is phrased as one short imperative so it reads like a
 *  coach standing behind you, not like an error log. */
const ANALYSIS = {
  /* ---- the player made the mistake ---- */
  NET: {
    code: 'net', col: '#ff8d6a',
    pick(a) {
      const s = a.myShot;
      if (!s) return 'Сетка возражает. Подними траекторию.';
      if (s.contact > 58 && s.topspin < 0) return 'Мягкой подрезке не хватило длины при открытой ракетке. Веди палец дальше вперёд: сетка не принимает недосказанность.';
      if (s.topspin < 60 && s.speed < 30) return 'Плоский медленный удар не прошёл сетку. Свайпни вверх для верхнего вращения: оно оформит перелёт.';
      if (s.topspin > 400 && s.speed < 34) return 'Вращения много, скорости мало. Удлини свайп, не только ускоряй его: мяч крутится, но заявление не движется.';
      return 'Сетка возражает. Начни свайп ниже и закончи выше мяча.';
    },
    alt: [
      'Сетка снова закрыла проход. Закончи свайп выше мяча.',
      'Повторный отказ сетки. Попробуй PUSH: коротко вперёд, почти без подъёма.',
      'Мяч не долетает. Бей на подъёме после отскока, не на падении: приёмная скоро закроется.',
    ],
  },
  LONG: {
    code: 'long', col: '#ff8d6a',
    pick(a) {
      const s = a.myShot;
      if (!s) return 'Мяч за столом. Укороти свайп.';
      if (s.topspin < 120 && s.speed > 50) return 'Быстро и плоско: мяч не опустился на стол. Веди вверх по касательной для верхнего вращения. Посадку надо согласовать.';
      if (s.topspin < 0) return 'Нижнее вращение держит быстрый мяч в воздухе. Для атаки веди вверх, не вниз: стол ждёт посадку, не пролёт.';
      if (s.speed > 75) return 'Скорости слишком много. Веди почти вертикально вверх, чтобы мяч опустился. Стол расширение не одобрил.';
      return 'Длинно. Свайп мягче или больше верхнего вращения: стол конечный.';
    },
    alt: [
      'Снова за столом. Укороти свайп примерно на треть: меньше скорости, вращение останется.',
      'Мяч всё ещё улетает. Заканчивай жест резко вверх: нужен спин, не командировка.',
      'Повторный аут по длине. Целься в середину чужой половины, не в заднюю линию.',
    ],
  },
  WIDE: {
    code: 'wide', col: '#ff8d6a',
    pick(a) {
      const s = a.myShot;
      if (s && Math.abs(s.sidespin) > 90) return 'Боковое вращение увело мяч за линию. Укороти дугу жеста: объезд не согласован.';
      return 'Аут вбок. Закончи свайп ближе к центру: у стола строгие границы.';
    },
    alt: [
      'Снова вбок. Веди палец прямее: боковое вращение накапливает снос, не права на соседний стол.',
      'Мяч уходит за боковую. Целься по диагонали в дальний угол: там больше запаса по длине.',
    ],
  },
  MISSED: {
    code: 'missed', col: '#ffc46a',
    pick(a) {
      if (a.wideBall) return 'Мяч ушёл в угол. После удара верни ракетку к центру: оба угла обслуживаются из одного окна.';
      if (a.fastBall) return 'Для замаха мяч слишком быстрый. Играй блок почти без движения пальцем: срочная обработка.';
      if (a.lateSwipe) return 'Свайп опоздал. Начни движение до встречи мяча с ракеткой: тайминг продление не выдаёт.';
      return 'Мяч прошёл раньше ракетки. Подведи её заранее и ударь при встрече.';
    },
    alt: [
      'Снова нет контакта. Начни движение сразу после удара соперника: мяч без очереди.',
      'Снова мимо. Между ударами держи палец на экране, чтобы ракетка оставалась у места встречи.',
      'Контакт снова не случился. Включи Slow-Mo для разбора или коротко тапни по мячу для подставки.',
    ],
  },
  VOLLEY: {
    code: 'volley', col: '#ff8d6a',
    pick() { return 'С лёта над столом нельзя. Дождись отскока на своей половине: штамп стола обязателен.'; },
  },
  SERVE_FAIL: {
    code: 'serve', col: '#ff8d6a',
    pick(a) {
      if (a.serveOwnHalf) return 'Подача не перелетела. Нужны отскоки сначала у тебя, потом у соперника: две печати, не одна.';
      if (a.serveLong) return 'Подача за столом. Укороти свайп: вращение важнее силы. Экспресс-доставка ушла мимо адреса.';
      return 'Подача не принята. Подбрось, дождись падения и веди палец вверх через мяч.';
    },
    alt: [
      'Подача снова не прошла. Попробуй короткий свайп вверх на треть экрана.',
      'Подача снова отклонена. Не спеши: встречай мяч в нижней точке подброса.',
    ],
  },
  /* ---- the player won it ---- */
  WINNER: {
    code: 'win', col: '#4ee39a',
    pick(a) {
      const s = a.myShot;
      if (!s) return 'Очко учтено.';
      if (s.stroke === 'SMASH') return 'Смеш завершил розыгрыш. Высокий мяч дал разрешение на закрытие дела.';
      if (s.topspin > 450) return ET('Накат: {spin} об/с. Соперник не удержал мяч. Вращение прошло без согласования.', { spin: Math.round(s.topspin / TAU) });
      if (Math.abs(s.sidespin) > 110) return 'Боковое вращение увело мяч от ракетки соперника. Адрес встречи изменён.';
      if (s.speed > 70) return ET('{speed} км/ч. Соперник не успел. Срочный запрос обработан.', { speed: Math.round(s.speed) });
      return 'Розыгрыш чистый. Протоколу не к чему придраться.';
    },
  },
  OPP_ERROR: {
    code: 'opperr', col: '#4ee39a',
    pick(a) {
      if (a.rallyLen >= 6) return ET('Розыгрыш: {n} ударов. Соперник ошибся первым. Терпение закрыло дело.', { n: a.rallyLen });
      return 'Соперник ошибся. Держи мяч на столе: система любит проверять терпение.';
    },
  },
};

class PointAnalyst {
  constructor() { this.last = null; this.lastKey = null; this.repeat = 0; }

  reset() { this.last = null; this.lastKey = null; this.repeat = 0; }

  /**
   * @param rec    RallyRecorder
   * @param who    +1 the player won the point, -1 the opponent won it
   * @param reason the engine's short reason string
   * @param game   for context (player position, swipe timing)
   */
  analyse(rec, who, reason, game) {
    const myShot = rec.last(1);
    const oppShot = rec.last(-1);
    const a = {
      myShot, oppShot,
      rallyLen: rec.length,
      wideBall: false, fastBall: false, lateSwipe: false,
      serveOwnHalf: false, serveLong: false,
    };
    if (oppShot) {
      a.fastBall = oppShot.speed > 58;
      const b = rec.bouncesAfterLast(-1)[0];
      if (b) a.wideBall = Math.abs(b.x) > PH.T_HALF_WID * 0.62;
    }
    if (game && game.lastSwipeLate) a.lateSwipe = true;

    let key;
    if (who > 0) {
      key = (reason && /СОПЕРНИК/.test(reason)) ? 'OPP_ERROR' : 'WINNER';
      if (myShot && myShot.speed > 60 && rec.length <= 4) key = 'WINNER';
    } else {
      if (/СЕТКУ|НЕ ПЕРЕЛЕТ/.test(reason || '')) key = 'NET';
      else if (/АУТ|ДЛИН/.test(reason || '')) key = 'LONG';
      else if (/ВБОК|ШИРОК/.test(reason || '')) key = 'WIDE';
      else if (/ЛЁТА|ЛЕТА/.test(reason || '')) key = 'VOLLEY';
      else if (/ПОДАЧ/.test(reason || '')) key = 'SERVE_FAIL';
      else key = 'MISSED';
      if (key === 'NET' && rec.serveBy === 1 && rec.length <= 1) { key = 'SERVE_FAIL'; a.serveOwnHalf = true; }
      if (key === 'LONG' && rec.serveBy === 1 && rec.length <= 1) { key = 'SERVE_FAIL'; a.serveLong = true; }
    }

    // A coach who repeats himself word for word stops being heard, so
    // the same diagnosis twice in a row escalates to a different angle.
    this.repeat = key === this.lastKey ? this.repeat + 1 : 0;
    this.lastKey = key;
    a.rep = this.repeat;

    const A = ANALYSIS[key] || ANALYSIS.MISSED;
    let text;
    if (this.repeat > 0 && A.alt && A.alt.length) text = A.alt[(this.repeat - 1) % A.alt.length];
    else text = A.pick(a);

    // Winning points are only worth a word now and then — constant praise
    // is noise. Losing points always get an answer.
    if (who > 0 && this.repeat > 0 && Math.random() < 0.6) return (this.last = null);

    this.last = { code: A.code, col: A.col, text: ET(text), key, ctx: a };
    return this.last;
  }
}

/* ------------------------------------------------------------------ */
/*  MATCH DIRECTOR                                                      */
/* ------------------------------------------------------------------ */
class MatchDirector {
  constructor() {
    this.streak = 0;            // + player winning in a row, - losing
    this.handicap = 1;
    this.enabled = true;
    this.history = [];          // +1 / -1 per point
  }

  reset() { this.streak = 0; this.handicap = 1; this.history.length = 0; }

  /**
   * Nudge the opponent's handicap after every point. The window BREATHES:
   * the share of recent points moves it a little (0.88 … 1.03), and a
   * losing streak escalates the rescue past that floor — about −0.05 for
   * every lost point past the THIRD, down to 0.70, and sinks fast (0.65 of
   * the way per point). A skill gap measured in divisions cannot be answered
   * by trickle-down rescue that arrives after the match is dead: by 0:5 the
   * bot must already be playing soft. Hot streaks harden the bot
   * symmetrically, up to 1.06. Still far too small to hand anybody a free
   * win — it buys back footing, not points.
   */
  onPoint(who, levelIndex) {
    this.history.push(who > 0 ? 1 : -1);
    if (this.history.length > 24) this.history.shift();
    this.streak = (who > 0) === (this.streak > 0) ? this.streak + sign(who) : sign(who);

    if (!this.enabled || levelIndex >= 4) { this.handicap = 1; return 1; }

    const recent = this.history.slice(-8);
    const won = recent.filter((v) => v > 0).length;
    const share = recent.length ? won / recent.length : 0.5;

    // target: the player should be winning somewhere around 40-60 %
    let want = 1;
    if (share < 0.30) want = 0.88;
    else if (share < 0.42) want = 0.94;
    else if (share > 0.72) want = 1.03;
    else want = 1.0;
    /* streak −3 → 0.87, −4 → 0.82, −5 → 0.77, −6 → 0.72, −7 и глубже → 0.70;
       лёрп 0.65 за очко при разгроме — спасение приходит до 0:5, не после 0:8 */
    if (this.streak <= -3) want = Math.min(want, Math.max(0.70, 0.92 + (this.streak + 2) * 0.05));
    if (this.streak >= 4) want = Math.max(want, Math.min(1.06, 1.03 + (this.streak - 4) * 0.015));

    this.handicap = lerp(this.handicap, want, this.streak <= -3 ? 0.65 : 0.5);
    return this.handicap;
  }

  /** a short read of who is on top right now, for the HUD */
  momentum() {
    const recent = this.history.slice(-6);
    if (recent.length < 3) return 0;
    return recent.reduce((s, v) => s + v, 0) / recent.length;
  }
}
