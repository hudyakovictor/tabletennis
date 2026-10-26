/* Physics bench: canonical strokes through the game's own integrator, legacy vs measured aero.
 * node tools/phys/physbench.cjs [legacy|measured|both] */
const path = require('path'), fs = require('fs'), vm = require('vm');
/* kick % = horizontal speed gained/lost off the table for a standard arrival (8 m/s, 18° down);
 * "ref kick" = Nakashima/Sony model with measured mu .25 — the game deliberately runs mu .40 (see PH.MU_TABLE). */
const SRC = path.resolve(__dirname, '../../game/tt/src');
function load(model) {
  const ctx = vm.createContext({ console, Math });
  const src = ['10_math.js', '30_physics.js'].map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  vm.runInContext(src + `\n;globalThis.api = { PH, V3, predict, aeroAccel, bounceTable, integrateBall };`, ctx);
  if (model && ctx.api.PH.AERO_MODEL !== undefined) ctx.api.PH.AERO_MODEL = model;
  return ctx.api;
}
const DEG = Math.PI / 180;
// ball leaves the player's bat at (0, table+0.20, +1.55) towards -z; spin in rad/s, + = topspin (dips)
const SHOTS = [
  { id: 'drive', ru: 'накат', v: 12, el: 9, spin: 300 },
  { id: 'loop', ru: 'топспин', v: 10, el: 16, spin: 650 },
  { id: 'loop_fast', ru: 'быстрый топспин', v: 15, el: 8, spin: 800 },
  { id: 'push', ru: 'подрезка', v: 5, el: 20, spin: -250 },
  { id: 'chop', ru: 'чоп (дальний)', v: 7.5, el: 15, spin: -500, z: 2.6, y: .25 },
  { id: 'smash', ru: 'смеш', v: 22, el: -6, spin: 100, y: .55 },
  { id: 'lob', ru: 'свеча', v: 7.5, el: 42, spin: 400, z: 2.8, y: .1 },
  { id: 'flat', ru: 'без вращения', v: 9, el: 10, spin: 0 },
];
function run(api, s) {
  const { PH, V3, predict } = api;
  const p = V3.new(0, PH.TABLE_Y + (s.y ?? .20), s.z ?? 1.55);
  const v = V3.new(0, s.v * Math.sin(s.el * DEG), -s.v * Math.cos(s.el * DEG));
  // topspin for a ball flying to -z: ω along -x (ω × v points down)
  const w = V3.new(-s.spin, 0, 0);
  const o = predict(p, v, w, { dt: 1 / 600, maxT: 3, out: {} });
  const r = { landZ: o.landed ? +o.landed.z.toFixed(2) : null, t1: o.landed ? +o.landed.t.toFixed(3) : null,
    apex: +((o.apex - PH.TABLE_Y) * 100).toFixed(1), clear: +(o.clear * 100).toFixed(1), net: o.hitNet };
  if (o.landed && o.b2) r.b2Z = +o.b2.z.toFixed(2);
  // bounce response from a standardised arrival: 8 m/s at 18° down with the shot's spin
  const bv = V3.new(0, -8 * Math.sin(18 * DEG), -8 * Math.cos(18 * DEG)), bw = V3.new(-s.spin, 0, 0), bp = V3.new(0, PH.TABLE_Y + PH.R, -.6);
  const vh0 = Math.abs(bv.z); api.bounceTable(bp, bv, bw);
  r.kick = +((Math.abs(bv.z) / vh0 - 1) * 100).toFixed(1);   // % horizontal speed gained (+) / lost (-) off the table
  r.outDeg = +(Math.atan2(bv.y, Math.abs(bv.z)) / DEG).toFixed(1);
  // reference: Nakashima point-contact model as used by Sony AI (mu .25, kappa 3/2, e = .98 + .02 vz)
  const vz = -8 * Math.cos(18 * DEG), vy = -8 * Math.sin(18 * DEG), slip = vz + PH.R * s.spin;
  const al = Math.min(.4, .25 * (1 + .98 + .02 * vy) * Math.abs(vy) / Math.max(Math.abs(slip), 1e-6));
  r.kickNakashima = +(((vz - al * slip) / vz - 1) * 100).toFixed(1);
  return r;
}
function drop(api) { // ITTF: 30.5 cm drop must rebound 23-26 cm
  const { PH, V3 } = api; const p = V3.new(0, PH.TABLE_Y + PH.R + .305, 0), v = V3.new(), w = V3.new();
  let up = false, top = 0; for (let i = 0; i < 2400; i++) { api.integrateBall(p, v, w, 1 / 1200);
    if (!up && p.y - PH.R <= PH.TABLE_Y) { p.y = PH.TABLE_Y + PH.R; api.bounceTable(p, v, w); up = true; }
    if (up) { top = Math.max(top, p.y - PH.R - PH.TABLE_Y); if (v.y < 0) break; } }
  return +(top * 100).toFixed(1);
}
function terminal(api) { const { V3 } = api; const p = V3.new(0, 100, 0), v = V3.new(), w = V3.new(); for (let i = 0; i < 6000; i++) api.integrateBall(p, v, w, 1 / 600); return +(-v.y).toFixed(2); }
const mode = process.argv[2] || 'both';
const models = mode === 'both' ? ['legacy', 'measured'] : [mode];
const res = {};
for (const m of models) {
  const api = load(m); res[m] = { model: api.PH.AERO_MODEL || 'legacy', drop_cm: drop(api), terminal_ms: terminal(api) };
  for (const s of SHOTS) res[m][s.id] = run(api, s);
}
const out = [];
out.push(`drop 30.5 cm → rebound (ITTF 23–26):  ` + models.map((m) => `${m} ${res[m].drop_cm}`).join(' | '));
out.push(`terminal velocity m/s (measured Cd .55 → 8.0):  ` + models.map((m) => `${m} ${res[m].terminal_ms}`).join(' | '));
out.push('shot'.padEnd(26) + models.map((m) => `${m}: land z / t1 s / apex cm / net clear cm / kick % / out°`.padEnd(64)).join(''));
for (const s of SHOTS) out.push((s.ru + ` ${s.v}м/с ${s.spin}рад/с`).padEnd(26) + models.map((m) => { const r = res[m][s.id];
  return `${r.net ? 'NET' : r.landZ ?? 'long'} / ${r.t1 ?? '-'} / ${r.apex} / ${r.clear} / ${r.kick} / ${r.outDeg}`.padEnd(64); }).join('') + `ref kick ${res[models[0]][s.id].kickNakashima}%`);
console.log(out.join('\n'));
if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(res, null, 1));
