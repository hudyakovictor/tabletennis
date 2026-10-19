/* Reproducible read-only physics bench. Artifacts belong in ignored test-results/. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const files = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js'];
const source = files.map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const api = vm.runInNewContext(source + '\n;({runShotCalibration, snapshot: new ShotJournal().exportData()})', { console });
(async () => {
  const args = process.argv.slice(2), arg = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
  for (let i = 0; i < args.length; i += 2) {
    if (!['--baseline', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Use --baseline PATH and/or --output PATH.');
  }
  const output = path.resolve(root, arg('--output') || 'test-results/calibration.json');
  const baselinePath = arg('--baseline') && path.resolve(root, arg('--baseline'));
  if (baselinePath === output) throw Error('Baseline and output must be different files; refusing to overwrite baseline.');
  const baseline = baselinePath ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const report = await api.runShotCalibration();
  const data = { ...api.snapshot, calibration: report };
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
  console.log(`${report.legal}/${report.total} legal returns; ${report.invariantFailures} invariant failures.\n${output}`);
  for (const r of report.results.filter(r => !r.legal)) console.log(`  INVESTIGATE ${r.grip}/${r.hand}/${r.forehand ? 'FH' : 'BH'} y=${r.y} z=${r.z} dy=${r.dy}: ${r.hitNet ? 'net' : 'out'}`);
  if (baseline) {
    if (JSON.stringify(baseline.calibration) !== JSON.stringify(report)) {
      console.error('Calibration differs from baseline. Inspect individual cases; do not silently accept a new score.'); process.exitCode = 1;
    } else console.log('Exact baseline match.');
  }
  if (report.invariantFailures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
