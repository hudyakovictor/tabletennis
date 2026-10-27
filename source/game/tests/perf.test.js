/* Frame-cost monitor and the adaptive render scale it drives. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '45_perf.js'],
  ['perfScaleStep', 'PerfMonitor', 'PERF_SCALE_MIN', 'PERF_SCALE_MAX', 'PERF_SLOW_MS', 'PERF_FAST_MS', 'PERF_WINDOW_S']);

test('scale bounds are a real ceiling and a soft floor', () => {
  assert.equal(lib.PERF_SCALE_MAX, 1, 'никогда не апскейлим выше выбранного качества');
  assert.ok(lib.PERF_SCALE_MIN > 0.5 && lib.PERF_SCALE_MIN < 0.7, 'ниже 0.6 картинка мылится');
  assert.ok(lib.PERF_SLOW_MS > lib.PERF_FAST_MS, 'иначе решение дёргается');
  assert.ok(lib.PERF_SLOW_MS >= 16.7 && lib.PERF_SLOW_MS <= 33, 'порог — уверенно ниже 60 fps');
});

test('slow frames step the resolution down, fast ones creep back up', () => {
  const S = lib.perfScaleStep;
  assert.ok(S(1, 33) < 1, '30 fps обязан ронять масштаб');
  assert.ok(S(1, 33) > 0.8, 'но не одним кадром до пола');
  assert.equal(S(1, 16.7), 1, 'ровные 60 fps — не повод ухудшать');
  assert.equal(S(0.76, 16.7), 0.76, 'мёртвая зона: между порогами ничего не меняем');
  assert.ok(S(0.76, 8.3) > 0.76, '120 Гц — можно вернуть пиксели');
  // Спуск быстрее подъёма: иначе на грани порога картинка «дышит».
  assert.ok((1 - S(1, 33)) > (S(0.76, 8.3) - 0.76));
});

test('clamps hold at both ends and junk values cannot move the scale', () => {
  const S = lib.perfScaleStep;
  assert.equal(S(lib.PERF_SCALE_MIN, 100), lib.PERF_SCALE_MIN);
  assert.equal(S(lib.PERF_SCALE_MAX, 5), lib.PERF_SCALE_MAX, 'быстрее потолка не бывает');
  assert.equal(S(0.5, 100), lib.PERF_SCALE_MIN, 'вход ниже пола зажимается');
  assert.equal(S(2, 5), lib.PERF_SCALE_MAX, 'и выше потолка тоже');
  for (const bad of [NaN, Infinity, -Infinity, undefined, 'slow']) assert.equal(S(0.9, bad), 0.9);
  // Битый масштаб трактуется как потолок, а дальше — обычное решение.
  assert.equal(S(NaN, 16.7), lib.PERF_SCALE_MAX);
  assert.ok(S(NaN, 33) < lib.PERF_SCALE_MAX);
  // Окно короче 0.6 от расчётного — статистики мало, масштаб не трогаем.
  assert.equal(S(1, 40, 100), 1);
});

test('the live monitor only acts once per full window and ignores throttled frames', () => {
  const seen = [];
  const p = new lib.PerfMonitor({ onScale: (k) => seen.push(k) });
  assert.equal(p.overlay, false, 'панель по умолчанию выключена');
  // 30 fps за окно 1.5 с: ~45 кадров по 33 мс.
  for (let i = 0; i < 46; i++) p.frame(33, [4, 20, 2]);
  assert.equal(seen.length, 1, 'ровно один шаг за окно, а не на каждый кадр');
  assert.ok(seen[0] < 1 && seen[0] >= lib.PERF_SCALE_MIN);
  assert.ok(p.avg > 30 && p.fps > 25 && p.fps < 35);
  assert.ok(p.sec.render > 15 && p.sec.update > 2, 'цена частей кадра сохранена');
  // Свёрнутая вкладка отдаёт кадры по секунде — это не стоимость кадра.
  const before = p.scale;
  for (let i = 0; i < 60; i++) p.frame(1000);
  assert.equal(p.scale, before);
  // Разрешение возвращается, когда кадры снова быстрые.
  for (let i = 0; i < 200; i++) p.frame(8, [1, 5, 1]);
  assert.ok(p.scale > before);
});

test('snapshot is report-safe: numbers only, bounded long-task tail', () => {
  const p = new lib.PerfMonitor();
  assert.equal(p.snapshot().fps, 0);
  p.frame(20, [2, 12, 1]);
  for (let i = 0; i < 60; i++) p.frame(20, [2, 12, 1]);
  const s = p.snapshot();
  assert.deepEqual(Object.keys(s).join(','), 'fps,frame,update,render,ui,scale,long');
  for (const k of ['fps', 'frame', 'update', 'render', 'ui', 'scale']) assert.ok(Number.isFinite(s[k]), k);
  assert.ok(Array.isArray(s.long) && s.long.length <= 10);
  assert.ok(s.scale >= lib.PERF_SCALE_MIN && s.scale <= lib.PERF_SCALE_MAX);
});
