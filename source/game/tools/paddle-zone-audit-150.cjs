'use strict';
// 3 cameras × 5 viewports × 10 pointer zones. Geometric target probe only:
// no live input, moving ball, paddle animation, collision correction or frame timing.
// Run: node tools/paddle-zone-audit-150.cjs > ../../docs/paddle-zone-results-150.ru.md
const { load } = require('../tests/helpers.cjs');
const L = load(['10_math.js', '30_physics.js', '57_camera.js'], [
  'cameraRigFor', 'rigViewProj', 'pointerBladeSolve', 'projectPoint', 'unprojectToPlane',
  'clampPaddleToFrustum', 'paddleLimitsFor', 'REACH_SHELL', 'PADDLE_LIMITS', 'PH',
]);
const modes = ['BROADCAST', 'DYNAMIC', 'LOW'];
const viewports = [[360, 640], [390, 844], [768, 1024], [1280, 720], [844, 390]];
const zones = [
  ['центр', .50, .55], ['лево', .10, .45], ['право', .90, .45],
  ['верх', .50, .32], ['низ', .50, .83], ['лево-верх', .10, .32],
  ['право-верх', .90, .32], ['лево-низ', .10, .83], ['право-низ', .90, .83],
  ['средне-лево', .30, .55],
];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const rows = [];
for (const mode of modes) for (const [w, h] of viewports) for (const [zone, x, y] of zones) {
  const aspect = w / h, rig = L.cameraRigFor(mode, null, aspect), vp = L.rigViewProj(rig, aspect);
  // A neutral target and a requested step-in to z=.8. A request can be declined.
  const base = { ...L.pointerBladeSolve(rig, aspect, x, y) };
  const foot = { ...L.pointerBladeSolve(rig, aspect, x, y, { zFoot: .8 }) };
  const t = { tx: foot.tx, ty: foot.ty, tz: foot.tz };
  L.clampPaddleToFrustum(vp, t, .012);
  const lim = L.paddleLimitsFor(t.tz), shell = L.REACH_SHELL;
  t.tx = clamp(clamp(t.tx, -shell.xHard, shell.xHard), -lim.x, lim.x);
  t.ty = clamp(clamp(t.ty, L.PH.TABLE_Y + shell.yLoHard, L.PH.TABLE_Y + shell.yHiHard),
    L.PH.TABLE_Y + lim.yLo, L.PH.TABLE_Y + lim.yHi);
  t.tz = clamp(t.tz, L.PADDLE_LIMITS.zStepIn, L.PADDLE_LIMITS.zFar);
  const p = L.projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
  const before = L.projectPoint(vp, { x: foot.tx, y: foot.ty, z: foot.tz }, {});
  const raw = {}, ray = L.unprojectToPlane(rig, aspect, x, y, foot.tz, raw);
  const stepped = Math.abs(foot.tz - .8) < 1e-9 && Math.abs(base.tz - .8) > 1e-9;
  const expectedPin = ray && Math.abs(raw.x) > shell.xSoft + 1e-9 ? Math.sign(raw.x) : 0;
  const pinOK = !stepped || foot.pinned === expectedPin && foot.exact === !expectedPin;
  const finite = p.ok && before.ok && [t.tx, t.ty, t.tz, p.x, p.y].every(Number.isFinite);
  const offset = finite ? Math.hypot((p.x - x) * w, (p.y - y) * h) : NaN;
  const adjustment = finite ? Math.hypot((p.x - before.x) * w, (p.y - before.y) * h) : NaN;
  rows.push({ mode, w, h, zone, x, y, z: foot.tz, stepped, pin: foot.pinned,
    exact: foot.exact, offset, adjustment, finite, pinOK });
}
const bad = rows.filter(r => !r.finite || !r.pinOK);
const step = rows.filter(r => r.stepped);
const pinned = rows.filter(r => r.pin);
const max = rows.reduce((a, b) => a.offset >= b.offset ? a : b);
console.log('# 150 проверок геометрии цели ракетки — результаты\n');
console.log('Повтор: `cd source/game && node tools/paddle-zone-audit-150.cjs` (вывод — этот файл).');
console.log('3 камеры × 5 размеров × 10 положений указателя; в каждой строке базовая цель и запрос шага вперёд на z=0,8 м.');
console.log('Выполнены только геометрический солвер, ограничение кадра и численные ограничения цели; движение ракетки, мяч, коллизия со столом и касания браузера не моделируются. Нормализованные координаты заданы на всём экране, а не на гарантированно игровой области.');
console.log('Отклонение — пиксели между указателем и ограниченной целью, а не ошибка видимой ракетки; большая величина может быть следствием намеренных ограничений. Коррекция — изменение проекции после ограничений. «Шаг» означает, что запрос был принят и изменил глубину.');
console.log(`\nВсего: ${rows.length}; некорректная геометрия/метаданные шага: ${bad.length}; шаг применён: ${step.length}; сжатие по боку (pinned): ${pinned.length}. Максимум отклонения: ${max.offset.toFixed(1)} px (${max.mode}, ${max.w}×${max.h}, ${max.zone}).\n`);
console.log('| № | Камера | Экран | Зона (x,y) | z, м | Шаг | Сторона | Смещение, px | Коррекция, px | Проверка |');
console.log('|---:|---|---|---|---:|---|---:|---:|---:|---|');
rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.mode} | ${r.w}×${r.h} | ${r.zone} (${r.x.toFixed(2)}, ${r.y.toFixed(2)}) | ${r.z.toFixed(2)} | ${r.stepped ? 'да' : 'нет'} | ${r.pin} | ${r.offset.toFixed(1)} | ${r.adjustment.toFixed(1)} | ${r.finite && r.pinOK ? 'OK' : 'FAIL'} |`));
if (rows.length !== 150 || bad.length) process.exitCode = 1;
