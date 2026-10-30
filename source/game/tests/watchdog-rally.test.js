const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/* Гейт сторожа на живой физике: настоящий ИИ (plan → commit → swing →
 * refine → execution error), настоящий интегратор, настоящие отскоки.
 * Полный прогон по 200 ударов на уровень — `npm run watchdog:rally`;
 * здесь укороченная версия, чтобы `npm test` не ждал минуту. */
const root = path.resolve(__dirname, '..');
const run = (strokes) => JSON.parse(execFileSync(process.execPath,
  [path.join(root, 'tt/tools/headless-rally.cjs'), `--strokes=${strokes}`, '--json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

test('headless rally: no false anomalies on the bot blade, in frame, or at the ceiling', () => {
  const out = run(40);
  assert.equal(out.pass, true, JSON.stringify(out.total));
  assert.equal(out.total.BALL_THROUGH_RACKET, 0);
  assert.equal(out.total.RACKET_UNDER_TABLE, 0);
  assert.equal(out.total.SPEED_CEILING, 0);
  assert.equal(out.other, 0, 'no other code may fire either');
  for (const lv of out.perLevel) assert.equal(lv.gates, 'green', `level ${lv.name}`);
  /* Зелёный прогон обязан быть НЕ пустым: детекторы должны были реально
   * смотреть на клинок и на кадр, иначе «ноль тикетов» ничего не значит. */
  assert.ok(out.probe.armedSteps > 1000, `armed substeps: ${out.probe.armedSteps}`);
  assert.ok(out.probe.planeCrossings > 0, 'the ball must have crossed the blade plane');
  assert.ok(out.probe.poses > 1000, 'both rackets must be measured every frame');
  assert.ok(out.probe.strokes > 100, 'the bot must actually hit');
  assert.ok(out.msPerFrame < 0.05, `watchdog costs ${out.msPerFrame} ms per frame`);
});
