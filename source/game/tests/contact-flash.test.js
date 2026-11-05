/* Фаза 1 контактной вспышки: один принятый контакт ракетки — одна короткая
 * пульса в замороженной точке касания, окрашенная в цвет ПРИНЯТОГО удара.
 * Проверяем палитру (единственный источник — STROKES.col), алиасы подач,
 * нейтральный неизвестный id, дедупликацию по стороне+shotId, границы
 * одновременных пульс, гейзы приостановленных состояний и то, что живёт
 * вспышка в незамедленном времени матча, а не в strokeTime/частицах/шлейфе. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '57_camera.js', '70_game.js'],
  ['Game', 'SwipeTracker', 'ShotJournal', 'V3', 'Q', 'PH', 'GS', 'STROKES', 'SERVE_STROKE_ALIAS',
    'CONTACT_FLASH_LIFE_S', 'CONTACT_FLASH_OPACITY', 'CONTACT_FLASH_W0', 'CONTACT_FLASH_W1',
    'FLASH_NEUTRAL_HEX', 'hexToRgb']);
const { GS, STROKES, SERVE_STROKE_ALIAS, V3, Q, PH } = lib;

function stub(over = {}) {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, {
    time: 1, strokeTime: 1, timeScale: 1, state: GS.RALLY, paused: false, reducedMotion: false,
    _ttSleeping: false, preview: null, shotId: 7, server: 1, rally: 0, rallyBounces: [1],
    isServeBall: false, training: null, demoMode: false, netTouched: false, hitFlash: 0,
    ball: { p: V3.new(0, 1, 0.4), v: V3.new(0, 0, 4), w: V3.new(), q: Q.new(), live: true, lastHitBy: -1, hist: [] },
    contactFlashes: [], _contactFlashSeen: new Set(),
    settings: { showTrail: true, hand: 'right', grip: 'shakehand' }, _calValues: { trailLen: 40 },
  }, over);
  return g;
}
const rgb = (f) => [f.r, f.g, f.b];
/* конвертация живёт в vm-контексте движка: массивы из разных realm'ов
 * deepStrictEqual не сравнивает, поэтому забираем значения в локальный массив */
const host = (c) => [c[0], c[1], c[2]];
const paletteOf = (id) => host(lib.hexToRgb(STROKES[SERVE_STROKE_ALIAS[id] || id].col));

test('the contact palette is the single STROKES.col metadata for all twenty ids', () => {
  const ids = Object.keys(STROKES);
  assert.equal(ids.length, 20, `expected twenty archetypes, got ${ids.length}`);
  for (const id of ids) {
    const g = stub();
    g._recordContactFlash(1, id, V3.new(0, 1, 0.4), g.time);
    assert.equal(g.contactFlashes.length, 1, `${id}: an accepted contact must flash`);
    const f = g.contactFlashes[0];
    assert.equal(f.id, id, `${id}: the pulse remembers the accepted stroke`);
    assert.deepEqual(rgb(f), paletteOf(id), `${id}: colour comes from STROKES.col`);
  }
  /* контраст пары, которую чаще всего путают на маленьком экране */
  assert.notDeepEqual(rgbOfHex(STROKES.BLOCK.col), rgbOfHex(STROKES.DRIVE.col));
  assert.deepEqual(rgbOfHex(STROKES.BLOCK.col), rgbOfHex('#f5f7ff'), 'BLOCK is the cool white');
  assert.deepEqual(rgbOfHex(STROKES.CHOP_BLOCK.col), rgbOfHex('#94b5ff'), 'CHOP_BLOCK is periwinkle blue');
  assert.deepEqual(rgbOfHex(STROKES.SERVE_NO_SPIN.col), rgbOfHex('#7fafc2'), 'a flat serve is steel, not white');
});

function rgbOfHex(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

test('serves borrow the stroke they execute, unknown ids stay neutral', () => {
  const alias = { SERVE_TOP: 'LOOP', SERVE_BACK: 'PUSH', SERVE_SIDE: 'SIDE', SERVE_FAST: 'DRIVE' };
  for (const [serve, rally] of Object.entries(alias)) {
    const g = stub();
    g._recordContactFlash(1, serve, V3.new(0, 1, 0.4), g.time);
    assert.deepEqual(rgb(g.contactFlashes[0]), host(lib.hexToRgb(STROKES[rally].col)), `${serve} must read as ${rally}`);
    assert.equal(g.contactFlashes[0].id, serve, `${serve}: the accepted id stays the serve, not the rally label`);
  }
  const unknown = stub();
  unknown._recordContactFlash(1, 'NOT_A_STROKE', V3.new(0, 1, 0.4), unknown.time);
  assert.equal(unknown.contactFlashes.length, 1, 'an accepted contact always flashes');
  assert.equal(unknown.contactFlashes[0].id, null, 'the pulse must not claim a classified stroke');
  assert.deepEqual(rgb(unknown.contactFlashes[0]), rgbOfHex(lib.FLASH_NEUTRAL_HEX), 'unknown ids use neutral styling');
  /* скользящий контакт приносит голое `{id:'BLOCK'}` без `.col`: вызывающая
   * сторона достаёт только id, а палитру читает канонический метаданные */
  const glance = stub();
  const glancingRacket = { id: 'BLOCK' };
  glance._recordContactFlash(1, glancingRacket.id, V3.new(0, 1, 0.4), glance.time);
  assert.deepEqual(rgb(glance.contactFlashes[0]), host(lib.hexToRgb(STROKES.BLOCK.col)), 'BLOCK resolves through canonical metadata');
});

test('one pulse per accepted contact, both sides keep theirs, at most two alive', () => {
  const g = stub();
  g._recordContactFlash(1, 'DRIVE', V3.new(0, 1, 0.4), g.time);
  g._recordContactFlash(1, 'LOOP', V3.new(0, 1, 0.4), g.time);
  assert.equal(g.contactFlashes.length, 1, 'the same side + shotId is the same contact');
  g._recordContactFlash(-1, 'LOOP', V3.new(0, 1, 0.4), g.time);
  assert.equal(g.contactFlashes.length, 2, 'the opponent contact is a different identity');
  assert.deepEqual(g.contactFlashes.map((f) => f.side), [1, -1]);
  g.shotId++;
  g._recordContactFlash(1, 'PUSH', V3.new(0, 1, 0.4), g.time);
  g.shotId++;
  g._recordContactFlash(-1, 'CHOP', V3.new(0, 1, 0.4), g.time);
  assert.equal(g.contactFlashes.length, 2, 'never more than two simultaneous pulses');
  assert.deepEqual(g.contactFlashes.map((f) => f.id), ['PUSH', 'CHOP'], 'the oldest pulse is dropped, not the newest');
});

test('the pulse is frozen at the contact point and dies in un-slowed match time', () => {
  const g = stub();
  const contact = V3.new(0.12, 0.93, 0.55);
  g._recordContactFlash(1, 'LOOP', contact, g.time);
  const f = g.contactFlashes[0];
  assert.notEqual(f.p, contact, 'the position is cloned, not aliased');
  V3.set(contact, 9, 9, 9); V3.set(g.ball.p, -3, 2, -2);
  assert.deepEqual([f.p.x, f.p.y, f.p.z], [0.12, 0.93, 0.55], 'neither the ball nor a later contact may drag the flash');
  assert.equal(lib.CONTACT_FLASH_LIFE_S, 0.12, 'about 120 ms');
  assert.equal(f.life, lib.CONTACT_FLASH_LIFE_S);
  g.ageContactFlashes(f.birth + 0.119);
  assert.equal(g.contactFlashes.length, 1, 'still fading just before the end');
  g.ageContactFlashes(f.birth + 0.12);
  assert.equal(g.contactFlashes.length, 0, 'expired at 120 ms of Game.time');
  /* the clock that ages the pulse is the match clock, never the scaled one */
  const src = fs.readFileSync(path.resolve(__dirname, '../tt/src/70_game.js'), 'utf8');
  assert.match(src, /this\.ageContactFlashes\(this\.time\)/, 'the purge runs on Game.time');
  assert.doesNotMatch(src, /ageContactFlashes\(this\.strokeTime/, 'slow motion must not stretch the pulse');
});

test('paused, sleeping, reduced-motion, preview and menu states neither spawn nor freeze a pulse', () => {
  const gated = [
    ['paused', { paused: true }], ['sleeping', { _ttSleeping: true }],
    ['reduced motion', { reducedMotion: true }], ['preview', { preview: { active: true } }],
    ['menu', { state: GS.MENU }], ['splash', { state: GS.SPLASH }],
  ];
  for (const [name, over] of gated) {
    const g = stub(over);
    g._recordContactFlash(1, 'DRIVE', V3.new(0, 1, 0.4), g.time);
    assert.equal(g.contactFlashes.length, 0, `${name} must not spawn a pulse`);
  }
  const born = stub();
  born._recordContactFlash(1, 'DRIVE', V3.new(0, 1, 0.4), born.time);
  born.setPaused = undefined;
  born.clearContactFlashes();
  assert.equal(born.contactFlashes.length, 0, 'a suspended state clears the pulse synchronously');
  /* книга дедупликации переживает паузу: тот же контакт не воскресает */
  born._recordContactFlash(1, 'DRIVE', V3.new(0, 1, 0.4), born.time);
  assert.equal(born.contactFlashes.length, 0, 'the same shotId cannot re-flash after resume');
  born.shotId++;
  born._recordContactFlash(1, 'DRIVE', V3.new(0, 1, 0.4), born.time);
  assert.equal(born.contactFlashes.length, 1, 'a new contact does flash');
});

test('a new serve resets the visual bookkeeping so reused shot ids can flash again', () => {
  const paddle = () => ({ pos: V3.new(0, PH.TABLE_Y + 0.25, PH.T_HALF_LEN + 0.45), prevPos: V3.new(), prev: V3.new(),
    vel: V3.new(), normal: V3.new(0, 0.15, -1), roll: 0, forehand: true, lastHitT: -9, swing: 0 });
  const g = stub({
    player: paddle(), aiPaddle: paddle(), score: [0, 0], recenterT: 0, _acc: 0,
    followThrough: { active: false }, anticipation: { active: false },
    audio: { resetRally() {}, ui() {} }, recorder: { begin() {} }, moments: { beginRally() {} },
    ai: { setPressure() {}, reset() {} }, paddleMotion: null, _liveRig: { eye: V3.new(), look: V3.new(), fov: 44, shiftY: 0 },
    swipe: { cancel() {}, pressZone: null }, shotJournal: new lib.ShotJournal(),
    ui: { clearShotFeedback() {} },
    _contactFlashSeen: new Set(['1/7']),
  });
  g.contactFlashes.push({ side: 1, id: 'DRIVE', p: V3.clone(g.ball.p), r: 1, g: 0, b: 0, birth: 1, life: 0.12 });
  g.prepServe();
  assert.equal(g.contactFlashes.length, 0, 'the serve installs a clean visual generation');
  assert.equal(g._contactFlashSeen.size, 0, 'reused numeric shot ids must not suppress the first pulse');
  g._recordContactFlash(1, 'SERVE_TOP', V3.new(0, 1, 0.4), g.time);
  assert.equal(g.contactFlashes.length, 1, 'the serve contact flashes right after prepServe');
});

test('a passive wall contact flashes at the pre-displacement point as BLOCK', () => {
  const g = stub({
    swipe: { active: true, pressZone: null, gestureId: 3, consumedGestureId: -1, realGestureId: 3 },
    shotJournal: new lib.ShotJournal(),
    equip: { forSide: () => null }, stats: {}, audio: { hitRacket() {}, onRallyHit() {}, ui() {} },
    paddleMotion: null, buzz() {}, msg() {}, emitParticles() {}, logInput() {},
    bestRally: 0, points: [], recorder: { addShot() {} }, moments: { addContact() {} },
    player: { pos: V3.new(0.05, PH.TABLE_Y + 0.25, PH.T_HALF_LEN + 0.45), prevPos: V3.new(), vel: V3.new(0, 0, 0),
      normal: V3.new(0, 0.15, -1), roll: 0, forehand: true, lastHitT: 0, swing: 0, contactInput: null },
  });
  g.shotJournal.create(g.swipe.gestureId, g.time);
  const b = g.ball, pad = g.player;
  V3.set(b.p, pad.pos.x + 0.03, pad.pos.y - 0.02, pad.pos.z - 0.12);
  V3.set(b.v, 0.1, -0.4, 4.8); V3.set(b.w, -40, 0, 0);
  const preContact = V3.clone(b.p);
  assert.equal(g._tryPassiveBlock(pad, b), true, 'the wall must accept the block');
  assert.equal(g.contactFlashes.length, 1, 'a held block bypasses applyHit but is still a contact');
  const f = g.contactFlashes[0];
  assert.equal(f.id, 'BLOCK');
  assert.deepEqual(rgb(f), host(lib.hexToRgb(STROKES.BLOCK.col)), 'ordinary BLOCK stays white');
  assert.ok(V3.dist(f.p, preContact) < 1e-9,
    'the pulse is pinned to the ball position before the contact displaced it');
  assert.ok(V3.dist(f.p, b.p) > 0, 'and not to the CCD-moved ball');
});

test('the quad is sized to be SEEN around the ball, not to hide behind it', () => {
  /* Замер в живом рендере (headless Chromium, readPixels всего кадра): мяч —
   * непрозрачная сфера с depth-mask, а пульса рисуется аддитивно ПОСЛЕ него.
   * Квад диаметра мяча в пике давал ровно ноль изменённых пикселей: эффект
   * существовал только как тонкая кромка на закате. Пик — от 1.4 диаметра. */
  const ballDia = 2 * PH.R;
  const peak = lib.CONTACT_FLASH_W0 * PH.R, end = (lib.CONTACT_FLASH_W0 + lib.CONTACT_FLASH_W1) * PH.R;
  assert.ok(peak >= 1.4 * ballDia, `пик ${peak.toFixed(3)} м должен превышать силуэт мяча ${ballDia.toFixed(3)} м`);
  assert.ok(end <= 2.25 * ballDia, `наружный диаметр ${end.toFixed(3)} м не влезает в ~2.2 диаметра мяча`);
  assert.ok(peak < end, 'пульса разрастается, а не сжимается');
  assert.ok(lib.CONTACT_FLASH_OPACITY >= 0.20 && lib.CONTACT_FLASH_OPACITY <= 0.25,
    'пиковая непрозрачность в согласованной полосе 0.20–0.25');
  /* яркость мяча не должна перебиваться: аддитивный слой без uAlbedo-белизны */
  const src = fs.readFileSync(path.resolve(__dirname, '../tt/src/70_game.js'), 'utf8');
  assert.match(src, /tex: this\.scene\.tex\.glow, blend: 'add', doubleSided: true, unlit: 1/, ' пульса — unlit-эмиссия по glow-альфе');
  assert.doesNotMatch(src, /CONTACT_FLASH_OPACITY = 0\.[3-9]/, 'никакого произвольного усиления сверх полосы');
});
