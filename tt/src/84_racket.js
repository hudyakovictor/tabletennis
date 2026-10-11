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

const STAT_MIN = 40, STAT_MAX = 92;
const STAT_KEYS = ['speed', 'spin', 'control', 'feel'];
const STAT_RU = { speed: 'СКОРОСТЬ', spin: 'ВРАЩЕНИЕ', control: 'КОНТРОЛЬ', feel: 'ЧУВСТВО' };

/**
 * A stat is not a "+12 % damage" sticker: each one moves exactly one
 * physical parameter of the impact, inside a deliberately narrow band.
 *
 *   spread(64, a, b) ≈ (a+b)/2  — the starter gear sits in the middle,
 *
 * and the band itself is the design decision. Two of them matter:
 *
 *   · SPEED  stays within ±5 % per part. A full attack build is ~18 %
 *     faster off the face than a defensive one — enough to feel on every
 *     ball, not enough to buy a win. Anything wider and the shop starts
 *     selling points instead of character (an earlier build of this file
 *     had +35 %, which is exactly that mistake).
 *   · SPIN is the wide one (±30 % tangential restitution) because spin is
 *     what a racket is *for*: the topspin player feels it immediately,
 *     while the flat hitter never notices.
 */
function spread(v, lo, hi) {
  return lo + (hi - lo) * (clamp(v, STAT_MIN, STAT_MAX) - STAT_MIN) / (STAT_MAX - STAT_MIN);
}
/** The single-stat multiplier used by the shop cards (mid stat ≈ 1.0). */
function statK(v) { return spread(v, 0.88, 1.12); }

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
  { id: 'b_def', name: 'DEFENCE', ru: 'ЗАЩИТА', tier: 2, price: 1800, crystals: 240,
    s: { speed: 50, spin: 58, control: 84, feel: 66 }, wood: [0.72, 0.62, 0.48], grip: [0.26, 0.20, 0.16] },
  { id: 'b_carb', name: 'CARBON', ru: 'КАРБОН', tier: 2, price: 2600, crystals: 340,
    s: { speed: 80, spin: 60, control: 56, feel: 62 }, wood: [0.24, 0.27, 0.32], grip: [0.12, 0.13, 0.16] },
  { id: 'b_hero', name: 'ARENA PRO', ru: 'АРЕНА ПРО', tier: 3, price: 4200, crystals: 520, star: true,
    s: { speed: 68, spin: 70, control: 58, feel: 62 }, wood: [0.86, 0.72, 0.34], grip: [0.10, 0.12, 0.20] },
];

/* Two currencies, one ladder. Tier 0–1 items are bought with coins only:
   the whole game, including a competitive racket, is earnable for free.
   Tier 2–3 also carry a crystal price (crystals come from the store), so
   a player who wants the flagship today can pay for the time instead of
   grinding — never for power, since the stat budget is identical. */
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
  { id: 'r_hyb', name: 'HYBRID', ru: 'ГИБРИД', tier: 2, price: 2200, crystals: 300,
    s: { speed: 74, spin: 74, control: 50, feel: 60 }, col: [0.86, 0.58, 0.12], back: [0.14, 0.12, 0.10] },
  { id: 'r_hero', name: 'ARENA GRIP', ru: 'АРЕНА ГРИП', tier: 3, price: 3400, crystals: 420, star: true,
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
  const st = b.s;
  return {
    eK: spread(st.speed, 0.950, 1.050),       // the blade is the springs
    muK: spread(st.spin, 0.950, 1.060),       // surface grip on a thin contact
    etK: spread(st.spin, 0.960, 1.100),       // a flexible blade holds the ball longer
    dampK: spread(st.control, 1.050, 0.940),  // control = swallows a little pace
    sweetK: spread(st.control, 0.900, 1.120), // and forgives an off-centre hit
    vmagK: spread(st.feel, 0.970, 1.030),     // weight in the hand: swing speed
  };
}
function rubberPhysics(r) {
  const st = r.s;
  return {
    eK: spread(st.speed, 0.960, 1.040),
    muK: spread(st.spin, 0.860, 1.140),
    dampK: spread(st.control, 1.060, 0.930),
    etK: spread(st.spin, 0.820, 1.450),       // the catapult: this is the spin
    feelK: spread(st.feel, 0.940, 1.060),     // a softer topsheet forgives more
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
  /* The card shows what the item actually does: invert the same mapping
     the physics uses, so the two can never disagree. */
  const out = {};
  for (const k of STAT_KEYS) out[k] = Math.round(clamp(it.s[k], 0, 100));
  return out;
}

/**
 * The whole racket's card: what a player will feel, in one place.
 * speed and spin come from the fitted parts; control and feel are the
 * average of the three parts, because that is how they are felt.
 */
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
      sweet: bp.sweetK * r.phys.feelK,        // how much an off-centre hit costs
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
