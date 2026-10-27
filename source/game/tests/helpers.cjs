const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function load(files, names, extra = {}) {
  if (!process.env.TT_TEST_REF && files.some(f => ['40_swipe.js', '56_rig.js', '70_game.js'].includes(f)) && !files.includes('38_paddle_motion.js')) {
    files = [...files];
    const index = files.findIndex(f => ['40_swipe.js', '56_rig.js', '70_game.js'].includes(f));
    files.splice(index, 0, '38_paddle_motion.js');
  }
  if (!process.env.TT_TEST_REF && files.some(f => ['60_scene.js', '70_game.js'].includes(f)) && !files.includes('62_arena.js')) {
    files = [...files]; files.splice(files.findIndex(f => ['60_scene.js', '70_game.js'].includes(f)), 0, '62_arena.js');
  }
  if (!process.env.TT_TEST_REF && files.includes('70_game.js') && !files.includes('61_particles.js')) {
    files = [...files]; files.splice(files.indexOf('70_game.js'), 0, '61_particles.js');
  }
  if (!process.env.TT_TEST_REF && files.some(f => ['65_train.js', '70_game.js', '80_ui.js', '90_boot.js', '92_embed.js'].includes(f)) && !files.includes('03_i18n.js')) {
    files = ['03_i18n.js', ...files];
  }
  if (!process.env.TT_TEST_REF && files.some(f => ['70_game.js', '80_ui.js'].includes(f)) && !files.includes('12_match_rules.js')) {
    files = [...files]; files.splice(Math.max(0, files.indexOf('10_math.js') + 1), 0, '12_match_rules.js');
  }
  if (!process.env.TT_TEST_REF && files.some(f => ['70_game.js', '80_ui.js'].includes(f)) && !files.includes('42_shot_diagnostics.js')) {
    files = [...files]; const index = files.findIndex(f => ['70_game.js', '80_ui.js'].includes(f));
    files.splice(index, 0, '42_shot_diagnostics.js');
  }
  if (!process.env.TT_TEST_REF && files.some(f => ['70_game.js', '80_ui.js'].includes(f)) && !files.includes('43_input_telemetry.js')) {
    files = [...files]; const index = files.findIndex(f => ['70_game.js', '80_ui.js'].includes(f));
    files.splice(index, 0, '43_input_telemetry.js');
  }
  const saved = new Map();
  const context = vm.createContext({ console, setInterval, clearInterval, URLSearchParams,
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
    ...extra });
  const source = files.map(f => process.env.TT_TEST_REF
    ? execFileSync('git', ['show', `${process.env.TT_TEST_REF}:tt/src/${f}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
  vm.runInContext(source + '\n;globalThis.api = {' + names.join(',') + '};', context);
  return { ...context.api, context, saved };
}
module.exports = { load, root };
