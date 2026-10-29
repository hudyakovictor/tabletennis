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
/* The repository keeps exactly ONE built HTML: <repo>/play/index.html (the
 * shell build). The standalone engine page it used to ship alongside is a dev
 * artifact now: it is built on demand into <repo>/build/engine.html (git-
 * ignored) and rebuilt whenever a source file is newer than it. Browser tests
 * ask for it here instead of hard-coding a path that no longer exists. */
const repo = path.resolve(root, '../..');
const ENGINE_BUILD = path.join(repo, 'build', 'engine.html');
function newestSourceTime(dir) {
  let newest = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name), st = fs.statSync(p);
    newest = Math.max(newest, st.isDirectory() ? newestSourceTime(p) : st.mtimeMs);
  }
  return newest;
}
let engineBuilt = null;
function enginePage() {
  if (engineBuilt) return engineBuilt;
  const ttDir = path.join(root, 'tt');
  const newest = Math.max(newestSourceTime(path.join(ttDir, 'src')),
    newestSourceTime(path.join(ttDir, 'assets')), fs.statSync(path.join(ttDir, 'build.py')).mtimeMs);
  const fresh = fs.existsSync(ENGINE_BUILD) && fs.statSync(ENGINE_BUILD).mtimeMs >= newest;
  if (!fresh) {
    execFileSync('python3', [path.join(root, 'tt', 'build.py'), ENGINE_BUILD],
      { env: { ...process.env, TT_NO_LOGO: '1' }, stdio: 'inherit' });
  }
  return (engineBuilt = ENGINE_BUILD);
}
module.exports = { load, root, repo, enginePage, ENGINE_BUILD };
