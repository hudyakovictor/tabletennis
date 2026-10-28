/* Рейтинг один на клиент и сервер. Клиент считает дельту сам (иначе офлайн-
 * матч не давал бы ничего), но формула и константы обязаны совпадать с
 * `PROGRESS_LIMITS` в `newfolder/src/routes/clientRoutes.js`. Тест читает файл
 * сервера и сверяет числа: молчаливое расхождение уже было один раз — клиент
 * прибавлял фиксированные +24, сервер начислял по Эло, и профиль с доской
 * рейтинга показывали разные числа у одного игрока. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/data/leagues.js'), 'utf8');
const context = vm.createContext({ t: (k) => k });
vm.runInContext(source + '\n;globalThis.api = { ratingDelta, ELO_K, ELO_MAX, ELO_UNKNOWN };', context);
const { ratingDelta, ELO_K, ELO_MAX, ELO_UNKNOWN } = context.api;

const serverSource = fs.readFileSync(
  path.join(__dirname, '../../newfolder/src/routes/clientRoutes.js'),
  'utf8'
);

test('клиентские константы Эло совпадают с серверными', () => {
  const k = Number(serverSource.match(/eloK:\s*(\d+)/)[1]);
  const max = Number(serverSource.match(/maxRatingDelta:\s*(\d+)/)[1]);
  assert.equal(ELO_K, k, 'eloK в клиенте и на сервере должен быть одним числом');
  assert.equal(ELO_MAX, max, 'maxRatingDelta в клиенте и на сервере должен быть одним числом');
  const fallback = Number(serverSource.match(/asInt\(body\.opponentRating\)\s*\?\?\s*(\d+)/)[1]);
  assert.equal(ELO_UNKNOWN, fallback, 'неизвестный соперник обрабатывается тем же дефолтом');
});

test('равный соперник даёт половину K, сильный — больше, слабый — меньше', () => {
  assert.equal(ratingDelta(1000, 1000, true), 16);
  assert.equal(ratingDelta(1000, 1000, false), -16);
  const weak = ratingDelta(1000, 800, true);
  const even = ratingDelta(1000, 1000, true);
  const strong = ratingDelta(1000, 1400, true);
  assert.ok(weak < even && even < strong, `порядок дельт: ${weak} < ${even} < ${strong}`);
  assert.ok(strong > 0, 'победа над сильным не может отнимать рейтинг');
});

test('дельта ограничена и не зависит от отсутствующего соперника', () => {
  /* K = 32, потолок — 64: при такой паре потолок не достигается никогда, но
   * проверять его надо — это та же защита, что у сервера. */
  assert.equal(ratingDelta(3000, 100, false), -ELO_K, 'проигрыш слабейшему списывает полный K');
  assert.equal(ratingDelta(3000, 100, true), 0, 'победа над слабейшим не даёт рейтинга');
  for (const [a, b] of [[0, 3000], [3000, 0], [1000, 1400]]) {
    assert.ok(Math.abs(ratingDelta(a, b, true)) <= ELO_MAX, `победа ${a} против ${b}`);
    assert.ok(Math.abs(ratingDelta(a, b, false)) <= ELO_MAX, `поражение ${a} против ${b}`);
  }
  const missing = ratingDelta(1000, undefined, true);
  assert.equal(missing, ratingDelta(1000, ELO_UNKNOWN, true), 'нет соперника — дефолт 1000');
  assert.equal(ratingDelta(1000, 'не число', true), 16);
});

test('ничья по силе не даёт целого скачка больше K', () => {
  for (const r of [0, 900, 1000, 1500, 2400, 3000]) {
    const d = Math.abs(ratingDelta(r, r, true));
    assert.ok(d <= 16, `равный соперник: ${d} при рейтинге ${r}`);
  }
});
