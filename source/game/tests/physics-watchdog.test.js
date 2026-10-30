const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '05_stroke_config.js', '30_physics.js', '55_ai.js', '46_physics_watchdog.js'],
  ['PhysicsWatchdog', 'WATCHDOG_RULES', 'WATCHDOG_CODES', 'WATCHDOG_CLASSES', 'PH',
    'STROKE_CONFIG', 'AI_LEVELS']);
const { PhysicsWatchdog, WATCHDOG_RULES, WATCHDOG_CODES, WATCHDOG_CLASSES, PH,
  STROKE_CONFIG, AI_LEVELS } = lib;

const tick = (w, ms) => ms / 1000;
/* Отложенный вердикт «сквозь клинок» ставится только после окна
 * throughGraceSec (игра применяет контакт на кадре, физика идёт на 600 Гц),
 * поэтому тест проматывает окно пустым подшагом с тем же hitSeq. */
function flushThrough(w, at, seq) {
  w.substep({ dt: 1 / 600, time: at, p0: { x: 0, y: 1.0, z: 1.0 }, p1: { x: 0, y: 1.0, z: 1.0 },
    ball: { v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, speed: 0 }, hitSeq: seq });
}


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
    'CORNER_STUCK', 'RACKET_UNDER_TABLE', 'BALL_THROUGH_RACKET', 'SERVE_NOT_FROM_RACKET',
    'SPEED_CEILING', 'SPIN_CEILING', 'bot blade'])
    assert.match(names, new RegExp(need));
  assert.deepEqual(Object.keys(WATCHDOG_CLASSES).sort(), ['corner', 'racket', 'serve', 'strong_shot']);
  assert.equal(WATCHDOG_CODES.length, 9);
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
  flushThrough(armed, 4.2, 2);
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
  /* вердикт отложен на throughGraceSec — проматываем окно тем же hitSeq */
  game.time = 10.1;
  game.ball.p = { x: 0, y: 1.0, z: 1.0 };
  game.watchdogSubstep({ x: 0, y: 1.0, z: 1.0 });
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

/* ------------------------------------------------------------------ *
 *  Клинок бота: пролёт сквозь него — главная жалоба                *
 * ------------------------------------------------------------------ */

const botPad = (z = -1.8, nz = 1) => ({
  pos: { x: 0, y: 1.0, z }, prevPos: { x: 0, y: 1.0, z }, normal: { x: 0, y: 0, z: nz },
});

test('ball through the BOT blade is ticketed, and the ticket names the side and level', () => {
  const w = new PhysicsWatchdog();
  w.armOpponent(true, { shotId: 12, stroke: 'DRIVE', aiLevel: 3 });
  w.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: -1.7 }, p1: { x: 0, y: 1.0, z: -1.9 },
    opp: { pad: botPad(), padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
    hitRadius: 0.152, ball: ballAt(0, 1, -1.8, { x: 0, y: 0, z: -6 }), hitSeq: 12 });
  flushThrough(w, 4.2, 12);
  assert.equal(w.counts.BALL_THROUGH_RACKET, 1);
  const row = w.tickets[0];
  assert.equal(row.side, -1);
  assert.equal(row.aiLevel, 3);
  assert.equal(row.detail.who, 'opponent');
  assert.equal(row.detail.armedStroke, 'DRIVE');
});

test('a pass beside the idle bot blade is not a bug (no arming, no contact)', () => {
  const w = new PhysicsWatchdog();
  w.armOpponent(false, null);
  w.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: -1.7 }, p1: { x: 0, y: 1.0, z: -1.9 },
    opp: { pad: botPad(), padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
    hitRadius: 0.152, ball: ballAt(0, 1, -1.8, { x: 0, y: 0, z: -6 }), hitSeq: 12 });
  assert.equal(w.tickets.length, 0);
});

test('a pass wide of the bot blade is not a through-racket ticket', () => {
  const w = new PhysicsWatchdog();
  w.armOpponent(true, { shotId: 13, aiLevel: 2 });
  w.substep({ dt: 1 / 600, time: 4, p0: { x: 0.45, y: 1.0, z: -1.7 }, p1: { x: 0.45, y: 1.0, z: -1.9 },
    opp: { pad: botPad(), padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
    hitRadius: 0.152, ball: ballAt(0.45, 1, -1.8, { x: 0, y: 0, z: -6 }), hitSeq: 13 });
  assert.equal(w.tickets.length, 0);
});

test('a slow ball that merely grazes the blade plane is not a pass-through', () => {
  /* Порог сближения 1 м/с: касание на 0.5 м/с — это не «пролёт сквозь». */
  const w = new PhysicsWatchdog();
  w.armOpponent(true, { shotId: 14, aiLevel: 4 });
  w.substep({ dt: 1 / 600, time: 4, p0: { x: 0, y: 1.0, z: -1.75 }, p1: { x: 0, y: 1.0, z: -1.85 },
    opp: { pad: botPad(-1.8), padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
    hitRadius: 0.152, ball: ballAt(0, 1, -1.8, { x: 0, y: 0, z: -0.5 }), hitSeq: 14 });
  assert.equal(w.tickets.length, 0);
});

test('both blades are checked in the same substep', () => {
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 21 });
  w.substep({ dt: 1 / 600, time: 5, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 0 });
  flushThrough(w, 5.2, 0);
  assert.equal(w.counts.BALL_THROUGH_RACKET, 1);
  const w2 = new PhysicsWatchdog();
  w2.armOpponent(true, { shotId: 22, aiLevel: 1 });
  w2.substep({ dt: 1 / 600, time: 5, p0: { x: 0, y: 1.0, z: -1.7 }, p1: { x: 0, y: 1.0, z: -1.9 },
    opp: { pad: botPad(), padPrev: { x: 0, y: 1.0, z: -1.8 }, hitRadius: 0.152 },
    hitRadius: 0.152, ball: ballAt(0, 1, -1.8, { x: 0, y: 0, z: -6 }), hitSeq: 0 });
  flushThrough(w2, 5.2, 0);
  assert.equal(w2.counts.BALL_THROUGH_RACKET, 1);
});

/* ------------------------------------------------------------------ *
 *  Ракетка под столом в кадре (без удара)                          *
 * ------------------------------------------------------------------ */

test('a blade under the table is ticketed per frame, for the player and for the bot', () => {
  const w = new PhysicsWatchdog();
  for (let i = 0; i < 30; i++)
    w.frame({ time: i / 60, dt: 1 / 60, player: { pos: { x: 0, y: PH.TABLE_Y - 0.05, z: 0.4 } },
      opponent: { pos: { x: 0, y: PH.TABLE_Y + 0.4, z: -1.9 } } });
  assert.equal(w.counts.RACKET_UNDER_TABLE, 1);
  assert.equal(w.tickets[0].detail.who, 'player');

  const w2 = new PhysicsWatchdog();
  for (let i = 0; i < 30; i++)
    w2.frame({ time: i / 60, dt: 1 / 60, aiLevel: 2, player: { pos: { x: 0, y: PH.TABLE_Y + 0.4, z: 1.4 } },
      opponent: { pos: { x: 0.3, y: PH.TABLE_Y - 0.10, z: -0.9 } } });
  assert.equal(w2.counts.RACKET_UNDER_TABLE, 1);
  assert.equal(w2.tickets[0].detail.who, 'opponent');
  assert.equal(w2.tickets[0].aiLevel, 2);
});

test('one frame under the table is not enough: the pose must hold', () => {
  const w = new PhysicsWatchdog();
  w.frame({ time: 1, dt: 1 / 60, player: { pos: { x: 0, y: PH.TABLE_Y - 0.05, z: 0.4 } } });
  assert.equal(w.tickets.length, 0);
});

test('legal poses are silent: behind the end line, and the bot scooping a low ball', () => {
  const w = new PhysicsWatchdog();
  for (let i = 0; i < 40; i++)
    w.frame({ time: i / 60, dt: 1 / 60,
      player: { pos: { x: 0.2, y: PH.TABLE_Y - 0.30, z: 1.9 } },
      opponent: { pos: { x: 0.2, y: PH.TABLE_Y + 0.04, z: -0.95 } } });
  assert.equal(w.tickets.length, 0);
});

test('the contact check uses the resolved paddle pose the game passes in', () => {
  const w = new PhysicsWatchdog();
  /* Анимированный клинок был низко, но удар решён другой позой (выше) —
   * тикета нет: сторож смотрит на ту ракетку, которая коснулась мяча. */
  w.contact({ time: 1, side: 1, serve: false, contact: { x: 0, y: 0.9, z: 0.6 },
    pad: { pos: { x: 0, y: PH.TABLE_Y + 0.30, z: 0.6 } } });
  assert.equal(w.counts.RACKET_UNDER_TABLE, 0);
});

test('a bot blade that is a legal 4 cm above the table is not ticketed at contact', () => {
  const w = new PhysicsWatchdog();
  w.contact({ time: 1, side: -1, aiLevel: 1, serve: false, contact: { x: 0, y: 0.82, z: -1.0 },
    pad: { pos: { x: 0, y: PH.TABLE_Y + 0.04, z: -1.0 } } });
  assert.equal(w.counts.RACKET_UNDER_TABLE, 0);
  const w2 = new PhysicsWatchdog();
  w2.contact({ time: 1, side: -1, aiLevel: 1, serve: false, contact: { x: 0, y: 0.6, z: -1.0 },
    pad: { pos: { x: 0, y: PH.TABLE_Y - 0.12, z: -1.0 } } });
  assert.equal(w2.counts.RACKET_UNDER_TABLE, 1);
});

/* ------------------------------------------------------------------ *
 *  Потолки темпа и вращения                                        *
 * ------------------------------------------------------------------ */

test('SPEED_CEILING: the bot may not swing harder than its own level allows', () => {
  const w = new PhysicsWatchdog();
  const limit = w.speedLimit({ side: -1, strokeId: 'DRIVE', aiLevel: 0 });
  const L = AI_LEVELS[0];
  assert.ok(limit <= L.vmagMax * 1.36, 'ceiling must come from AI_LEVELS.vmagMax');
  w.stroke({ time: 2, side: -1, aiLevel: 0, strokeId: 'DRIVE', vmag: limit + 0.5,
    ball: { v: { x: 0, y: 0, z: 10 }, w: { x: 0, y: 0, z: 0 } } });
  assert.equal(w.counts.SPEED_CEILING, 1);
  assert.equal(w.tickets[0].side, -1);
  assert.equal(w.tickets[0].aiLevel, 0);
  assert.ok(w.tickets[0].detail.limit < w.tickets[0].detail.vmag);
});

test('SPEED_CEILING: a legal stroke, a legal serve and the SIDE cap stay silent', () => {
  for (const [strokeId, k] of [['DRIVE', 0.9], ['SMASH', 0.95], ['SIDE', 0.9], ['SERVE_FAST', 0.95]]) {
    const w = new PhysicsWatchdog();
    const limit = w.speedLimit({ side: 1, strokeId });
    w.stroke({ time: 2, side: 1, strokeId, vmag: limit * k,
      ball: { v: { x: 0, y: 0, z: 8 }, w: { x: 0, y: 0, z: 0 } } });
    assert.equal(w.counts.SPEED_CEILING, 0, `${strokeId} at ${(limit * k).toFixed(2)} m/s`);
  }
});

test('SPEED_CEILING: the SIDE archetype keeps its own, lower, cap', () => {
  const w = new PhysicsWatchdog();
  const side = w.speedLimit({ side: 1, strokeId: 'SIDE' });
  const drive = w.speedLimit({ side: 1, strokeId: 'DRIVE' });
  assert.ok(side < drive, `SIDE ${side.toFixed(2)} must be below DRIVE ${drive.toFixed(2)}`);
  assert.ok(side <= STROKE_CONFIG.spin.sideVmax * 1.11);
});

test('SPIN_CEILING: spin above the model cap is a ticket, the cap itself is not', () => {
  const w = new PhysicsWatchdog();
  const cap = w.spinLimit();
  w.stroke({ time: 3, side: 1, strokeId: 'LOOP', vmag: 6,
    ball: { v: { x: 0, y: 0, z: 8 }, w: { x: cap * 0.95, y: 0, z: 0 } } });
  assert.equal(w.counts.SPIN_CEILING, 0);
  w.stroke({ time: 3.6, side: 1, strokeId: 'LOOP', vmag: 6,
    ball: { v: { x: 0, y: 0, z: 8 }, w: { x: cap * 1.2, y: 0, z: 0 } } });
  assert.equal(w.counts.SPIN_CEILING, 1);
  assert.ok(w.tickets[0].detail.spin > w.tickets[0].detail.limit);
});

test('the aiShots ring records the bot stroke: pose, contact, ball before/after, vmag', () => {
  const w = new PhysicsWatchdog();
  for (let i = 0; i < 120; i++)
    w.stroke({ time: i / 10, side: -1, aiLevel: 2, tactic: 'ATTACK', strokeId: 'DRIVE', vmag: 6,
      contact: { x: 0.1, y: 0.9, z: -1.5 },
      racket: { pos: { x: 0.1, y: 0.9, z: -1.5 }, normal: { x: 0, y: 0, z: 1 } },
      ball: { v: { x: 0, y: 0.2, z: 7 }, w: { x: -60, y: 0, z: 0 } },
      ballBefore: { v: { x: 0, y: 0.1, z: -6 }, w: { x: 0, y: 0, z: 0 } } });
  assert.equal(w.aiShots.length, w.rules.maxAiShots);
  const last = w.aiShots[w.aiShots.length - 1];
  assert.equal(last.level, 2);
  assert.equal(last.tactic, 'ATTACK');
  assert.equal(last.vmag, 6);
  assert.equal(last.contact.join(','), '0.1,0.9,-1.5');
  assert.equal(last.before.speed, 6);
  assert.equal(last.after.speed, 7);
  assert.equal(w.report().aiShots.total, w.rules.maxAiShots);
});

/* ------------------------------------------------------------------ *
 *  Экран: мяч ушёл за кадр                                          *
 * ------------------------------------------------------------------ */

const offProject = () => ({ ok: true, x: 0.5, y: -0.9, d: 4 });

test('BALL_OFF_ARENA gets the screen variant when the ball is gone from the frame', () => {
  const w = new PhysicsWatchdog();
  const ball = { live: true, p: { x: 0, y: 4.2, z: -3.3 }, v: { x: 0, y: 4, z: -7 } };
  for (let i = 0; i < 30; i++)
    w.frame({ time: i / 60, dt: 1 / 60, ball, project: offProject, viewport: { w: 1280, h: 760 } });
  assert.equal(w.counts.BALL_OFF_ARENA, 1);
  assert.equal(w.tickets[0].detail.variant, 'screen');
  assert.ok(w.tickets[0].detail.outPx > 24);
});

test('a legal lob that the fixed camera crops is not a bug', () => {
  const w = new PhysicsWatchdog();
  const ball = { live: true, p: { x: 0.1, y: 2.3, z: -0.4 }, v: { x: 0, y: 0.8, z: 0 } };
  for (let i = 0; i < 60; i++)
    w.frame({ time: i / 60, dt: 1 / 60, ball, project: offProject, viewport: { w: 1280, h: 760 } });
  assert.equal(w.counts.BALL_OFF_ARENA, 0);
});

test('a ball in frame is never a screen ticket, even outside the play volume', () => {
  const w = new PhysicsWatchdog();
  const ball = { live: true, p: { x: 4.5, y: 2, z: -5 }, v: { x: 1, y: 0, z: -2 } };
  for (let i = 0; i < 60; i++)
    w.frame({ time: i / 60, dt: 1 / 60, ball, project: () => ({ ok: true, x: 0.5, y: 0.5, d: 4 }),
      viewport: { w: 1280, h: 760 } });
  assert.equal(w.counts.BALL_OFF_ARENA, 0);
});

test('a dead ball is not measured for screen visibility', () => {
  const w = new PhysicsWatchdog();
  const ball = { live: false, p: { x: 0, y: 3.4, z: -2.6 }, v: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i < 60; i++)
    w.frame({ time: i / 60, dt: 1 / 60, ball, project: offProject, viewport: { w: 1280, h: 760 } });
  assert.equal(w.counts.BALL_OFF_ARENA, 0);
});

test('every ticket carries side and aiLevel', () => {
  const w = new PhysicsWatchdog();
  w.context(-1, 4);
  w.ticket('BALL_INTO_TABLE', { time: 1, depth: 0.05 });
  assert.equal(w.tickets[0].side, -1);
  assert.equal(w.tickets[0].aiLevel, 4);
  w.context(1, null);
  w.ticket('SPIN_CEILING', { time: 2, spin: 2000, limit: 1100 });
  assert.equal(w.tickets[1].side, 1);
});

test('substep stays cheap at 600 Hz (budget 0.05 ms per frame of 10 substeps)', () => {
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 1 });
  w.armOpponent(true, { shotId: 1, aiLevel: 3 });
  const pad = { pos: { x: 0, y: 1.1, z: 1.8 }, prevPos: { x: 0, y: 1.1, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } };
  const opp = { pad: { pos: { x: 0, y: 1.1, z: -1.8 }, normal: { x: 0, y: 0, z: 1 } },
    padPrev: { x: 0, y: 1.1, z: -1.8 }, hitRadius: 0.152 };
  const ball = { p: { x: 0, y: 1.1, z: 1.2 }, v: { x: 0, y: -1, z: 5 }, w: { x: -40, y: 0, z: 0 }, speed: 5 };
  const frames = 3000;
  /* Микро-бенчмарк шумит от загрузки машины: берём лучший из трёх прогонов,
   * как это делают остальные бенчмарки репозитория. */
  let ms = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    const t0 = process.hrtime.bigint();
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < 10; k++) {
        const p0 = { x: 0, y: 1.1, z: 1.2 + k * 0.001 };
        ball.p.z = p0.z + 0.001;
        w.substep({ dt: 1 / 600, time: f / 60 + k / 600, p0, p1: ball.p, ball, pad, padPrev: pad.prevPos,
          hitRadius: 0.152, opp, hitSeq: 0 });
      }
      w.frame({ time: f / 60, dt: 1 / 60, ball, player: pad, opponent: opp.pad,
        project: offProject, viewport: { w: 1280, h: 760 } });
    }
    ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6 / frames);
  }
  assert.ok(ms < 0.05, `watchdog costs ${ms.toFixed(4)} ms per frame`);
});

test('a contact that lands inside the grace window cancels the pass-through verdict', () => {
  /* Игра применяет удар на кадре: мяч на 1-10 подшагов раньше законно
   * проходит плоскость клинка. Контакт в этом окне — не баг. */
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 31 });
  w.substep({ dt: 1 / 600, time: 6, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 5 });
  w.substep({ dt: 1 / 600, time: 6.01, p0: { x: 0, y: 1.0, z: 1.9 }, p1: { x: 0, y: 1.0, z: 1.85 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.85, { x: 0, y: 0, z: -6 }), hitSeq: 6 });
  flushThrough(w, 6.2, 6);
  assert.equal(w.tickets.length, 0, JSON.stringify(w.tickets));
});

test('a ticket for a pass-through is still issued when the contact never comes', () => {
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 32 });
  w.substep({ dt: 1 / 600, time: 7, p0: { x: 0, y: 1.0, z: 1.7 }, p1: { x: 0, y: 1.0, z: 1.9 },
    padPrev: { x: 0, y: 1.0, z: 1.8 }, pad: { pos: { x: 0, y: 1.0, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } },
    hitRadius: 0.152, ball: ballAt(0, 1, 1.8, { x: 0, y: 0, z: 6 }), hitSeq: 5 });
  assert.equal(w.tickets.length, 0, 'нет тикета в том же подшаге — вердикт отложен');
  flushThrough(w, 7.2, 5);
  assert.equal(w.counts.BALL_THROUGH_RACKET, 1);
  assert.ok(w.tickets[0].detail.resolvedAt > w.tickets[0].detail.time);
});

test('game hooks: frame and stroke feed the watchdog without touching the ball', () => {
  const g = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js',
    '42_shot_diagnostics.js', '43_input_telemetry.js', '44_diagnostics.js', '46_physics_watchdog.js', '70_game.js'],
    ['Game', 'V3']).Game;
  const game = Object.create(g.prototype);
  const V = load(['10_math.js'], ['V3']).V3;
  Object.assign(game, {
    time: 5, shotId: 3, state: 'RALLY', vw: 1280, vh: 760, frame: 1,
    watchdog: new PhysicsWatchdog(),
    _watchOppPad: { pos: V.new(0, 1.0, -1.8), normal: V.new(0, 0, 1) },
    _watchOppPrev: V.new(0, 1.0, -1.8),
    ball: { p: V.new(0, 1.0, 0.4), v: V.new(0, 1.0, -5), w: V.new(), live: true, lastHitBy: -1, speed: 5 },
    player: { pos: V.new(0, 1.0, 1.7), normal: V.new(0, 0, -1) },
    aiPaddle: { pos: V.new(0, 1.0, -1.8), normal: V.new(0, 0, 1) },
    ai: { levelIndex: 2, tactic: 'ATTACK' },
    R: { viewProj: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
  });
  /* кадр: позы обеих ракеток + видимость мяча */
  game.watchdogFrame(1 / 60);
  assert.equal(game.watchdog.probe.poses, 2);
  /* удар: потолки пишутся в журнал бота с уровнем и тактикой */
  game.watchdogStroke(-1, { vmag: 6, vR: V.new(0, 0, -6), quality: 0.8,
    stroke: { id: 'DRIVE' }, normal: V.new(0, 0, 1) }, { x: 0, y: 1, z: -1.6 }, 0.8, 6, 100);
  assert.equal(game.watchdog.aiShots.length, 1);
  const shot = game.watchdog.aiShots[0];
  assert.equal(shot.level, 2);
  assert.equal(shot.tactic, 'ATTACK');
  assert.equal(shot.strokeId, 'DRIVE');
  assert.equal(shot.vmag, 6);
  assert.ok(Math.abs(shot.after.speed - Math.hypot(0, 1, 5)) < 0.01);
  assert.equal(game.watchdog.counts.SPEED_CEILING, 0);
  game.watchdogStroke(-1, { vmag: 60, vR: V.new(0, 0, -60), quality: 1,
    stroke: { id: 'DRIVE' }, normal: V.new(0, 0, 1) }, { x: 0, y: 1, z: -1.6 }, 1, 60, 100);
  assert.equal(game.watchdog.counts.SPEED_CEILING, 1);
  assert.equal(game.watchdog.tickets[0].aiLevel, 2);
});
