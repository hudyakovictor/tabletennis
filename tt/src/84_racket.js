/* =====================================================================
 *  EQUIPMENT — blades, rubbers, and the numbers they actually change.
 *
 *  A racket in this game is not a stat card with a "+12% damage" sticker.
 *  Every item is a small set of real physical parameters — coefficient of
 *  restitution, coefficient of friction, tangential restitution, dwell
 *  damping, sweet-spot radius, swing weight — fed straight into the same
 *  `impactRacket` the rest of the physics uses. Which means:
 *
 *  · the four numbers on the card are DERIVED from the physics, not the
 *    other way round, so the card cannot lie about the feel;
 *  · two rackets can be equally good and still ask you to play
 *    differently — one throws the ball flatter and harder, another holds
 *    it a millisecond longer and turns the same swing into more spin;
 *  · nothing is strictly better than the starting racket. The budget of
 *    the four stats is fixed (STAT_BUDGET), and every physical parameter
 *    is a monotone function of exactly one stat — so a build can only
 *    trade, never dominate. Paid equipment is different, never stronger.
 * ===================================================================== */
'use strict';

const STAT_MIN = 40, STAT_MAX = 92, STAT_MID = 64.5;
const STAT_KEYS = ['speed', 'spin', 'control', 'feel'];
const STAT_RU = { speed: 'СКОРОСТЬ', spin: 'ВРАЩЕНИЕ', control: 'КОНТРОЛЬ', feel: 'ЧУВСТВО' };

/** One stat, one physical multiplier: 40 → 0.80×, 64.5 → 1.00×, 92 → 1.20×. */
function statK(v) { return 1 + 0.40 * (clamp(v, STAT_MIN, STAT_MAX) - STAT_MID) / (STAT_MAX - STAT_MIN); }

/* ------------------------------------------------------------------ *
 *  The catalogue.  s = the profile the player sees (sums to 258 for
 *  everything); the physics below is computed from it, so the shop can
 *  never quietly sell power.                                          * ------------------------------------------------------------------ */
const BLADES = [
  { id: 'b_base', name: 'BASIC 5', ru: 'ПЯТИСЛОЙКА', tier: 0, price: 0,
    s: { speed: 64, spin: 64, control: 65, feel: 65 }, wood: [0.62, 0.42, 0.24], grip: [0.20, 0.14, 0.11] },
  { id: 'b_off', name: 'OFFENSIVE 7', ru: 'СЕМИСЛОЙКА', tier: 1, price: 900,
    s: { speed: 76, spin: 58, control: 58, feel: 66 }, wood: [0.70, 0.50, 0.30], grip: [0.16, 0.11, 0.09] },
  { id: 'b_loop', name: 'LOOPER', ru: 'ПЕТЛЯ', tier: 1, price: 1400,
    s: { speed: 62, spin: 74, control: 62, feel: 60 }, wood: [0.58, 0.38, 0.22], grip: [0.24, 0.16, 0.12] },
  { id: 'b_ctl', name: 'CONTROL', ru: 'КОНТРОЛЬ', tier: 1, price: 1100,
    s: { speed: 56, spin: 62, control: 78, feel: 62 }, wood: [0.66, 0.56, 0.42], grip: [0.22, 0.18, 0.15] },
  { id: 'b_def', name: 'DEFENCE', ru: 'ЗАЩИТА', tier: 2, price: 1800,
    s: { speed: 50, spin: 58, control: 84, feel: 66 }, wood: [0.72, 0.62, 0.48], grip: [0.26, 0.20, 0.16] },
  { id: 'b_carb', name: 'CARBON', ru: 'КАРБОН', tier: 2, price: 2600,
    s: { speed: 80, spin: 60, control: 56, feel: 62 }, wood: [0.24, 0.27, 0.32], grip: [0.12, 0.13, 0.16] },
  { id: 'b_hero', name: 'ARENA PRO', ru: 'АРЕНА ПРО', tier: 3, price: 4200, star: true,
    s: { speed: 68, spin: 70, control: 58, feel: 62 }, wood: [0.86, 0.72, 0.34], grip: [0.10, 0.12, 0.20] },
];

const RUBBERS = [
  { id: 'r_base', name: 'ALL-ROUND', ru: 'УНИВЕРСАЛ', tier: 0, price: 0,
    s: { speed: 64, spin: 64, control: 64, feel: 66 }, col: [0.78, 0.12, 0.14], back: [0.15, 0.15, 0.17] },
  { id: 'r_tops', name: 'TOPSPIN', ru: 'ТОПСПИН', tier: 1, price: 700,
    s: { speed: 60, spin: 78, control: 60, feel: 60 }, col: [0.18, 0.16, 0.20], back: [0.10, 0.10, 0.12] },
  { id: 'r_fast', name: 'SPEED', ru: 'СКОРОСТЬ', tier: 1, price: 700,
    s: { speed: 78, spin: 56, control: 60, feel: 64 }, col: [0.80, 0.16, 0.18], back: [0.16, 0.14, 0.15] },
  { id: 'r_soft', name: 'SOFT', ru: 'МЯГКАЯ', tier: 1, price: 900,
    s: { speed: 58, spin: 68, control: 76, feel: 56 }, col: [0.20, 0.42, 0.34], back: [0.12, 0.14, 0.14] },
  { id: 'r_ctl', name: 'CONTROL', ru: 'КОНТРОЛЬ', tier: 1, price: 600,
    s: { speed: 54, spin: 60, control: 82, feel: 62 }, col: [0.24, 0.26, 0.52], back: [0.12, 0.12, 0.14] },
  { id: 'r_hyb', name: 'HYBRID', ru: 'ГИБРИД', tier: 2, price: 2200,
    s: { speed: 74, spin: 74, control: 50, feel: 60 }, col: [0.86, 0.58, 0.12], back: [0.14, 0.12, 0.10] },
  { id: 'r_hero', name: 'ARENA GRIP', ru: 'АРЕНА ГРИП', tier: 3, price: 3400, star: true,
    s: { speed: 66, spin: 76, control: 56, feel: 60 }, col: [0.14, 0.14, 0.16], back: [0.10, 0.11, 0.12] },
];

/* Physics from the profile. One stat → one parameter, always monotone,
   so no two items can be ordered "better" in every respect.

   Two notes on why the mapping looks the way it does:
   · `damp` multiplies the restitution inside impactRacket, so a control
     racket gets damp BELOW 1 — it is literally slower off the face. That
     is what control means in this physics, and it is a real trade.
   · spin is carried mostly by tangential restitution (et), because that
     is the term that lives in the gripping regime, where nearly every
     rally stroke happens; mu only bites on a thin, fast graze. Putting
     spin on mu alone would have produced rackets that measure different
     and feel identical. */
function bladePhysics(b) {
  return {
    eK: statK(b.s.speed),
    muK: statK(b.s.spin),
    dampK: 1 / Math.pow(statK(b.s.control), 0.7),
    sweetK: statK(b.s.control),
    vmagK: statK(b.s.feel),
  };
}
function rubberPhysics(r) {
  return {
    eK: statK(r.s.speed),
    muK: Math.pow(statK(r.s.spin), 1.5),
    dampK: 1 / Math.pow(statK(r.s.control), 0.7),
    etK: 0.45 * Math.pow(statK(r.s.spin), 2.4) + 0.55 * statK(r.s.feel),
  };
}

const ITEMS = {};
for (const b of BLADES) ITEMS[b.id] = { kind: 'blade', ...b, phys: bladePhysics(b) };
for (const r of RUBBERS) ITEMS[r.id] = { kind: 'rubber', ...r, phys: rubberPhysics(r) };
const ITEM_LIST = BLADES.concat(RUBBERS).map((i) => ITEMS[i.id]);
/* catalogue order for the workshop: cheapest first, stars last */
const ITEMS_ORDER = ITEM_LIST.slice().sort((a, b) => (a.price - b.price) || (a.kind < b.kind ? -1 : 1));

/** Card numbers, rounded and normalised for the profile screen. */
function itemStats(it) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = Math.round(clamp(it.s[k], 0, 100));
  return out;
}

/** The whole racket's card: the mean of its three parts. */
function racketStats(bladeId, fhId, bhId) {
  const out = { speed: 0, spin: 0, control: 0, feel: 0 };
  let n = 0;
  for (const id of [bladeId, fhId, bhId]) {
    const it = ITEMS[id]; if (!it) continue;
    for (const k of STAT_KEYS) out[k] += it.s[k];
    n++;
  }
  for (const k of STAT_KEYS) out[k] = n ? Math.round(out[k] / n) : 0;
  return out;
}

/* ------------------------------------------------------------------ *
 *  Equipment — the fitted racket, and the rubber object the impact
 *  solver consumes. Everything else in the game reads it from here.
 * ------------------------------------------------------------------ */
class Equipment {
  constructor(blade = 'b_base', fh = 'r_base', bh = 'r_base') {
    this.set(blade, fh, bh);
  }

  set(blade, fh, bh) {
    this.bladeId = ITEMS[blade] ? blade : 'b_base';
    this.fhId = ITEMS[fh] ? fh : 'r_base';
    this.bhId = ITEMS[bh] ? bh : 'r_base';
    this.refresh();
    return this;
  }

  refresh() {
    const b = ITEMS[this.bladeId], fh = ITEMS[this.fhId], bh = ITEMS[this.bhId];
    this.blade = b; this.fh = fh; this.bh = bh;
    this.stats = racketStats(this.bladeId, this.fhId, this.bhId);
    const bp = b.phys;
    /* The blade multiplies both faces; the two faces may differ, so a
       defensive backhand with an attacking forehand is a real build. */
    const mix = (r) => ({
      e: PH.E_RACKET * bp.eK * r.phys.eK,
      mu: PH.MU_RACKET * bp.muK * r.phys.muK,
      et: PH.ET_RACKET * (bp.etK || 1) * r.phys.etK,
      damp: bp.dampK * r.phys.dampK,
    });
    this.fhParams = mix(fh);
    this.bhParams = mix(bh);
    this.sweetK = bp.sweetK;
    this.vmagK = bp.vmagK;
    this.colours = {
      wood: b.wood, grip: b.grip,
      fore: fh.col, foreBack: fh.back,
      back: bh.col, backBack: bh.back,
    };
  }

  /** @param side +1 forehand (red face), −1 backhand */
  forSide(side) { return side >= 0 ? this.fhParams : this.bhParams; }
  get name() { return this.blade.name + ' · ' + this.fh.name; }

  /** Shop sanity: every profile must spend the same budget. */
  static audit() {
    let worst = 0, ids = [];
    for (const id in ITEMS) {
      const s = ITEMS[id].s, sum = s.speed + s.spin + s.control + s.feel;
      worst = Math.max(worst, Math.abs(sum - 258));
      if (Math.abs(sum - 258) > 0.5) ids.push(id + ':' + sum);
    }
    return { worst, ids };
  }

  /** No item may dominate another: 0 pairs that do, or it is a bug. */
  static dominatingPairs() {
    const bad = [];
    for (const a of ITEM_LIST) for (const c of ITEM_LIST) {
      if (a === c || a.kind !== c.kind) continue;
      const ge = STAT_KEYS.every((k) => a.s[k] >= c.s[k]) && STAT_KEYS.some((k) => a.s[k] > c.s[k]);
      if (ge) bad.push(a.id + '>' + c.id);
    }
    return bad;
  }
}
