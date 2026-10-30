const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '46_physics_watchdog.js'],
  ['PhysicsWatchdog', 'WATCHDOG_RULES', 'WATCHDOG_CODES', 'WATCHDOG_CLASSES', 'PH']);
const { PhysicsWatchdog, WATCHDOG_RULES, WATCHDOG_CODES, WATCHDOG_CLASSES, PH } = lib;

const tick = (w, ms) => ms / 1000;

function ballAt(x, y, z, v) {
  return { p: { x, y, z }, v: v || { x: 0, y: -1, z: 4 }, w: { x: 0, y: 0, z: 0 },
    speed: v ? Math.hypot(v.x, v.y, v.z) : 4 };
}

test('watchdog self-test gates are green and cover every code', () => {
  const gates = new PhysicsWatchdog().selfTest();
  assert.equal(gates.status, 'green', JSON.stringify(gates.checks.filter(c => !c.pass)));
  assert.equal(gates.failed, 0);
  assert.ok(gates.checks.length >= 10);
  const names = gates.checks.map(c => c.name).join(' ');
  for (const need of ['clean run', 'BALL_INTO_TABLE', 'BALL_OFF_ARENA', 'CORNER_REPEAT_CONTACT',
    'CORNER_STUCK', 'RACKET_UNDER_TABLE', 'BALL_THROUGH_RACKET', 'SERVE_NOT_FROM_RACKET'])
    assert.match(names, new RegExp(need));
  assert.deepEqual(Object.keys(WATCHDOG_CLASSES).sort(), ['corner', 'racket', 'serve', 'strong_shot']);
  assert.equal(WATCHDOG_CODES.length, 7);
});

test('clean legal flight, honest table bounce and contact produce zero tickets', () => {
  const w = new PhysicsWatchdog();
  for (let i = 0; i < 600; i++) {
    const t = i / 600, y = 1.5 - 0.35 * t, z = -1.2 + 1.6 * t;
    w.substep({ dt: 1 / 600, time: t, p0: { x: 0.1, y: y + 0.001, z: z - 0.002 },
      p1: { x: 0.1, y, z }, ball: ballAt(0.1, y, z, { x: 0, y: -0.35, z: 1.6 }), hitSeq: 0 });
  }
  w.tableContact({ time: 0.5, edge: 0, edgeAxis: 'z', side: -1, speed: 3.2 });
  w.contact({ time: 0.8, side: 1, serve: false, contact: { x: 0.1, y: 0.95, z: 1.7 },
    pad: { pos: { x: 0.1, y: 0.95, z: 1.7 } } });
  assert.equal(w.tickets.length, 0);
  assert.equal(w.report().gates.status, 'green');
});

test('ball inside the table slab is one ticket per shot with a measured depth', () => {
  const w = new PhysicsWatchdog();
  const y = PH.TABLE_Y + PH.R - 0.02;
  for (let i = 0; i < 4; i++) {
    w.substep({ dt: 1 / 600, time: i / 600, p0: { x: 0.2, y: PH.TABLE_Y + PH.R + 0.02, z: 0.5 },
      p1: { x: 0.2, y, z: 0.5 }, ball: ballAt(0.2, y, 0.5, { x: 0, y: -8, z: 0 }), hitSeq: 0 });
  }
  const row = w.tickets.find(t => t.code === 'BALL_INTO_TABLE');
  assert.ok(row, 'ticket expected');
  assert.equal(w.counts.BALL_INTO_TABLE, 1, 'only one ticket per shot');
  assert.ok(row.detail.depth >= 0.015 && row.detail.depth <= 0.03);
  assert.equal(row.detail.strong, true);
  assert.equal(row.class, 'strong_shot');
});

test('one substep of shallow contact is not a penetration ticket', () => {
  const w = new PhysicsWatchdog();
  const y = PH.TABLE_Y + PH.R - 0.002;   // within the tolerance
  w.substep({ dt: 1 / 600, time: 0, p0: { x: 0.2, y: y + 0.01, z: 0.5 }, p1: { x: 0.2, y, z: 0.5 },
    ball: ballAt(0.2, y, 0.5, { x: 0, y: -2, z: 0 }), hitSeq: 0 });
  assert.equal(w.counts.BALL_INTO_TABLE, 0);
});

test('ball leaving the arena is a ticket even when the engine would just kill the ball', () => {
  const w = new PhysicsWatchdog();
  w.substep({ dt: 1 / 600, time: 2, p0: { x: 5.0, y: 1.2, z: 3.0 }, p1: { x: 6.4, y: 1.2, z: 3.0 },
    ball: ballAt(6.4, 1.2, 3.0, { x: 22, y: 0, z: 0 }), hitSeq: 0 });
  assert.equal(w.counts.BALL_OFF_ARENA, 1);
  assert.equal(w.tickets[0].detail.speed, 22);
});

test('repeated edge contacts within the window are a corner ticket', () => {
  const w = new PhysicsWatchdog();
  w.tableContact({ time: 1.0, edge: 0.7, edgeAxis: 'x', side: -1, speed: 4 });
  assert.equal(w.counts.CORNER_REPEAT_CONTACT, 0, 'one edge contact is legal');
  w.tableContact({ time: 1.12, edge: 0.9, edgeAxis: 'x', side: -1, speed: 3 });
  assert.equal(w.counts.CORNER_REPEAT_CONTACT, 1);
  assert.equal(w.tickets[0].detail.axis, 'x');
});

test('a ball crawling along the edge line is a corner ticket, a ball in the middle is not', () => {
  const w = new PhysicsWatchdog();
  const x = PH.T_HALF_WID - 0.01, y = PH.TABLE_Y + PH.R;
  for (let i = 0; i < 480; i++) {
    w.substep({ dt: 1 / 600, time: i / 600, p0: { x, y, z: 0.4 }, p1: { x, y, z: 0.4 },
      ball: ballAt(x, y, 0.4, { x: 0, y: 0, z: 0.2 }), hitSeq: 0 });
  }
  assert.equal(w.counts.CORNER_STUCK, 1);
  const clean = new PhysicsWatchdog();
  for (let i = 0; i < 480; i++) {
    clean.substep({ dt: 1 / 600, time: i / 600, p0: { x: 0, y, z: 0.4 }, p1: { x: 0, y, z: 0.4 },
      ball: ballAt(0, y, 0.4, { x: 0, y: 0, z: 0.2 }), hitSeq: 0 });
  }
  assert.equal(clean.counts.CORNER_STUCK, 0);
});

test('racket under the table is a ticket over the table and legal behind the end line', () => {
  const over = new PhysicsWatchdog();
  over.contact({ time: 3, side: 1, serve: false, contact: { x: 0, y: 0.9, z: 0.5 },
    pad: { pos: { x: 0, y: PH.TABLE_Y - 0.05, z: 0.5 } } });
  assert.equal(over.counts.RACKET_UNDER_TABLE, 1);
  assert.ok(over.tickets[0].detail.below > 0.1);

  const behind = new PhysicsWatchdog();
  behind.contact({ time: 3, side: 1, serve: false, contact: { x: 0, y: 0.5, z: 1.95 },
    pad: { pos: { x: 0, y: PH.TABLE_Y - 0.35, z: 1.95 } } });
  assert.equal(behind.counts.RACKET_UNDER_TABLE, 0, 'a low blade behind the line is allowed');
});

test('ball crossing an armed blade without contact is a ticket; an idle blade is not', () => {
  const armed = new PhysicsWatchdog();
  armed.arm(true, { shotId: 12 });
  armed.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 2 });
  assert.equal(armed.counts.BALL_THROUGH_RACKET, 1);
  assert.equal(armed.tickets[0].detail.armedShotId, 12);

  const idle = new PhysicsWatchdog();
  idle.arm(false, null);
  idle.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 2 });
  assert.equal(idle.counts.BALL_THROUGH_RACKET, 0);

  const hit = new PhysicsWatchdog();
  hit.arm(true, { shotId: 12 });
  hit.substep({ dt: 1 / 600, time: 3.999, p0: { x: 0, y: 1.0, z: 1.52 }, p1: { x: 0, y: 1.0, z: 1.53 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.53, { x: 0, y: 0, z: 6 }), hitSeq: 2 });
  hit.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 3 });
  assert.equal(hit.counts.BALL_THROUGH_RACKET, 0, 'the same substep registered a contact');
});

test('a fast ball passing beside the blade is not a through-racket ticket', () => {
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 1 });
  w.substep({ dt: 1 / 600, time: 5, p0: { x: 0.4, y: 1.0, z: 1.7 }, p1: { x: 0.4, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0.4, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 0 });
  assert.equal(w.counts.BALL_THROUGH_RACKET, 0);
});

test('serve far from the blade and serve that does not leave the blade are both ticketed', () => {
  const reach = new PhysicsWatchdog();
  reach.contact({ time: 6, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
    pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0.46, y: 1.1, z: 1.9 } });
  assert.equal(reach.counts.SERVE_NOT_FROM_RACKET, 1);
  assert.equal(reach.tickets[0].detail.variant, 'reach');
  assert.ok(Math.abs(reach.tickets[0].detail.distance - 0.46) < 1e-6);

  const offset = new PhysicsWatchdog();
  offset.contact({ time: 7, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
    pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0, y: 1.1, z: 1.9 } });
  offset.substep({ dt: 1 / 600, time: 7.001, p0: { x: 0, y: 1.3, z: 1.1 }, p1: { x: 0, y: 1.3, z: 1.1 },
    ball: ballAt(0, 1.3, 1.1, { x: 0, y: 0, z: 4 }), hitSeq: 9 });
  assert.equal(offset.counts.SERVE_NOT_FROM_RACKET, 1);
  assert.equal(offset.tickets[0].detail.variant, 'offset');

  const honest = new PhysicsWatchdog();
  honest.contact({ time: 8, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
    pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0.02, y: 1.1, z: 1.9 } });
  honest.substep({ dt: 1 / 600, time: 8.001, p0: { x: 0, y: 1.1, z: 1.88 }, p1: { x: 0, y: 1.1, z: 1.88 },
    ball: ballAt(0, 1.1, 1.88, { x: 0, y: 0, z: 4 }), hitSeq: 9 });
  assert.equal(honest.tickets.length, 0);
});

test('tickets are deduplicated by cooldown and bounded by the ring', () => {
  const w = new PhysicsWatchdog();
  assert.ok(w.ticket('BALL_OFF_ARENA', { time: 1 }));
  assert.equal(w.ticket('BALL_OFF_ARENA', { time: 1.2 }), null, 'cooldown per code');
  assert.ok(w.ticket('BALL_OFF_ARENA', { time: 1 + WATCHDOG_RULES.ticketCooldownSec + 0.01 }));
  assert.equal(w.counts.BALL_OFF_ARENA, 2);
  for (let i = 0; i < 100; i++) w.ticket('CORNER_STUCK', { time: 100 + i });
  assert.equal(w.tickets.length, WATCHDOG_RULES.maxTickets);
  assert.equal(w.counts.CORNER_STUCK, 100, 'counters keep counting after the ring is full');
});

test('report exposes counts, classes, tickets and green gates', () => {
  const w = new PhysicsWatchdog();
  w.ticket('RACKET_UNDER_TABLE', { time: 1, at: 'contact' });
  const r = w.report();
  assert.equal(r.version, 1);
  assert.equal(r.total, 1);
  assert.equal(r.classes.racket, 1);
  assert.equal(r.classes.serve, 0);
  assert.equal(r.gates.status, 'green');
  assert.ok(r.rules && typeof r.rules.penetrationTol === 'number');
});

test('clean run on the real integrator produces zero tickets', () => {
  const phys = load(['10_math.js', '30_physics.js', '46_physics_watchdog.js'],
    ['PhysicsWatchdog', 'PH', 'integrateBall', 'tableContact', 'bounceTable', 'V3']);
  const { integrateBall, tableContact, bounceTable, V3 } = phys;
  const w = new PhysicsWatchdog();
  const p = V3.new(0.2, 1.05, -1.05), v = V3.new(0, 0.4, 5.6), spin = V3.new(-55, 0, 0);
  const pad = { pos: { x: 0, y: phys.PH.TABLE_Y + 0.28, z: 1.78 }, prevPos: { x: 0, y: phys.PH.TABLE_Y + 0.28, z: 1.78 },
    normal: { x: 0, y: 0, z: -1 } };
  const hit = { x: 0, y: 0, z: 0 };
  let time = 0;
  for (let i = 0; i < 900; i++) {
    time = i / 600;
    const p0 = { x: p.x, y: p.y, z: p.z };
    integrateBall(p, v, spin, 1 / 600);
    if (v.y < 0 && tableContact(p0.x, p0.y, p0.z, p.x, p.y, p.z, hit)) {
      p.x = hit.x; p.y = hit.y + 1e-5; p.z = hit.z;
      const info = bounceTable(p, v, spin);
      w.tableContact({ time, side: Math.sign(p.z) || 1, edge: info && info.edge, edgeAxis: info && info.edgeAxis,
        speed: Math.abs(v.y) });
    }
    w.substep({ dt: 1 / 600, time, p0, p1: p, ball: { p, v, speed: Math.hypot(v.x, v.y, v.z) },
      pad, padPrev: pad.prevPos, hitRadius: 0.152, hitSeq: 0 });
    if (!Number.isFinite(p.y) || p.y < -0.2) break;
  }
  assert.equal(w.tickets.length, 0, JSON.stringify(w.tickets));
  assert.ok(time > 0.5, 'the flight actually ran');
});

test('game hooks: arm reads the gate and a pass-through is ticketed without touching the ball', () => {
  const g = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js',
    '42_shot_diagnostics.js', '43_input_telemetry.js', '44_diagnostics.js', '46_physics_watchdog.js', '70_game.js'],
    ['Game', 'GS', 'V3', 'PhysicsWatchdog']).Game;
  const game = Object.create(g.prototype);
  const V = load(['10_math.js'], ['V3']).V3;
  Object.assign(game, {
    time: 10, shotId: 4, state: 'RALLY', debugRecording: false, _hitSeq: 0, frame: 1,
    _subPad: null,
    rallyBounces: [1],
    ball: { p: V.new(0, 1.0, 1.9), v: V.new(0, 0, 6), w: V.new(), live: true, lastHitBy: -1, speed: 6 },
    player: { pos: V.new(0, 1.0, 1.8), prevPos: V.new(0, 1.0, 1.8), prev: V.new(0, 1.0, 1.8),
      normal: V.new(0, 0, -1), hitRadius: 0.152, lastHitT: -9 },
    swipe: { gestureId: 1, active: false, pressZone: { accepted: true, shotId: 4, directionOk: true },
      lastReleased: { samples: 4, dist: .3, pathLen: .35, peakSpeed: 3, tap: false } },
    watchdog: new lib.PhysicsWatchdog(),
  });
  game.watchdogArmFrame();
  assert.equal(game.watchdog._armed, true);
  const p0 = { x: 0, y: 1.0, z: 1.7 };
  game.ball.p = { x: 0, y: 1.0, z: 1.9 };
  game.watchdogSubstep(p0);
  assert.equal(game.watchdog.counts.BALL_THROUGH_RACKET, 1);

  /* гейт не пускает (нажатия нет) — пролёт сквозь ракетку не считается багом */
  game.swipe.pressZone = null;
  game.watchdogArmFrame();
  assert.equal(game.watchdog._armed, false);
});

test('an off-centre but legal serve contact (inside the capture sphere) is not a false anomaly', () => {
  const w = new PhysicsWatchdog();
  w.contact({ time: 9, side: 1, serve: true, contact: { x: 0, y: 1.1, z: 1.9 },
    pad: { pos: { x: 0, y: 1.1, z: 1.9 } }, padBefore: { x: 0.30, y: 1.1, z: 1.9 } });
  /* игра ставит мяч в точку контакта + R*launchSeparation; сторож это принимает */
  w.substep({ dt: 1 / 600, time: 9.001, p0: { x: 0, y: 1.1, z: 1.88 }, p1: { x: 0, y: 1.1, z: 1.88 },
    ball: ballAt(0, 1.1, 1.88, { x: 0, y: 0, z: -4 }), hitSeq: 9 });
  assert.equal(w.tickets.length, 0, JSON.stringify(w.tickets));
});
