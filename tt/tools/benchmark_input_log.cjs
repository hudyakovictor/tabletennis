'use strict';
/* Benchmark the always-on input log through the real camera path.
 *
 *   node tt/tools/benchmark_input_log.cjs [--iterations 20000]
 *
 * benchmarkInputTelemetry builds a BROADCAST rigViewProj matrix and calls
 * Game.prototype.project twice per event (ball now and ball at p+v*dt).
 * Exit 1 if the real projection is unavailable, the call count is not
 * exactly two per event, or the mean cost reaches the 0.3 ms budget. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const iterations = Math.max(1, Math.floor(Number(option('--iterations', '20000')) || 20000));
const files = ['10_math.js', '12_match_rules.js', '25_career.js', '30_physics.js',
  '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js',
  '55_ai.js', '56_rig.js', '57_camera.js', '59_replay.js', '70_game.js', '80_ui.js'];
const saved = new Map();
const context = vm.createContext({ console, setInterval, clearInterval, URLSearchParams,
  localStorage: { getItem: k => saved.get(k) ?? null,
    setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } });
const source = files.map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const { benchmarkInputTelemetry } = vm.runInContext(
  source + '\n;({ benchmarkInputTelemetry })', context);

const result = benchmarkInputTelemetry(iterations);
console.log(JSON.stringify({ command: `node tt/tools/benchmark_input_log.cjs --iterations ${iterations}`,
  budgetMsPerEvent: .3, ...result }, null, 2));
if (result.error || result.projectionsPerEvent !== 2 || !(result.msPerEvent < .3)) process.exit(1);
