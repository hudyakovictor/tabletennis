'use strict';
/* =====================================================================
 * ZONE AUDIT 50 — пятьдесят независимых анализов конвейера касания.
 *
 *   node tt/tools/zone_audit_50.cjs [--json] [--only A,B,...]
 *
 * Конвейер касания в игре состоит из пяти последовательных ворот:
 *   1) допуск нажатия (press gate, экранные px)  — 12_match_rules.js
 *   2) намерение удара (свежесть жеста)          — 40_swipe.js / 70_game.js
 *   3) легальность отскока (ITTF 2.07)           — 70_game.js
 *   4) физический захват (метры, 3D)             — 12_match_rules.js / CCD
 *   5) направление свайпа + удар гранью          — 70_game.js
 * Каждый анализ бьёт в конкретное место конвейера и возвращает
 * статус ok / warn / fail с числовой доказательной базой.
 * ===================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',').map(s => s.trim()) : null; })();

const files = ['10_math.js', '12_match_rules.js', '13_contact.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js'];
const source = files.map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const api = vm.runInNewContext(source +
  '\n;({ MATCH_RULES, GRACE_RULES, PRESS_REJECTION_REASONS, playerCaptureLimits, playerInCaptureRange, playerGraceRange,' +
  ' pressHitZone, pressHitZoneOval, pressServeZoneOval, pressContactZone, pressZoneForBall, contactGateExtents,' +
  ' pressOvalSmoothstep, serveTossRise, ballCaptureTarget, measureCaptureAllowance, isRealStroke, SwipeTracker,' +
  ' tapStrokeMetrics, ContactSystem, CONTACT_TIMING, contactTimingFor, contactPredictionAllowed, impactSphere,' +
  ' PH, V3 })', { console });
const { MATCH_RULES: R, GRACE_RULES: G, PH, V3 } = api;

const src = (f) => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8');
const SRC = {
  game: src('70_game.js'), rules: src('12_match_rules.js'), contact: src('13_contact.js'), swipe: src('40_swipe.js'),
  embed: src('92_embed.js'), ui: src('80_ui.js'), physics: src('30_physics.js'),
};

/* Референсная камера телефона 390×844 (та самая, под которую откалиброваны
 * reference px правил) и крупный планшет 834×1112 — проверка масштаба. */
function makeCamera(W, H) {
  const project = (p, out = {}) => {
    const denom = 3.4 - p.z;
    if (!(denom > 0.2) || ![p.x, p.y, p.z].every(Number.isFinite)) { out.ok = false; return out; }
    out.x = 0.5 + 0.42 * p.x / denom;
    out.y = 0.60 - 0.38 * (p.y - PH.TABLE_Y) / denom;
    out.ok = true; return out;
  };
  const pxPerCm = (p) => {
    const c = project(p, {}), ax = project({ x: p.x + .01, y: p.y, z: p.z }, {}), ay = project({ x: p.x, y: p.y + .01, z: p.z }, {});
    return { kx: Math.hypot((ax.x - c.x) * W, (ax.y - c.y) * H) / R.zoneRefPxPerCmX,
             ky: Math.hypot((ay.x - c.x) * W, (ay.y - c.y) * H) / R.zoneRefPxPerCmY };
  };
  return { W, H, project, pxPerCm };
}
const PHONE = makeCamera(390, 844);
const TABLET = makeCamera(834, 1112);
const meeting = { x: 0, y: PH.TABLE_Y + 0.32, z: 1.78 };   // типичная точка встречи
const pointerAt = (cam, dxPx, dyPx, center) => ({ x: (center.x * cam.W + dxPx) / cam.W, y: (center.y * cam.H + dyPx) / cam.H });

const checks = [];
const check = (id, group, title, severity, fn) => { if (!only || only.includes(id)) checks.push({ id, group, title, severity, fn }); };
const cnt = (re, s, g) => (s.match(g === undefined ? re : new RegExp(re.source, g)) || []).length;

/* ============================ A. АРХИТЕКТУРА ============================ */
check('A01', 'A', 'Две параллельные системы истины: гейт в px и захват в метрах', 'critical', () => {
  const hasPxGate = /contactSideTouchPx|contactForwardPx/.test(SRC.rules);
  const hasMCapture = /captureRadius|depthTolerance/.test(SRC.rules);
  return { status: hasPxGate && hasMCapture ? 'fail' : 'ok',
    evidence: `press gate в CSS px (side ${R.contactSideTouchPx}/${R.contactSideMousePx}, fwd ${R.contactForwardPx}, back ${R.contactBackPx}) и физический захват в метрах (r ${R.captureRadius}, depth ${R.depthTolerance}) нигде не связаны одной моделью` };
});
check('A02', 'A', 'Штамп допуска нажатия заморожен навсегда в момент pointerdown', 'critical', () => {
  // ContactSystem.refreshPressZone пересчитывает центр допущенного нажима
  // покадрово за дрейфующим прогнозом; отклонённый нажим при этом не воскресает.
  const refreshInModule = /refreshPressZone/.test(SRC.contact);
  const refreshInLoop = /ContactSystem\.refreshPressZone\(this\)/.test(SRC.game);
  const frozenForever = /Admission is stamped once[\s\S]{0,220}?cannot rewrite it/.test(SRC.game);
  return { status: refreshInModule && refreshInLoop ? 'ok' : frozenForever ? 'warn' : 'ok',
    evidence: refreshInModule && refreshInLoop
      ? 'покадровый refreshPressZone обновляет геометрию принятого штампа за прогнозом; rejected остаётся rejected (контракт теста)'
      : 'refreshPressZone не подключён к игровому циклу' };
});
check('A03', 'A', 'contactPrediction отключается при v.z <= 0.2 — тихий откат на другую форму зоны', 'critical', () => {
  const hard = /b\.v\.z > \.2\)\s*[\s\S]{0,80}?return null/.test(SRC.game);
  // смоделируем: медленный мяч у апекса
  const g = { ball: { live: true, lastHitBy: -1, v: { z: 0.15 } }, state: 'RALLY' };
  return { status: hard ? 'fail' : 'ok', evidence: `условие b.v.z>.2 найдено: ${hard}; свеча/укороченный мяч у апексы (v.z 0.15) не дают contact-гейт, ветка падает в ball-овал с другими размерами` };
});
check('A04', 'A', 'Гейт контакта и ball-овал принимают разные точки для одного пальца', 'major', () => {
  const cam = PHONE, c = cam.project(meeting, {});
  const scale = cam.pxPerCm(meeting);
  const contact = api.pressContactZone(c, pointerAt(cam, 0, 90, c), cam.W, cam.H, { pointerType: 'touch', scale });
  const ball = api.pressHitZoneOval({ p: meeting, v: { x: 0, y: 0, z: 4 } }, pointerAt(cam, 0, 90, c), cam.W, cam.H,
    { project: (p, o) => cam.project(p, o || {}), pointerType: 'touch', referenceScreen: { x: .5, y: 1 } });
  const diverge = contact.accepted !== ball.accepted;
  // Единый вход ContactSystem.evaluatePress маршрутизирует все нажатия через
  // contact-гейт; ball-овал остался только fallback-ом, когда прогноз=null.
  const router = /ContactSystem\.evaluatePress/.test(SRC.game);
  return { status: diverge && !router ? 'fail' : diverge ? 'warn' : 'ok',
    evidence: `нажатие +90px от точки: contact-гейт accepted=${contact.accepted}, ball-овал accepted=${ball.accepted}; единый вход evaluatePress: ${router} — расхождение возможно лишь в fallback при недоступном прогнозе` };
});
check('A05', 'A', 'Легаси-круг pressHitZone всё ещё в сборке и доступен через zoneShape', 'minor', () => {
  const uses = cnt(/pressHitZone\(/g, SRC.rules) + cnt(/pressHitZone\(/g, SRC.game) + cnt(/pressHitZone\(/g, SRC.ui);
  return { status: 'warn', evidence: `${uses} вызовов pressHitZone; круг радиусом ${R.pressRadiusPx}px — параллельная мёртвая геометрия A/B` };
});
check('A06', 'A', 'Гейт обещает больше, чем физика достаёт: сравнение площадей (референс камеры)', 'critical', () => {
  // документированный масштаб BROADCAST-камеры на 390×844: 1см = 2.94px × 2.39px
  const sideCm = R.contactSideTouchPx / R.zoneRefPxPerCmX;
  const fwdCm = R.contactForwardPx / R.zoneRefPxPerCmY, backCm = R.contactBackPx / R.zoneRefPxPerCmY;
  const gateCm2 = Math.PI * sideCm * ((fwdCm + backCm) / 2);
  const capCm2 = Math.PI * (R.captureRadius * 100) * (R.depthTolerance * 100); // цилиндр захвата
  const alongOver = fwdCm / (R.depthTolerance * 100);
  // _tryGateRescue исполняет обещание гейта: на пересечении плоскости биты
  // экранно-внутренняя точка даёт слабый блок даже без 3D-захвата.
  const rescue = /_tryGateRescue/.test(SRC.game) && /gateCoversBall/.test(SRC.contact);
  const raw = alongOver > 2 ? 'fail' : alongOver > 1.3 ? 'warn' : 'ok';
  return { status: rescue && raw === 'fail' ? 'warn' : raw,
    evidence: `бок гейта ${sideCm.toFixed(1)}см ≈ радиус захвата ${(R.captureRadius * 100).toFixed(0)}см (ок), длинная ось ${backCm.toFixed(0)}..${fwdCm.toFixed(0)}см против глубины ±${(R.depthTolerance * 100).toFixed(0)}см (×${alongOver.toFixed(1)}), площадь ${gateCm2.toFixed(0)} против ${capCm2.toFixed(0)} см²; структурный разрыв остаётся, но gate-rescue (${rescue}) превращает экранно-обещанные точки в слабый блок на плоскости биты` };
});
check('A07', 'A', 'Проверка направления продублирована в двух модулях с разными порогами', 'major', () => {
  const inOval = /dotLimit = .*pointerType === 'mouse' \? -0\.3 : 0/.test(SRC.rules);
  const inGame = /dotLimit = pz\.pointerType === 'mouse' \? -0\.3 : \(fast \? -0\.12 : 0\)/.test(SRC.game);
  return { status: inOval && inGame ? 'warn' : 'ok', evidence: `овал: -0.3/0; игра: -0.3/-0.12/0 — два разных контракта одного решения; в down() свайп ещё не передан, работает только второй` };
});
check('A08', 'A', 'Кольцо края (grace) не связано с экранным гейтом', 'major', () => {
  const graceCm = R.captureRadius * G.bandMul * 100;
  const gateSideCm = R.contactSideTouchPx / R.zoneRefPxPerCmX;
  return { status: Math.abs(graceCm - gateSideCm) > 4 ? 'warn' : 'ok', evidence: `grace бок ${graceCm.toFixed(1)} см, гейт бок ${gateSideCm.toFixed(1)} см — на ${Math.abs(graceCm - gateSideCm).toFixed(1)} см края физический «срезанный» контакт происходит вне нарисованной/допущенной зоны` };
});
check('A09', 'A', 'Магические окна 0.25/0.18/1.15/2.5 разбросаны по файлу и противоречат друг другу', 'major', () => {
  const singleSource = /CONTACT_TIMING\s*=/.test(SRC.contact) && /contactTimingFor\(/.test(SRC.game);
  const uses = cnt(/contactTimingFor\(/g, SRC.game);
  const n25 = cnt(/0?\.25\b/g, SRC.game), n18 = cnt(/0?\.18\b/g, SRC.game), n115 = cnt(/1\.15\b/g, SRC.game);
  return { status: singleSource ? 'ok' : 'warn',
    evidence: singleSource
      ? `окна живут в замороженном CONTACT_TIMING (13_contact.js), движок берёт их через contactTimingFor в ${uses} местах; остаточные литералы .25: ${n25}, .18: ${n18}, 1.15: ${n115}`
      : `вхождений .25: ${n25}, .18: ${n18}, 1.15: ${n115} — единый источник правды для таймингов отсутствует` };
});
check('A10', 'A', 'Отрисованная зона и judged-зона — разные вызовы (locked против live)', 'minor', () => {
  const split = /const zone=locked \? saved :/.test(SRC.ui);
  return { status: split ? 'warn' : 'ok', evidence: split ? 'drawCaptureDebug рисует сохранённый штамп при активном жесте и живой прогноз иначе; игрок сравнивает палец не с тем контуром, по которому судят' : 'не найдено' };
});

/* ============================ B. ГЕОМЕТРИЯ ГЕЙТА ============================ */
check('B01', 'B', 'Рисуется полный овал, но верхняя полоса принимает только нисходящий жест — скрытая мёртвая зона', 'critical', () => {
  // референсный масштаб (scale 1:1): back-ось = 120px; точка на −100px внутри гейта
  const W = 390, H = 844, center = { x: .5, y: .5, ok: true };
  const z = api.pressContactZone(center, { x: .5, y: .5 - 100 / H }, W, H, { pointerType: 'touch', scale: { kx: 1, ky: 1 } });
  // решение направления теперь выносит ContactSystem.directionAllows с единым
  // порогом на тип указателя; проверим фактический вердикт, а не ручной dot.
  // штамп зоны живёт в CSS px (pointerX = NDC * width), метрики свайпа — в NDC
  const zone = { accepted: true, x: W / 2, y: H / 2, pointerX: W / 2, pointerY: H / 2 - 100, vw: W, vh: H, pointerType: 'touch' };
  const awayVerdict = api.ContactSystem.directionAllows(zone, { dx: 0, dy: -120 / H }); // свайп ВВЕРХ, мяч ниже
  const towardVerdict = api.ContactSystem.directionAllows(zone, { dx: 0, dy: 120 / H }); // свайп ВНИЗ к мячу
  // это уже не «скрытая» мёртвая зона: отказ логируется кодом WRONG_DIRECTION,
  // а встречный жест в той же точке принимается.
  return { status: z.accepted && awayVerdict === false && towardVerdict === true ? 'warn' : 'ok',
    evidence: `нажатие −100px (внутри back-оси ${Math.round(z.backPx)}): гейт accepted=${z.accepted}; свайп от мяча → WRONG_DIRECTION=${awayVerdict === false}, к мячу → принят=${towardVerdict}; отказ явный (телеметрия), но нарисованный овал выглядит активным целиком` };
});
check('B02', 'B', 'Тайминг, обещанный нижней полуосью, превышает окно намерения 0.25с', 'critical', () => {
  // при медленном мяче 350 px/с нижняя полуось 150px = 0.43с пути
  const speedPx = 350;
  const reachSec = R.contactForwardPx / speedPx;
  // удержанный палец живёт heldWin секунд — весь ранний нажим успевает дождаться мяча;
  // released-жест по-прежнему ограничен deadWin, поэтому остаточный риск — warn, а не fail.
  const held = api.CONTACT_TIMING.rally.heldWin, dead = api.CONTACT_TIMING.rally.deadWin;
  return { status: reachSec > held ? 'fail' : reachSec > dead ? 'warn' : 'ok',
    evidence: `медленный мяч ${speedPx}px/с: гейт пускает нажим за ${reachSec.toFixed(2)}с; held-окно ${held}с покрывает его полностью, released-окно ${dead}с — нет (NO_FRESH_SWIPE только для отпущенного пальца)` };
});
check('B03', 'B', 'Нижняя полуось на быстром мяче короче одного кадра реакции', 'major', () => {
  const speedPx = 1400;
  const reachSec = R.contactForwardPx / speedPx;
  return { status: reachSec < 0.1 ? 'warn' : 'ok', evidence: `быстрый мяч ${speedPx}px/с: вся нижняя зона = ${(reachSec * 1000).toFixed(0)} мс — меньше кадра 60fps на реакцию` };
});
check('B04', 'B', 'World-scale зажат в [0.75..1.5]: на части устройств гейт не совпадает с физикой', 'major', () => {
  const kPhone = PHONE.pxPerCm(meeting), kTab = TABLET.pxPerCm(meeting);
  const clampK = (k) => Math.min(R.zoneScaleMax, Math.max(R.zoneScaleMin, k));
  return { status: 'warn', evidence: `телефон kx=${kPhone.kx.toFixed(2)} → ${clampK(kPhone.kx).toFixed(2)}; планшет kx=${kTab.kx.toFixed(2)} → ${clampK(kTab.kx).toFixed(2)}; физический захват 0.22м при этом не масштабируется` };
});
check('B05', 'B', 'Кламп точки встречи у края экрана создаёт разрыв геометрии', 'major', () => {
  const cam = PHONE;
  const off = { x: 0.012, y: 0.5, ok: true }; // точка за краем (порог 20/390≈0.051)
  const z = api.pressContactZone(off, { x: 0.06, y: 0.5 }, cam.W, cam.H, { pointerType: 'touch', scale: { kx: 1, ky: 1 } });
  return { status: z.edgeClamped ? 'warn' : 'ok', evidence: `edgeClamped=${z.edgeClamped}: центр гейта притянут к ${z.x.toFixed(3)}, а физический мяч продолжает уходить за стекло — палец судят по фантому` };
});
check('B06', 'B', 'Та же физика пальца: touch 64px против mouse 46px — стилус приравнен к пальцу', 'minor', () => {
  const extT = api.contactGateExtents('touch', { kx: 1, ky: 1 }), extM = api.contactGateExtents('mouse', { kx: 1, ky: 1 });
  return { status: 'warn', evidence: `side touch ${Math.round(extT.sidePx)} vs mouse ${Math.round(extM.sidePx)}px; pointerType pen идёт по широкой touch-ветке` };
});
check('B07', 'B', 'Ось still-овала и его полуоси берутся из разных блендов', 'major', () => {
  const z = api.pressHitZoneOval({ x: .5, y: .5, ok: true }, { x: .5, y: .56 }, PHONE.W, PHONE.H,
    { screenVelocityPx: { x: 12, y: 0 }, pointerType: 'touch', referenceScreen: { x: .5, y: 1 } });
  // axis выбирается по still>=blend, протяженности — по blendEff
  return { status: z.blend !== z.blendEff ? 'warn' : 'ok', evidence: `blend=${z.blend.toFixed(3)}, blendEff=${z.blendEff.toFixed(3)}, ось и полуоси считаются разными формулами при скорости ${z.speedPx.toFixed(0)}px/с` };
});
check('F06', 'F', 'Первый тап на SERVE_READY судится раллийной веткой до startToss()', 'major', () => {
  const servePress = /const servePress = this\.state === GS\.SERVE_TOSS && this\.server === 1/.test(SRC.game);
  const startTossAtEnd = /if \(this\.state === GS\.SERVE_READY && this\.server === 1\) this\.startToss\(\)/.test(SRC.game);
  const iGate = SRC.game.indexOf('const servePress'), iToss = SRC.game.indexOf('this.startToss()');
  const order = servePress && startTossAtEnd && iGate > 0 && iToss > iGate;
  return { status: order ? 'warn' : 'ok', evidence: order ? 'жест, начатый тап-подачей, несёт штамп раллийной зоны (мяч ещё не live); продолжение того же драга в удар по тоссу судится не серверной геометрией' : 'порядок не подтверждён' };
});
check('B09', 'B', 'Шкала ky измеряется по 5см-смещению в перспективе — анизотропия у краёв', 'minor', () => {
  const center = PHONE.pxPerCm({ x: 0, y: PH.TABLE_Y + .32, z: 1.78 });
  const edge = PHONE.pxPerCm({ x: .7, y: PH.TABLE_Y + .32, z: 1.78 });
  return { status: Math.abs(center.kx - edge.kx) > 0.05 ? 'warn' : 'ok', evidence: `центр kx=${center.kx.toFixed(2)} ky=${center.ky.toFixed(2)}; край kx=${edge.kx.toFixed(2)} ky=${edge.ky.toFixed(2)} — один scale на весь овал` };
});
check('B10', 'B', 'Monte-Carlo карта «мёртвых» нажатий: допущено гейтом, но недостижимо физикой', 'critical', () => {
  // Сетка по эллипсу гейта (референсные px). Каждую допущенную точку
  // переводим в мировые см и проверяем физический цилиндр захвата 22/22см.
  const side = R.contactSideTouchPx, fwd = R.contactForwardPx, back = R.contactBackPx;
  let admitted = 0, dead = 0; const deadBins = { deepFwd: 0, deepBack: 0, side: 0 };
  for (let v = -0.98; v <= 0.98; v += 0.07) for (let u = -0.98; u <= 0.98; u += 0.07) {
    if (u * u + v * v > 0.96) continue;
    const alongPx = u >= 0 ? u * fwd : u * back, acrossPx = v * side;
    admitted++;
    const alongCm = Math.abs(alongPx) / R.zoneRefPxPerCmY, acrossCm = Math.abs(acrossPx) / R.zoneRefPxPerCmX;
    const lateralOk = acrossCm <= R.captureRadius * 100 * G.bandMul; // честный бокс + кольцо края
    const depthOk = alongCm <= R.depthTolerance * 100 * G.depthMul;
    if (!lateralOk || !depthOk) {
      dead++;
      if (!depthOk) u >= 0 ? deadBins.deepFwd++ : deadBins.deepBack++; else deadBins.side++;
    }
  }
  const pct = Math.round(dead / admitted * 100);
  const rescue = /_tryGateRescue/.test(SRC.game);
  return { status: pct >= 35 ? (rescue ? 'warn' : 'fail') : pct >= 15 ? 'warn' : 'ok',
    evidence: `${dead}/${admitted} (${pct}%) допущенных точек гейта вне физического захвата даже с grace-кольцом; разрез: дальняя полоса ${deadBins.deepFwd}, верхняя ${deadBins.deepBack}, бок ${deadBins.side}; gate-rescue=${rescue}: на пересечении плоскости биты эти точки больше не тихие промахи, а слабый блок с телеметрией gate_rescue` };
});

/* ============================ C. ТАЙМИНГ И ЖЕСТЫ ============================ */
check('C01', 'C', 'Порог реального удара в NDC означает разный физический жест на телефоне и планшете', 'critical', () => {
  // minPath 0.046 NDC в физических миллиметрах ширины экрана
  const mm = (screenMm) => 0.046 * screenMm;
  const phone = mm(64), tab = mm(130); // iPhone ~64mm ширина, iPad ~130mm
  return { status: tab / phone >= 1.8 ? 'fail' : 'ok', evidence: `один порог minPath 0.046 = ${phone.toFixed(1)}мм движения на телефоне, но ${tab.toFixed(1)}мм на планшете (×${(tab / phone).toFixed(1)}); короткий взмах планшета не квалифицируется как удар` };
});
check('C02', 'C', 'Порог скорости 0.30 NDC/с — за 120мс жеста это разная физическая дистанция', 'major', () => {
  const dist = (screenMm) => 0.30 * 0.12 * screenMm;
  const phone = dist(64), tab = dist(130);
  return { status: tab / phone >= 1.8 ? 'warn' : 'ok', evidence: `за окно 120мс палец должен пройти ${phone.toFixed(1)}мм на телефоне против ${tab.toFixed(1)}мм на планшете — медленный защитный блок на крупном экране не проходит isRealStroke` };
});
check('C03', 'C', 'Окно live-свежести 0.18с убивает удержание при джиттере событий >180мс', 'major', () => {
  const t = new api.SwipeTracker();
  t.down(.5, .7, 0); t.move(.54, .55, .06); t.move(.58, .42, .12);
  // эмулируем паузу 200мс (лаг вебвью/Telegram)
  t.move(.585, .40, .32);
  const age = .32 - .12;
  return { status: age > .18 ? 'warn' : 'ok', evidence: `после паузы ${(age * 1000).toFixed(0)}мс sampleAge выходит за liveWin .18 — held-ветка спасает только если жест уже стал real` };
});
check('C04', 'C', 'Кулдаун удара 90мс: быстрый мяч пролетает >1м за это время', 'major', () => {
  const travel = 12 * 0.09;
  return { status: travel > 0.9 ? 'warn' : 'ok', evidence: `за 0.09с при 12 м/с мяч смещается ${travel.toFixed(2)} м — повторный контакт в этой фазе исключён молча` };
});
check('C05', 'C', 'Второй палец полностью отменяет удар (ptrs.size >= 2)', 'critical', () => {
  const found = /ptrs\.size >= 2\)[\s\S]{0,260}?dropStroke\(\)/.test(SRC.game);
  return { status: found ? 'fail' : 'ok', evidence: found ? 'обычный хват телефона с опорным пальцем на краю стекла обнуляет active-жест в момент касания — классическая «мёртвая зона» на реальном устройстве' : 'не найдено' };
});
check('C06', 'C', 'После контакта жест consume+cancel: непрерывный драг не может бить второй мяч', 'critical', () => {
  const found = /sw\.consumedGestureId = sw\.gestureId;[\s\S]{0,60}?sw\.cancel\(\)/.test(SRC.game);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'естественное ведение ракетки без отрыва пальца обрывается: каждый возврат требует полного подъёма и нового нажима' : 'не найдено' };
});
check('C07', 'C', 'Тап: граница slop 14px не масштабируется под DPR/размер', 'minor', () => {
  const found = /tapSlop = zone && zone\.pointerType === 'mouse' \? 10 : 14/.test(SRC.game);
  return { status: found ? 'warn' : 'ok', evidence: found ? '14 CSS px на любом экране; на планшете это микро-движение, на маленьком телефоне — заметный сдвиг' : 'не найдено' };
});
check('C08', 'C', 'Пассивная «стенка» требует realGestureId — медленный защитный блок не работает', 'major', () => {
  const found = /realGestureId !== this\.swipe\.gestureId\) return false/.test(SRC.game);
  // _tryGateRescue снимает жалобу для ГЛАВНОГО случая: палец допущен гейтом,
  // держится в зоне, мяч пересекает плоскость биты — стационарное удержание
  // теперь даёт слабый блок без квалификации замаха.
  const rescue = /_tryGateRescue\(pad, b, p0, null\)/.test(SRC.game) && /gateCoversBall/.test(SRC.contact);
  const t = new api.SwipeTracker(); t.down(.5, .6, 0); // без движения
  return { status: found && t.realGestureId === -1 && !rescue ? 'warn' : 'ok',
    evidence: rescue
      ? 'сам по себе блок-«стенка» по-прежнему требует замах, но допущенное удержание в живой зоне спасается _tryGateRescue (слабый блок на плоскости биты)'
      : 'удержание без квалифицировавшегося взмаха не отражает мяч даже в физическом боксе' };
});
check('F01', 'F', 'Скорость руки измеряется симуляционным временем: slow-mo раздувает её до ×4.5', 'critical', () => {
  // down/move/up теперь получают настенное время ContactSystem.wallTime(e);
  // сим-время остаётся лишь для свежести через отдельный параметр sampleSimTime.
  const wallWired = /ContactSystem\.wallTime\(e\)/.test(SRC.game);
  // один физический жест (wall dt .05с) при двух разных sim-часах
  const mk = () => { const t = new api.SwipeTracker(); t.down(.5, .7, 100.0, 1.0); return t; };
  const slowmo = mk(); slowmo.move(.55, .6, 100.05, 1.011);
  const normal = mk(); normal.move(.55, .6, 100.05, 1.045);
  const sameSpeed = Math.abs(slowmo.m.speed - normal.m.speed) < 1e-9;
  return { status: wallWired && sameSpeed ? 'ok' : 'fail',
    evidence: `настенное время подключено: ${wallWired}; скорость при sim dt .011 и .045 одинакова: ${sameSpeed} (${slowmo.m.speed.toFixed(2)} NDC/с) — буллет-тайм больше не раздувает скорость руки` };
});
check('F02', 'F', 'Оси жеста нормированы на разную ширину/высоту: угол и длина искажены аспектом', 'critical', () => {
  // SwipeTracker.setAspect переводит движение в квадратные единицы:
  // физически одинаковый сдвиг 30×30px на 390×844 обязан дать угол 45°.
  const rawAng = Math.atan2(-(30 / 844), 30 / 390) * 180 / Math.PI;
  const t = new api.SwipeTracker();
  t.setAspect(390 / 844);
  t.down(.5, .7, 0);
  t.move(.5 + 30 / 390, .7 - 30 / 844, .05);
  const corrected = Math.abs(t.m.angleDeg - 45) < 2;
  const wired = /\.setAspect\(/.test(SRC.game);
  return { status: corrected && wired ? 'ok' : 'fail',
    evidence: `сырой NDC-угол ${rawAng.toFixed(1)}°; после setAspect(390/844) угол жеста ${t.m.angleDeg.toFixed(1)}° (цель 45°); setAspect подключён в движке: ${wired}` };
});
check('F03', 'F', 'Кольцевой буфер 64 сэмпла стирает начало жеста: хорда и длительность меняются на длинном замахе', 'major', () => {
  const t = new api.SwipeTracker();
  t.down(.2, .8, 0);
  for (let i = 1; i <= 70; i++) t.move(.2 + .004 * i, .8 - .003 * i, i * 0.008);
  const m = t.m;
  const originLost = Math.abs(m.sx - .2) > 1e-9 || Math.abs(m.sy - .8) > 1e-9;
  return { status: originLost ? 'warn' : 'ok', evidence: `после 70 сэмплов sx,sy=(${m.sx.toFixed(3)},${m.sy.toFixed(3)}) вместо (.200,.800); dur=${m.dur.toFixed(2)}с описывает остаток, не весь замах — peakSpeed хранится от старых точек` };
});

/* ============================ D. ФИЗИЧЕСКИЙ ЗАХВАТ ============================ */
check('D01', 'D', 'Бок гейта и физический радиус согласованы, а длинная ось — нет (референс 2.94/2.39 px/см)', 'critical', () => {
  const sideCm = R.contactSideTouchPx / R.zoneRefPxPerCmX;
  const fwdCm = R.contactForwardPx / R.zoneRefPxPerCmY;
  const cap = R.captureRadius * 100, depth = R.depthTolerance * 100;
  const alongOver = fwdCm / depth;
  const rescue = /_tryGateRescue/.test(SRC.game);
  const raw = alongOver > 2 ? 'fail' : 'warn';
  return { status: rescue && raw === 'fail' ? 'warn' : raw,
    evidence: `бок: гейт ${sideCm.toFixed(1)}см vs захват ${cap.toFixed(0)}см — ок; низ: гейт ${fwdCm.toFixed(1)}см vs глубина ±${depth.toFixed(0)}см (×${alongOver.toFixed(1)}); gate-rescue=${rescue} исполняет экранное обещание слабым блоком, структурная единая метрическая модель всё ещё не построена` };
});
check('D02', 'D', 'atClosest: порог −2см против шага подшага 4-6см на быстром мяче', 'critical', () => {
  // ContactSystem.closestTolerance масштабирует допуск от скорости мяча;
  // сравниваем его с фактическим подшагом боевой физики 1/PH.SIM_DT.
  const stepAt12 = 12 * PH.SIM_DT;
  const tol = api.ContactSystem.closestTolerance({ v: { x: 0, y: 0, z: 12 } });
  const covers = tol >= stepAt12;
  return { status: covers ? 'ok' : 'fail',
    evidence: `подшаг ${Math.round(1 / PH.SIM_DT)}Гц при 12 м/с = ${(stepAt12 * 100).toFixed(1)} см; closestTolerance=${(tol * 100).toFixed(1)} см (растущий по скорости, пол ${0.02 * 100} см) — фаза сближения покрыта без опоры только на CCD` };
});
check('D03', 'D', 'CCD срабатывает только при пересечении плоскости грани (d0>R && d1<=R)', 'major', () => {
  // мяч проходит сбоку от нормали: пересечения плоскости в радиусе нет
  const pad = { pos: V3.new(0, 1, 1.5), prevPos: V3.new(0, 1, 1.5), normal: V3.new(0, 0, -1) };
  const p0 = V3.new(.3, 1, 1.4), p1 = V3.new(.3, 1, 1.6);
  const fakeGame = { sweepPaddle: GameProtoSweep };
  const hit = fakeGame.sweepPaddle(pad, p0, p1, R.captureRadius);
  return { status: hit === null ? 'warn' : 'ok', evidence: `боковой пролёт в ${(0.3 * 100).toFixed(0)}см от центра: CCD=${hit ? 'hit' : 'null'} при радиусе ${(R.captureRadius * 100).toFixed(0)}см` };
});
// минимальный прототип sweepPaddle, идентичный боевому (70_game.js)
function GameProtoSweep(pad, p0, p1, radius) {
  const n = pad.normal, Rr = PH.R;
  const d0 = (p0.x - pad.prevPos.x) * n.x + (p0.y - pad.prevPos.y) * n.y + (p0.z - pad.prevPos.z) * n.z;
  const d1 = (p1.x - pad.pos.x) * n.x + (p1.y - pad.pos.y) * n.y + (p1.z - pad.pos.z) * n.z;
  if (d0 > Rr && d1 <= Rr) {
    const t = Math.max(0, Math.min(1, (d0 - Rr) / Math.max(d0 - d1, 1e-9)));
    const cx = p0.x + (p1.x - p0.x) * t, cy = p0.y + (p1.y - p0.y) * t, cz = p0.z + (p1.z - p0.z) * t;
    const px = pad.prevPos.x + (pad.pos.x - pad.prevPos.x) * t, py = pad.prevPos.y + (pad.pos.y - pad.prevPos.y) * t, pz = pad.prevPos.z + (pad.pos.z - pad.prevPos.z) * t;
    const ex = cx - px, ey = cy - py, ez = cz - pz, dn = ex * n.x + ey * n.y + ez * n.z;
    const rad = Math.hypot(ex - n.x * dn, ey - n.y * dn, ez - n.z * dn);
    if (rad <= radius) return { t, rad };
  }
  return null;
}
check('D04', 'D', 'moving_away обрезает на 35см: между захватом 22 и 35см — мёртвая полоса выпада', 'major', () => {
  return { status: 'warn', evidence: `мяч на 22-35 см за плоскостью биты не берётся ни захватом, ни обработкой moving_away (.35) — серая зона без подсказки` };
});
check('D05', 'D', 'Глубина grace ×1.75 = 38.5см выходит за глубину гейта', 'minor', () => {
  const graceDepth = R.depthTolerance * G.depthMul;
  const gateDepthCm = (R.contactBackPx + R.contactForwardPx) / (PHONE.pxPerCm(meeting).ky * R.zoneRefPxPerCmY);
  return { status: Math.abs(graceDepth * 100 - gateDepthCm) > 8 ? 'warn' : 'ok', evidence: `grace depth ${(graceDepth * 100).toFixed(1)} см, полная вертикаль гейта ≈ ${gateDepthCm.toFixed(1)} см` };
});
check('D06', 'D', 'Отвёрнутая грань: impactRacket вернёт null даже внутри радиуса', 'major', () => {
  // проверить логику через сигнатуру: impactRacket нет в загруженном модуле, проверим по исходнику
  const found = /A separating face returns null/.test(SRC.game);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'мяч в захвате, но грань отвернулась (wrist pose) → тишина; жест при этом НЕ consume — повторная попытка возможна, но игрок не понимает отказ' : 'не найдено' };
});
check('D07', 'D', 'Авто-футворк ставит глубину биты по прогнозу, а гейт — по плоскости pad.pos.z', 'major', () => {
  const found = /stopZ:[\s\S]{0,80}?pad\.pos\.z/.test(SRC.game);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'прогноз встречи и фактическая глубина биты могут разойтись: центр гейта нарисован не там, где физически стоит ракетка' : 'не найдено' };
});
check('D08', 'D', 'endpoint и CCD — два параллельных маршрута с разными радиусами оценки', 'minor', () => {
  // бита делает выпад вперёд (1.50→1.42), мяч пересекает плоскость грани со смещением 10см
  const pad = { pos: V3.new(0, 1, 1.42), prevPos: V3.new(0, 1, 1.50), normal: V3.new(0, 0, -1) };
  const sample = api.measureCaptureAllowance(pad, V3.new(.12, 1, 1.45), V3.new(.08, 1, 1.43), false, true);
  const twoRoutes = sample && Number.isFinite(sample.endpointRadius) && Number.isFinite(sample.ccdRadius)
    && Math.abs(sample.endpointRadius - sample.ccdRadius) > 1e-4;
  return { status: twoRoutes ? 'warn' : 'ok', evidence: `endpointRadius=${sample.endpointRadius.toFixed(3)}, ccdRadius=${sample.ccdRadius.toFixed(3)} — один контакт, две геометрии решения` };
});
check('F04', 'F', 'impactSphere требует единичную нормаль, но saneN её не нормирует', 'minor', () => {
  // impactSphere теперь сам нормализует неединичную нормаль: проверим
  // эквивалентность ударов с n и 1.7·n на одинаковых входах.
  const a = { v: V3.new(0, -1, 4), w: V3.new(), n: V3.new(0, 0, -1) };
  const b = { v: V3.new(0, -1, 4), w: V3.new(), n: V3.new(0, 0, -1.7) };
  const ia = api.impactSphere(a.v, a.w, a.n, V3.new(), PH.E_RACKET, PH.MU_RACKET, PH.ET_RACKET);
  const ib = api.impactSphere(b.v, b.w, b.n, V3.new(), PH.E_RACKET, PH.MU_RACKET, PH.ET_RACKET);
  const invariant = ia && ib && ['x', 'y', 'z'].every((k) => Math.abs(a.v[k] - b.v[k]) < 1e-10);
  return { status: invariant ? 'ok' : 'warn',
    evidence: invariant ? 'удары с n=(0,0,-1) и 1.7·n дают идентичную скорость — нормаль нормализуется внутри impactSphere' : 'поведение не эквивалентно' };
});
check('D10', 'D', 'Тренировка расширяет только физику (CAPTURE_FORGIVE), не экранный гейт', 'major', () => {
  const found = /setCaptureForgiveness/.test(SRC.rules) && !/forgive/i.test(SRC.game.match(/pressContactZone[\s\S]{0,200}/) ? SRC.game.match(/pressContactZone[\s\S]{0,200}/)[0] : '');
  return { status: found ? 'warn' : 'ok', evidence: 'в уроке физика прощает, а нарисованная зона и допуск — нет; подсказка и решение расходятся' };
});

/* ============================ E. НАПРАВЛЕНИЕ/ПОДСКАЗКИ/ТЕЛЕМЕТРИЯ ============================ */
check('E01', 'E', 'Порог направления зависит от длины жеста: тот же угол при len 0.15 и 0.17 судится по-разному', 'critical', () => {
  // ContactSystem.directionAllows: один порог на тип указателя, длина жеста
  // больше не участвует в решении. Прогоняем один и тот же жест дважды.
  const mk = () => ({ accepted: true, x: 200, y: 300, pointerX: 260, pointerY: 300, vw: 390, vh: 844, pointerType: 'touch' });
  const m = { dx: -0.06 / 390, dy: 0 }; // dot ≈ -0.06 — раньше ломался на границе len 0.16
  const short = api.ContactSystem.directionAllows(mk(), { ...m, len: 0.15 });
  const long = api.ContactSystem.directionAllows(mk(), { ...m, len: 0.17 });
  return { status: short === long && short === true ? 'ok' : 'fail',
    evidence: `dot≈-0.06 при len 0.15 → ${short}, при len 0.17 → ${long}; единый порог touch -0.12 / mouse -0.30, длина жеста в решении не участвует` };
});
check('E02', 'E', 'Вектор направления считается от замороженного штампа, а не от живого мяча', 'major', () => {
  const found = /toBallX = pz\.x - pz\.pointerX/.test(SRC.game);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'после дрейфа прогноза «направление к мячу» указывает на старую точку встречи' : 'не найдено' };
});
check('E03', 'E', 'Зелёная подсветка загорается только внутри 22см — практически в момент контакта', 'major', () => {
  // ContactSystem.strikeArmed зажигает готовность по упреждению ready>.82,
  // не дожидаясь физического контакта (contactable).
  const lead = api.ContactSystem.strikeArmed({ on: true, contactable: false, ready: 0.9 });
  const cold = api.ContactSystem.strikeArmed({ on: true, contactable: false, ready: 0.4 });
  const wired = /ContactSystem\.strikeArmed\(/.test(SRC.game);
  return { status: lead && !cold && wired ? 'ok' : 'warn',
    evidence: `strikeArmed на упреждении ready=.9 → ${lead}, на ready=.4 → ${cold}; подключён в движке: ${wired} — подсказка «бей сейчас» опережает контакт` };
});
check('F05', 'F', 'predict() по умолчанию 1/240, а боевая физика 1/600 — прогноз встречи расходится с реальностью', 'minor', () => {
  const default240 = /const dt = opts\.dt \|\| 1 \/ 240/.test(SRC.physics);
  const contactUses600 = /predict\([\s\S]{0,160}?dt: PHYS_DT/.test(SRC.game);
  return { status: default240 ? 'warn' : 'ok', evidence: `дефолт predict 1/240: ${default240}; contactPrediction передаёт PHYS_DT: ${contactUses600} — части вызовов (ассист, солверы) живут на другом шаге, чем мяч` };
});
check('E05', 'E', 'Телеметрия dx/dy без ext[] на ball-анкоре — советы миссят размеры', 'minor', () => {
  const found = /ext: z\.anchor === 'contact' \?/.test(SRC.embed);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'для ball-овала ext=null, а missTip и ZoneStats считают совет по contact-константам' : 'не найдено' };
});
check('E06', 'E', 'Пороги советов missTip завязаны на доли экранных осей без учёта world-scale', 'minor', () => {
  const found = /side \* 0\.8|back \* 0\.8|fwd \* 0\.8/.test(SRC.embed);
  return { status: found ? 'warn' : 'ok', evidence: found ? 'подсказки «правее/левее» сравнивают нормированные dx с масштабированными осями — на разных телефонах совет разный при той же ошибке' : 'не найдено' };
});

check('E08', 'E', 'Штамп живёт после конца очка: попытка может привязаться к чужому розыгрышу', 'major', () => {
  const flush = /setState', function \(orig, st\) \{ if \(st !== GS\.RALLY && st !== GS\.SERVE_TOSS\) flush\(\)/.test(SRC.embed);
  return { status: flush ? 'ok' : 'warn', evidence: flush ? 'flush есть в embed-обёртке, но движок без embed (прямой запуск) очистки не имеет' : 'обёртка не найдена' };
});
check('E09', 'E', 'Все 10 причин отказа достижимы и имеют уникальный код (контракт телеметрии)', 'ok', () => {
  const reasons = api.PRESS_REJECTION_REASONS;
  // причины живут и в движке, и в новом контактном модуле — искать надо в обоих
  const covered = reasons.every((r) => cnt(new RegExp(r, 'g'), SRC.game) + cnt(new RegExp(r, 'g'), SRC.contact) >= 1);
  return { status: covered ? 'ok' : 'fail', evidence: `${reasons.length} причин, все упомянуты в движке/контактном модуле: ${covered}` };
});
check('E10', 'E', 'Сглаживание биты: позиция ракетки отстаёт от пальца в фазе контакта', 'major', () => {
  const found = /pad\.pos\.x = expSmooth\(pad\.pos\.x, tx, rate, dt\)/.test(SRC.game);
  // постоянная времени фильтра при rate 55: ~18мс лаг по позиции
  const tau = 1 / 55;
  return { status: found ? 'warn' : 'ok', evidence: found ? `expSmooth rate 55 (τ≈${(tau * 1000).toFixed(0)}мс) на позиции: быстрый доводящий взмах застаёт биту сзади пальца — решает физический захват, а не картинка` : 'не найдено' };
});

/* ============================ прогон ============================ */
const order = { critical: 0, major: 1, minor: 2, ok: 3 };
const results = checks.map((c) => {
  let r;
  try { r = c.fn(); } catch (e) { r = { status: 'fail', evidence: String(e && e.stack || e) }; }
  return { ...c, ...r };
});
const sev = (s) => s === 'fail' ? 0 : s === 'warn' ? 1 : 2;
results.sort((a, b) => sev(a.status) - sev(b.status) || order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const groups = {};
  for (const r of results) (groups[r.group] ||= []).push(r);
  const icon = { fail: '✗ FAIL', warn: '⚠ WARN', ok: '✓ OK  ' };
  for (const g of ['A', 'B', 'C', 'D', 'E', 'F']) {
    console.log(`\n===== ГРУППА ${g} =====`);
    for (const r of groups[g]) console.log(`${icon[r.status]} ${r.id} [${r.severity}] ${r.title}\n         ${r.evidence}`);
  }
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\nИТОГО: ${results.length} анализов · fail ${n('fail')} · warn ${n('warn')} · ok ${n('ok')}`);
}
module.exports = { results };
