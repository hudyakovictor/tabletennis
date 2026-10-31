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
  racket: Object.freeze(['RACKET_UNDER_TABLE', 'RACKET_OFFSCREEN', 'BALL_THROUGH_RACKET']),
  serve: Object.freeze(['SERVE_NOT_FROM_RACKET']),
  /* Исход удара, а не баг движка: кривой или слишком сильный удар законно
   * уводит мяч за кадр. Пишется всегда, в гейт идёт только cause='engine'. */
  shot_outcome: Object.freeze(['BALL_OFF_FRAME']),
});

/* Тикеты, которые сами по себе доказывают баг движка: если такой случился в
 * этом розыгрыше, уход мяча за кадр тоже получает cause='engine'. */
const WATCHDOG_ENGINE_CODES = Object.freeze([
  'BALL_INTO_TABLE', 'SPEED_CEILING', 'SPIN_CEILING', 'BALL_THROUGH_RACKET',
  'RACKET_UNDER_TABLE', 'RACKET_OFFSCREEN',
]);

/** Коды, которые валят гейт. `BALL_OFF_FRAME` с cause='input' — объяснение,
 *  почему удар не получился, а не аномалия. */
function wdCountsForGate(tickets, counts) {
  const out = { ...counts };
  for (const row of tickets || []) {
    if (row.code === 'BALL_OFF_FRAME' && row.detail && row.detail.cause === 'input') {
      out.BALL_OFF_FRAME = (out.BALL_OFF_FRAME || 0) - 1;
    }
  }
  return out;
}

const WATCHDOG_CODES = Object.freeze(Object.keys(WATCHDOG_CLASSES)
  .reduce((all, name) => all.concat(WATCHDOG_CLASSES[name]), []));

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
  /* Скачок скорости внутри одного подшага без удара и без отскока — это
   * телепорт, а не физика: гравитация добавляет 0.016 м/с за 1/600 с. */
  teleportSpeedJump: 12.0,
  /* Клинок за кадром: игрок видит не то, что бьёт. Порог в пикселях и
   * выдержка — те же, что у мяча, чтобы одиночный кадр не давал тикет. */
  racketOffscreenMarginPx: 24,
  racketOffscreenDwellSec: 0.10,
  screenMarginPx: 24,
  screenDwellSec: 0.25,
  /* Границы «мяч ушёл» в метрах. Замер headless-прогона (все уровни × 200
   * ударов): легальный мяч доходит до apex 2.30 м, |x| 1.71 м, |z| 2.28 м —
   * всё это камера штатно режет по краю, и тикета быть не должно. Пороги
   * стоят выше измеренного максимума на полкорпуса-корпус. */
  maxAiShots: 100,                    // кольцо журнала ударов бота
  /* 0.44 = 80 % от serveCaptureRadius (0.55): внутри сферы захвата подача
   * разрешена контрактом, внешние 20 % — уже видимый телепорт клинка. */
  serveBladeDistance: 0.44,           // м: ракетка должна быть у мяча на подаче
  serveOffsetTol: 0.06,               // м: мяч ушёл не с ракетки после контакта
  ticketCooldownSec: 0.5,             // с: не сыпать одинаковыми тикетами
  /* 256, а не 64: за одну сессию (828 с) набегало 104 тикета, и отчёт
   * показывал только хвост — «44 из 64» вместо полной картины. */
  maxTickets: 256,                    // кольцо; старые вытесняются
  /* Журнал апексов: сколько мяч поднимался над столом после каждого удара
   * и после каждого отскока. Это то, что видно глазом («подпрыгнул выше
   * кадра»), и то, что раньше не мерилось вообще. */
  maxApexRows: 400,
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
    this.apexLog = this.apexLog || [];
    this._ctxSide = null;
    this._ctxLevel = null;
    this._oppFloorSec = 0;
    this._playerFloorSec = 0;
    this._offScreenSec = 0;
    this._offScreen = false;
    this._offscreen = { player: 0, opponent: 0 };
    this._cause = null;
    this._prevSpeed = null;
    this._lastTableContactT = null;
    this._lastStroke = null;
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
    /* Причина «почему мяч улетел»: сначала честный удар, потом — если
     * найдётся баг движка — отметка engine. */
    this._cause = null;
    this._prevSpeed = null;
    this._lastTableContactT = null;
    this._offscreen = { player: 0, opponent: 0 };
    /* Апекс мяча: сколько он поднялся над столом после удара и после
     * отскока. Единицы — метры мира, отчёт переводит в сантиметры. */
    this._apexY = null;
    this._bounceApexY = null;
    this._lastBallY = null;
    this._lastAiShot = null;
    this._snap = null;
    this._penetrationArmed = false;
    this._apexLogged = true;
  }

  /** Отметить причину на этот розыгрыш: 'engine' сильнее 'input'. */
  _markCause(cause, kind, detail) {
    if (cause === 'engine' || !this._cause) {
      this._cause = { cause, kind: kind || null, detail: detail || null,
        time: detail && Number.isFinite(detail.time) ? detail.time : null };
    }
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
    if (WATCHDOG_ENGINE_CODES.includes(code)) this._markCause('engine', code);
    const side = Number.isFinite(detail.side) ? detail.side : this._ctxSide;
    const aiLevel = Number.isFinite(detail.aiLevel) ? detail.aiLevel : this._ctxLevel;
    const row = {
      code, time: now, seq: ++this._seq, side, aiLevel,
      class: Object.keys(WATCHDOG_CLASSES).find(k => WATCHDOG_CLASSES[k].includes(code)) || null,
      /* Причина и виновник — на верхнем уровне: по логу видно, объясняется
       * ли уход мяча ударом, не разбирая detail. */
      ...(detail.cause ? { cause: detail.cause } : {}),
      ...(detail.who ? { who: detail.who } : {}),
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

    /* --- 0а. апекс: как высоко мяч поднимался над столом ---------------- */
    if (Number.isFinite(p1.y)) {
      this._lastBallY = p1.y;
      if (this._apexY === null || p1.y > this._apexY) this._apexY = p1.y;
      if (this._bounceApexY === null || p1.y > this._bounceApexY) this._bounceApexY = p1.y;
    }

    /* --- 0. телепорт и NaN: причина 'engine' для ухода мяча ---------- */
    const nanBall = !Number.isFinite(p1.y) || !Number.isFinite(p1.z) ||
      (s.ball && s.ball.v && (!Number.isFinite(s.ball.v.x) || !Number.isFinite(s.ball.v.y) ||
        !Number.isFinite(s.ball.v.z)));
    if (nanBall) {
      this._markCause('engine', 'nan', { time: s.time, ball: [p1.x, p1.y, p1.z] });
    } else if (s.ball && Number.isFinite(s.ball.speed)) {
      const prev = this._prevSpeed;
      const bounced = this._lastTableContactT !== null && Number.isFinite(s.time) &&
        Math.abs(s.time - this._lastTableContactT) < 0.004;
      const hit = s.hitSeq !== undefined && this._hitSeqSeen !== null && s.hitSeq !== this._hitSeqSeen;
      if (prev !== null && Math.abs(s.ball.speed - prev) > R.teleportSpeedJump && !hit && !bounced) {
        this._markCause('engine', 'speed_jump', {
          time: s.time, before: +prev.toFixed(2), after: +s.ball.speed.toFixed(2),
        });
      }
      this._prevSpeed = s.ball.speed;
    }

    /* --- 1. сильный удар в стол: мяч внутри плиты -------------------- */
    /* Только ВХОД сверху и только живой мяч. Мяч, который промахнулся,
     * скатился с края и уже катится ПОД плитой (в логе: y=0.316, v.y −3.03,
     * глубина 0.46 м), «провалившимся» не является — он и не был над
     * столом. Без этого условия каждый промах под столом давал тикет. */
    const inFootprint = Math.abs(p1.x) <= PHc.T_HALF_WID && Math.abs(p1.z) <= PHc.T_HALF_LEN;
    const surface = PHc.TABLE_Y + PHc.R;
    const ballLive = !(s.ball && s.ball.live === false);
    const below = inFootprint && ballLive && p1.y < surface - R.penetrationTol;
    if (below) {
      if (!this._penetrationArmed && Number.isFinite(p0.y) && p0.y >= surface) this._penetrationArmed = true;
      if (this._penetrationArmed) {
        this._penetrationSteps++;
        if (this._penetrationSteps >= R.penetrationSteps && !this._intoTable) {
          this._intoTable = true;
          const speed = s.ball && Number.isFinite(s.ball.speed) ? s.ball.speed : null;
          if (this.ticket('BALL_INTO_TABLE', {
            time: s.time, depth: +(surface - p1.y).toFixed(4),
            x: +p1.x.toFixed(3), y: +p1.y.toFixed(3), z: +p1.z.toFixed(3),
            speed, strong: speed !== null ? speed >= R.strongSpeed : null,
            ball: { p: [p1.x, p1.y, p1.z], v: s.ball && s.ball.v ? [s.ball.v.x, s.ball.v.y, s.ball.v.z] : null },
          })) { /* один тикет на удар */ }
        }
      }
    } else { this._penetrationSteps = 0; this._penetrationArmed = false; }

    /* --- 1б. сильный удар за экран: мяч вышел из арены ----------------- */
    if (!this._offArena && (Math.abs(p1.x) > R.arena.x || Math.abs(p1.z) > R.arena.z ||
        p1.y > R.arena.y)) {
      this._offArena = true;
      const cause = this._cause ? this._cause.cause : 'input';
      this.ticket('BALL_OFF_ARENA', {
        time: s.time, x: +p1.x.toFixed(3), y: +p1.y.toFixed(3), z: +p1.z.toFixed(3),
        speed: s.ball && Number.isFinite(s.ball.speed) ? +s.ball.speed.toFixed(2) : null,
        ...this.strokeContext(), cause,
        causeKind: this._cause ? this._cause.kind : null,
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
    this._racketOffscreen(f, dt);
    this._screen(f, dt);
  }

  /** 3. ракетка под столом БЕЗ удара: поза видна и в кадре. */
  _racketPose(who, pad, dt, floorY, side, time) {
    const pos = pad && (pad.pos || pad);
    const key = who === 'opponent' ? '_oppFloorSec' : '_playerFloorSec';
    if (!pos || !Number.isFinite(pos.y)) { this[key] = 0; return; }
    const R = this.rules;
    if (this.probe) { this.probe.poses++; if (wdOverTable(pos, R.racketOverMargin)) this.probe.frames++; }
    const mesh = typeof paddleTableClearance === 'function' && (pad.normal || pad.q);
    const clearance = mesh ? paddleTableClearance(pos, pad.normal, pad.roll, WD_PH().TABLE_Y,
      WD_PH().T_HALF_WID, WD_PH().T_HALF_LEN, pad.q) : null;
    const under = mesh ? clearance < -R.penetrationTol : wdOverTable(pos, R.racketOverMargin) && pos.y < floorY;
    if (under) {
      this[key] += dt;
      if (this[key] >= R.racketFloorDwellSec) {
        this.context(side, null);
        this.ticket('RACKET_UNDER_TABLE', {
          time: wdNum(time), at: 'frame', who, side,
          racket: [ +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3) ],
          floor: +floorY.toFixed(3),
          below: +(mesh ? -clearance : floorY - pos.y).toFixed(3),
          geometry: mesh ? 'blade-rubber-handle' : 'center-only',
          seconds: +this[key].toFixed(3),
          overTable: true,
        });
      }
    } else this[key] = 0;
  }

  /** 3б. Клинок за кадром, пока мяч жив: игрок видит не то, что бьёт. */
  _racketOffscreen(f, dt) {
    const R = this.rules, b = f.ball;
    const live = !!(b && b.live);
    const vw = f.viewport && f.viewport.w, vh = f.viewport && f.viewport.h;
    const measurable = live && typeof f.project === 'function' &&
      Number.isFinite(vw) && Number.isFinite(vh) && vw > 0 && vh > 0;
    for (const [who, side] of [['player', 1], ['opponent', -1]]) {
      const pad = who === 'player' ? f.player : f.opponent;
      const pos = pad && (pad.pos || pad);
      if (!pos || !Number.isFinite(pos.x) || !measurable) { this._offscreen[who] = 0; continue; }
      const pr = f.project(pos);
      let outPx = Infinity;
      if (pr && pr.ok === true && Number.isFinite(pr.x) && Number.isFinite(pr.y)) {
        const px = pr.x * vw, py = pr.y * vh;
        outPx = Math.max(-px, px - vw, -py, py - vh);
      }
      if (outPx > R.racketOffscreenMarginPx) {
        this._offscreen[who] += dt;
        if (this._offscreen[who] >= R.racketOffscreenDwellSec) {
          this.context(side, null);
          this.ticket('RACKET_OFFSCREEN', {
            time: wdNum(f.time), who, side,
            racket: [ +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3) ],
            outPx: Number.isFinite(outPx) ? Math.round(outPx) : null,
            seconds: +this._offscreen[who].toFixed(3),
            viewport: { w: vw, h: vh },
          });
        }
      } else this._offscreen[who] = 0;
    }
  }

  /** Мяч ушёл за кадр. Это ИСХОД удара, а не всегда баг: кривой или слишком
   *  сильный удар законно уводит мяч за кадр. Тикет пишется всегда, но в
   *  гейт идёт только cause='engine'. */
  _screen(f, dt) {
    const R = this.rules, b = f.ball;
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
    if (outPx > R.screenMarginPx && this.probe) this.probe.screens++;
    if (outPx > R.screenMarginPx) {
      this._offScreenSec += dt;
      if (this._offScreenSec >= R.screenDwellSec && !this._offScreen) {
        this._offScreen = true;
        const ctx = this.strokeContext();
        const cause = this._cause ? this._cause.cause : 'input';
        this.ticket('BALL_OFF_FRAME', {
          time: f.time, projected, cause,
          causeKind: this._cause ? this._cause.kind : null,
          outPx: Number.isFinite(outPx) ? Math.round(outPx) : null,
          seconds: +this._offScreenSec.toFixed(3),
          x: +b.p.x.toFixed(3), y: +b.p.y.toFixed(3), z: +b.p.z.toFixed(3),
          /* Апекс с последнего удара в сантиметрах над столом: именно его
           * видит игрок, а не пиксели. */
          apexCm: this._apexY === null ? null : Math.round((this._apexY - WD_PH().TABLE_Y) * 100),
          speed: b.v ? +Math.hypot(b.v.x, b.v.y, b.v.z).toFixed(2) : null,
          ...ctx,
        });
      }
    } else this._offScreenSec = 0;
  }

  /** Потолок темпа удара — ФИЗИЧЕСКИЙ, а не «характер архетипа».
   *
   *  `archetypes[id].speed` — это множитель жеста внутри deriveStroke
   *  (40_swipe.js:492: `vmag = clamp(vmag * A.speed * powerScale, vmin, vmax)`),
   *  а не потолок: SIDE со speed 0.33 при сильном жесте всё равно имеет
   *  право дойти до vmax. Пока потолок умножался на этот множитель,
   *  честные PUSH/BLOCK/DRIVE получали SPEED_CEILING (в логе: 12 из 15
   *  тикетов были ложными — 14.47 «против» лимита 12.05).
   *
   *  Реальные потолки: `racket.vmax` для всех, `spin.sideVmax` для SIDE
   *  (его движок режет отдельно, 70_game.js — и не должен обходить),
   *  `AI_LEVELS[].vmagMax` для бота. Снаряжение и бонус за точный контакт
   *  применяются ДО этих потолков, поэтому входят только в допуск. */
  speedLimit(st) {
    const R = this.rules, sc = wdStrokeConfig();
    const cfg = sc && sc.racket ? sc.racket : null;
    const vmax = cfg && Number.isFinite(cfg.vmax) ? cfg.vmax : 19.5;
    const timingK = cfg && cfg.contact && Number.isFinite(cfg.contact.speedBonus) ? cfg.contact.speedBonus : 1.05;
    let limit = vmax * R.equipK * timingK * (1 + R.speedTol);
    if (st && st.strokeId === 'SIDE' && sc && sc.spin && Number.isFinite(sc.spin.sideVmax))
      limit = Math.min(limit, sc.spin.sideVmax * (1 + R.speedTol));
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
    /* Апекс предыдущего удара закрываем ДО смены контекста: если мяч так и
     * не дошёл до стола (сетка, аут), строка всё равно нужна. */
    if (this._apexY !== null && !this._apexLogged) this._finalizeApex(null, null);
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
    /* Контекст последнего удара: нужен тикетам «мяч улетел», чтобы по логу
     * было видно, чем именно били и сколько оставалось до потолка. */
    this._lastStroke = {
      side: st.side === -1 ? -1 : 1,
      aiLevel: Number.isFinite(st.aiLevel) ? st.aiLevel : null,
      strokeId: st.strokeId || null,
      vmag: vmag === null ? null : +vmag.toFixed(3),
      limit: limit === null ? null : +limit.toFixed(3),
      ratio: vmag !== null && limit ? +(vmag / limit).toFixed(3) : null,
      quality: wdNum(st.quality),
      time: wdNum(st.time),
    };
    if (vmag !== null && limit && vmag <= limit) this._markCause('input', 'legal_stroke');
    /* Новый удар: апекс считаем от точки контакта. */
    this._apexY = Number.isFinite(this._lastBallY) ? this._lastBallY : null;
    this._bounceApexY = null;
    this._apexLogged = false;
    if (st.side === -1) this._pushAiShot(st, vmag, limit);
  }

  /** Закрыть строку апекса: сколько мяч поднялся над столом с последнего
   *  удара/отскока. Пишется на каждом отскоке (первый — дуга удара,
   *  второй — дуга после отскока) и на следующем ударе, если стола мяч
   *  так и не коснулся. */
  _finalizeApex(time, speed) {
    if (this._apexY === null) return;
    const PHc = WD_PH(), st = this._lastStroke || null;
    const cm = y => (y === null || !Number.isFinite(y) ? null : Math.round((y - PHc.TABLE_Y) * 100));
    const row = {
      time: wdNum(time),
      side: st ? st.side : null, aiLevel: st ? st.aiLevel : null, strokeId: st ? st.strokeId : null,
      apexCm: cm(this._apexY),
      bounceApexCm: cm(this._bounceApexY),
      speed: wdNum(speed),
    };
    this.apexLog.push(row);
    while (this.apexLog.length > this.rules.maxApexRows) this.apexLog.shift();
    if (this._lastAiShot && st && st.side === -1) {
      this._lastAiShot.apexCm = row.apexCm;
      this._lastAiShot.bounceApexCm = row.bounceApexCm;
    }
    this._apexLogged = true;
    /* Следующий отрезок меряем уже от поверхности: дуга после отскока. */
    this._bounceApexY = null;
  }

  /** Поля последнего удара для тикетов об улетевшем мяче. */
  strokeContext() {
    const s = this._lastStroke;
    if (!s) return { who: null, vmag: null, limit: null, limitRatio: null };
    return {
      who: s.side === -1 ? 'opponent' : 'player',
      aiLevel: s.aiLevel,
      strokeId: s.strokeId,
      vmag: s.vmag, limit: s.limit, limitRatio: s.ratio,
    };
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
      /* Насколько игра ПОДТЯНУЛА клинок к мячу перед ударом. Контракт
       * разрешает 0.42 м (reach в tryAiHit), но именно эта подтяжка
       * выглядит в игре как «ракетка прыгнула к мячу». */
      snap: this._snap && this._snap.who === 'opponent' ? this._snap.reach : null,
      apexCm: null, bounceApexCm: null,
      contact: st.contact ? [ +st.contact.x.toFixed(3), +st.contact.y.toFixed(3), +st.contact.z.toFixed(3) ] : null,
      racket: pad.pos ? [ +pad.pos.x.toFixed(3), +pad.pos.y.toFixed(3), +pad.pos.z.toFixed(3) ] : null,
      normal: pad.normal ? [ +pad.normal.x.toFixed(3), +pad.normal.y.toFixed(3), +pad.normal.z.toFixed(3) ] : null,
      before: before.v ? { speed: +Math.hypot(before.v.x, before.v.y, before.v.z).toFixed(2),
        v: [ +before.v.x.toFixed(2), +before.v.y.toFixed(2), +before.v.z.toFixed(2) ] } : null,
      after: b.v ? { speed: +Math.hypot(b.v.x, b.v.y, b.v.z).toFixed(2),
        v: [ +b.v.x.toFixed(2), +b.v.y.toFixed(2), +b.v.z.toFixed(2) ],
        spin: b.w ? +Math.hypot(b.w.x, b.w.y, b.w.z).toFixed(1) : null } : null,
    });
    /* Ссылка на только что записанную строку: апекс долетит позже, на
     * отскоке, и допишется в неё же. */
    this._lastAiShot = this.aiShots[this.aiShots.length - 1];
    if (this.aiShots.length > this.rules.maxAiShots) this.aiShots.shift();
  }

  /** Контакт мяча со столом (уже после bounceTable). */
  tableContact(t) {
    if (!t) return;
    const R = this.rules;
    if (Number.isFinite(t.time)) this._lastTableContactT = t.time;
    /* Апекс после удара и после отскока — в сантиметрах над столом. */
    this._finalizeApex(t.time, Number.isFinite(t.speed) ? t.speed : null);
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
    /* Насколько клинок «подтянули» к мячу на этом ударе. Раньше это число
     * было недоступно (журнал всегда видел 0.000 м, потому что позу уже
     * переставили в точку контакта), и «ракетка в стороне, а мяч отбит»
     * никак не проверялось. */
    const preSnap = c.padBefore || null;
    const bX = preSnap ? (preSnap.x === undefined ? (preSnap.pos ? preSnap.pos.x : padX) : preSnap.x) : padX;
    const bY = preSnap ? (preSnap.y === undefined ? (preSnap.pos ? preSnap.pos.y : padY) : preSnap.y) : padY;
    const bZ = preSnap ? (preSnap.z === undefined ? (preSnap.pos ? preSnap.pos.z : padZ) : preSnap.z) : padZ;
    const reach = [bX, bY, bZ].every(Number.isFinite) ? wdDist(p.x, p.y, p.z, bX, bY, bZ) : null;
    if (reach !== null) this._snap = { who: c.side === -1 ? 'opponent' : 'player', reach: +reach.toFixed(3) };
    this.lastContact = {
      time: wdNum(c.time), side: c.side, serve: !!c.serve,
      point: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
      racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
      reach: reach === null ? null : +reach.toFixed(3),
    };

    /* 3. ракетка под столом — но только пока она висит НАД плитой.
     * За задней линией ракетке разрешено уходить ниже поверхности. */
    const overTable = Math.abs(padX) <= PHc.T_HALF_WID + R.racketOverMargin &&
      Math.abs(padZ) <= PHc.T_HALF_LEN + R.racketOverMargin;
    /* Порог свой у каждой стороны: у игрока клинок поднят контрактом до
     * +0.175 м, у бота он законно опускается к мячу на 4 см над плитой. */
    const floorY = PHc.TABLE_Y + (c.side === -1 ? R.opponentFloorOverTable : R.racketFloorOverTable);
    const mesh = typeof paddleTableClearance === 'function' && (pad.normal || pad.q);
    const clearance = mesh ? paddleTableClearance(pad.pos || pad, pad.normal, pad.roll,
      PHc.TABLE_Y, PHc.T_HALF_WID, PHc.T_HALF_LEN, pad.q) : null;
    if (mesh ? clearance < -R.penetrationTol : overTable && padY < floorY) {
      this.context(c.side, c.aiLevel);
      this.ticket('RACKET_UNDER_TABLE', {
        time: c.time, at: c.serve ? 'serve_contact' : 'contact',
        who: c.side === -1 ? 'opponent' : 'player',
        racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
        floor: +floorY.toFixed(3),
        below: +(mesh ? -clearance : floorY - padY).toFixed(3),
        geometry: mesh ? 'blade-rubber-handle' : 'center-only',
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

  /** Сколько тикетов объяснено законным ударом, а сколько — багом движка. */
  _causeCounts() {
    const out = { input: 0, engine: 0 };
    for (const row of this.tickets) {
      const c = row.detail && row.detail.cause;
      if (c === 'input') out.input++;
      else if (c === 'engine') out.engine++;
    }
    return out;
  }

  /** Медиана/максимум по списку чисел — без внешних зависимостей. */
  _stats(list) {
    const xs = (list || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!xs.length) return null;
    const at = p => xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * p)))];
    return { n: xs.length, median: at(0.5), p90: at(0.9), max: xs[xs.length - 1] };
  }

  /** Апекс мяча над столом в сантиметрах: сколько он поднимался после удара
   *  и после отскока. Именно это видит игрок, а не пиксели за краем кадра. */
  apexSummary() {
    const rows = this.apexLog || [];
    const pick = (who, key) => this._stats(rows.filter(r => (who === 'all' || r.side === who))
      .map(r => r[key]));
    const shape = who => ({
      afterStroke: pick(who, 'apexCm'),
      afterBounce: pick(who, 'bounceApexCm'),
      ballSpeed: pick(who, 'speed'),
    });
    /* По ударам: видно, что у SERVE_TOP и LOB дуга выше, чем у DRIVE. */
    const byStroke = {};
    for (const r of rows) {
      const k = r.strokeId || 'none';
      (byStroke[k] = byStroke[k] || []).push(r);
    }
    for (const k of Object.keys(byStroke)) {
      const list = byStroke[k];
      byStroke[k] = { n: list.length, apex: this._stats(list.map(r => r.apexCm)),
        afterBounce: this._stats(list.map(r => r.bounceApexCm)) };
    }
    return {
      unit: 'cm over the table surface',
      all: shape('all'), player: shape(1), opponent: shape(-1), byStroke,
      rows: rows.length,
      recent: rows.slice(-20),
    };
  }

  /** Сколько игра подтягивает клинок к мячу перед ударом бота. */
  snapSummary() {
    const shots = (this.aiShots || []).filter(s => Number.isFinite(s.snap));
    return { ...(this._stats(shots.map(s => s.snap)) || { n: 0, median: null, p90: null, max: null }),
      contract: 0.42 };
  }

  /** Замеры бота по УРОВНЯМ: заявленный потолок один, а фактический темп
   *  и высота мяча по уровням разные — по этому блоку видно, что “уровень
   *  сильнее” означает больше скорости, а не больше высоты. */
  aiLevelSummary() {
    const shots = this.aiShots || [];
    const levels = Array.from(new Set(shots.map(s => s.level).filter(Number.isFinite))).sort();
    const out = {};
    for (const level of levels) {
      const mine = shots.filter(s => s.level === level);
      out[level] = {
        shots: mine.length,
        speeds: this._stats(mine.map(s => s.after && s.after.speed)),
        vmag: this._stats(mine.map(s => s.vmag)),
        apex: this._stats(mine.map(s => s.apexCm)),
        snap: this._stats(mine.map(s => s.snap)),
        overCeiling: mine.filter(s => Number.isFinite(s.vmag) && Number.isFinite(s.limit) && s.vmag > s.limit).length,
      };
    }
    return out;
  }

  report() {
    const classes = {};
    for (const [name, codes] of Object.entries(WATCHDOG_CLASSES)) {
      classes[name] = codes.reduce((n, code) => n + (this.counts[code] || 0), 0);
    }
    const gates = this.selfTest();
    return {
      version: this.version, rules: this.rules, classes, codes: WATCHDOG_CLASSES,
      counts: { ...this.counts }, total: this.tickets.length, tickets: this.tickets.slice(),
      /* cause='input' — законный исход удара: в счёт аномалий не идёт. */
      gateCounts: wdCountsForGate(this.tickets, this.counts),
      causes: this._causeCounts(),
      lastStroke: this._lastStroke,
      lastContact: this.lastContact,
      limits: { speed: { vmax: (wdStrokeConfig() && wdStrokeConfig().racket || {}).vmax || 19.5 },
        spin: { cap: this.spinLimit() } },
      apex: this.apexSummary(),
      aiShots: { total: (this.aiShots || []).length, ring: (this.aiShots || []).slice(),
        snap: this.snapSummary(), byLevel: this.aiLevelSummary() },
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
      const firstOf = (w, code) => w.tickets.find(t => t.code === code) || null;
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
      /* --- 4д. законный удар увёл мяч за кадр: тикет есть, гейт чист ---- */
      {
        const w = fresh();
        w.stroke({ time: 0.5, side: 1, strokeId: 'DRIVE', vmag: 6,
          ball: { v: { x: 0, y: 0, z: 9 }, w: { x: 0, y: 0, z: 0 } } });
        const project = p => ({ ok: true, x: 0.5, y: -0.6, d: 3 });
        for (let i = 0; i < 20; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0, y: 1.2, z: -0.4 }, v: { x: 0, y: 3, z: -6 } },
          project, viewport: { w: 1280, h: 760 } });
        add('BALL_OFF_FRAME (legal shot)', 1, w.counts.BALL_OFF_FRAME);
        add('off-frame cause=input', 'input', (firstOf(w, 'BALL_OFF_FRAME') || {}).detail?.cause || 'none');
        add('off-frame input does not fail the gate', 0,
          wdCountsForGate(w.tickets, w.counts).BALL_OFF_FRAME);
      }
      /* --- 4д2. мяч улетел после бага движка: cause=engine, гейт красный -- */
      {
        const w = fresh();
        const lim = w.speedLimit({ side: -1, strokeId: 'DRIVE', aiLevel: 0 });
        w.stroke({ time: 0.5, side: -1, aiLevel: 0, strokeId: 'DRIVE', vmag: lim * 1.8,
          ball: { v: { x: 0, y: 0, z: 9 }, w: { x: 0, y: 0, z: 0 } } });
        const project = p => ({ ok: true, x: 0.5, y: -0.6, d: 3 });
        for (let i = 0; i < 20; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0, y: 1.2, z: -0.4 }, v: { x: 0, y: 3, z: -6 } },
          project, viewport: { w: 1280, h: 760 } });
        add('off-frame cause=engine', 'engine', (firstOf(w, 'BALL_OFF_FRAME') || {}).detail?.cause || 'none');
        add('off-frame engine fails the gate', 1,
          wdCountsForGate(w.tickets, w.counts).BALL_OFF_FRAME);
        const off = firstOf(w, 'BALL_OFF_FRAME');
        add('off-frame carries vmag/limit', 'yes',
          off && Number.isFinite(off.detail.limitRatio) && Number.isFinite(off.detail.vmag) ? 'yes' : 'none');
      }
      /* --- 4е. лоб: камера его режет, но это законный удар ---------------- */
      {
        const w = fresh();
        w.stroke({ time: 0.2, side: 1, strokeId: 'LOB', vmag: 5,
          ball: { v: { x: 0, y: 6, z: -3 }, w: { x: 0, y: 0, z: 0 } } });
        const project = p => ({ ok: true, x: 0.5, y: -0.4, d: 3 });
        for (let i = 0; i < 40; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0.1, y: 2.4, z: -0.4 }, v: { x: 0, y: 1, z: 0 } },
          project, viewport: { w: 1280, h: 760 } });
        add('legal lob off the frame is not an anomaly', 0,
          wdCountsForGate(w.tickets, w.counts).BALL_OFF_FRAME);
      }
      /* --- 3д. клинок за кадром, пока мяч жив -------------------------- */
      {
        const w = fresh();
        const outProj = p => (p.y > 1.5 ? { ok: true, x: 0.5, y: 2.2, d: 3 } : { ok: true, x: 0.5, y: 0.5, d: 3 });
        for (let i = 0; i < 12; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0, y: 1.1, z: 1.2 }, v: { x: 0, y: 0, z: 4 } },
          player: { pos: { x: 0, y: 1.1, z: 1.7 } },
          opponent: { pos: { x: 0, y: 2.0, z: -1.5 } },
          project: outProj, viewport: { w: 1280, h: 760 } });
        add('RACKET_OFFSCREEN', 1, w.counts.RACKET_OFFSCREEN);
        add('offscreen ticket names the blade', 'opponent', (firstOf(w, 'RACKET_OFFSCREEN') || {}).detail?.who || 'none');
      }
      {
        const w = fresh();
        const inProj = () => ({ ok: true, x: 0.5, y: 0.5, d: 3 });
        for (let i = 0; i < 12; i++) w.frame({ time: i / 60, dt: 1 / 60,
          ball: { live: true, p: { x: 0, y: 1.1, z: 1.2 }, v: { x: 0, y: 0, z: 4 } },
          player: { pos: { x: 0, y: 1.1, z: 1.7 } }, opponent: { pos: { x: 0, y: 1.0, z: -1.5 } },
          project: inProj, viewport: { w: 1280, h: 760 } });
        add('blades in frame: allowed', 0, w.counts.RACKET_OFFSCREEN);
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
      /* --- 1в. мяч уже ПОД плитой (промах, укатился) — не баг ---------- */
      {
        const w = fresh(); const PHc = WD_PH();
        for (let i = 0; i < 6; i++) w.substep({ dt: 1 / 600, time: i / 600,
          p0: { x: 0.3, y: PHc.TABLE_Y - 0.40, z: 0.4 },
          p1: { x: 0.3, y: PHc.TABLE_Y - 0.42, z: 0.4 },
          ball: { v: { x: 0, y: -3, z: 0.2 }, speed: 3 }, hitSeq: 0 });
        add('ball rolling under the plate: allowed', 0, w.counts.BALL_INTO_TABLE);
      }
      /* --- 7. апекс мяча в сантиметрах над столом ---------------------- */
      {
        const w = fresh(); const PHc = WD_PH();
        w.substep({ dt: 1 / 600, time: 0, p0: { x: 0, y: PHc.TABLE_Y + 0.3, z: 1.0 },
          p1: { x: 0, y: PHc.TABLE_Y + 0.3, z: 1.0 },
          ball: { v: { x: 0, y: 3, z: -4 }, speed: 5 }, hitSeq: 0 });
        w.stroke({ time: 0.01, side: 1, strokeId: 'LOB', vmag: 5,
          ball: { v: { x: 0, y: 3, z: -4 }, w: { x: 0, y: 0, z: 0 } } });
        let y = PHc.TABLE_Y + 0.3;
        for (let i = 1; i <= 60; i++) {
          y += 0.02;
          w.substep({ dt: 1 / 600, time: 0.01 + i / 600, p0: { x: 0, y: y - 0.02, z: 1.0 },
            p1: { x: 0, y, z: 1.0 }, ball: { v: { x: 0, y: 1, z: -4 }, speed: 4 }, hitSeq: 0 });
        }
        w.tableContact({ time: 0.2, edge: 0, edgeAxis: 'z', side: -1, speed: 4 });
        const row = w.apexLog[w.apexLog.length - 1] || null;
        add('apex is measured in cm over the table', 'yes', row && row.apexCm > 100 ? 'yes' : 'no');
      }
      /* --- 8. подтяжка клинка к мячу записана ------------------------- */
      {
        const w = fresh();
        w.contact({ time: 2, side: -1, contact: { x: 0, y: 1.0, z: -1.6 },
          pad: { pos: { x: 0, y: 1.0, z: -1.6 } }, padBefore: { x: 0.2, y: 1.0, z: -1.6 } });
        add('blade snap distance is recorded', 0.2, w.lastContact.reach);
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
