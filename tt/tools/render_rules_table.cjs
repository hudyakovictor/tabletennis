'use strict';
/* Render the MATCH_RULES table into the marked documentation blocks.
 *
 *   node tt/tools/render_rules_table.cjs          rewrite README + docs
 *   node tt/tools/render_rules_table.cjs --check  exit 1 if stale
 *   node tt/tools/render_rules_table.cjs --stdout print the generated block
 *
 * The numeric contract has exactly one source: tt/src/12_match_rules.js.
 * Documentation prose should name parameters; values live in this block. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = ['10_math.js', '12_match_rules.js']
  .map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const { MATCH_RULES, PRESS_REJECTION_REASONS } = vm.runInNewContext(
  source + '\n;({ MATCH_RULES, PRESS_REJECTION_REASONS })', { console });

const fmt = (v) => {
  if (typeof v === 'number') return String(+v.toFixed(6)).replace('.', ',');
  return String(v);
};
const rows = [
  ['version', fmt(MATCH_RULES.version), 'версия контракта правил'],
  ['zoneShape', `\`${MATCH_RULES.zoneShape}\``, 'активная форма зоны нажатия'],
  ['pressRadiusPx', `${fmt(MATCH_RULES.pressRadiusPx)} CSS px`, 'legacy-круг только для A/B-сравнения'],
  ['ovalLeadSec', `${fmt(MATCH_RULES.ovalLeadSec)} с`, 'опережение по экранной скорости'],
  ['ovalForwardPx', `${fmt(MATCH_RULES.ovalForwardPx)} CSS px`, 'фиксированная добавка вперёд'],
  ['ovalForwardMaxPx', `${fmt(MATCH_RULES.ovalForwardMaxPx)} CSS px`, 'жёсткий потолок передней полуоси'],
  ['ovalBackPx', `${fmt(MATCH_RULES.ovalBackPx)} CSS px`, 'допуск позади мяча'],
  ['ovalSideMousePx', `${fmt(MATCH_RULES.ovalSideMousePx)} CSS px`, 'поперечный допуск мыши'],
  ['ovalSideTouchPx', `${fmt(MATCH_RULES.ovalSideTouchPx)} CSS px`, 'поперечный допуск касания/пера'],
  ['ovalMinSpeedPx', `${fmt(MATCH_RULES.ovalMinSpeedPx)} px/s`, 'ниже — круг и опорная ось к ракетке'],
  ['ovalFullSpeedPx', `${fmt(MATCH_RULES.ovalFullSpeedPx)} px/s`, 'выше — полный овал; между порогами smoothstep'],
  ['ovalSampleDtSec', `${fmt(MATCH_RULES.ovalSampleDtSec)} с`, 'интервал двух проекций экранной скорости'],
  ['serveTossMinRise', `${fmt(MATCH_RULES.serveTossMinRise)} м`, 'минимальный подъём подброса от выпуска'],
  ['captureRadius', `${fmt(MATCH_RULES.captureRadius)} м`, 'физический поперечный захват приёма'],
  ['depthTolerance', `${fmt(MATCH_RULES.depthTolerance)} м`, 'физический допуск глубины приёма'],
  ['serveCaptureRadius', `${fmt(MATCH_RULES.serveCaptureRadius)} м`, 'физическая сфера падающего подброса'],
  ['sweetRadius', `${fmt(MATCH_RULES.sweetRadius)} м`, 'эталон качества контакта, не граница захвата'],
  ['trajectoryAssist', fmt(MATCH_RULES.trajectoryAssist), 'общая помощь траектории'],
  ['positionAssist', fmt(MATCH_RULES.positionAssist), 'общая помощь позиции'],
  ['sensitivity', fmt(MATCH_RULES.sensitivity), 'нормализованная чувствительность контракта'],
];
const table = [
  '| Параметр `MATCH_RULES` | Значение | Смысл |',
  '|---|---:|---|',
  ...rows.map(([name, value, meaning]) => `| \`${name}\` | ${value} | ${meaning} |`),
  '',
  `Коды отказа: ${PRESS_REJECTION_REASONS.map(r => `\`${r}\``).join(', ')}.`,
].join('\n');

const BEGIN = '<!-- BEGIN GENERATED MATCH_RULES: tt/tools/render_rules_table.cjs -->';
const END = '<!-- END GENERATED MATCH_RULES -->';
const block = `${BEGIN}\n${table}\n${END}`;
if (process.argv.includes('--stdout')) {
  console.log(block);
  process.exit(0);
}

const targets = ['README.md', 'docs/shot-diagnostics.ru.md', 'docs/control-indicators-100.ru.md'];
const check = process.argv.includes('--check');
let stale = 0;
for (const rel of targets) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(BEGIN), end = text.indexOf(END);
  if (start < 0 || end < start) throw Error(`${rel}: generated MATCH_RULES markers not found`);
  const next = text.slice(0, start) + block + text.slice(end + END.length);
  if (next !== text) {
    stale++;
    if (check) console.error(`${rel}: MATCH_RULES table is stale; run npm run docs:rules`);
    else fs.writeFileSync(file, next);
  }
}
if (check && stale) process.exit(1);
console.log(check ? 'MATCH_RULES documentation tables are current' : `Rendered MATCH_RULES table into ${targets.length} files`);
