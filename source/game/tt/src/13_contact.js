/* =====================================================================
 *  CONTACT SYSTEM — единый модуль решения «засчитывается ли касание».
 *
 *  До этой версии логика была размазана по трём несогласованным слоям:
 *    1) экранный гейт нажатия в CSS-пикселях (12_match_rules.js),
 *    2) физический захват в метрах (12_match_rules.js / CCD в 70_game.js),
 *    3) тайминги жеста и проверка направления — магические числа в 70_game.js.
 *  Из-за этого нарисованная зона, допуск нажатия и реальный контакт жили
 *  по разным контрактам («палец в зоне, а мяч не отбивается»).
 *
 *  Модуль НЕ вводит новых правил физики: MATCH_RULES остаётся замороженным
 *  контрактом, а 12_match_rules.js — библиотекой чистой геометрии. Здесь
 *  живёт только ОРКЕСТРАЦИЯ: один источник таймингов, одна точка допуска
 *  нажатия, обновление зоны по живому прогнозу и одна проверка направления.
 *
 *  Жёсткий инвариант (на него опираются тесты press-zone.test.js):
 *  нажатие, не допущенное в момент pointerdown, НИКОГДА не становится
 *  допущенным позже. Обновление зоны может только уточнять геометрию уже
 *  принятого нажатия, но не воскрешать отклонённое.
 * ===================================================================== */
'use strict';

/* Один источник правды для всех окон намерения. Значения заморожены
 * контрактом slowmo-hit/press-zone тестов: розыгрыш 0.18/0.25/2.5,
 * подача 1.15, кулдаун контакта 0.09 с. */
const CONTACT_TIMING = Object.freeze({
  rally: Object.freeze({ liveWin: 0.18, deadWin: 0.25, heldWin: 2.5, attemptWin: 0.25 }),
  serve: Object.freeze({ liveWin: 1.15, deadWin: 1.15, heldWin: 1.15, attemptWin: 1.15 }),
  hitCooldown: 0.09,
  /* На сколько зона, зафиксированная на pointerdown, может «уплыть» при
   * дрейфе прогноза (шнур, вращение, аэро), прежде чем нажатие перестанет
   * считаться принадлежащим точке встречи. В долях нормированного скора
   * овала: 1.0 = его граница, 1.25 = запас в четверть размера. */
  driftScoreLimit: 1.25,
});

function contactTimingFor(serving) {
  return serving ? CONTACT_TIMING.serve : CONTACT_TIMING.rally;
}

/* Время устройства для МЕТРИК РУКИ (скорость, длина, дуга). Симуляционное
 * время остаётся в SwipeTracker.sampleSimTime и отвечает за свежесть.
 * Без DOM (тесты, реплеи) вызывающая сторона передаёт число сама. */
function gestureWallTime(event) {
  if (event && Number.isFinite(event.timeStamp) && event.timeStamp > 0) return event.timeStamp / 1000;
  return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
}

const ContactSystem = {
  timing: CONTACT_TIMING,
  timingFor: contactTimingFor,
  wallTime: gestureWallTime,

  /* Полуоси экранного гейта с учётом тренировочного прощения.
   * Боевое прощение всегда 1.0, поэтому замороженные тесты геометрии
   * не меняются; урок передаёт CAPTURE_FORGIVE (1.55) и рисует/судит
   * ту же зону, которую физика реально прощает. */
  gateExtents(pointerType, scale, forgive = 1) {
    const ext = contactGateExtents(pointerType, scale);
    const k = Number.isFinite(forgive) && forgive > 0 ? forgive : 1;
    if (k === 1) return ext;
    return { ...ext, sidePx: ext.sidePx * k, fwdPx: ext.fwdPx * k, backPx: ext.backPx * k, forgive: k };
  },

  /* Главная точка допуска: вызывается ТОЛЬКО на pointerdown.
   * Возвращает объект зоны в том же контрактном формате, что и
   * pressContactZone/pressZoneForBall, плюс служебные поля. */
  evaluatePress(game, pointer, rect, pointerType, event) {
    const wallT = gestureWallTime(event);
    const state = game.state;
    const servingNow = state === GS.SERVE_TOSS && game.server === 1;
    const tossStart = state === GS.SERVE_READY && game.server === 1;

    /* Тап, запускающий подброс, — это команда «подбрось», а не удар:
     * мяч ещё не live. Раньше он штамповался РАЛЛИЙНОЙ зоной, и продолжение
     * того же драга в удар по тоссу судилось чужой геометрией. Ставим
     * нейтральный серверный штамп: легальность подброса всё равно
     * проверяет физика в момент контакта (падение, высота). */
    if (tossStart) {
      return this._serveTossStamp(game, pointer, rect, pointerType, wallT);
    }

    const forgive = typeof getCaptureForgiveness === 'function' ? getCaptureForgiveness() : 1;
    let zone = null;
    if (!servingNow && MATCH_RULES.zoneAnchor === 'contact') {
      const cp = game.contactPrediction();
      if (cp) {
        const screen = game.project(cp.p, {});
        if (screen && screen.ok) {
          zone = pressContactZone(screen, pointer, rect.width, rect.height, {
            pointerType, scale: game.contactGateScale(cp.p, rect), forgive,
          });
          if (zone) { zone.lead = Number.isFinite(cp.t) ? cp.t : null; }
        }
      }
    }
    if (!zone) {
      zone = pressZoneForBall(game.ball, pointer, rect.width, rect.height, {
        project: (point) => game.project(point, {}), pointerType,
        referenceWorld: game.player && game.player.pos,
        kind: servingNow ? 'serve' : 'rally',
        tossApex: game.tossApex, tossStartY: game.tossStartY, tableY: PH.TABLE_Y,
        forgive,
      });
    }
    if (!zone) {
      zone = { accepted: false, shape: MATCH_RULES.zoneShape,
        radius: MATCH_RULES.pressRadiusPx, distancePx: null, score: null, along: null,
        across: null, reason: 'OUTSIDE_ZONE', pointerType };
    }
    zone.pressX = pointer.x; zone.pressY = pointer.y;
    zone.vw = rect.width; zone.vh = rect.height;
    zone.pointerType = pointerType;
    zone.pressT = game.time;
    zone.pressWallT = wallT;
    zone.serving = state === GS.SERVE_READY || state === GS.SERVE_TOSS;
    zone.pressContactable = !!(game._strike && game._strike.on && game._strike.contactable);
    zone.shotId = game.shotId;
    zone.forgive = forgive;
    return zone;
  },

  _serveTossStamp(game, pointer, rect, pointerType, wallT) {
    const ext = this.gateExtents(pointerType, null, 1);
    const screen = game.ball && game.ball.p ? game.project(game.ball.p, {}) : null;
    const cx = screen && screen.ok ? screen.x * rect.width : rect.width * 0.5;
    const cy = screen && screen.ok ? screen.y * rect.height : rect.height * 0.6;
    return {
      accepted: true, shape: 'oval', reason: null, kind: 'serve-toss',
      anchor: 'contact', x: cx, y: cy, radius: Math.max(ext.fwdPx, ext.sidePx),
      sidePx: ext.sidePx, fwdPx: ext.fwdPx, backPx: ext.backPx,
      pointerX: pointer.x * rect.width, pointerY: pointer.y * rect.height,
      distancePx: Math.hypot(pointer.x * rect.width - cx, pointer.y * rect.height - cy),
      score: 0, along: 0, across: 0, pointerType,
      pressX: pointer.x, pressY: pointer.y, vw: rect.width, vh: rect.height,
      pressT: game.time, pressWallT: wallT, serving: true, shotId: game.shotId,
      pressContactable: false, lead: null, forgive: 1,
    };
  },

  /* Покадровое уточнение принятого нажатия. Вызывается, пока палец на стекле.
   * Инвариант: rejected-зоны не трогаются вовсе (false → true запрещён). */
  refreshPressZone(game) {
    const sw = game.swipe;
    if (!sw || !sw.active) return;
    const pz = sw.pressZone;
    if (!pz || !pz.accepted || pz.anchor !== 'contact' || pz.serving || pz.kind === 'serve-toss') return;
    const cp = game.contactPrediction();
    if (!cp) return;
    const rect = game.canvas && game.canvas.getBoundingClientRect ? game.canvas.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;
    const center = game.project(cp.p, {});
    if (!center || !center.ok) return;
    const forgive = Number.isFinite(pz.forgive) ? pz.forgive : 1;
    const z = pressContactZone(center, { x: pz.pressX, y: pz.pressY }, rect.width, rect.height, {
      pointerType: pz.pointerType, scale: game.contactGateScale(cp.p, rect), forgive,
    });
    if (!z) return;
    if (!(z.score <= CONTACT_TIMING.driftScoreLimit)) { pz.driftedOut = true; return; }
    /* Палец всё ещё принадлежит уплывшей точке встречи — переносим геометрию
     * на живой прогноз. accepted/reason/штамп нажатия не меняются. */
    pz.x = z.x; pz.y = z.y;
    pz.sidePx = z.sidePx; pz.fwdPx = z.fwdPx; pz.backPx = z.backPx;
    pz.axisX = z.axisX; pz.axisY = z.axisY;
    pz.shape = z.shape; pz.score = z.score; pz.radius = z.radius;
    pz.edgeClamped = z.edgeClamped; pz.lead = Number.isFinite(cp.t) ? cp.t : pz.lead;
    pz.drifted = true;
  },

  /* Единая проверка направления. Раньше в овале был предел 0 для touch,
   * в игре — порог, скачущий от длины жеста (-0.12/0). Теперь контракт один:
   * мышь -0.30, палец/перо -0.12, без зависимости от длины жеста.
   * Касание на самом центре (dist<4px) и тап всегда проходят. */
  directionAllows(zone, metrics) {
    if (!zone || !zone.accepted || !metrics) return true;
    if (metrics.tap === true) return true;
    if (zone.directionOk === true) return true;
    if (zone.directionOk === false) return false;
    if (![zone.x, zone.y, zone.pointerX, zone.pointerY, metrics.dx, metrics.dy]
        .every(Number.isFinite)) return true;
    const toBallX = zone.x - zone.pointerX, toBallY = zone.y - zone.pointerY;
    const swipeX = metrics.dx * (zone.vw > 0 ? zone.vw : 1);
    const swipeY = metrics.dy * (zone.vh > 0 ? zone.vh : 1);
    const dist = Math.hypot(toBallX, toBallY);
    const len = Math.hypot(swipeX, swipeY);
    if (dist < 4) { zone.directionDot = 1; zone.directionOk = true; return true; }
    if (!(len > 1e-9)) return false;
    const dot = (swipeX * toBallX + swipeY * toBallY) / (len * dist);
    const limit = zone.pointerType === 'mouse' ? -0.3 : -0.12;
    zone.directionDot = dot;
    zone.directionOk = dot > limit;
    if (!zone.directionOk) {
      zone.accepted = false;
      zone.reason = 'WRONG_DIRECTION';
    }
    return zone.directionOk;
  },

  /* Покрывает ли ЖИВОЙ штамп зоны текущую экранную позицию мяча. Считает тот
   * же овальный скор, что pressHitZoneOval при допуске нажатия, но по
   * спроецированному мячу, а не по пальцу. Нужно, чтобы нарисованный овал
   * не врал: нажатие допущено и мяч визуально внутри зоны — обещание зоны
   * должно исполняться даже при рассинхроне px-гейта и 3D-захвата. */
  gateCoversBall(game, ball, zone) {
    if (!zone || zone.accepted !== true || !ball || !ball.p || !zone.vw || !zone.vh) return false;
    const screen = game.project(ball.p, {});
    if (!screen || !screen.ok) return false;
    const bx = screen.x * zone.vw, by = screen.y * zone.vh;
    const dx = bx - zone.x, dy = by - zone.y;
    if (Number.isFinite(zone.axisX) && Number.isFinite(zone.axisY) &&
        Number.isFinite(zone.sidePx) && zone.sidePx > 0) {
      const along = dx * zone.axisX + dy * zone.axisY;
      const across = -dx * zone.axisY + dy * zone.axisX;
      const longExt = along >= 0 ? zone.fwdPx : zone.backPx;
      if (!(Number.isFinite(longExt) && longExt > 0)) return false;
      return Math.hypot(along / longExt, across / zone.sidePx) <= 1;
    }
    const r = Number.isFinite(zone.radius) ? zone.radius : 0;
    return Math.hypot(dx, dy) <= r;
  },

  /* Допуск фазы сближения для endpoint-контакта. Физический подшаг на
   * быстром мяче проходит 4-6 см, поэтому фиксированные -2 см иногда
   * пропускали фазу «ближайшей точки» и полагались только на CCD.
   * Допуск теперь не меньше полутора подшагов траектории. */
  closestTolerance(ball) {
    const speed = ball && ball.v ? Math.hypot(ball.v.x || 0, ball.v.y || 0, ball.v.z || 0) : 0;
    return Math.max(0.02, speed * PH.SIM_DT * 1.5);
  },

  /* Зелёная готовность удара с упреждением: физический контакт ещё не
   * наступил, но окно удара уже горячее (ready>.82). Подсветка больше не
   * загорается ровно в момент, когда бить уже поздно. */
  strikeArmed(windowObj) {
    return !!(windowObj && windowObj.on &&
      (windowObj.contactable || windowObj.ready >= 0.82));
  },
};

/* Прогноз встречи имеет право существовать и для зависшего мяча у апексы:
 * жёсткий порог v.z>0.2 выключал contact-гейт на свечах/укороченных, и игра
 * молча переключалась на ball-овал другой формы. -0.2 сохраняет отсечение
 * мячей, которые уже летят ОТ игрока. */
function contactPredictionAllowed(ball, state) {
  return !!(ball && ball.live && ball.lastHitBy === -1 && state === GS.RALLY &&
    Number.isFinite(ball.v && ball.v.z) && ball.v.z > -0.2);
}
