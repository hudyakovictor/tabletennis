/* =====================================================================
 *  PHYSICS WATCHDOG — автоматические детекторы багов геймплейной физики.
 *
 *  Задача одна: превратить жалобы «мяч вёл себя невозможнo» в машинные
 *  тикеты, которые появляются без участия человека. Сторож НЕ пишет
 *  кадры и НЕ хранит историю: он держит несколько чисел на кадр и, если
 *  инвариант физики нарушен, складывает в кольцо один короткий тикет
 *  (код + измеренные величины + точка контакта).
 *
 *  Пять классов (класс -> коды):
 *    1. сильный удар в стол / за экран : BALL_INTO_TABLE, BALL_OFF_ARENA
 *    2. удар в угол                   : CORNER_REPEAT_CONTACT, CORNER_STUCK
 *    3. ракетка под столом            : RACKET_UNDER_TABLE
 *    4. мяч сквозь ракетку            : BALL_THROUGH_RACKET
 *    5. подача не от ракетки          : SERVE_NOT_FROM_RACKET
 *
 *  Принципы, без которых сторож вреден:
 *   · только наблюдаемые инварианты (мяч не может быть внутри плиты стола,
 *     ракетка не может быть под столом, когда висит НАД ним);
 *   · порог с запасом, а не «впритык»: ложное срабатывание дороже
 *     пропуска, потому что учит игнорировать сторожа;
 *   · сторож ничего не подстраивает в физике. Срабатывание = тикет.
 * ===================================================================== */
'use strict';

const WATCHDOG_VERSION = 1;

/* Классы ровно в терминах жалоб; коды — то, что попадает в отчёт. */
const WATCHDOG_CLASSES = Object.freeze({
  strong_shot: Object.freeze(['BALL_INTO_TABLE', 'BALL_OFF_ARENA', 'SPEED_CEILING', 'SPIN_CEILING']),
  corner: Object.freeze(['CORNER_REPEAT_CONTACT', 'CORNER_STUCK']),
  racket: Object.freeze(['RACKET_UNDER_TABLE', 'BALL_THROUGH_RACKET']),
  serve: Object.freeze(['SERVE_NOT_FROM_RACKET']),
});

const WATCHDOG_CODES = Object.freeze(WATCHDOG_CLASSES.strong_shot
  .concat(WATCHDOG_CLASSES.corner, WATCHDOG_CLASSES.racket, WATCHDOG_CLASSES.serve));

/* Пороги. Каждый — физическая величина с запасом, а не подгонка под UI.
 *
 * penetrationTol 6 мм: контакт со столом ставит мяч ровно на R над
 * поверхностью, поэтому любое погружение глубже 6 мм на двух подшагах
 * подряд — это не «округление», а проваливание.
 *
 * racketFloorOverTable 0.10 м: штатный предел ракетки над столом — 0.18 м
 * (paddleLimitsFor), значит половина запаса ещё остаётся на анимацию
 * замаха. Под столом ЗА задней линией ракетке можно быть сколько угодно —
 * это разрешено и проверкой не считается. */
const WATCHDOG_RULES = Object.freeze({
  penetrationTol: 0.006,
  penetrationSteps: 2,
  strongSpeed: 8.0,                   // м/с: «сильный» удар (≈29 км/ч)
  /* Пол арены сторожа не касается: любой промах законно падает вниз, и
   * порог по y внизу ловил бы обычный промах. Верх и края — да: туда мяч
   * может попасть только багом. */
  arena: Object.freeze({ x: 6.0, z: 8.0, y: 6.0 }),
  cornerBand: 0.05,                   // м от линии стола
  cornerSlowSpeed: 0.5,               // м/с: мяч «елозит», а не летит
  cornerStuckSec: 0.60,               // с в полосе кромки на малой скорости
  cornerRepeatSec: 0.35,              // окно повторных контактов кромки
  cornerRepeatCount: 2,               // сколько контактов уже баг
  cornerRestTol: 0.02,                // м: мяч лежит НА поверхности, а не падает рядом
  racketFloorOverTable: 0.10,         // м над поверхностью, пока ракетка над столом
  racketOverMargin: 0.03,             // м: «висит над столом» с запасом на проекцию
  throughRadiusTol: 0.0,              // м: допуск к радиусу клинка
  throughMinClosing: 1.0,             // м/с: медленнее — это не «пролёт», а касание
  /* Игра применяет удар на кадре (60 Гц), а физика идёт на 600 Гц: мяч
   * ЗАКОННО проходит плоскость клинка на 1-10 подшагов раньше, чем гейт
   * успевает его поймать. Тикет ставится только если контакт так и не
   * случился за это окно — иначе каждый честный удар бота был бы багом. */
  throughGraceSec: 0.05,
  /* У самой поверхности мяч не «пролетает сквозь клинок», а отскакивает от
   * стола: у кромки клинок и плита сходятся вплотную, и отрезок подшага
   * перестаёт быть прямой (замер: 2 тикета на 480 ударов — оба в момент
   * касания стола на линии). Геометрию клинка у стола сторожит
   * RACKET_UNDER_TABLE, поэтому здесь она исключена. */
  throughSurfaceBand: 0.06,
  /* Клинок бота в кадре. His pose is his BODY position: the AI is allowed to
   * take a low ball 4 cm above the surface (computePlan clamps y to
   * TABLE_Y+0.04), so the centre sitting below the surface by more than the
   * animation slack is the violation — anything stricter fires on a legal
   * low scoop. The player's blade is lifted by keepPaddleAboveTable to
   * +0.175 m, so his floor stays the old 0.10 m and never floats. */
  opponentFloorOverTable: 0.02,
  racketFloorDwellSec: 0.08,          // с: поза должна продержаться, а не мигнуть
  /* Потолки темпа и вращения. Оба берутся из контракта, а не из воздуха:
   * `STROKE_CONFIG.racket.vmax` × скорость архетипа и `STROKE_CONFIG.spin.cap`
   * — это ровно то, что умеет модель; множители экипировки (vmagK ≤ 1.03),
   * бонус за точный контакт (speedBonus 1.05) и запас на округление входят
   * в допуск, поэтому честный удар с любым снаряжением остаётся ниже. */
  equipK: 1.03,                       // 84_racket.js: spread(feel, 0.970, 1.030)
  speedTol: 0.02,
  spinTol: 0.02,
  /* Замер на headless-прогоне (5 уровней × 200 ударов): refineRacket и
   * applyExecutionError поднимают итоговый замах до 1.27 × vmagMax уровня.
   * Потолок — этот измеренный максимум плюс запас, а не «чтобы молчало»:
   * двойка сверху (бот бьёт вдвое сильнее своего уровня) остаётся тикетом. */
  aiSpeedSlack: 1.35,
  /* Экран. Тикет только когда мяч И не в кадре, И вне играбельного объёма:
   * камера (57_camera.js) не следует за мячом, поэтому честный лоб над
   * столом штатно уходит за верхний край кадра — это не баг. */
  screenMarginPx: 24,
  screenDwellSec: 0.25,
  /* Границы «мяч ушёл» в метрах. Замер headless-прогона (все уровни × 200
   * ударов): легальный мяч доходит до apex 2.30 м, |x| 1.71 м, |z| 2.28 м —
   * всё это камера штатно режет по краю, и тикета быть не должно. Пороги
   * стоят выше измеренного максимума на полкорпуса-корпус. */
  screenGuardY: 3.0,                  // м над столом: 3.76 м по абсолютной высоте
  screenGuardX: 2.26,                 // T_HALF_WID + 1.5
  screenGuardZ: 2.87,                 // T_HALF_LEN + 1.5
  maxAiShots: 100,                    // кольцо журнала ударов бота
  /* 0.44 = 80 % от serveCaptureRadius (0.55): внутри сферы захвата подача
   * разрешена контрактом, внешние 20 % — уже видимый телепорт клинка. */
  serveBladeDistance: 0.44,           // м: ракетка должна быть у мяча на подаче
  serveOffsetTol: 0.06,               // м: мяч ушёл не с ракетки после контакта
  ticketCooldownSec: 0.5,             // с: не сыпать одинаковыми тикетами
  maxTickets: 64,                     // кольцо; старые вытесняются
});

const WD_PH = () => (typeof PH !== 'undefined' ? PH : {
  R: 0.020, TABLE_Y: 0.76, T_HALF_WID: 0.7625, T_HALF_LEN: 1.37,
});

function wdNum(v) { return Number.isFinite(v) ? v : null; }
/** Контракт удара/вращения (05_stroke_config.js) — читаем лениво: модуль
 *  сторожа грузится раньше, а значения конфига могут меняться в рантайме. */
function wdStrokeConfig() { return typeof STROKE_CONFIG !== 'undefined' ? STROKE_CONFIG : null; }
function wdAiLevel(i) {
  return typeof AI_LEVELS !== 'undefined' && Array.isArray(AI_LEVELS) && Number.isFinite(i)
    ? (AI_LEVELS[i] || null) : null;
}
function wdOverTable(pos, margin, PHc) {
  const P = PHc || WD_PH();
  return Math.abs(pos.x) <= P.T_HALF_WID + margin && Math.abs(pos.z) <= P.T_HALF_LEN + margin;
}
function wdDist(ax, ay, az, bx, by, bz) {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

class PhysicsWatchdog {
  constructor(options = {}) {
    this.version = WATCHDOG_VERSION;
    this.rules = Object.freeze({ ...WATCHDOG_RULES, ...options });
    this.onTicket = null;
    this.reset();
  }

  /** Новый розыгрыш: сбрасываем всё, кроме накопленных тикетов. */
  reset() {
    this.resetShot();
    this.tickets = [];
    this.counts = {};
    for (const code of WATCHDOG_CODES) this.counts[code] = 0;
    this.lastTicket = null;
    this.lastContact = null;
    this._lastAt = {};
    this._seq = 0;
    this.aiShots = this.aiShots || [];
    /* Счётчики «детектор действительно смотрел»: ноль тикетов на прогоне
     * ничего не доказывает, если пролётов сквозь клинок не было вообще. */
    this.probe = { substeps: 0, armedSteps: 0, planeCrossings: 0, crossings: 0, approaches: 0,
      frames: 0, poses: 0, screens: 0, strokes: 0 };
    this._ctxSide = null;
    this._ctxLevel = null;
    this._oppFloorSec = 0;
    this._playerFloorSec = 0;
    this._offScreenSec = 0;
    this._offScreen = false;
  }

  /** Новый удар: сбрасываем одноразовые флаги, счётчики и таймеры. */
  resetShot() {
    this._penetrationSteps = 0;
    this._intoTable = false;
    this._offArena = false;
    this._cornerRepeat = false;
    this._cornerStuck = false;
    this._stuckSec = 0;
    this._edgeTimes = [];
    this._through = false;
    this._throughOpp = false;
    this._throughPending = null;
    this._offScreen = false;
    this._hitSeqSeen = null;   // null = счётчик контактов ещё не наблюдали
    this._serveOffset = null;
    this._armed = false;
    this._armedMeta = null;
    this._armedOpp = false;
    this._armedOppMeta = null;
  }

  /** Состояние гейта на текущий кадр: бьёт ли игрок прямо сейчас. */
  arm(armed, meta) {
    this._armed = !!armed;
    this._armedMeta = meta || null;
  }

  /** То же для клинка бота: взвод — его собственная фаза удара. */
  armOpponent(armed, meta) {
    this._armedOpp = !!armed;
    this._armedOppMeta = meta || null;
  }

  /** Контекст тикета: сторона и уровень бота попадают в КАЖДЫЙ тикет. */
  context(side, aiLevel) {
    if (side === 1 || side === -1) this._ctxSide = side;
    if (Number.isFinite(aiLevel)) this._ctxLevel = aiLevel;
  }

  ticket(code, detail = {}) {
    if (!WATCHDOG_CODES.includes(code)) return null;
    const now = wdNum(detail.time);
    const last = this._lastAt[code];
    if (now !== null && Number.isFinite(last) && now - last < this.rules.ticketCooldownSec) return null;
    if (now !== null) this._lastAt[code] = now;
    this.counts[code] = (this.counts[code] || 0) + 1;
    const side = Number.isFinite(detail.side) ? detail.side : this._ctxSide;
    const aiLevel = Number.isFinite(detail.aiLevel) ? detail.aiLevel : this._ctxLevel;
    const row = {
      code, time: now, seq: ++this._seq, side, aiLevel,
      class: Object.keys(WATCHDOG_CLASSES).find(k => WATCHDOG_CLASSES[k].includes(code)) || null,
      detail,
    };
    this.tickets.push(row);
    if (this.tickets.length > this.rules.maxTickets) this.tickets.shift();
    this.lastTicket = row;
    if (typeof this.onTicket === 'function') {
      try { this.onTicket(row); } catch (e) { /* сторож не имеет права ломать игру */ }
    }
    return row;
  }

  /** Один подшаг физики (600 Гц). Читает только то, что уже посчитано. */
  substep(s) {
    if (!s || !s.p1 || !Number.isFinite(s.p1.x)) return;
    if (this.probe) { this.probe.substeps++; if (this._armed || this._armedOpp) this.probe.armedSteps++; }
    const PHc = WD_PH(), R = this.rules;
    const p1 = s.p1, p0 = s.p0 || p1;
    const dt = Number.isFinite(s.dt) ? s.dt : 0;

    /* --- 1. сильный удар в стол: мяч внутри плиты -------------------- */
    const inFootprint = Math.abs(p1.x) <= PHc.T_HALF_WID && Math.abs(p1.z) <= PHc.T_HALF_LEN;
    if (inFootprint && p1.y < PHc.TABLE_Y + PHc.R - R.penetrationTol) {
      this._penetrationSteps++;
      if (this._penetrationSteps >= R.penetrationSteps && !this._intoTable) {
        this._intoTable = true;
        const speed = s.ball && Number.isFinite(s.ball.speed) ? s.ball.speed : null;
        if (this.ticket('BALL_INTO_TABLE', {
          time: s.time, depth: +(PHc.TABLE_Y + PHc.R - p1.y).toFixed(4),
          x: +p1.x.toFixed(3), y: +p1.y.toFixed(3), z: +p1.z.toFixed(3),
          speed, strong: speed !== null ? speed >= R.strongSpeed : null,
          ball: { p: [p1.x, p1.y, p1.z], v: s.ball && s.ball.v ? [s.ball.v.x, s.ball.v.y, s.ball.v.z] : null },
        })) { /* один тикет на удар */ }
      }
    } else if (this._penetrationSteps) this._penetrationSteps = 0;

    /* --- 1б. сильный удар за экран: мяч вышел из арены ----------------- */
    if (!this._offArena && (Math.abs(p1.x) > R.arena.x || Math.abs(p1.z) > R.arena.z ||
        p1.y > R.arena.y)) {
      this._offArena = true;
      this.ticket('BALL_OFF_ARENA', {
        time: s.time, x: +p1.x.toFixed(3), y: +p1.y.toFixed(3), z: +p1.z.toFixed(3),
        speed: s.ball && Number.isFinite(s.ball.speed) ? +s.ball.speed.toFixed(2) : null,
      });
    }

    /* --- 2. удар в угол: мяч елозит по кромке -------------------------- */
    const onSurface = Math.abs(p1.y - (PHc.TABLE_Y + PHc.R)) <= R.cornerRestTol;
    const inBand = Math.abs(p1.x) >= PHc.T_HALF_WID - R.cornerBand ||
      Math.abs(p1.z) >= PHc.T_HALF_LEN - R.cornerBand;
    const speed1 = s.ball && Number.isFinite(s.ball.speed) ? s.ball.speed : null;
    if (onSurface && inBand && speed1 !== null && speed1 < R.cornerSlowSpeed) {
      this._stuckSec += dt;
      if (this._stuckSec >= R.cornerStuckSec && !this._cornerStuck) {
        this._cornerStuck = true;
        this.ticket('CORNER_STUCK', {
          time: s.time, seconds: +this._stuckSec.toFixed(3), speed: +speed1.toFixed(3),
          x: +p1.x.toFixed(3), y: +p1.y.toFixed(3), z: +p1.z.toFixed(3),
        });
      }
    } else this._stuckSec = 0;

    /* --- 4. мяч сквозь ракетку ---------------------------------------- */
    /* Номер контакта приходит из applyHit: если он изменился внутри этого
     * подшага, значит мяч всё-таки поймали, и пролёт сквозь клинок — не баг. */
    const seqKnown = s.hitSeq !== undefined;
    if (seqKnown && this._hitSeqSeen === null) this._hitSeqSeen = s.hitSeq;
    const contactThisStep = seqKnown && s.hitSeq !== this._hitSeqSeen;
    if (contactThisStep) this._throughPending = null;
    else if (this._throughPending) this._flushThrough(s.time);
    if (!contactThisStep) {
      if (this._armed && s.pad && s.pad.pos && s.padPrev)
        this._throughCheck(s, p0, p1, 1, s.pad, s.padPrev, s.hitRadius, this._armedMeta, dt);
      const o = s.opp;
      if (this._armedOpp && o && o.pad && o.pad.pos && o.padPrev)
        this._throughCheck(s, p0, p1, -1, o.pad, o.padPrev,
          Number.isFinite(o.hitRadius) ? o.hitRadius : s.hitRadius, this._armedOppMeta, dt);
    }
    if (seqKnown) this._hitSeqSeen = s.hitSeq;

    /* --- 5. подача не от ракетки: мяч ушёл не из точки контакта --------- */
    if (this._serveOffset) {
      const q = this._serveOffset;
      const d = wdDist(p1.x, p1.y, p1.z, q.padX, q.padY, q.padZ);
      if (d > this.rules.serveOffsetTol) {
        this.ticket('SERVE_NOT_FROM_RACKET', {
          time: s.time, variant: 'offset', distance: +d.toFixed(4),
          ball: [ +p1.x.toFixed(3), +p1.y.toFixed(3), +p1.z.toFixed(3) ],
          racket: [ +q.padX.toFixed(3), +q.padY.toFixed(3), +q.padZ.toFixed(3) ],
        });
      }
      this._serveOffset = null;
    }
  }

  /** Пересечение отрезком мяча диска ракетки (та же математика, что в CCD). */
  _crossesBlade(p0, p1, padPrev, padPos, normal, hitRadius, ball, dt) {
    if (!normal || !padPos) return false;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-6)) return false;
    const ux = nx / len, uy = ny / len, uz = nz / len;
    const d0 = (p0.x - padPrev.x) * ux + (p0.y - padPrev.y) * uy + (p0.z - padPrev.z) * uz;
    const d1 = (p1.x - padPos.x) * ux + (p1.y - padPos.y) * uy + (p1.z - padPos.z) * uz;
    if (!(d0 * d1 <= 0) || (d0 === 0 && d1 === 0)) return false;
    if (this.probe) this.probe.planeCrossings++;
    const denom = d0 - d1;
    const t = Math.abs(denom) > 1e-9 ? Math.min(1, Math.max(0, d0 / denom)) : 0.5;
    const qx = p0.x + (p1.x - p0.x) * t, qy = p0.y + (p1.y - p0.y) * t, qz = p0.z + (p1.z - p0.z) * t;
    const cx = padPrev.x + (padPos.x - padPrev.x) * t;
    const cy = padPrev.y + (padPos.y - padPrev.y) * t;
    const cz = padPrev.z + (padPos.z - padPrev.z) * t;
    const ex = qx - cx, ey = qy - cy, ez = qz - cz;
    const dn = ex * ux + ey * uy + ez * uz;
    if (p1.y < WD_PH().TABLE_Y + this.rules.throughSurfaceBand) return false;
    const radial = Math.hypot(ex - ux * dn, ey - uy * dn, ez - uz * dn);
    const blade = (Number.isFinite(hitRadius) ? hitRadius : 0.152) + this.rules.throughRadiusTol;
    if (!(radial <= blade)) return false;
    if (this.probe) this.probe.crossings++;
    /* Считаем ОТНОСИТЕЛЬНОЕ сближение мяча и клинка: удар «от мяча» (грань
     * уходит быстрее мяча) физически не является контактом, и гейт такой
     * удар честно не засчитывает. Ложный тикет здесь дороже пропуска. */
    if (ball && ball.v) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 600;
      const vRx = (padPos.x - padPrev.x) / step;
      const vRy = (padPos.y - padPrev.y) / step;
      const vRz = (padPos.z - padPrev.z) / step;
      const closing = (ball.v.x - vRx) * ux + (ball.v.y - vRy) * uy + (ball.v.z - vRz) * uz;
      if (closing > -this.rules.throughMinClosing) return false;
    }
    if (this.probe) this.probe.approaches++;
    return true;
  }

  /** Пролёт мимо ОДНОГО клинка: ракетка была в контакте, а мяч прошёл. */
  _throughCheck(s, p0, p1, side, pad, padPrev, hitRadius, meta, dt) {
    const flag = side === -1 ? '_throughOpp' : '_through';
    if (this[flag]) return;
    if (!this._crossesBlade(p0, p1, padPrev, pad.pos, pad.normal, hitRadius, s.ball, dt)) return;
    /* Отложенный вердикт: см. throughGraceSec — сначала даём игре шанс
     * применить контакт (он придёт как новый hitSeq). */
    this._throughPending = {
      side, meta, time: s.time, deadline: (Number.isFinite(s.time) ? s.time : 0) + this.rules.throughGraceSec,
      detail: {
        time: s.time, side, aiLevel: meta && meta.aiLevel,
        ball: [ +p0.x.toFixed(3), +p0.y.toFixed(3), +p0.z.toFixed(3) ],
        ballAfter: [ +p1.x.toFixed(3), +p1.y.toFixed(3), +p1.z.toFixed(3) ],
        racket: [ +pad.pos.x.toFixed(3), +pad.pos.y.toFixed(3), +pad.pos.z.toFixed(3) ],
        radius: wdNum(hitRadius),
        who: side === -1 ? 'opponent' : 'player',
        armedShotId: meta && meta.shotId,
        armedStroke: meta && meta.stroke || null,
      },
    };
  }

  /** Просроченный отложенный вердикт: контакт так и не пришёл — это баг. */
  _flushThrough(time) {
    const p = this._throughPending;
    if (!p) return;
    if (!Number.isFinite(time) || time < p.deadline) return;
    this._throughPending = null;
    this[p.side === -1 ? '_throughOpp' : '_through'] = true;
    this.context(p.side, p.meta && p.meta.aiLevel);
    if (p.detail.armedShotId !== undefined) {
      this.ticket('BALL_THROUGH_RACKET', { ...p.detail, resolvedAt: time });
      return;
    }
    this.ticket('BALL_THROUGH_RACKET', p.detail);
  }

  /** Кадр: позы обеих ракеток и видимость мяча. Ничего не копит, кроме
   *  нескольких секунд — 60 Гц не должны стоить кадра. */
  frame(f) {
    if (!f) return;
    this.context(f.side, f.aiLevel);
    const dt = Number.isFinite(f.dt) ? f.dt : 0;
    const R = this.rules, PHc = WD_PH();
    this._racketPose('player', f.player, dt, PHc.TABLE_Y + R.racketFloorOverTable, 1, f.time);
    this._racketPose('opponent', f.opponent, dt, PHc.TABLE_Y + R.opponentFloorOverTable, -1, f.time);
    this._screen(f, dt);
  }

  /** 3. ракетка под столом БЕЗ удара: поза видна и в кадре. */
  _racketPose(who, pad, dt, floorY, side, time) {
    const pos = pad && (pad.pos || pad);
    const key = who === 'opponent' ? '_oppFloorSec' : '_playerFloorSec';
    if (!pos || !Number.isFinite(pos.y)) { this[key] = 0; return; }
    const R = this.rules;
    if (this.probe) { this.probe.poses++; if (wdOverTable(pos, R.racketOverMargin)) this.probe.frames++; }
    if (wdOverTable(pos, R.racketOverMargin) && pos.y < floorY) {
      this[key] += dt;
      if (this[key] >= R.racketFloorDwellSec) {
        this.context(side, null);
        this.ticket('RACKET_UNDER_TABLE', {
          time: wdNum(time), at: 'frame', who, side,
          racket: [ +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3) ],
          floor: +floorY.toFixed(3),
          below: +(floorY - pos.y).toFixed(3),
          seconds: +this[key].toFixed(3),
          overTable: true,
        });
      }
    } else this[key] = 0;
  }

  /** 4. мяч ушёл за границы кадра и при этом вне играбельного объёма. */
  _screen(f, dt) {
    const R = this.rules, PHc = WD_PH(), b = f.ball;
    if (!b || !b.live || !b.p || !Number.isFinite(b.p.x) || typeof f.project !== 'function') {
      this._offScreenSec = 0; return;
    }
    let outPx = 0, projected = false;
    const pr = f.project(b.p);
    const vw = f.viewport && f.viewport.w, vh = f.viewport && f.viewport.h;
    if (pr && pr.ok === true && Number.isFinite(pr.x) && Number.isFinite(pr.y) &&
        Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0) {
      const px = pr.x * vw, py = pr.y * vh;
      outPx = Math.max(-px, px - vw, -py, py - vh);
      projected = true;
    } else outPx = Infinity;              // за камерой — тоже «не видно»
    const outside = Math.abs(b.p.x) > R.screenGuardX || Math.abs(b.p.z) > R.screenGuardZ ||
      b.p.y > PHc.TABLE_Y + R.screenGuardY;
    if (outPx > R.screenMarginPx && this.probe) this.probe.screens++;
    if (outPx > R.screenMarginPx && outside) {
      this._offScreenSec += dt;
      if (this._offScreenSec >= R.screenDwellSec) {
        this._offScreen = true;
        this.ticket('BALL_OFF_ARENA', {
          time: f.time, variant: 'screen', projected,
          outPx: Number.isFinite(outPx) ? Math.round(outPx) : null,
          seconds: +this._offScreenSec.toFixed(3),
          x: +b.p.x.toFixed(3), y: +b.p.y.toFixed(3), z: +b.p.z.toFixed(3),
          speed: b.v ? +Math.hypot(b.v.x, b.v.y, b.v.z).toFixed(2) : null,
        });
      }
    } else this._offScreenSec = 0;
  }

  /** Потолок темпа удара: контракт × снаряжение × бонус за точность. */
  speedLimit(st) {
    const R = this.rules, sc = wdStrokeConfig();
    const cfg = sc && sc.racket ? sc.racket : null;
    const vmax = cfg && Number.isFinite(cfg.vmax) ? cfg.vmax : 19.5;
    const arch = sc && sc.archetypes ? sc.archetypes[st && st.strokeId] : null;
    const archK = arch && Number.isFinite(arch.speed) ? arch.speed : 1;
    const timingK = cfg && cfg.contact && Number.isFinite(cfg.contact.speedBonus) ? cfg.contact.speedBonus : 1.05;
    let limit = vmax * archK * R.equipK * timingK * (1 + R.speedTol);
    if (st && st.strokeId === 'SIDE' && sc && sc.spin && Number.isFinite(sc.spin.sideVmax))
      limit = Math.min(limit, sc.spin.sideVmax * R.equipK * timingK * (1 + R.speedTol));
    if (st && st.side === -1) {
      const L = wdAiLevel(st.aiLevel);
      if (L && Number.isFinite(L.vmagMax))
        limit = Math.min(limit, L.vmagMax * R.aiSpeedSlack);
    }
    return limit;
  }

  /** Потолок вращения: контракт модели (1080 рад/с) — после всех множителей. */
  spinLimit() {
    const sc = wdStrokeConfig();
    const cap = sc && sc.spin && Number.isFinite(sc.spin.cap) ? sc.spin.cap : 1080;
    return cap * (1 + this.rules.spinTol);
  }

  /** Удар состоялся (после ВСЕХ множителей): темп, вращение, журнал бота. */
  stroke(st) {
    if (!st) return;
    this.context(st.side, st.aiLevel);
    if (this.probe) this.probe.strokes++;
    const R = this.rules;
    const vR = st.vR || (st.racket && st.racket.vR);
    const vmag = Number.isFinite(st.vmag) ? st.vmag
      : (vR ? Math.hypot(vR.x, vR.y, vR.z) : null);
    const limit = this.speedLimit(st);
    if (vmag !== null && limit !== null && vmag > limit) {
      this.ticket('SPEED_CEILING', {
        time: st.time, vmag: +vmag.toFixed(3), limit: +limit.toFixed(3),
        over: +(vmag - limit).toFixed(3), strokeId: st.strokeId || null,
        who: st.side === -1 ? 'opponent' : 'player',
      });
    }
    const w = st.ball && st.ball.w;
    const spin = w ? Math.hypot(w.x, w.y, w.z) : null;
    const cap = this.spinLimit();
    if (spin !== null && spin > cap) {
      this.ticket('SPIN_CEILING', {
        time: st.time, spin: +spin.toFixed(2), limit: +cap.toFixed(2),
        over: +(spin - cap).toFixed(2), strokeId: st.strokeId || null,
        who: st.side === -1 ? 'opponent' : 'player',
        w: [ +w.x.toFixed(1), +w.y.toFixed(1), +w.z.toFixed(1) ],
      });
    }
    if (st.side === -1) this._pushAiShot(st, vmag, limit);
  }

  _pushAiShot(st, vmag, limit) {
    if (!Array.isArray(this.aiShots)) this.aiShots = [];
    const b = st.ball || {}, before = st.ballBefore || {};
    const pad = st.racket || {};
    this.aiShots.push({
      time: wdNum(st.time), level: st.aiLevel, tactic: st.tactic || null,
      strokeId: st.strokeId || null, quality: wdNum(st.quality),
      vmag: vmag === null ? null : +vmag.toFixed(3),
      limit: limit === null ? null : +limit.toFixed(3),
      contact: st.contact ? [ +st.contact.x.toFixed(3), +st.contact.y.toFixed(3), +st.contact.z.toFixed(3) ] : null,
      racket: pad.pos ? [ +pad.pos.x.toFixed(3), +pad.pos.y.toFixed(3), +pad.pos.z.toFixed(3) ] : null,
      normal: pad.normal ? [ +pad.normal.x.toFixed(3), +pad.normal.y.toFixed(3), +pad.normal.z.toFixed(3) ] : null,
      before: before.v ? { speed: +Math.hypot(before.v.x, before.v.y, before.v.z).toFixed(2),
        v: [ +before.v.x.toFixed(2), +before.v.y.toFixed(2), +before.v.z.toFixed(2) ] } : null,
      after: b.v ? { speed: +Math.hypot(b.v.x, b.v.y, b.v.z).toFixed(2),
        v: [ +b.v.x.toFixed(2), +b.v.y.toFixed(2), +b.v.z.toFixed(2) ],
        spin: b.w ? +Math.hypot(b.w.x, b.w.y, b.w.z).toFixed(1) : null } : null,
    });
    if (this.aiShots.length > this.rules.maxAiShots) this.aiShots.shift();
  }

  /** Контакт мяча со столом (уже после bounceTable). */
  tableContact(t) {
    if (!t) return;
    const R = this.rules;
    const edge = Number.isFinite(t.edge) ? t.edge : 0;
    if (edge <= 0.25) return;
    const now = Number.isFinite(t.time) ? t.time : null;
    this._edgeTimes.push(now === null ? 0 : now);
    const window = R.cornerRepeatSec;
    this._edgeTimes = this._edgeTimes.filter(x => (now === null ? true : now - x <= window));
    if (this._edgeTimes.length >= R.cornerRepeatCount && !this._cornerRepeat) {
      this._cornerRepeat = true;
      this.ticket('CORNER_REPEAT_CONTACT', {
        time: now, count: this._edgeTimes.length, edge: +edge.toFixed(3),
        axis: t.edgeAxis || null, side: t.side,
        speed: Number.isFinite(t.speed) ? +t.speed.toFixed(2) : null,
      });
    }
  }

  /** Контакт мяча с ракеткой (до того, как поза ракетки «прилипла» к мячу). */
  contact(c) {
    if (!c || !c.contact || !c.pad) return;
    const PHc = WD_PH(), R = this.rules;
    const pad = c.pad, p = c.contact;
    const padX = pad.pos ? pad.pos.x : pad.x, padY = pad.pos ? pad.pos.y : pad.y, padZ = pad.pos ? pad.pos.z : pad.z;
    if (![padX, padY, padZ].every(Number.isFinite)) return;
    this.context(c.side, c.aiLevel);
    this.lastContact = {
      time: wdNum(c.time), side: c.side, serve: !!c.serve,
      point: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
      racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
    };

    /* 3. ракетка под столом — но только пока она висит НАД плитой.
     * За задней линией ракетке разрешено уходить ниже поверхности. */
    const overTable = Math.abs(padX) <= PHc.T_HALF_WID + R.racketOverMargin &&
      Math.abs(padZ) <= PHc.T_HALF_LEN + R.racketOverMargin;
    /* Порог свой у каждой стороны: у игрока клинок поднят контрактом до
     * +0.175 м, у бота он законно опускается к мячу на 4 см над плитой. */
    const floorY = PHc.TABLE_Y + (c.side === -1 ? R.opponentFloorOverTable : R.racketFloorOverTable);
    if (overTable && padY < floorY) {
      this.context(c.side, c.aiLevel);
      this.ticket('RACKET_UNDER_TABLE', {
        time: c.time, at: c.serve ? 'serve_contact' : 'contact',
        who: c.side === -1 ? 'opponent' : 'player',
        racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
        floor: +floorY.toFixed(3),
        below: +(floorY - padY).toFixed(3),
        point: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
      });
    }

    /* 5. подача не от ракетки: контакт далеко от клинка. */
    if (c.serve) {
      const before = c.padBefore || pad.pos || pad;
      const bx = before.x === undefined ? before.pos.x : before.x;
      const by = before.y === undefined ? before.pos.y : before.y;
      const bz = before.z === undefined ? before.pos.z : before.z;
      /* Порог берём из самого контракта: за `serveCaptureRadius` подача
       * физически невозможна, а внешние 20 % сферы — это уже видимый
       * «телепорт» клинка к мячу. Так порог не придуман, а унаследован. */
      const contract = typeof MATCH_RULES !== 'undefined' && Number.isFinite(MATCH_RULES.serveCaptureRadius)
        ? MATCH_RULES.serveCaptureRadius * 0.8 : R.serveBladeDistance;
      if ([bx, by, bz].every(Number.isFinite)) {
        const d = wdDist(p.x, p.y, p.z, bx, by, bz);
        if (d > contract) {
          this.ticket('SERVE_NOT_FROM_RACKET', {
            time: c.time, variant: 'reach', distance: +d.toFixed(4),
            point: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
            racket: [ +bx.toFixed(3), +by.toFixed(3), +bz.toFixed(3) ],
          });
        }
      }
      /* И проверим следующий подшаг: мяч обязан стартовать с клинка.
       * Точка отсчёта — точка контакта (именно туда игра ставит клинок),
       * а не поза до «прилипания»: иначе честный контакт с краю клинка
       * давал бы тикет на каждом ударе. */
      this._serveOffset = { padX: p.x, padY: p.y, padZ: p.z };
    }
  }

  /** Очко закончилось: следующий розыгрыш считается с чистого листа. */
  point() { this.resetShot(); }

  report() {
    const classes = {};
    for (const [name, codes] of Object.entries(WATCHDOG_CLASSES)) {
      classes[name] = codes.reduce((n, code) => n + (this.counts[code] || 0), 0);
    }
    const gates = this.selfTest();
    return {
      version: this.version, rules: this.rules, classes, codes: WATCHDOG_CLASSES,
      counts: { ...this.counts }, total: this.tickets.length, tickets: this.tickets.slice(),
      lastContact: this.lastContact,
      limits: { speed: { vmax: (wdStrokeConfig() && wdStrokeConfig().racket || {}).vmax || 19.5 },
        spin: { cap: this.spinLimit() } },
      aiShots: { total: (this.aiShots || []).length, ring: (this.aiShots || []).slice() },
      probe: { ...this.probe },
      gates,
    };
  }

  /** Гейты сторожа: чистый прогон без тикетов + по одному внедрённому багу
   *  на каждый код. Все зелёные — значит детекторы живы, а «тишина» в
   *  реальной игре не является следствием сломанного сторожа. */
  selfTest() {
    const run = () => {
      const checks = [];
      const fresh = () => new PhysicsWatchdog(this.rules);
      const add = (name, expected, got, extra) => checks.push({ name, expected, got, pass: expected === got, ...(extra || {}) });
      /* Отложенный вердикт «сквозь клинок» ставится только после окна
       * throughGraceSec: здесь это окно проматывается пустым подшагом. */
      const flush = (w, at, seq) => w.substep({ dt: 1 / 600, time: at,
        p0: { x: 0, y: 1.0, z: 1.0 }, p1: { x: 0, y: 1.0, z: 1.0 },
        ball: { v: { x: 0, y: 0, z: 0 }, speed: 0 }, hitSeq: seq });

      /* --- чистый прогон: легальный полёт + контакт, ноль тикетов ------ */
      {
        const w = fresh();
        for (let i = 0; i < 120; i++) {
          const y = 1.35 - i * 0.0025, z = -1.0 + i * 0.012;
          w.substep({ dt: 1 / 600, time: i / 600, p0: { x: 0.1, y: y + 0.003, z: z - 0.01 },
            p1: { x: 0.1, y, z }, ball: { v: { x: 0, y: -1.5, z: 6 }, speed: 6.2 }, hitSeq: 0 });
        }
        w.tableContact({ time: 0.2, edge: 0, edgeAxis: 'z', side: -1, speed: 3.1 });
        w.contact({ time: 0.4, side: 1, serve: false, contact: { x: 0.1, y: 1.0, z: 1.6 },
          pad: { pos: { x: 0.1, y: 1.0, z: 1.6 } } });
        add('clean run: no tickets', 0, w.tickets.length);
      }

      /* --- 1. мяч внутри плиты стола ---------------------------------- */
      {
        const w = fresh(); const PHc = WD_PH();
        for (let i = 0; i < 4; i++) w.substep({ dt: 1 / 600, time: i / 600,
          p0: { x: 0.2, y: PHc.TABLE_Y + PHc.R + 0.01, z: 0.5 },
          p1: { x: 0.2, y: PHc.TABLE_Y + PHc.R - 0.02, z: 0.5 },
          ball: { v: { x: 0, y: -3, z: 0 }, speed: 12.5 }, hitSeq: 0 });
        add('BALL_INTO_TABLE', 1, w.counts.BALL_INTO_TABLE);
      }
      /* --- 1б. мяч за ареной ------------------------------------------ */
      {
        const w = fresh();
        w.substep({ dt: 1 / 600, time: 0, p0: { x: 5.9, y: 1, z: 0 }, p1: { x: 6.4, y: 1, z: 0 },
          ball: { v: { x: 20, y: 0, z: 0 }, speed: 20 }, hitSeq: 0 });
        add('BALL_OFF_ARENA', 1, w.counts.BALL_OFF_ARENA);
      }
      /* --- 2. повторные контакты кромки -------------------------------- */
      {
        const w = fresh();
        w.tableContact({ time: 1.0, edge: 0.7, edgeAxis: 'x', side: -1, speed: 4 });
        w.tableContact({ time: 1.1, edge: 0.8, edgeAxis: 'x', side: -1, speed: 3 });
        add('CORNER_REPEAT_CONTACT', 1, w.counts.CORNER_REPEAT_CONTACT);
      }
      /* --- 2б. мяч елозит по кромке ------------------------------------ */
      {
        const w = fresh(); const PHc = WD_PH();
        for (let i = 0; i < 480; i++) w.substep({ dt: 1 / 600, time: i / 600,
          p0: { x: PHc.T_HALF_WID - 0.01, y: PHc.TABLE_Y + PHc.R, z: 0.4 },
          p1: { x: PHc.T_HALF_WID - 0.01, y: PHc.TABLE_Y + PHc.R, z: 0.4 },
          ball: { v: { x: 0, y: 0, z: 0.2 }, speed: 0.2 }, hitSeq: 0 });
        add('CORNER_STUCK', 1, w.counts.CORNER_STUCK);
      }
      /* --- 3. ракетка под столом --------------------------------------- */
      {
        const w = fresh(); const PHc = WD_PH();
        w.contact({ time: 2, side: 1, serve: false, contact: { x: 0, y: 0.9, z: 0.6 },
          pad: { pos: { x: 0, y: PHc.TABLE_Y - 0.05, z: 0.6 } } });
        add('RACKET_UNDER_TABLE', 1, w.counts.RACKET_UNDER_TABLE);
      }
      /* --- 3б. ракетка под столом ЗА задней линией — не баг ------------ */
      {
        const w = fresh(); const PHc = WD_PH();
        w.contact({ time: 2, side: 1, serve: false, contact: { x: 0, y: 0.5, z: 1.9 },
          pad: { pos: { x: 0, y: PHc.TABLE_Y - 0.3, z: 1.9 } } });
        add('racket below table behind the line: allowed', 0, w.counts.RACKET_UNDER_TABLE);
      }
      /* --- 4. мяч сквозь ракетку --------------------------------------- */
      {
        const w = fresh(); w.arm(true, { shotId: 7 });
        w.substep({ dt: 1 / 600, time: 3, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
          padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
          hitRadius: 0.152, ball: { v: { x: 0, y: 0, z: 6 }, speed: 6 }, hitSeq: 3 });
        flush(w, 3.1, 3);
        add('BALL_THROUGH_RACKET', 1, w.counts.BALL_THROUGH_RACKET);
      }
      /* --- 4б. тот же пролёт без замаха — не баг ----------------------- */
      {
        const w = fresh(); w.arm(false, null);
        w.substep({ dt: 1 / 600, time: 3, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
          padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
          hitRadius: 0.152, ball: { v: { x: 0, y: 0, z: 6 }, speed: 6 }, hitSeq: 3 });
        add('ball through idle racket: allowed', 0, w.counts.BALL_THROUGH_RACKET);
      }
      /* --- 5. подача не от ракетки (далеко и «не туда») ---------------- */
      {
        const w = fresh();
        w.contact({ time: 4, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
          pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0.45, y: 1.1, z: 1.9 } });
        add('SERVE_NOT_FROM_RACKET (reach)', 1, w.counts.SERVE_NOT_FROM_RACKET);
      }
      {
        const w = fresh(); const PHc = WD_PH();
        w.contact({ time: 5, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
          pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0, y: 1.1, z: 1.9 } });
        w.substep({ dt: 1 / 600, time: 5.001, p0: { x: 0, y: 1.2, z: 1.2 }, p1: { x: 0, y: 1.2, z: 1.2 },
          ball: { v: { x: 0, y: 0, z: 4 }, speed: 4 }, hitSeq: 9 });
        add('SERVE_NOT_FROM_RACKET (offset)', 1, w.counts.SERVE_NOT_FROM_RACKET);
      }
      /* --- 4в. тот же пролёт, но сквозь клинок БОТА -------------------- */
      {
        const w = fresh(); w.armOpponent(true, { shotId: 8, stroke: 'DRIVE', aiLevel: 3 });
        w.substep({ dt: 1 / 600, time: 3.5, p0: { x: 0, y: 1.0, z: -1.7 }, p1: { x: 0, y: 1.0, z: -1.9 },
          opp: { pad: { pos: { x: 0, y: 1.0, z: -1.8 }, normal: { x: 0, y: 0, z: 1 } },
            padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
          hitRadius: 0.152, ball: { v: { x: 0, y: 0, z: -6 }, speed: 6 }, hitSeq: 4 });
        flush(w, 3.6, 4);
        add('BALL_THROUGH_RACKET on the bot blade', 1, w.counts.BALL_THROUGH_RACKET);
        add('bot through-racket ticket carries side/aiLevel', '-1/3',
          w.tickets.length ? `${w.tickets[0].side}/${w.tickets[0].aiLevel}` : 'none');
      }
      /* --- 4г. бот НЕ бьёт: пролёт мимо его клинка — не баг ------------- */
      {
        const w = fresh(); w.armOpponent(false, null);
        w.substep({ dt: 1 / 600, time: 3.5, p0: { x: 0, y: 1.0, z: -1.7 }, p1: { x: 0, y: 1.0, z: -1.9 },
          opp: { pad: { pos: { x: 0, y: 1.0, z: -1.8 }, normal: { x: 0, y: 0, z: 1 } },
            padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
          hitRadius: 0.152, ball: { v: { x: 0, y: 0, z: -6 }, speed: 6 }, hitSeq: 4 });
        add('pass beside idle bot blade: allowed', 0, w.counts.BALL_THROUGH_RACKET);
      }
      /* --- 3в. ракетка под столом В КАДРЕ (обе стороны) ----------------- */
      {
        const w = fresh(); const PHc = WD_PH();
        for (let i = 0; i < 12; i++) w.frame({ time: i / 60, dt: 1 / 60,
          player: { pos: { x: 0, y: PHc.TABLE_Y - 0.05, z: 0.4 } },
          opponent: { pos: { x: 0, y: PHc.TABLE_Y + 0.30, z: -1.9 } } });
        add('RACKET_UNDER_TABLE in frame', 1, w.counts.RACKET_UNDER_TABLE);
        add('frame floor ticket names the blade', 'player', w.tickets.length ? w.tickets[0].detail.who : 'none');
      }
      /* --- 3г. бот законно берёт низкий мяч в 4 см над плитой ----------- */
      {
        const w = fresh(); const PHc = WD_PH();
        for (let i = 0; i < 20; i++) w.frame({ time: i / 60, dt: 1 / 60,
          player: { pos: { x: 0, y: PHc.TABLE_Y + 0.30, z: 1.4 } },
          opponent: { pos: { x: 0.2, y: PHc.TABLE_Y + 0.04, z: -0.95 } } });
        add('low bot scoop over the table: allowed', 0, w.counts.RACKET_UNDER_TABLE);
      }
      /* --- 6. потолок темпа удара -------------------------------------- */
      {
        const w = fresh(); const lim = w.speedLimit({ side: -1, strokeId: 'DRIVE', aiLevel: 0 });
        w.stroke({ time: 7, side: -1, aiLevel: 0, strokeId: 'DRIVE', vmag: lim * 1.4,
          ball: { v: { x: 0, y: 0, z: 12 }, w: { x: 0, y: 0, z: 0 } } });
        add('SPEED_CEILING', 1, w.counts.SPEED_CEILING);
      }
      {
        const w = fresh(); const lim = w.speedLimit({ side: -1, strokeId: 'DRIVE', aiLevel: 0 });
        w.stroke({ time: 7, side: -1, aiLevel: 0, strokeId: 'DRIVE', vmag: lim * 0.9,
          ball: { v: { x: 0, y: 0, z: 12 }, w: { x: 0, y: 0, z: 0 } } });
        add('legal stroke under the ceiling: allowed', 0, w.counts.SPEED_CEILING);
      }
      /* --- 6б. потолок вращения ---------------------------------------- */
      {
        const w = fresh();
        w.stroke({ time: 8, side: 1, strokeId: 'LOOP', vmag: 6,
          ball: { v: { x: 0, y: 0, z: 8 }, w: { x: w.spinLimit() * 1.5, y: 0, z: 0 } } });
        add('SPIN_CEILING', 1, w.counts.SPIN_CEILING);
      }
      {
        const w = fresh();
        w.stroke({ time: 8, side: 1, strokeId: 'LOOP', vmag: 6,
          ball: { v: { x: 0, y: 0, z: 8 }, w: { x: w.spinLimit() * 0.8, y: 0, z: 0 } } });
        add('legal spin under the cap: allowed', 0, w.counts.SPIN_CEILING);
      }
      /* --- 4д. мяч ушёл за кадр И вне играбельного объёма ---------------- */
      {
        const w = fresh();
        const project = p => ({ ok: true, x: 0.5, y: -0.6, d: 3 });
        for (let i = 0; i < 20; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0, y: 3.6, z: -3.0 }, v: { x: 0, y: 5, z: -6 } },
          project, viewport: { w: 1280, h: 760 } });
        add('BALL_OFF_ARENA (screen)', 1, w.counts.BALL_OFF_ARENA);
        add('screen ticket variant', 'screen', w.tickets.length ? w.tickets[0].detail.variant : 'none');
      }
      /* --- 4е. честный лоб над столом уходит за кадр — не баг ----------- */
      {
        const w = fresh();
        const project = p => ({ ok: true, x: 0.5, y: -0.4, d: 3 });
        for (let i = 0; i < 40; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0.1, y: 2.4, z: -0.4 }, v: { x: 0, y: 1, z: 0 } },
          project, viewport: { w: 1280, h: 760 } });
        add('legal lob above the frame: allowed', 0, w.counts.BALL_OFF_ARENA);
      }
      /* --- 5б. честная подача: ракетка у мяча, мяч стартует с клинка --- */
      {
        const w = fresh();
        w.contact({ time: 6, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
          pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0.03, y: 1.1, z: 1.9 } });
        w.substep({ dt: 1 / 600, time: 6.001, p0: { x: 0, y: 1.1, z: 1.88 }, p1: { x: 0, y: 1.1, z: 1.88 },
          ball: { v: { x: 0, y: 0, z: 4 }, speed: 4 }, hitSeq: 9 });
        add('clean serve: no tickets', 0, w.tickets.length);
      }
      return checks;
    };
    let checks = [];
    try { checks = run(); } catch (e) {
      return { status: 'red', error: String(e && e.message || e), checks: [] };
    }
    const failed = checks.filter(c => !c.pass);
    return { status: failed.length ? 'red' : 'green', checks, failed: failed.length, ranAt: Date.now() };
  }
}
