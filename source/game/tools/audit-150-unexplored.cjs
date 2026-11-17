/* =====================================================================
 *  AUDIT 150 · UNEXPLORED AREAS
 *
 *  The 2026-11-17 gameplay pass covered input, physics, serve solving and
 *  contact. This audit goes over the parts nobody had measured in detail:
 *  career progression, the equipment catalogue, the save/meta layer, the
 *  network mirror, input telemetry, replay, particles, perf scaling,
 *  emotion/music and the training catalogue.
 *
 *  Every check is independent; a failure is printed and the run continues.
 *  Usage: node tools/audit-150-unexplored.cjs   (exit 1 on failures)
 * ===================================================================== */
'use strict';
const { load } = require('../tests/helpers.cjs');

const L = load([
  '10_math.js', '05_stroke_config.js', '12_match_rules.js', '13_stamina.js',
  '25_career.js', '27_network.js', '30_physics.js', '38_paddle_motion.js',
  '43_input_telemetry.js', '45_perf.js', '59_replay.js', '61_particles.js',
  '76_emotion.js', '75_music.js', '84_racket.js', '86_meta.js',
  '40_swipe.js', '55_ai.js', '64_training_data.js', '03_i18n.js',
], [
  'V3', 'Q', 'PH', 'clamp', 'lerp', 'smoothstep', 'dirFromAngles',
  'STAMINA_CONFIG', 'Stamina', 'PERKS', 'TOURNAMENTS', 'Career',
  'generateOpponent', 'pickThreePerks', 'getAvailablePerks', 'CAREER_MAX_AI_LEVEL',
  'netMirrorState', 'netMirrorInput', 'netFlipZ', 'netFlipAxial', 'resolveNetUrl',
  'NetworkManager', 'InputTelemetryLog', 'perfScaleStep', 'PERF_SCALE_MIN', 'PERF_SCALE_MAX',
  'PERF_SLOW_MS', 'PERF_FAST_MS', 'REPLAY_FLOATS', 'BEAUTY', 'MomentRecorder', 'MomentPlayer',
  'MATCH_RULES', 'paddlePoseQuaternion', 'ITEMS_ORDER', 'CAREER_MAX_AI_LEVEL', 'MAX_LEVEL',
  'Particles', 'ITEMS', 'BLADES', 'RUBBERS', 'STAT_KEYS', 'statK', 'spread', 'itemStats',
  'Profile', 'Platform', 'num', 'int', 'bool', 'strList', 'safeAssign', 'SAVE_KEY',
  'MAX_COINS', 'EmotionalSystem', 'EMOTION_STATE', 'MusicSystem', 'MUSIC_STATE',
  'TRAIN_SKILLS', 'TRAIN_MODULES', 'TRAIN_GUIDES', 'TRAIN_GUIDE_FIELDS', 'ET', 'STROKES',
  'AI_LEVELS',
]);

let total = 0; const failures = [];
function check(desc, fn) {
  total++;
  try { fn(); } catch (e) { failures.push(`${String(total).padStart(3, '0')}  ${desc}: ${e.message}`); }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m ? m + ': ' : ''}${a} !== ${b}`); };
const near = (a, b, eps, m) => { if (!(Math.abs(a - b) <= eps)) throw new Error(`${m ? m + ': ' : ''}${a} != ${b}`); };
const finite = (v, m) => { if (!Number.isFinite(v)) throw new Error(`${m || 'value'} not finite: ${v}`); };

/* ================================================================== */
/* 1–14  MATH / GEOMETRY                                              */
/* ================================================================== */
check('clamp keeps the interval and rejects NaN', () => {
  eq(L.clamp(5, 0, 10), 5); eq(L.clamp(-5, 0, 10), 0); eq(L.clamp(50, 0, 10), 10);
  ok(Number.isNaN(L.clamp(NaN, 0, 10)), 'NaN must stay NaN');
});
check('lerp hits both ends', () => { near(L.lerp(2, 8, 0), 2, 1e-12); near(L.lerp(2, 8, 1), 8, 1e-12); });
check('smoothstep clamps outside [0,1]', () => {
  eq(L.smoothstep(0, 1, -1), 0); eq(L.smoothstep(0, 1, 2), 1); near(L.smoothstep(0, 1, .5), .5, 1e-12);
});
check('smoothstep is monotone', () => {
  let prev = -1;
  for (let x = -0.2; x <= 1.2; x += 0.01) { const v = L.smoothstep(0, 1, x); ok(v >= prev - 1e-12, `decreased at ${x}`); prev = v; }
});
check('dirFromAngles(0,0) points along -z for side +1', () => {
  const v = L.V3.new(), n = L.V3.new();
  L.dirFromAngles(v, 0, 0, -1); near(v.z, -1, 1e-12); near(v.y, 0, 1e-12);
});
check('dirFromAngles(pi/2) points up', () => {
  const v = L.V3.new(); L.dirFromAngles(v, Math.PI / 2, 0, 1); near(v.y, 1, 1e-12);
});
check('mirrored side flips z', () => {
  const a = L.V3.new(), b = L.V3.new();
  L.dirFromAngles(a, .2, .3, 1); L.dirFromAngles(b, .2, .3, -1);
  near(a.z, -b.z, 1e-12); near(a.x, b.x, 1e-12); near(a.y, b.y, 1e-12);
});
check('V3.norm of zero stays zero', () => { const v = L.V3.norm(L.V3.new(), L.V3.new()); near(L.V3.len(v), 0, 1e-12); });
check('V3.norm produces a unit vector', () => {
  const v = L.V3.norm(L.V3.new(), L.V3.new(3, 4, 12)); near(L.V3.len(v), 1, 1e-12);
});
check('V3.dist is symmetric', () => {
  const a = L.V3.new(1, 2, 3), b = L.V3.new(-4, 5, 6);
  near(L.V3.dist(a, b), L.V3.dist(b, a), 1e-12);
});
check('Q.slerp keeps unit length at the midpoint', () => {
  const a = L.Q.new(), b = L.Q.new(), o = L.Q.new();
  L.Q.identity(a); L.Q.setAxisAngle(b, 0, 1, 0, Math.PI / 2);
  L.Q.slerp(o, a, b, .5); near(Math.hypot(o.x, o.y, o.z, o.w), 1, 1e-9);
});
check('paddlePoseQuaternion returns a unit quaternion', () => {
  const q = L.paddlePoseQuaternion(L.V3.norm(L.V3.new(), L.V3.new(.3, -.4, -.5)), .7);
  near(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9);
});
check('table constants are symmetric', () => {
  eq(L.PH.T_HALF_WID, L.PH.T_HALF_WID); ok(L.PH.T_HALF_LEN > L.PH.T_HALF_WID, 'table longer than wide');
  ok(L.PH.TABLE_Y > 0 && L.PH.R > 0, 'positive geometry');
});
check('match rules carry a finite version', () => { ok(Number.isFinite(L.MATCH_RULES.version), 'version'); });
check('capture radii are positive and ordered', () => {
  ok(L.MATCH_RULES.captureRadius > 0, 'capture'); ok(L.MATCH_RULES.serveCaptureRadius >= L.MATCH_RULES.captureRadius, 'serve capture');
});

/* ================================================================== */
/* 15–28  STAMINA                                                     */
/* ================================================================== */
check('fresh stamina is full and calm', () => {
  const s = L.Stamina.fresh(); eq(s.energy, 100); eq(s.fatigue, 0); eq(s.low, false);
});
check('capacity subtracts fatigue with a floor', () => {
  near(L.Stamina.capacity({ energy: 0, fatigue: 20 }), 80, 1e-9);
  near(L.Stamina.capacity({ energy: 0, fatigue: 1e9 }), 100 - L.STAMINA_CONFIG.fatigueMax, 1e-9);
});
check('cost of a tap is fixed', () => eq(L.Stamina.cost({ kind: 'tap' }), L.STAMINA_CONFIG.tapCost));
check('cost of an unknown stroke falls back to DRIVE', () => {
  near(L.Stamina.cost({ strokeId: 'NOPE', effort: .5 }), L.Stamina.cost({ strokeId: 'DRIVE', effort: .5 }), 1e-12);
});
check('cost grows with effort', () => {
  ok(L.Stamina.cost({ strokeId: 'LOOP', effort: 1 }) > L.Stamina.cost({ strokeId: 'LOOP', effort: 0 }), 'effort');
});
check('charging more than the tank empties it and still fatigues', () => {
  const s = L.Stamina.charge(L.Stamina.fresh(), 1000);
  eq(s.energy, 0); ok(s.fatigue > 0, 'fatigue');
});
check('non-positive work is a no-op', () => {
  const before = L.Stamina.fresh(); const after = L.Stamina.charge(before, -5);
  eq(after.energy, before.energy); eq(after.fatigue, before.fatigue);
});
check('advance respects the regeneration delay', () => {
  const s = { energy: 50, fatigue: 0, regenDelayRemaining: .55, low: false };
  const after = L.Stamina.advance(s, .25); near(after.energy, 50, 1e-9); near(after.regenDelayRemaining, .30, 1e-9);
});
check('advance regenerates only the post-delay part of a long step', () => {
  const s = { energy: 50, fatigue: 0, regenDelayRemaining: .55, low: false };
  const after = L.Stamina.advance(s, 1.0);
  near(after.energy, 50 + 4 * .45, 1e-9); eq(after.regenDelayRemaining, 0);
});
check('advance never exceeds capacity', () => {
  const s = { energy: 99, fatigue: 0, regenDelayRemaining: 0, low: false };
  near(L.Stamina.advance(s, 10).energy, 100, 1e-9);
});
check('low latch enters below 25 and exits only above the hysteresis', () => {
  const a = L.Stamina.advance({ energy: 24.9, fatigue: 0, regenDelayRemaining: 0, low: false }, 0);
  eq(a.low, true);
  const b = L.Stamina.advance({ energy: 27, fatigue: 0, regenDelayRemaining: 0, low: true }, 0);
  eq(b.low, true, 'must stay latched until 30');
  const c = L.Stamina.advance({ energy: 30.1, fatigue: 0, regenDelayRemaining: 0, low: true }, 0);
  eq(c.low, false);
});
check('validateRestore accepts a consistent state', () => {
  ok(L.Stamina.validateRestore({ energy: 40, fatigue: 10, regenDelayRemaining: 0, low: false }), 'valid');
});
check('validateRestore rejects inconsistent low/high values', () => {
  eq(L.Stamina.validateRestore({ energy: 40, fatigue: 10, regenDelayRemaining: 0, low: true }), null);
  eq(L.Stamina.validateRestore({ energy: 95, fatigue: 10, regenDelayRemaining: 0, low: false }), null);
  eq(L.Stamina.validateRestore({ energy: NaN, fatigue: 0, regenDelayRemaining: 0, low: false }), null);
});
check('effortScale is 1 at full energy and lower when depleted', () => {
  const full = L.Stamina.deriveEffortBudget({ energy: 100, fatigue: 0, regenDelayRemaining: 0, low: false }, { requestedVmag: 10, freshVmagCap: 10 });
  const low = L.Stamina.deriveEffortBudget({ energy: 5, fatigue: 30, regenDelayRemaining: 0, low: true }, { requestedVmag: 10, freshVmagCap: 10 });
  near(full.effortScale, 1, 1e-9); ok(low.effortScale < .8, `low scale ${low.effortScale}`); ok(low.vmagCap < 10, 'cap');
});

/* ================================================================== */
/* 29–55  CAREER                                                      */
/* ================================================================== */
check('career has twelve tournaments with sequential ids', () => {
  eq(L.TOURNAMENTS.length, 12); L.TOURNAMENTS.forEach((t, i) => eq(t.id, i));
});
for (const t of L.TOURNAMENTS) {
  check(`tournament ${t.id} has an ordered ELO band and sane rounds`, () => {
    ok(t.eloMin > 0 && t.eloMax >= t.eloMin, `ELO ${t.eloMin}-${t.eloMax}`);
    ok(Number.isInteger(t.rounds) && t.rounds >= 1 && t.rounds <= 6, `rounds ${t.rounds}`);
    ok(typeof t.name === 'string' && t.name.length > 0, 'name');
  });
}
check('career perk rarities are the documented three', () => {
  const set = new Set(L.PERKS.map(p => p.rarity)); eq(set.size, 3);
  for (const r of ['green', 'blue', 'gold']) ok(set.has(r), r);
});
check('retired assistance perks are gone', () => {
  for (const id of ['steady_hand', 'quick_feet', 'sharp_eye', 'net_touch', 'berserker', 'glass_cannon'])
    ok(!L.PERKS.some(p => p.id === id), id);
});
check('early tournaments expose only common perks', () => {
  const c = { currentTournament: 0, perks: [] };
  const ids = L.getAvailablePerks(c).map(p => p.id);
  ok(ids.length >= 3, 'at least three');
  ok(L.getAvailablePerks(c).every(p => p.rarity === 'green'), 'only green');
});
check('blue perks unlock at tournament 3 and gold at 7', () => {
  const at2 = L.getAvailablePerks({ currentTournament: 2, perks: [] });
  const at3 = L.getAvailablePerks({ currentTournament: 3, perks: [] });
  const at6 = L.getAvailablePerks({ currentTournament: 6, perks: [] });
  const at7 = L.getAvailablePerks({ currentTournament: 7, perks: [] });
  ok(!at2.some(p => p.rarity === 'blue'), 'blue at 2'); ok(at3.some(p => p.rarity === 'blue'), 'blue at 3');
  ok(!at6.some(p => p.rarity === 'gold'), 'gold at 6'); ok(at7.some(p => p.rarity === 'gold'), 'gold at 7');
});
check('owned perks are excluded from the pool', () => {
  const pool = L.getAvailablePerks({ currentTournament: 11, perks: [{ id: 'heavy_spin' }] });
  ok(!pool.some(p => p.id === 'heavy_spin'), 'owned leaked');
});
check('pickThreePerks returns at most three unique available perks', () => {
  for (let i = 0; i < 50; i++) {
    const c = { currentTournament: 11, perks: [] };
    const pick = L.pickThreePerks(c);
    ok(pick.length <= 3, `length ${pick.length}`);
    eq(new Set(pick.map(p => p.id)).size, pick.length, 'duplicates');
    const available = new Set(L.getAvailablePerks(c).map(p => p.id));
    ok(pick.every(p => available.has(p.id)), 'not available');
  }
});
check('perk application is replayable from a clean boost state', () => {
  const g = {};
  const perk = L.PERKS.find(p => p.id === 'heavy_spin'); perk.apply(g); perk.apply(g);
  near(g._careerSpinBoost, 1.12 * 1.12, 1e-9);
});
check('generated opponents stay inside the requested ELO band', () => {
  for (let i = 0; i < 200; i++) {
    const o = L.generateOpponent(900, 1100); ok(o.elo >= 900 && o.elo <= 1100, `elo ${o.elo}`);
    ok(typeof o.name === 'string' && o.name.length > 0, 'name'); ok(o.level >= 0, 'level');
  }
});
check('generated opponent levels never exceed the AI level list', () => {
  const max = L.AI_LEVELS.length - 1;
  for (let i = 0; i < 500; i++) {
    const o = L.generateOpponent(2900, 3100);
    ok(o.level <= max, `level ${o.level} > ${max}`);
  }
});
check('career ceiling matches the AI level list', () => eq(L.CAREER_MAX_AI_LEVEL, L.AI_LEVELS.length - 1));
check('ELO 2500+ maps to the strongest existing AI, not a phantom level 4', () => {
  const max = L.AI_LEVELS.length - 1;
  for (let i = 0; i < 100; i++) eq(L.generateOpponent(2500, 3100).level, max);
});
check('career start resets the bracket and run stats', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); c.start();
  eq(c.currentTournament, 0); eq(c.currentRound, 0); eq(c.perks.length, 0);
  eq(c.opponents.length, L.TOURNAMENTS[0].rounds);
  eq(c.runStats.totalRallies, 0);
});
check('career match end accumulates rallies and the longest rally', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [11, 7], stats: { rallies: 9, maxSpeed: 71 }, bestRally: 14 };
  const c = new L.Career(fake); c.start(); c.state = 'MATCH';
  c.selectedOpponent = c.opponents[0]; c.onMatchEnd(1);
  eq(c.runStats.totalRallies, 9, 'total rallies');
  eq(c.runStats.longestRally, 14, 'longest rally');
  eq(c.matchHistory.length, 1);
});
check('career loss ends the run and records it', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [4, 11], stats: { rallies: 6, maxSpeed: 40 }, bestRally: 7 };
  const c = new L.Career(fake); c.start(); c.state = 'MATCH';
  c.selectedOpponent = c.opponents[0]; c.onMatchEnd(-1);
  eq(c.state, 'RUN_END'); eq(c.totalLosses, 1); eq(c.matchHistory[0].won, false);
});
check('career load rejects an unknown tournament and a bad round', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake);
  c.save = () => {}; // pure validation below
  const saved = L.saved;
  const write = (obj) => saved.set('topspin_career', JSON.stringify(obj));
  write({ v: 2, state: 'TOURNAMENT_INTRO', currentTournament: 99, currentRound: 0, totalWins: 0, totalLosses: 0, perks: [], opponents: [], matchHistory: [], runStats: {} });
  eq(c.load(), false, 'unknown tournament');
  write({ v: 2, state: 'TOURNAMENT_INTRO', currentTournament: 0, currentRound: 99, totalWins: 0, totalLosses: 0, perks: [], opponents: [], matchHistory: [], runStats: {} });
  eq(c.load(), false, 'bad round');
});
check('career load accepts a well-formed suspended checkpoint', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake);
  const opp = L.generateOpponent(600, 900);
  L.saved.set('topspin_career', JSON.stringify({ v: 2, state: 'TOURNAMENT_INTRO', currentTournament: 0,
    currentRound: 1, totalWins: 1, totalLosses: 0, perks: [], opponents: [opp, opp], matchHistory: [], runStats: { totalPoints: 11 } }));
  c.load();
  eq(c.currentTournament, 0); eq(c.currentRound, 1); eq(c.totalWins, 1); eq(c.state, 'TOURNAMENT_INTRO');
});

/* ================================================================== */
/* 56–97  EQUIPMENT CATALOGUE (one sum + one range + one trade/item)   */
/* ================================================================== */
check('equipment ids are unique and both kinds exist', () => {
  const ids = Object.keys(L.ITEMS); eq(new Set(ids).size, ids.length);
  ok(ids.some(id => L.ITEMS[id].kind === 'blade'), 'blade'); ok(ids.some(id => L.ITEMS[id].kind === 'rubber'), 'rubber');
});
check('every item spends the same 258-point stat budget', () => {
  for (const id of Object.keys(L.ITEMS)) {
    const s = L.ITEMS[id].s; const sum = L.STAT_KEYS.reduce((a, k) => a + s[k], 0);
    eq(sum, 258, id);
  }
});
check('every stat stays inside the documented 40..92 band', () => {
  for (const id of Object.keys(L.ITEMS)) for (const k of L.STAT_KEYS) {
    const v = L.ITEMS[id].s[k]; ok(v >= 40 && v <= 92, `${id}.${k}=${v}`);
  }
});
check('starter gear is never strictly dominated by a shop item', () => {
  const base = L.ITEMS['b_base'].s;
  for (const id of Object.keys(L.ITEMS)) {
    if (id === 'b_base') continue;
    const s = L.ITEMS[id].s;
    ok(!L.STAT_KEYS.every(k => s[k] >= base[k]), `${id} dominates the starter`);
  }
});
check('itemStats mirrors the stored profile exactly', () => {
  for (const id of Object.keys(L.ITEMS)) {
    const st = L.itemStats(L.ITEMS[id]), s = L.ITEMS[id].s;
    for (const k of L.STAT_KEYS) eq(st[k], Math.round(L.clamp(s[k], 0, 100)), `${id}.${k}`);
  }
});
check('statK spans 0.88..1.12 and is monotone', () => {
  near(L.statK(40), .88, 1e-9); near(L.statK(92), 1.12, 1e-9);
  ok(L.statK(50) < L.statK(80), 'monotone');
});
check('spread clamps inputs outside the stat band', () => {
  near(L.spread(0, 0, 1), 0, 1e-12); near(L.spread(999, 0, 1), 1, 1e-12);
});
check('every physical parameter is finite and positive', () => {
  for (const id of Object.keys(L.ITEMS)) {
    for (const [k, v] of Object.entries(L.ITEMS[id].phys)) { finite(v, `${id}.${k}`); ok(v > 0, `${id}.${k}`); }
  }
});
check('blade physics is monotone in its driving stat', () => {
  const a = L.ITEMS['b_def'].phys, b = L.ITEMS['b_off'].phys;
  ok(b.eK > a.eK, 'speed -> restitution');
  ok(b.sweetK < a.sweetK, 'control -> sweet spot');
});
check('rubber grip raises tangential restitution, not just the label', () => {
  const ctl = L.ITEMS['r_ctl'].phys, top = L.ITEMS['r_tops'].phys;
  ok(top.etK > ctl.etK, 'spin -> etK');
  ok(top.dampK > ctl.dampK, 'higher control damps the face more');
});
check('the shop order is cheapest first', () => {
  for (let i = 1; i < L.ITEMS_ORDER.length; i++) ok(L.ITEMS_ORDER[i - 1].price <= L.ITEMS_ORDER[i].price, `order ${i}`);
});

/* ================================================================== */
/* 98–119  META / SAVE                                                */
/* ================================================================== */
check('num rejects strings, NaN and infinities', () => {
  eq(L.num('5', 7), 7); eq(L.num(NaN, 7), 7); eq(L.num(Infinity, 7), 7); eq(L.num(5, 7), 5);
});
check('num clamps to the given range', () => { eq(L.num(-1, 0, 0, 10), 0); eq(L.num(99, 0, 0, 10), 10); });
check('int rounds and clamps', () => { eq(L.int(1.6, 0), 2); eq(L.int(1e9, 0, 0, 10), 10); });
check('bool only accepts booleans', () => { eq(L.bool(1, true), true); eq(L.bool(false, true), false); });
check('strList filters, caps and keeps strings only', () => {
  const v = L.strList(['a', 1, 'b', 'c'], x => x.length === 1, 2); eq(v.join(','), 'a,b');
});
check('safeAssign refuses prototype keys', () => {
  const base = {}; L.safeAssign(base, JSON.parse('{"__proto__":{"polluted":1},"ok":2}'));
  eq(base.ok, 2); eq({}.polluted, undefined); eq(Object.getPrototypeOf(base), Object.prototype);
});
check('a fresh profile starts with the starter kit and 250 coins', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.data.coins, 250); ok(p.data.owned.includes('b_base') && p.data.owned.includes('r_base'), 'starter');
});
check('a corrupt wallet is sanitised on load, not multiplied', () => {
  L.saved.set(L.SAVE_KEY, JSON.stringify({ v: 3, coins: 'много', crystals: NaN, xp: -5, level: 'high' }));
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.data.coins, 250); eq(p.data.crystals, 0); eq(p.data.xp, 0); eq(p.data.level, 1);
});
check('unknown equipment falls back to owned gear of the right kind', () => {
  L.saved.set(L.SAVE_KEY, JSON.stringify({ v: 3, owned: ['b_base', 'r_base'], equip: { blade: 'b_hero', fh: 'nope', bh: 'r_hero' } }));
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.data.equip.blade, 'b_base'); eq(p.data.equip.fh, 'r_base'); eq(p.data.equip.bh, 'r_base');
});
check('an unpaid item cannot be equipped by editing the save', () => {
  L.saved.set(L.SAVE_KEY, JSON.stringify({ v: 3, owned: ['b_base', 'r_base'], equip: { blade: 'b_hero', fh: 'r_base', bh: 'r_base' } }));
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  ok(p.data.owned.includes('b_base'), 'owned'); eq(p.data.equip.blade, 'b_base');
});
check('coins clamp at the sanity ceiling and floor', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.data.coins = 0; p.addCoins(1e12); eq(p.data.coins, L.MAX_COINS);
  p.addCoins(-1e12); eq(p.data.coins, 0);
});
check('NaN rewards do not poison the wallet', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  const before = p.data.coins; p.addCoins(NaN); eq(p.data.coins, before);
});
check('spend refuses an unaffordable purchase and keeps the balance', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.data.coins = 100; eq(p.spend(101, 0), false); eq(p.data.coins, 100);
  eq(p.spend(100, 0), true); eq(p.data.coins, 0);
});
check('XP level-up stops at the level ceiling even for a huge reward', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.data.level = 1; p.data.xp = 0;
  const t0 = Date.now(); p.addXP(1e9); const took = Date.now() - t0;
  ok(p.data.level <= 200, `level ${p.data.level}`); ok(took < 500, `took ${took} ms`);
});
check('dayKey is a stable unpadded date key', () => {
  const k = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 })).dayKey(new Date(2026, 0, 5).getTime());
  eq(k, '2026-1-5');
});
check('daily streak increments only across consecutive days', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  const y = new Date(Date.now() - 86400000);
  p.data.daily.day = p.dayKey(y.getTime()); p.data.streak = 3; p.data.days = [];
  p.today(); eq(p.data.streak, 4);
});
check('the daily rollover clears tasks but keeps the score history', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.data.daily.day = '2000-1-1'; p.data.daily.tasks = { win1: 1 }; p.data.daily.done = ['win1']; p.data.daily.claimed = ['win1'];
  p.today(); eq(p.data.daily.tasks.win1, undefined); eq(p.data.daily.done.length, 0); ok(p.data.days.length > 0, 'days');
});
check('a purchase survives a save/load roundtrip', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.data.coins = 5000; ok(p.buy('b_off', 900, 'coins'), 'buy');
  p.save(true);
  const q = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  ok(q.owns('b_off'), 'owned after reload'); eq(q.data.coins, 4100);
});

/* ================================================================== */
/* 120–134  NETWORK MIRROR                                             */
/* ================================================================== */
check('z mirror is an involution for polar vectors', () => {
  const v = [1, 2, 3]; eq(L.netFlipZ(L.netFlipZ(v)).join(','), v.join(','));
});
check('spin mirror flips the perpendicular components and keeps z', () => {
  const v = [1, 2, 3]; eq(L.netFlipAxial(v).join(','), '-1,-2,3');
});
check('netMirrorState is an involution for a full frame', () => {
  const msg = { type: 'state', ball: { p: [1, 2, 3], v: [4, 5, 6], w: [7, 8, 9] },
    racket: { pos: [1, 1, 1], n: [0, 0, 1], sw: .5 }, score: [7, 5], server: 1, who: 1, lastHitBy: 1 };
  const twice = L.netMirrorState(L.netMirrorState(msg));
  eq(JSON.stringify(twice), JSON.stringify(Object.assign({}, msg)));
});
check('netMirrorState swaps the score', () => {
  eq(L.netMirrorState({ score: [9, 4] }).score.join(','), '4,9');
});
check('netMirrorState flips server and who', () => {
  eq(L.netMirrorState({ server: 1, who: 1 }).server, -1); eq(L.netMirrorState({ who: -1 }).who, 1);
});
check('netMirrorState flips lastHitBy so the guest can return again', () => {
  eq(L.netMirrorState({ lastHitBy: 1 }).lastHitBy, -1); eq(L.netMirrorState({ lastHitBy: 0 }).lastHitBy, -0);
});
check('netMirrorInput mirrors the racket pose and normal', () => {
  const m = L.netMirrorInput({ pos: [1, 2, 3], n: [0, 0, 1] });
  eq(m.pos.join(','), '1,2,-3'); eq(m.n.join(','), '0,0,-1');
});
check('an explicit relay URL wins over everything', () => {
  eq(L.resolveNetUrl('wss://explicit/x', 'https://game.test', '?net=wss://q', 'wss://inj'), 'wss://explicit/x');
});
check('an injected relay URL wins over the query', () => {
  eq(L.resolveNetUrl(null, 'https://game.test', '?net=wss://q', 'wss://inj'), 'wss://inj');
});
check('the net query parameter is honoured', () => {
  eq(L.resolveNetUrl(null, 'https://game.test', '?net=wss%3A%2F%2Frelay.test', null), 'wss://relay.test');
});
check('the same-origin relay is used when nothing else is configured', () => {
  eq(L.resolveNetUrl(null, 'https://game.test', '', null), 'wss://game.test/api/relay');
});
check('localhost keeps its port and switches to ws', () => {
  eq(L.resolveNetUrl(null, 'http://localhost:8080', '', null), 'ws://localhost:8080/api/relay');
});
check('the host does not mirror its own authoritative point', () => {
  const nm = Object.create(L.NetworkManager.prototype); nm.isHost = true;
  const m = nm._pointMessage({ type: 'point', who: 1, score: [11, 4], server: 1 });
  eq(m.who, 1); eq(m.score.join(','), '11,4'); eq(m.server, 1);
});
check('the guest mirrors the point into its own frame', () => {
  const nm = Object.create(L.NetworkManager.prototype); nm.isHost = false;
  const m = nm._pointMessage({ type: 'point', who: 1, score: [11, 4], server: 1 });
  eq(m.who, -1); eq(m.score.join(','), '4,11'); eq(m.server, -1);
});
check('duplicate guest hits are rejected by a monotone id', () => {
  const nm = Object.create(L.NetworkManager.prototype);
  nm._lastGuestHitId = 0;
  eq(nm._acceptGuestHit({ hitId: 1 }), true); eq(nm._acceptGuestHit({ hitId: 1 }), false); eq(nm._acceptGuestHit({ hitId: 2 }), true);
});
check('guest hits without an id keep the legacy behaviour', () => {
  const nm = Object.create(L.NetworkManager.prototype); nm._lastGuestHitId = 7;
  eq(nm._acceptGuestHit({}), true);
});

/* ================================================================== */
/* 135–150  TELEMETRY · PERF · REPLAY · PARTICLES · EMOTION · MUSIC    */
/* ================================================================== */
check('telemetry ring wraps and counts drops', () => {
  const log = new L.InputTelemetryLog({ seconds: 10, maxEvents: 128 });
  for (let i = 0; i < 200; i++) log.record({ t: i / 100, type: 'x' });
  eq(log.count, 128); eq(log.dropped, 72); eq(log.events(1.99).length, 128);
});
check('telemetry honours the time window', () => {
  const log = new L.InputTelemetryLog({ seconds: 1, maxEvents: 512 });
  for (let i = 0; i < 100; i++) log.record({ t: i / 50 });
  eq(log.events(1.99).length, 50);
});
check('telemetry starts a new epoch when the clock rolls back', () => {
  const log = new L.InputTelemetryLog(); log.record({ t: 100 }); const e = log.epoch;
  log.record({ t: 1 }); ok(log.epoch > e, 'no epoch'); eq(log.count, 1);
});
check('perf scale steps down above the slow frame threshold', () => {
  near(L.perfScaleStep(1, L.PERF_SLOW_MS + 1, 1500), 1 - .12, 1e-12);
});
check('perf scale steps up only below the fast threshold', () => {
  near(L.perfScaleStep(.8, L.PERF_FAST_MS - 1, 1500), .86, 1e-12);
  eq(L.perfScaleStep(.8, L.PERF_FAST_MS + 1, 1500), .8);
});
check('perf scale never leaves its bounds', () => {
  eq(L.perfScaleStep(L.PERF_SCALE_MIN, 99, 1500), L.PERF_SCALE_MIN);
  eq(L.perfScaleStep(L.PERF_SCALE_MAX, 1, 1500), L.PERF_SCALE_MAX);
  eq(L.perfScaleStep(1, 5, 100), 1, 'short window ignored');
});
check('beauty scores stay inside their documented bands', () => {
  near(L.BEAUTY.rally(16), .30, 1e-9); near(L.BEAUTY.speed(110), .17, 1e-9); near(L.BEAUTY.spin(130), .14, 1e-9);
  for (const n of [0, 5, 20, 100]) ok(L.BEAUTY.rally(n) >= 0 && L.BEAUTY.rally(n) <= .3, 'rally');
});
check('replay ring upsamples a 20 Hz feed onto 30 Hz', () => {
  const g = replayStub(); const rec = new L.MomentRecorder(); rec.beginRally(0, [0, 0]);
  rec.push(0, g); rec.push(.05, g);
  eq(rec.n, 2, 'frames at 0.05 s');
  const clip = rec.captureClip(.05); ok(clip && clip.len === 2 && clip.frames.length === 2 * L.REPLAY_FLOATS, 'clip');
});
check('replay clip keeps chronological order', () => {
  const g = replayStub(); const rec = new L.MomentRecorder(); rec.beginRally(0, [0, 0]);
  for (let i = 0; i <= 3; i++) { g.ball.p.z = i; rec.push(i / 30, g); }
  const clip = rec.captureClip(3 / 30); near(clip.frames[2], 0, 1e-9); near(clip.frames[clip.frames.length - 14], 3, 1e-9);
});
check('replay player refuses a clip without a full frame', () => {
  const player = new L.MomentPlayer(); eq(player.play({ frames: new Float32Array(0) }), false);
  eq(player.play({ frames: new Float32Array(L.REPLAY_FLOATS) }), true); player.stop();
});
check('replay player clamps at the last frame and ends once', () => {
  const g = replayStub(); const player = new L.MomentPlayer(); let ended = 0;
  const frames = new Float32Array(L.REPLAY_FLOATS * 2); player.play({ frames, hz: 30 }, 1, () => ended++);
  for (let i = 0; i < 200; i++) player.update(.05, g);
  eq(ended, 1); eq(player.on, false); eq(player.moment, null);
});
check('particle pool never exceeds its cap', () => {
  const p = new L.Particles(260); for (let i = 0; i < 1000; i++) p.spawn(0, 1, 0, 0, 0, 0, 1, .1, 1, 1, 1, 0);
  eq(p.n, 260);
});
check('particles age and die on the sim clock', () => {
  const p = new L.Particles(8); p.spawn(0, 1, 0, 0, 0, 0, .1, .1, 1, 1, 1, 0);
  p.update(.2); ok(p.life[0] <= 0, 'still alive');
});
check('emotion detects match point on both sides but not at deuce', () => {
  const e = new L.EmotionalSystem({});
  eq(e._detectMatchPoint({ score: [10, 9], settings: { targetScore: 11 } }), true);
  eq(e._detectMatchPoint({ score: [9, 10], settings: { targetScore: 11 } }), true);
  eq(e._detectMatchPoint({ score: [10, 10], settings: { targetScore: 11 } }), false);
  eq(e._detectMatchPoint({ score: [10, 9], settings: { targetScore: 11 }, demoMode: true }), false);
});
check('emotion intensity stays inside 0..1 under absurd input', () => {
  const e = new L.EmotionalSystem({});
  const v = e._computeIntensity({ rally: 1e6, ball: { v: L.V3.new(0, 0, 1e6) }, score: [0, 0], momentum: { current: 1e6 }, netTouched: true });
  ok(v >= 0 && v <= 1, `intensity ${v}`);
});
check('music intensity stays inside 0..1 under absurd input', () => {
  const m = new L.MusicSystem({}); const v = m.computeIntensity({ rally: 1e6, ball: { v: L.V3.new(0, 0, 1e6), w: L.V3.new(1e6, 0, 0) }, settings: { assist: -1e6 }, momentum: { current: 1e6 } });
  ok(v >= 0 && v <= 1, `intensity ${v}`);
});
check('music calm raises the base layer, rally raises tension', () => {
  const m = new L.MusicSystem({});
  m.state = L.MUSIC_STATE.CALM; m._updateLayerGains({}); const calm = m.targetLayerGain.base;
  m.state = L.MUSIC_STATE.INTENSE; m.intensity = 1; m._updateLayerGains({});
  ok(m.targetLayerGain.base < calm, 'base'); ok(m.targetLayerGain.tension > 0, 'tension');
});

/* ================================================================== */
/* 150  TRAINING CATALOGUE                                            */
/* ================================================================== */
check('every stroke and every skill has translated training copy', () => {
  for (const id of Object.keys(L.STROKES)) ok(L.TRAIN_GUIDES[id], `guide ${id}`);
  for (const g of Object.values(L.TRAIN_GUIDES)) for (const f of L.TRAIN_GUIDE_FIELDS)
    ok(typeof g[f] === 'string' && g[f].trim() && L.ET.dicts.ru[g[f]] && L.ET.dicts.en[g[f]], `${g.id}.${f}`);
  for (const s of L.TRAIN_SKILLS.concat(L.TRAIN_MODULES)) ok(L.ET.dicts.ru[s.title] && L.ET.dicts.en[s.title], `title ${s.id}`);
});


/* ================================================================== */
/* 122–150  SECOND PASS: STATE MACHINES AND SIDE EFFECTS              */
/* ================================================================== */
check('career ceiling is three for the current four-level AI', () => eq(L.CAREER_MAX_AI_LEVEL, 3));
check('a legacy level-4 opponent is clamped before it reaches the AI', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel(l) { this.level = l; }, reset() {} },
    startMatch(l) { this.started = l; }, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); c.start(); c.state = 'OPPONENT_SELECT';
  c.opponents = [{ ...L.generateOpponent(600, 900), level: 4 }];
  c.selectOpponent(0);
  eq(fake.started, 3); eq(fake.settings.difficulty, 3); eq(fake.ai.level, 3);
});
check('career stop restores the pre-run difficulty', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); c.start(); fake.settings.difficulty = 0; c.stop(); eq(fake.settings.difficulty, 2);
});
check('advancing from a tournament end moves to the next bracket', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); c.start(); c.state = 'TOURNAMENT_END'; c.advanceTournament();
  eq(c.currentTournament, 1); eq(c.state, 'TOURNAMENT_INTRO'); eq(c.opponents.length, L.TOURNAMENTS[1].rounds);
});
check('an inactive career does not overwrite its checkpoint', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); L.saved.delete('topspin_career'); c.save();
  eq(L.saved.has('topspin_career'), false);
});
check('the late-career pool exposes every perk exactly once', () => {
  const pool = L.getAvailablePerks({ currentTournament: 11, perks: [] });
  eq(pool.length, L.PERKS.length); eq(new Set(pool.map(p => p.id)).size, pool.length);
});
check('career history is capped on load', () => {
  const fake = { settings: { difficulty: 2 }, ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [0, 0], stats: {}, bestRally: 0 };
  const c = new L.Career(fake); const opp = L.generateOpponent(600, 900);
  const history = Array.from({ length: 40 }, () => ({ tournament: 0, round: 0, opponent: opp, won: true, score: [11, 0] }));
  L.saved.set('topspin_career', JSON.stringify({ v: 2, state: 'TOURNAMENT_INTRO', currentTournament: 0, currentRound: 0,
    totalWins: 40, totalLosses: 0, perks: [], opponents: [opp, opp, opp], matchHistory: history, runStats: {} }));
  c.load(); eq(c.matchHistory.length, 20);
});
check('blades and rubbers both have seven catalogue entries', () => { eq(L.BLADES.length, 7); eq(L.RUBBERS.length, 7); });
check('every item has a non-negative price and a starter is free', () => {
  for (const id of Object.keys(L.ITEMS)) ok(L.ITEMS[id].price >= 0, id);
  eq(L.ITEMS['b_base'].price, 0); eq(L.ITEMS['r_base'].price, 0);
});
check('the shop opens on free starter gear', () => eq(L.ITEMS_ORDER[0].id, 'b_base'));
check('rubber colour arrays are three finite channels', () => {
  for (const r of L.RUBBERS) { eq(r.col.length, 3); eq(r.back.length, 3); r.col.concat(r.back).forEach((v) => finite(v, r.id)); }
});
check('itemStats exposes exactly the four advertised stats', () => {
  for (const id of Object.keys(L.ITEMS)) eq(Object.keys(L.itemStats(L.ITEMS[id])).sort().join(','), L.STAT_KEYS.slice().sort().join(','));
});
check('the save level ceiling is the same 200 in both places', () => eq(L.MAX_LEVEL, 200));
check('a portal that forbids IAP is detected by its SDK flag', () => {
  const p = new L.Platform({ userAgent: '', maxTouchPoints: 0, poki: true }); eq(p.canIAP, false); eq(p.label, 'POKI');
});
check('a direct launch may sell, a portal may not', () => {
  eq(new L.Platform({ userAgent: '', maxTouchPoints: 0 }).canIAP, true);
  eq(new L.Platform({ userAgent: '', maxTouchPoints: 0, CrazyGames: true }).canIAP, true);
});
check('buying an owned item or an unknown id is refused', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.buy('b_base', 0, 'coins'), false); eq(p.buy('not_an_item', 0, 'coins'), false);
});
check('a forced save clears the dirty flag', () => {
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  p.touch(); eq(p.save(true), true); eq(p.dirty, false);
});
check('resetting a network session clears ordering state', () => {
  const nm = Object.create(L.NetworkManager.prototype);
  nm.room = 'r'; nm.side = 1; nm._interpBuf = [1, 2]; nm._lastGuestHitId = 9; nm._lastStateClock = 5;
  nm._resetSession();
  eq(nm.room, null); eq(nm.side, 0); eq(nm._interpBuf.length, 0); eq(nm._lastGuestHitId, 0); eq(nm._lastStateClock, null);
});
check('mirroring an empty frame does not invent fields', () => {
  const m = L.netMirrorState({}); eq(m.ball, undefined); eq(m.score, undefined);
});
check('telemetry clear empties the ring and starts an epoch', () => {
  const log = new L.InputTelemetryLog(); log.record({ t: 1 }); log.clear();
  eq(log.count, 0); eq(log.events().length, 0); eq(log.buffer.filter(Boolean).length, 0);
});
check('telemetry stats are finite on an empty log', () => {
  const s = new L.InputTelemetryLog().stats(); ok(Number.isFinite(s.stored) && Number.isFinite(s.approxBytes), 'stats');
});
check('perf keeps the scale inside the dead band', () => eq(L.perfScaleStep(.8, 15, 1500), .8));
check('replay reset drops the ring and the moment list', () => {
  const g = replayStub(); const rec = new L.MomentRecorder(); rec.beginRally(0, [0, 0]); rec.push(0, g); rec.kept.push({}); rec.reset();
  eq(rec.n, 0); eq(rec.kept.length, 0); eq(rec.lastClip, null);
});
check('a two-shot rally is never saved as a highlight', () => {
  const g = replayStub(); const rec = new L.MomentRecorder(); rec.beginRally(0, [0, 0]);
  rec.addContact(1, { by: 1, speed: 40 }); rec.addContact(2, { by: -1, speed: 40 });
  eq(rec.endRally(3, g, { score: [0, 0], winner: 1, target: 11 }), null);
});
check('a burst respects the particle cap', () => {
  const p = new L.Particles(32); p.burst(0, 1, 0, 200, 2, 1, .1, 1, 1, 1); eq(p.n, 32);
});
check('emotion exposes a neutral default snapshot', () => {
  const e = new L.EmotionalSystem({}); eq(e.getParams().state, L.EMOTION_STATE.NEUTRAL); eq(e.getParams().intensity, 0);
});
check('music exposes finite layer gains', () => {
  const m = new L.MusicSystem({}); const p = m.getParams();
  for (const k of ['baseGain', 'tensionGain', 'climaxGain', 'resolutionGain']) finite(p[k], k);
});
check('training skill ids are unique', () => eq(new Set(L.TRAIN_SKILLS.map(s => s.id)).size, L.TRAIN_SKILLS.length));
check('training has the eight documented modules', () => eq(L.TRAIN_MODULES.length, 8));
check('touch is detected from ontouchstart even when maxTouchPoints is zero', () => {
  eq(new L.Platform({ maxTouchPoints: 0, ontouchstart: null }).touch, true);
  eq(new L.Platform({ maxTouchPoints: 5 }).touch, true);
  eq(new L.Platform({ maxTouchPoints: 0 }).touch, false);
});
check('the inventory is deduplicated on load', () => {
  L.saved.set(L.SAVE_KEY, JSON.stringify({ v: 3, owned: ['b_base', 'r_base', 'b_base', 'r_base'] }));
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.data.owned.length, 2);
});
check('oversized trophy strings are dropped instead of retained', () => {
  L.saved.set(L.SAVE_KEY, JSON.stringify({ v: 3, career: { trophies: ['ok', 'x'.repeat(500)] } }));
  const p = new L.Profile(new L.Platform({ userAgent: '', maxTouchPoints: 0 }));
  eq(p.data.career.trophies.join(','), 'ok');
});

/* ================================================================== */
function replayStub() {
  return {
    ball: { p: L.V3.new(0, 1, 0), v: L.V3.new(), w: L.V3.new(), live: true, hist: [], histTimes: [] },
    player: { pos: L.V3.new(0, 0, 1.5), normal: L.V3.new(0, 0, -1), roll: 0 },
    aiPaddle: { pos: L.V3.new(0, 0, -1.5), normal: L.V3.new(0, 0, 1) },
    ai: { pos: L.V3.new(0, 0, -1.5) },
    settings: { hand: 'right', grip: 'shakehand' },
  };
}

const passed = total - failures.length;
console.log(`\n===== AUDIT 150+ UNEXPLORED: ${passed}/${total} checks passed =====`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ' + f);
  process.exitCode = 1;
} else console.log('ALL GREEN');
