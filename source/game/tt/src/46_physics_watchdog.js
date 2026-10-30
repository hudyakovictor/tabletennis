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
  strong_shot: Object.freeze(['BALL_INTO_TABLE', 'BALL_OFF_ARENA']),
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
  arena: Object.freeze({ x: 6.0, z: 8.0, y: 6.0, floor: -0.4 }),
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
    this._hitSeqSeen = null;   // null = счётчик контактов ещё не наблюдали
    this._serveOffset = null;
    this._armed = false;
    this._armedMeta = null;
  }

  /** Состояние гейта на текущий кадр: бьёт ли игрок прямо сейчас. */
  arm(armed, meta) {
    this._armed = !!armed;
    this._armedMeta = meta || null;
  }

  ticket(code, detail = {}) {
    if (!WATCHDOG_CODES.includes(code)) return null;
    const now = wdNum(detail.time);
    const last = this._lastAt[code];
    if (now !== null && Number.isFinite(last) && now - last < this.rules.ticketCooldownSec) return null;
    if (now !== null) this._lastAt[code] = now;
    this.counts[code] = (this.counts[code] || 0) + 1;
    const row = {
      code, time: now, seq: ++this._seq,
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
        p1.y > R.arena.y || p1.y < R.arena.floor)) {
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
    if (this._armed && !contactThisStep && s.pad && s.pad.pos && s.padPrev) {
      if (this._crossesBlade(p0, p1, s.padPrev, s.pad.pos, s.pad.normal, s.hitRadius, s.ball, dt)) {
        if (!this._through) {
          this._through = true;
          this.ticket('BALL_THROUGH_RACKET', {
            time: s.time,
            ball: [ +p0.x.toFixed(3), +p0.y.toFixed(3), +p0.z.toFixed(3) ],
            ballAfter: [ +p1.x.toFixed(3), +p1.y.toFixed(3), +p1.z.toFixed(3) ],
            racket: [ +s.pad.pos.x.toFixed(3), +s.pad.pos.y.toFixed(3), +s.pad.pos.z.toFixed(3) ],
            radius: wdNum(s.hitRadius),
            armedShotId: this._armedMeta && this._armedMeta.shotId,
          });
        }
      }
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
    const denom = d0 - d1;
    const t = Math.abs(denom) > 1e-9 ? Math.min(1, Math.max(0, d0 / denom)) : 0.5;
    const qx = p0.x + (p1.x - p0.x) * t, qy = p0.y + (p1.y - p0.y) * t, qz = p0.z + (p1.z - p0.z) * t;
    const cx = padPrev.x + (padPos.x - padPrev.x) * t;
    const cy = padPrev.y + (padPos.y - padPrev.y) * t;
    const cz = padPrev.z + (padPos.z - padPrev.z) * t;
    const ex = qx - cx, ey = qy - cy, ez = qz - cz;
    const dn = ex * ux + ey * uy + ez * uz;
    const radial = Math.hypot(ex - ux * dn, ey - uy * dn, ez - uz * dn);
    const blade = (Number.isFinite(hitRadius) ? hitRadius : 0.152) + this.rules.throughRadiusTol;
    if (!(radial <= blade)) return false;
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
    return true;
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
    this.lastContact = {
      time: wdNum(c.time), side: c.side, serve: !!c.serve,
      point: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
      racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
    };

    /* 3. ракетка под столом — но только пока она висит НАД плитой.
     * За задней линией ракетке разрешено уходить ниже поверхности. */
    const overTable = Math.abs(padX) <= PHc.T_HALF_WID + R.racketOverMargin &&
      Math.abs(padZ) <= PHc.T_HALF_LEN + R.racketOverMargin;
    if (overTable && padY < PHc.TABLE_Y + R.racketFloorOverTable) {
      this.ticket('RACKET_UNDER_TABLE', {
        time: c.time, at: c.serve ? 'serve_contact' : 'contact',
        racket: [ +padX.toFixed(3), +padY.toFixed(3), +padZ.toFixed(3) ],
        floor: +(PHc.TABLE_Y + R.racketFloorOverTable).toFixed(3),
        below: +(PHc.TABLE_Y + R.racketFloorOverTable - padY).toFixed(3),
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
      lastContact: this.lastContact, gates,
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
