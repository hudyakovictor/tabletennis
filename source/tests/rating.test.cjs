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
/* `S` и `save` — те же имена, что в бандле: история рейтинга живёт в сейве. */
const S = { hist: [] };
const context = vm.createContext({ t: (k) => k, S, save: () => 0 });
vm.runInContext(source + '\n;globalThis.api = { ratingDelta, ELO_K, ELO_MAX, ELO_UNKNOWN, ratingNote, ratingCorrect, ratingSeries, ratingHasHistory, histDay, HIST_DAYS };', context);
const { ratingDelta, ELO_K, ELO_MAX, ELO_UNKNOWN, ratingNote, ratingCorrect, ratingSeries, ratingHasHistory, histDay, HIST_DAYS } = context.api;

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

/* График в профиле рисуется по истории из сейва. Раньше он был синусоидой
 * с подписью «+231»: тесты ниже держат серию честной — одна точка на день,
 * без дней, которых не было. */
const DAY = 864e5;
const today = histDay(Date.now());

/* Массивы из vm — чужой realm: перед сравнением приводим к своим. */
const list = (a) => Array.from(a);

test('без истории графика нет — вместо кривой пустое состояние', () => {
  S.hist = [];
  assert.deepEqual(list(ratingSeries()), []);
  assert.equal(ratingHasHistory(), false);
});

test('один матч — две точки за сегодня: рейтинг до и после', () => {
  S.hist = [];
  ratingNote(1032, 1000);
  assert.deepEqual(list(ratingSeries().map((p) => p.r)), [1000, 1032], 'отправная точка — рейтинг до матча');
  assert.equal(ratingHasHistory(), true, 'есть от чего строить кривую');
  ratingNote(1064, 1032);
  assert.deepEqual(list(ratingSeries().map((p) => p.r)), [1000, 1032, 1064], 'матчи одного дня — история за сегодня');
});

test('серия по дням: пустые дни тянут предыдущее значение', () => {
  S.hist = [{ t: today - 2 * DAY + 36e5, r: 1000 }, { t: today - DAY + 36e5, r: 1016 }];
  ratingNote(1032, 1016);
  const series = ratingSeries(30);
  assert.equal(series.length, 3, 'три известных дня — три точки');
  assert.deepEqual(list(series.map((p) => p.r)), [1000, 1016, 1032]);
  assert.equal(series[2].t, today, 'последняя точка — сегодня');
  assert.ok(series.every((p, i) => i === 0 || p.t > series[i - 1].t), 'дни по возрастанию');
});

test('точки старше 30 дней не тянутся дальше, первая точка дня — рейтинг до матча', () => {
  S.hist = [{ t: today - 40 * DAY, r: 900 }, { t: today - 39 * DAY, r: 950 }];
  ratingNote(1000, 980);
  assert.ok(S.hist.every((p) => p.t >= today - HIST_DAYS * DAY), 'старше окна — выброшено');
  assert.deepEqual(list(S.hist.map((p) => p.r)), [980, 1000], 'первая точка дня — рейтинг ДО матча');
  assert.deepEqual(list(ratingSeries().map((p) => p.r)), [980, 1000]);
});

test('ответ сервера правит сегодняшнюю точку, а не добавляет новую', () => {
  S.hist = [{ t: today - DAY + 36e5, r: 1000 }, { t: today + 1, r: 1048 }];
  ratingCorrect(1040);
  assert.equal(S.hist.length, 2, 'одна точка на день');
  assert.equal(S.hist[1].r, 1040, 'сегодняшняя точка стала серверной');
  assert.equal(ratingSeries()[1].r, 1040, 'график показывает серверное число');
  ratingCorrect('не число');
  assert.equal(S.hist.length, 2, 'мусор с сервера историю не трогает');
});
