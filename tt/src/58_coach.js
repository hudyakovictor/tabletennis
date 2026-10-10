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
      if (!s) return 'Мяч в сетку.';
      if (s.contact > 58 && s.topspin < 0) return 'Ракетка слишком открыта и удар мягкий — подрезке не хватило длины. Веди палец длиннее вперёд.';
      if (s.topspin < 60 && s.speed < 30) return 'Удар плоский и медленный. Свайп вверх даёт верхнее вращение — оно перетягивает мяч через сетку.';
      if (s.topspin > 400 && s.speed < 34) return 'Вращения много, скорости мало. Добавь длину свайпа, а не только резкость.';
      return 'В сетку. Начинай свайп чуть ниже и веди его выше.';
    },
    alt: [
      'Опять сетка. Подними точку окончания свайпа — палец должен уходить выше мяча.',
      'Сетка третий раз. Попробуй короткий толчок (PUSH): свайп вперёд почти без подъёма.',
      'Мяч не долетает. Проверь момент: бей по мячу на подъёме, а не когда он уже падает.',
    ],
  },
  LONG: {
    code: 'long', col: '#ff8d6a',
    pick(a) {
      const s = a.myShot;
      if (!s) return 'Мяч за столом.';
      if (s.topspin < 120 && s.speed > 50) return 'Быстро и плоско — такой мяч нечем опустить. Верхнее вращение прижимает мяч к столу: свайпай вверх по касательной.';
      if (s.topspin < 0) return 'Нижнее вращение на быстром ударе держит мяч в воздухе. Для атаки нужен свайп вверх, не вниз.';
      if (s.speed > 75) return 'Перебор скорости. На таком темпе нужен почти вертикальный свайп, иначе мяч улетает.';
      return 'Длинно. Либо мягче, либо больше вращения.';
    },
    alt: [
      'Снова за столом. Уменьши длину свайпа примерно на треть — скорость упадёт, вращение останется.',
      'Мяч всё ещё улетает. Заканчивай жест резко вверх: это закручивает, а не разгоняет.',
      'Длинно подряд. Целься в середину чужой половины, а не в заднюю линию.',
    ],
  },
  WIDE: {
    code: 'wide', col: '#ff8d6a',
    pick(a) {
      const s = a.myShot;
      if (s && Math.abs(s.sidespin) > 90) return 'Боковое вращение увело мяч за боковую. Делай дугу жеста короче.';
      return 'Мимо стола вбок. Заканчивай свайп ближе к центру.';
    },
    alt: [
      'Снова вбок. Веди палец прямее — боковой снос копится вместе с боковым вращением.',
      'Мяч уходит за боковую. Бей в дальний угол по диагонали, там запас по длине больше.',
    ],
  },
  MISSED: {
    code: 'missed', col: '#ffc46a',
    pick(a) {
      if (a.wideBall) return 'Мяч ушёл в угол. После своего удара возвращай ракетку к центру — оттуда достаёшь оба угла.';
      if (a.fastBall) return 'Слишком быстро для замаха. На таком мяче играй блок: почти без движения пальцем.';
      if (a.lateSwipe) return 'Свайп был поздно. Начинай вести палец, когда кольцо ещё только сжимается.';
      return 'Не успел к мячу. Следи за кольцом — оно показывает точку и момент.';
    },
    alt: [
      'Опять не достал. Не жди мяч — начинай движение, как только соперник ударил.',
      'Снова мимо. Держи палец на экране между ударами: тогда ракетка уже стоит там, где нужно.',
      'Третий раз подряд. Увеличь «ПОМОЩЬ ПОЗИЦИИ» в настройках или сними уровень сложности — это не стыдно.',
    ],
  },
  VOLLEY: {
    code: 'volley', col: '#ff8d6a',
    pick() { return 'Удар с лёта над столом — так нельзя. Дай мячу удариться о твою половину.'; },
  },
  SERVE_FAIL: {
    code: 'serve', col: '#ff8d6a',
    pick(a) {
      if (a.serveOwnHalf) return 'Подача не перелетела. Мяч должен удариться сначала у тебя, потом у соперника.';
      if (a.serveLong) return 'Подача мимо. Свайп короче — на подаче нужна не сила, а вращение.';
      return 'Подача не вышла. Подбрось, дождись падения и проведи палец вверх.';
    },
    alt: [
      'Снова брак на подаче. Самый надёжный вариант — короткий свайп вверх на треть экрана.',
      'Подача опять не прошла. Не торопись: удар по мячу нужен в нижней точке подброса.',
    ],
  },
  /* ---- the player won it ---- */
  WINNER: {
    code: 'win', col: '#4ee39a',
    pick(a) {
      const s = a.myShot;
      if (!s) return 'Очко.';
      if (s.stroke === 'SMASH') return 'Смеш забит. Высокий мяч — всегда повод закончить розыгрыш.';
      if (s.topspin > 450) return `Накат с вращением ${Math.round(s.topspin / TAU)} об/с — соперник не удержал мяч.`;
      if (Math.abs(s.sidespin) > 110) return 'Боковое вращение увело мяч от ракетки соперника.';
      if (s.speed > 70) return `${Math.round(s.speed)} км/ч — соперник не успел.`;
      return 'Чисто разыграно.';
    },
  },
  OPP_ERROR: {
    code: 'opperr', col: '#4ee39a',
    pick(a) {
      if (a.rallyLen >= 6) return `Длинный розыгрыш (${a.rallyLen} ударов) — соперник сломался первым.`;
      return 'Ошибка соперника. Держи мяч в столе — этого часто достаточно.';
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

    this.last = { code: A.code, col: A.col, text, key, ctx: a };
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
   * Nudge the opponent's handicap after every point. The window is
   * deliberately narrow (0.86 … 1.03) — enough to stop a blow-out from
   * feeling hopeless, far too small to hand anybody a free win.
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
    if (this.streak <= -4) want = Math.min(want, 0.86);
    if (this.streak >= 4) want = Math.max(want, 1.03);

    this.handicap = lerp(this.handicap, want, 0.5);
    return this.handicap;
  }

  /** a short read of who is on top right now, for the HUD */
  momentum() {
    const recent = this.history.slice(-6);
    if (recent.length < 3) return 0;
    return recent.reduce((s, v) => s + v, 0) / recent.length;
  }
}
