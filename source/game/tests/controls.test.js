const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
/* 55_ai.js sits before 70_game.js: Game.setDifficulty() reads the global
 * AI_LEVELS to clamp the index, so the fixture must load the AI module too. */
const lib = load(['10_math.js', '12_match_rules.js', '25_career.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '55_ai.js', '56_rig.js', '57_camera.js', '70_game.js', '80_ui.js'],
  ['MATCH_RULES', 'pressHitZone', 'ballCaptureTarget', 'measureCaptureAllowance', 'installUnifiedControls', 'playerCaptureLimits', 'playerInCaptureRange', 'strikeCueModel',
    'Game', 'UI', 'GS', 'V3', 'Career', 'PERKS', 'MEET_ASSIST', 'AI_LEVELS']);
const { MATCH_RULES: rules, V3, GS } = lib;
function fixture() {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, { settings: lib.installUnifiedControls({ hand: 'right', grip: 'shakehand', difficulty: 2, volume: .9 }),
    state: GS.RALLY, server: 1, paused: false, shotId: 2, replayer: { on: false },
    ball: { live: true, p: V3.new(0, 1, 1.5), v: V3.new(0, 0, 6), w: V3.new(), lastHitBy: -1 },
    player: { pos: V3.new(0, 1, 1.5) }, rallyBounces: [1], tossApex: 1.4,
    audio: { setVolume() {}, setMuted() {} }, ai: { setLevel() {}, reset() {} },
    profile: { data: {}, touch() {} }, R: {}, canvas: { style: {} },
    pointer: { x: .5, y: .5 }, pointerInside: true,
  });
  return g;
}
function canvasFixture() {
  const ops = [];
  const c = {};
  for (const method of ['save', 'restore', 'beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'setLineDash'])
    c[method] = (...args) => ops.push({ method, args });
  const u = Object.create(lib.UI.prototype), g = fixture();
  g.project = () => ({ x: .4, y: .5, ok: true });
  Object.assign(u, { game: g, hasFinePointer: true, _cur: '', _pv: {} });
  return { g, u, c, ops };
}

test('shared gameplay contract is frozen and publishes the v3 racket-sized capture', () => {
  assert.equal(Object.isFrozen(rules), true);
  assert.equal(rules.captureRadius, .22);
  assert.equal(rules.depthTolerance, .22);
  assert.equal(rules.serveCaptureRadius, .55);
  assert.equal(rules.contactAtClosest, true);
  assert.equal(rules.autoFootwork, true);
  assert.equal(rules.trajectoryAssist, .85);
  assert.equal(rules.positionAssist, .85);
});

test('strict-mode legacy writes cannot change controls and do not crash gameplay', () => {
  const settings = lib.installUnifiedControls({ assist: .1, hitZone: .3 });
  for (const key of ['assist', 'posAssist', 'hitZone', 'sensitivity', 'showZone']) {
    const before = settings[key]; settings[key] = 0;
    assert.equal(settings[key], before);
    assert.equal(Object.getOwnPropertyDescriptor(settings, key).configurable, false);
    assert.equal(Object.keys(settings).includes(key), false);
  }
});

test('old saved gameplay sliders are ignored while hand and grip still restore', () => {
  const g = fixture();
  g.profile.data.settings = { assist: 0, posAssist: 1, hitZone: .3, sensitivity: 1.8, showZone: false,
    hand: 'left', grip: 'penhold' };
  g.loadSettings();
  assert.equal(g.settings.assist, .85); assert.equal(g.settings.posAssist, .85);
  assert.equal(g.settings.hitZone, .85); assert.equal(g.settings.sensitivity, 1);
  assert.equal(g.settings.showZone, true); assert.equal(g.settings.hand, 'left');
  assert.equal(g.settings.grip, 'penhold');
});

test('new saves never resurrect assistance through career base settings', () => {
  const g = fixture();
  g.career = { active: true, _baseSettings: { difficulty: 1, assist: .1, posAssist: .2 } };
  g.saveSettings();
  assert.equal(g.profile.data.settings.rulesVersion, rules.version);
  assert.equal(g.profile.data.settings.difficulty, 1);
  for (const key of ['assist', 'posAssist', 'hitZone', 'sensitivity', 'showZone'])
    assert.equal(key in g.profile.data.settings, false);
});

test('removed slider API is a no-op, not just hidden HTML', () => {
  const u = Object.create(lib.UI.prototype), g = fixture(); u.game = g;
  for (const key of ['hitZone', 'assist', 'posAssist', 'sens', 'zone']) u.applySetting(key, 0);
  assert.equal(g.settings.assist, rules.trajectoryAssist);
  assert.equal(g.settings.posAssist, rules.positionAssist);
  assert.equal(g.settings.sensitivity, rules.sensitivity);
});

test('capture boundaries are inclusive and outside endpoint capture is rejected', () => {
  const origin = V3.new();
  assert.equal(lib.playerInCaptureRange(V3.new(rules.captureRadius, 0, rules.depthTolerance), origin), true);
  assert.equal(lib.playerInCaptureRange(V3.new(rules.captureRadius + .0001, 0, 0), origin), false);
  assert.equal(lib.playerInCaptureRange(V3.new(0, 0, rules.depthTolerance + .0001), origin), false);
  assert.equal(lib.playerInCaptureRange(V3.new(0, rules.captureRadius, 0), origin), true);
  assert.equal(lib.playerInCaptureRange(V3.new(.5, .5, 0), origin), false);
});

test('serve envelope is a sphere, not a larger rectangular corner exploit', () => {
  assert.equal(lib.playerInCaptureRange(V3.new(rules.serveCaptureRadius, 0, 0), V3.new(), true), true);
  assert.equal(lib.playerInCaptureRange(V3.new(.6, .6, .6), V3.new(), true), false);
  assert.equal(lib.playerCaptureLimits(true).sweet, lib.playerCaptureLimits(false).sweet);
});

test('invalid coordinates cannot light the contact window', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined])
    assert.equal(lib.playerInCaptureRange({ x: bad, y: 0, z: 0 }, V3.new()), false);
});

test('timing cue has a bounded CSS size, never the metre-scale capture radius', () => {
  for (const time of [0, .1, .3, .44]) {
    const cue = lib.strikeCueModel({ on: true, kind: 'rally', t: time, k: 1, ready: .5, contactable: false });
    assert.ok(cue.radius >= 8 && cue.radius <= 20);
  }
  assert.equal(lib.strikeCueModel({ on: true, kind: 'rally', t: .45, k: 1, ready: .5 }), null);
});

test('cue shape, not colour alone, distinguishes contact availability', () => {
  const base = { on: true, kind: 'rally', t: 0, k: 1, ready: 1 };
  assert.equal(lib.strikeCueModel({ ...base, contactable: true }).dashed, false);
  assert.equal(lib.strikeCueModel({ ...base, contactable: false }).dashed, true);
});

test('malformed cue values cannot poison Canvas with NaN or Infinity', () => {
  for (const patch of [{ t: NaN }, { k: NaN }, { ready: Infinity }, { kind: 'ready' }, { on: false }])
    assert.equal(lib.strikeCueModel({ on: true, kind: 'rally', t: 0, k: 1, ready: 1, ...patch }), null);
});

test('ready stance does not put a golden timing circle on the racket', () => {
  const g = fixture(); g.state = GS.SERVE_READY; g.updateStrikeWindow(1 / 60);
  assert.equal(g._strike.on, false); assert.equal(lib.strikeCueModel(g._strike), null);
});

test('rising or insufficiently tossed serve cannot advertise a hit window', () => {
  const g = fixture(); g.state = GS.SERVE_TOSS; g.ball.lastHitBy = 0;
  g.ball.v.y = 1; g.updateStrikeWindow(1 / 60); assert.equal(g._strike.on, false);
  g.ball.v.y = -1; g.tossApex = .8; g.updateStrikeWindow(1 / 60); assert.equal(g._strike.on, false);
});

test('falling serve cue follows the ball, not the paddle or pointer', () => {
  const g = fixture(); g.state = GS.SERVE_TOSS; g.ball.lastHitBy = 0; g.ball.v.y = -1;
  g.ball.p.x = .12; g.updateStrikeWindow(1 / 60);
  assert.equal(g._strike.on, true); assert.equal(g._strike.contactable, true);
  assert.equal(g._strike.x, g.ball.p.x); assert.notEqual(g._strike.x, g.player.pos.x);
});

test('no hot cue before the legal receiving bounce or on an outgoing ball', () => {
  const g = fixture(); g.rallyBounces = []; g.updateStrikeWindow(1 / 60);
  assert.equal(g._strike.on, false);
  g.rallyBounces = [1]; g.ball.lastHitBy = 1; g.updateStrikeWindow(1 / 60);
  assert.equal(g._strike.on, false);
});

test('spatially reachable legal incoming ball opens the window without automatically hitting', () => {
  const g = fixture(), before = JSON.stringify(g.ball);
  g.updateStrikeWindow(1 / 60);
  assert.equal(g._strike.on, true); assert.equal(g._strike.contactable, true);
  assert.equal(g._strike.ready, 1); assert.equal(JSON.stringify(g.ball), before);
});

test('paused and replay states suppress gameplay timing hints', () => {
  for (const mode of ['pause', 'replay']) {
    const g = fixture(); if (mode === 'pause') g.paused = true; else g.replayer.on = true;
    g.updateStrikeWindow(1 / 60); assert.equal(g._strike.k, 0);
  }
});

test('custom pointer renderer and dot size stay removed; live play hides native cursor', () => {
  const { g, u, ops } = canvasFixture();
  g.canvas.style.cursor = 'none'; u.syncNativeCursor();
  assert.equal(typeof u.drawHand, 'undefined');
  assert.equal('cursorDotPx' in rules, false);
  assert.equal(ops.length, 0);
  assert.equal(g.canvas.style.cursor, 'none');
});

test('cursor is hidden over live play and restored for pause, results, menus and replay', () => {
  for (const mode of ['play', 'touch', 'outside', 'pause', 'replay', 'menu', 'results', 'invalid']) {
    const { g, u, ops } = canvasFixture();
    if (mode === 'touch') u.hasFinePointer = false;
    if (mode === 'outside') g.pointerInside = false;
    if (mode === 'pause') g.paused = true;
    if (mode === 'replay') g.replayer.on = true;
    if (mode === 'menu') g.state = GS.MENU;
    if (mode === 'results') g.state = GS.MATCH_END;
    if (mode === 'invalid') g.pointer.x = NaN;
    g.canvas.style.cursor = 'none'; u.syncNativeCursor();
    assert.equal(ops.length, 0); assert.equal(g.canvas.style.cursor, ['pause', 'replay', 'menu', 'results'].includes(mode) ? 'default' : 'none');
  }
});

test('timing brackets use actual ball projection and contain no circular hitbox drawing', () => {
  const { g, u, c, ops } = canvasFixture();
  g._strike = { on: true, kind: 'rally', t: 0, k: 1, ready: 1, contactable: true, x: 999 };
  g.project = p => { assert.equal(p, g.ball.p); return { x: .4, y: .5, ok: true }; };
  u.drawStrikeRing(c, 1000, 500, 1);
  assert.equal(ops.filter(o => o.method === 'arc').length, 0);
  assert.equal(ops.filter(o => o.method === 'moveTo').length, 4);
  assert.equal(ops.filter(o => o.method === 'lineTo').length, 8);
});

test('legacy careers discard retired assist perks rather than silently restoring different rules', () => {
  const g = fixture(); g.startMatch = () => {}; g.score = [0, 0]; g.stats = { maxSpeed: 0 };
  const c = new lib.Career(g); c.start(); c.save();
  const raw = JSON.parse(lib.saved.get('topspin_career'));
  raw.perks = ['steady_hand', 'quick_feet', 'sharp_eye', 'net_touch', 'berserker', 'glass_cannon', 'heavy_spin'];
  lib.saved.set('topspin_career', JSON.stringify(raw));
  assert.equal(c.load(), true);
  assert.equal(c.perks.length, 1); assert.equal(c.perks[0].id, 'heavy_spin');
  assert.equal(g.settings.assist, .85); assert.equal(g.settings.posAssist, .85);
  assert.ok(lib.PERKS.every(p => !/Assist|Помощь прицела|Помощь позиции|Кольцо удара|всегда перелетает/.test(p.desc)));
});


test('capture debug is opt-in, read-only, and hidden during pause or replay', () => {
  const {g,u,c,ops}=canvasFixture();u.drawCaptureDebug(c,1000,500,1);assert.equal(ops.length,0);
  u.captureDebug=true;const before=JSON.stringify([g.ball,g.player,g.settings]);u.drawCaptureDebug(c,1000,500,1);
  assert.ok(ops.some(o=>o.method==='arc'));assert.equal(JSON.stringify([g.ball,g.player,g.settings]),before);
  ops.length=0;g.paused=true;u.drawCaptureDebug(c,1000,500,1);assert.equal(ops.length,0);
  g.paused=false;g.replayer.on=true;u.drawCaptureDebug(c,1000,500,1);assert.equal(ops.length,0);
});
test('debug cursor is visible only while requested; invalid geometry produces no misleading area', () => {
  const {g,u}=canvasFixture();u.captureDebug=true;u.syncNativeCursor();assert.equal(g.canvas.style.cursor,'default');
  u.captureDebug=false;u.syncNativeCursor();assert.equal(g.canvas.style.cursor,'none');
  assert.equal(lib.ballCaptureTarget({pos:V3.new(NaN,0,0)},g.ball.p),null);
});


test('new target follows the ball, not the racket; section is at actual racket depth', () => {
  const pad={pos:V3.new(.2,1,1.5)},ball=V3.new(-.1,1.1,1.6);
  const model=lib.ballCaptureTarget(pad,ball,false);
  assert.equal(model.center.x,ball.x);assert.equal(model.center.y,ball.y);assert.equal(model.center.z,pad.pos.z);
  assert.equal(model.inside,lib.playerInCaptureRange(ball,pad.pos));
  for(const p of model.points){assert.equal(p.z,pad.pos.z);assert.ok(Math.abs(Math.hypot(p.x-ball.x,p.y-ball.y)-rules.captureRadius)<1e-10);}
  const other=lib.ballCaptureTarget(pad,V3.new(.3,1.3,1.6),false);assert.notEqual(other.center.x,model.center.x);
});
test('ball target never draws a fake acceptance area at an invalid depth', () => {
  const pad={pos:V3.new(0,1,1.5)};
  for(const serving of [false,true]) {
    const model=lib.ballCaptureTarget(pad,V3.new(0,1,3),serving);
    assert.equal(model.depthOk,false);assert.equal(model.inside,false);assert.equal(model.points.length,0);
  }
  const ball=V3.new(0,1,1.8),sphere=lib.ballCaptureTarget(pad,ball,true);
  assert.ok(Math.abs(sphere.radius-Math.sqrt(rules.serveCaptureRadius**2-.3**2))<1e-10);
});
test('measured minimum radius includes alternate continuous collision instead of exaggerating lost hits', () => {
  const pad={pos:V3.new(0,1,1.5),prevPos:V3.new(0,1,1.5),normal:V3.new(0,0,-1)};
  const m=lib.measureCaptureAllowance(pad,V3.new(.1,1,1.4),V3.new(.32,1,1.7),false,true);
  assert.ok(Math.abs(m.endpointRadius-.32)<1e-10);assert.ok(Math.abs(m.ccdRadius-(.1+.22*(.08/.3)))<1e-9);
  assert.equal(m.requiredRadius,m.ccdRadius);assert.ok(m.requiredRadius<rules.captureRadius);
  // beyond the v3 depth tolerance the endpoint route is not eligible at all
  const far=lib.measureCaptureAllowance(pad,V3.new(.1,1,1.4),V3.new(.32,1,1.8),false,true);
  assert.equal(far.endpointRadius,null);
});
test('allowance measurement agrees with real CCD and is read-only over 100 deterministic crossings', () => {
  const g=fixture();const pad={pos:V3.new(0,1,1.5),prevPos:V3.new(.01,1,1.49),normal:V3.new(0,0,-1)};
  for(let i=0;i<100;i++){
    const p0=V3.new(Math.sin(i)*.5,1+Math.cos(i)*.3,1.3),p1=V3.new(Math.sin(i+1)*.5,1+Math.cos(i+1)*.3,1.8);
    const before=JSON.stringify([pad,p0,p1]);const m=lib.measureCaptureAllowance(pad,p0,p1,false,false);
    const hit=g.sweepPaddle(pad,p0,p1,rules.captureRadius);
    assert.equal(!!hit,m.ccdRadius!==null&&m.ccdRadius<=rules.captureRadius);
    if(hit)assert.ok(Math.abs(hit.rad-m.ccdRadius)<1e-10);
    assert.equal(JSON.stringify([pad,p0,p1]),before);
  }
});


test('screen press zone uses CSS pixels and exact inclusive boundary, independent of world geometry',()=>{
  const center={x:.5,y:.5,ok:true};
  const R = rules.pressRadiusPx; // legacy circle; the live default shape is the oval
  for(const [width,height] of [[1280,760],[390,844]]){
    assert.equal(lib.pressHitZone(center,{x:.5+R/width,y:.5},width,height).accepted,true);
    assert.equal(lib.pressHitZone(center,{x:.5+(R+0.01)/width,y:.5},width,height).accepted,false);
    assert.equal(lib.pressHitZone(center,{x:.5,y:.5+(R+1)/height},width,height).accepted,false);
  }
});
test('outside press blocks all physical capture and CCD before assistance can rescue it',()=>{
  const g=fixture();g.swipe={pressZone:{accepted:false}};
  const before=JSON.stringify(g.ball);g.sweepPaddle=()=>{throw Error('must not reach CCD');};
  g.tryPlayerHit(V3.new());assert.equal(JSON.stringify(g.ball),before);
});

test('camera trim persists, quantises and clamps back into its band', () => {
  const g = fixture();
  g.setCamZoom(1.456); g.setCamPitch(7.31);
  assert.equal(g.settings.camZoom, 1.46);          // quantised to whole percents
  assert.equal(g.settings.camPitch, 7.5);          // quantised to half degrees
  g.saveSettings();
  assert.equal(g.profile.data.settings.camZoom, 1.46);
  assert.equal(g.profile.data.settings.camPitch, 7.5);
  // a hostile or stale save is clamped on load, never trusted
  const g2 = fixture();
  g2.profile.data.settings = { camZoom: 99, camPitch: -99 };
  g2.loadSettings();
  assert.equal(g2.settings.camZoom, 1.8);
  assert.equal(g2.settings.camPitch, -16);
  // and a neutral trim survives the round trip unchanged
  const g3 = fixture();
  g3.settings.camZoom = 1; g3.settings.camPitch = 0;
  g3.saveSettings();
  const g4 = fixture();
  g4.profile.data.settings = g3.profile.data.settings;
  g4.loadSettings();
  assert.equal(g4.settings.camZoom, 1);
  assert.equal(g4.settings.camPitch, 0);
});

test('meeting-point assist fades with difficulty: heavy vs rookie, nearly none vs WTF', () => {
  const M = lib.MEET_ASSIST;
  assert.equal(M.length, 4, 'one strength per AI level');
  assert.equal(M[0], 0.85); assert.equal(M[3], 0.10);
  for (let i = 1; i < M.length; i++) assert.ok(M[i] < M[i - 1], `assist must fall off: ${M}`);
  for (const v of M) assert.ok(v >= 0 && v <= 1);
});

test('setDifficulty drives the bot, persists to the profile and ignores garbage', () => {
  const g = fixture();
  g.settings = lib.installUnifiedControls({ difficulty: 1 });
  const seen = [];
  g.ai = { setLevel(i) { seen.push(i); this.levelIndex = i; }, reset() {} };
  assert.equal(g.setDifficulty(3), 3);
  assert.equal(g.ai.levelIndex, 3, 'движок переключил бота, а не только надпись');
  assert.equal(g.profile.data.settings.difficulty, 3, 'уровень уехал в профиль');
  assert.equal(g.setDifficulty('0'), 0, 'строка из UI тоже принимается');
  assert.equal(g.setDifficulty(99), 3, 'индекс клампится сверху');
  assert.equal(g.setDifficulty(-5), 0, 'и снизу');
  assert.equal(g.setDifficulty('wtf'), 0, 'мусор не пишет NaN в профиль');
  assert.equal(lib.AI_LEVELS.length, 4, 'кламп считается по реальному числу уровней');
  assert.equal(seen.join(','), '3,0,3,0,0', 'каждый вызов дошёл до бота');
});
