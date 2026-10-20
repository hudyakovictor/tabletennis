/* Тесты меню-хаба: motion-математика, личные настройки удара и связь
 * отчёта по 100 анализам с реально внедрёнными приёмами. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./helpers.cjs');

const src = (f) => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8');

/* --------------------------- motion-математика хаба ------------------- */
test('пружина хаба сходится к цели и не пролетает мимо', () => {
  const { HubSpring } = load(['82_hub.js'], ['HubSpring']);
  const s = new HubSpring(0, { stiffness: 220, damping: 26 });
  s.to(100);
  let max = 0, steps = 0;
  while (!s.step(1 / 60) && steps < 600) { max = Math.max(max, s.value); steps++; }
  assert.ok(steps < 600, 'пружина должна успокоиться');
  assert.equal(s.value, 100);
  assert.ok(max <= 100.01, 'пружина не должна пролетать мимо цели: ' + max);
  assert.equal(s.resting, true);
});

test('пружина реагирует на новую цель, не залипая', () => {
  const { HubSpring } = load(['82_hub.js'], ['HubSpring']);
  const s = new HubSpring(0, { stiffness: 200, damping: 24 });
  s.to(10);
  for (let i = 0; i < 200 && !s.step(1 / 60); i++) {}
  s.to(40);
  assert.equal(s.resting, false);
  for (let i = 0; i < 300 && !s.step(1 / 60); i++) {}
  assert.equal(s.value, 40);
});

test('дешифратор заголовка собирает исходный текст и держит разделители', () => {
  const { hubScrambleFrame } = load(['82_hub.js'], ['hubScrambleFrame']);
  const text = 'ТОПСПИН · АРЕНА';
  assert.equal(hubScrambleFrame(text, 0, 7).length, text.length);
  const mid = hubScrambleFrame(text, 0.5, 7);
  assert.ok(mid.includes(' ') && mid.includes('·'), 'разделители не должны шифроваться');
  assert.equal(hubScrambleFrame(text, 1, 7), text);
});

test('каскад ограничен потолком: поздние блоки не ждут слишком долго', () => {
  const { hubStaggerIndices } = load(['82_hub.js'], ['hubStaggerIndices']);
  const idx = hubStaggerIndices(20, 34, 12);
  assert.equal(idx.length, 20);
  assert.equal(idx[0], 0);
  assert.ok(idx[12] <= idx[19], 'задержки не растут после потолка');
  assert.ok(idx[19] <= 12 * 34 + 1);
});

test('функции хаба доступны без браузера (тест не зависит от DOM)', () => {
  const api = load(['82_hub.js'], ['hubEaseOut', 'hubEaseInOut', 'hubClamp', 'hubLerp']);
  assert.equal(api.hubEaseOut(0), 0);
  assert.equal(api.hubEaseOut(1), 1);
  assert.equal(api.hubEaseInOut(0), 0);
  assert.equal(api.hubEaseInOut(1), 1);
  assert.equal(api.hubClamp(5, 0, 1), 1);
  assert.equal(api.hubLerp(0, 10, 0.25), 2.5);
});

/* ------------------------- личные настройки удара -------------------- */
test('личные настройки ужимаются и никогда не дают преимущества', () => {
  const { PLAYER_TUNING, setPlayerTuning, resetPlayerTuning, PLAYER_TUNING_LIMITS, MATCH_RULES } =
    load(['10_math.js', '12_match_rules.js'],
      ['PLAYER_TUNING', 'setPlayerTuning', 'resetPlayerTuning', 'PLAYER_TUNING_LIMITS', 'MATCH_RULES']);
  resetPlayerTuning();
  assert.equal(PLAYER_TUNING.capture, 1);
  assert.equal(PLAYER_TUNING.press, 1);
  assert.equal(PLAYER_TUNING.aim, MATCH_RULES.trajectoryAssist);
  assert.equal(PLAYER_TUNING.approach, MATCH_RULES.positionAssist);
  assert.equal(PLAYER_TUNING.sens, 1);
  /* верхние границы равны авторским значениям */
  assert.equal(setPlayerTuning('capture', 5), 1);
  assert.equal(setPlayerTuning('press', 5), 1);
  assert.equal(setPlayerTuning('aim', 5), MATCH_RULES.trajectoryAssist);
  assert.equal(setPlayerTuning('approach', 5), MATCH_RULES.positionAssist);
  /* нижние границы — только ужимание */
  assert.equal(setPlayerTuning('capture', 0.1), PLAYER_TUNING_LIMITS.capture[0]);
  assert.equal(setPlayerTuning('press', 0.1), PLAYER_TUNING_LIMITS.press[0]);
  assert.equal(setPlayerTuning('sens', 9), PLAYER_TUNING_LIMITS.sens[1]);
  /* мусорные значения игнорируются */
  assert.equal(setPlayerTuning('capture', 'abc'), PLAYER_TUNING.capture);
  assert.equal(setPlayerTuning('nope', 1), null);
  resetPlayerTuning();
  assert.equal(PLAYER_TUNING.capture, 1);
});

test('окно захвата сужается только вместе с настройкой игрока', () => {
  const { playerCaptureLimits, setPlayerTuning, resetPlayerTuning, MATCH_RULES } =
    load(['10_math.js', '12_match_rules.js'], ['playerCaptureLimits', 'setPlayerTuning', 'resetPlayerTuning', 'MATCH_RULES']);
  resetPlayerTuning();
  const base = playerCaptureLimits(false);
  assert.equal(base.radius, MATCH_RULES.captureRadius);
  setPlayerTuning('capture', 0.8);
  const narrow = playerCaptureLimits(false);
  assert.ok(narrow.radius < base.radius);
  assert.equal(narrow.sweet, base.sweet, 'сладкая зона не должна меняться');
  resetPlayerTuning();
});

/* --------------------- отчёт по анализам и код --------------------- */
test('отчёт по 100 анализам соответствует внедрённому коду', () => {
  const reportPath = path.join(root, 'docs', 'menu-motion-analysis.json');
  assert.ok(fs.existsSync(reportPath), 'нет отчёта docs/menu-motion-analysis.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.runs, 100);
  assert.equal(report.rounds, 2);
  assert.ok(report.chosen.length >= 15, 'в отчёте должно быть много выбранных приёмов');
  assert.ok(report.rejected.length >= 5, 'отклонённые приёмы должны быть зафиксированы');

  const code = ['82_hub.js', '05_style.css', '80_ui.js', '02_body.html']
    .map((f) => src(f)).join('\n');
  /* Каждый выбранный приём должен быть виден в коде по своему маркеру. */
  const markers = {
    spring: 'HubSpring', 'view-transition': '.screen.on', stagger: 'hub-enter',
    'dock-morph': 'movePill', 'dock-magnify': 'dock-btn.on', spotlight: 'bindSpotlight',
    'border-beam': 'btn-hero', scramble: 'hubScrambleFrame', ticker: 'setNumber',
    confetti: 'hub-spark', 'coin-fly': 'hub-coin-fly', toast: 'hubToast',
    ripple: 'hub-ripple', bento: 'bento', 'aurora-bg': 'hub-orb', 'light-rays': 'hub-beam',
    glass: 'hub-dock', 'progress-ring': 'track', 'live-preview': 'drawServePreview',
    'label-underline': '.opt.sel', 'focus-ring': 'focus-visible',
  };
  for (const c of report.chosen) {
    const m = markers[c.id];
    assert.ok(m, 'нет маркера для приёма ' + c.id);
    assert.ok(code.includes(m), 'приём ' + c.id + ' не найден в коде (' + m + ')');
  }
  /* Отклонённые приёмы действительно не внедрены. */
  for (const r of report.rejected) {
    assert.equal(r.impl, 'не внедрён', 'отклонённый приём ' + r.id + ' не должен быть внедрён');
  }
});

test('бюджеты раунда analyses не превышены', () => {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'menu-motion-analysis.json'), 'utf8'));
  for (const cls of Object.keys(report.budget)) {
    assert.ok(report.spent[cls] <= report.budget[cls],
      'бюджет ' + cls + ' превышен: ' + report.spent[cls] + ' > ' + report.budget[cls]);
  }
});

test('меню-хаб в разметке: док, шторка, сцена и живые области', () => {
  const body = src('02_body.html');
  for (const id of ['hub', 'hubTop', 'hubStage', 'hubDock', 'dockPill', 'hubDrawer',
    'hubScrim', 'hubFx', 'hubLive', 'hubToast']) {
    assert.ok(body.includes('id="' + id + '"'), 'нет #' + id);
  }
  assert.ok(body.includes('role="status" aria-live="polite"'), 'нет aria-live области');
  assert.ok(body.includes('aria-modal="true"'), 'модальные экраны должны быть aria-modal');
});

test('сборка совпадает с опубликованным HTML', () => {
  const built = fs.readFileSync(path.join(root, 'table-tennis-topspin.html'), 'utf8');
  const play = fs.readFileSync(path.join(root, 'play', 'index.html'), 'utf8');
  assert.equal(built.length, play.length, 'play/index.html должен совпадать со сборкой');
  assert.ok(built.includes('MenuHub'), 'в сборке нет motion-системы хаба');
});
