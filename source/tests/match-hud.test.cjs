const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');

const swipe = fs.readFileSync(path.join(__dirname, '../game/tt/src/40_swipe.js'), 'utf8');
const strokes = vm.runInNewContext('(' + swipe.match(/const STROKES = (\{[\s\S]*?\n\});/)[1] + ')');
const catalog = Object.values(strokes).map(({ id, col }) => ({ id, col }));
const captureDir = process.env.HUD_CAPTURE_DIR;
let browser;
after(async () => { if (browser) await browser.close(); });

async function setup(t, { width = 390, height = 844, reducedMotion = true } = {}) {
  browser ||= await launchBrowser();
  const fixture = await pageFixture(t, browser, [], { width, height, matchHUD: true });
  await fixture.page.evaluate(({ catalog, reducedMotion }) => {
    document.body.classList.remove('rm'); document.body.classList.add('in-game'); I18n.lang = 'ru';
    const screens = document.getElementById('screens'); screens.replaceChildren();
    const surface = document.createElement('div'); surface.id = 'hud-input-surface';
    surface.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:auto';
    document.getElementById('device').append(surface);
    const mx = document.createElement('div'); mx.className = 'mx live'; screens.append(mx);
    const slot = document.createElement('div'); slot.className = 'match-hud-slot'; mx.append(slot);
    const actions = document.createElement('div'); actions.className = 'match-actions pe'; mx.append(actions);
    fixture.actionClicks = 0; fixture.input = [];
    for (const [label, className] of [['Notices', 'notice-button'], ['Slow-Mo', 'ib m-slowmo'], ['Pause', 'ib m-pause']]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = className;
      button.setAttribute('aria-label', label); button.textContent = label[0];
      button.addEventListener('click', () => fixture.actionClicks++); actions.append(button);
    }
    for (const event of ['pointerdown', 'pointermove', 'pointerup']) surface.addEventListener(event, e => fixture.input.push(e.type));
    fixture.media = []; const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => { const media = matchMedia(query); fixture.media.push(media); return media; };
    fixture.animations = []; const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, timing) {
      const animation = animate.call(this, frames, timing), record = { node: this, frames, timing, animation, cancelled: 0 };
      const cancel = animation.cancel.bind(animation); animation.cancel = () => { record.cancelled++; cancel(); };
      fixture.animations.push(record); return animation;
    };
    fixture.makeSnapshot = (changes = {}) => ({ schema: 1, matchId: 'match-a', seq: 1, rallyId: 1,
      visible: true, free: false, staminaEnabled: true, phase: 'SERVE_READY', score: [0, 0], target: 11,
      server: 1, rally: 0, paused: false, matchPoint: 0,
      players: [{ side: 1, energy: 100, capacity: 100, fatigue: 0, limited: false }, { side: -1, energy: 100, capacity: 100, fatigue: 0, limited: false }],
      contacts: [null, null], whiffs: [null, null], event: { id: 1, type: 'serve', side: 1 }, result: null, ...changes });
    fixture.options = { t: (key, params) => I18n.t(key, params), strokeCatalog: catalog,
      names: ['Near Player', 'Far Player'], botLevel: 'Expert', reducedMotion,
      reason: (who, reason) => I18n.lang + ': ' + reason };
    fixture.latest = fixture.makeSnapshot(); fixture.hud = MatchHUD.mount(slot, fixture.options);
    fixture.hud.update(fixture.latest);
    fixture.send = (changes, options) => {
      fixture.latest = { ...fixture.latest, seq: fixture.latest.seq + 1, ...changes };
      fixture.hud.update(fixture.latest, options);
    };
    fixture.contact = (side, eventId, stroke = 'DRIVE', extra = {}) => ({ matchId: fixture.latest.matchId, eventId,
      rallyId: fixture.latest.rallyId, swingId: eventId, side, stroke, kmh: 57.8, rps: 34.2,
      quality: .97, energy: 85, capacity: 98, limited: false, ...extra });
    fixture.hit = (side, eventId, stroke = 'DRIVE') => {
      const contacts = fixture.latest.contacts.slice(); contacts[side === 1 ? 0 : 1] = fixture.contact(side, eventId, stroke);
      fixture.send({ phase: 'RALLY', contacts, event: { id: eventId, type: 'contact', side } });
    };
    fixture.energy = (energy, capacity = 70) => fixture.send({ players: [{ side: 1, energy, capacity, fatigue: 100 - capacity, limited: true }, fixture.latest.players[1]] });
    fixture.finish = () => fixture.hud.element.getAnimations({ subtree: true }).forEach(a => a.finish());
  }, { catalog, reducedMotion });
  await fixture.page.evaluate(async () => {
    await Promise.all(['900 28px Unb', '800 11px Man'].map(font => document.fonts.load(font)));
    await document.fonts.ready;
  });
  return fixture;
}

test('all real STROKES have authored, monochrome-distinct 24px silhouettes; auxiliary icons stay separate', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(async () => {
    const raster = [], geometry = [], bounds = [];
    for (const id of StrokeIcons.ids) {
      const svg = StrokeIcons.create(id); svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
      svg.style.cssText = 'color:#fff;--hud-ball:#fff';
      const paths = [...svg.querySelectorAll('path,circle')].map(el => [el.tagName, ...['d', 'cx', 'cy', 'r'].map(k => el.getAttribute(k))]);
      geometry.push(JSON.stringify(paths)); bounds.push(svg.getAttribute('viewBox'));
      const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg)); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 24, 24);
      const pixels = ctx.getImageData(0, 0, 24, 24).data;
      raster.push({ signature: canvas.toDataURL(), ink: [...pixels].filter((n, i) => i % 4 === 3 && n > 40).length });
    }
    return { ids: StrokeIcons.ids, auxiliary: StrokeIcons.auxiliaryIds, geometry, bounds,
      raster, unknown: ['NEXT_STROKE', '__proto__', 'constructor'].map(id => StrokeIcons.create(id).dataset.icon),
      motion: StrokeIcons.ids.map(id => StrokeIcons.motion(id).duration) };
  });
  assert.deepEqual(result.ids.slice().sort(), Object.keys(strokes).sort()); assert.equal(result.ids.length, 20);
  assert.equal(new Set(result.geometry).size, 20); assert.equal(new Set(result.raster.map(r => r.signature)).size, 20);
  assert.ok(result.raster.every(r => r.ink > 35 && r.ink < 310), 'every silhouette paints a readable, bounded amount of ink at 24px');
  assert.ok(result.bounds.every(box => box === '0 0 32 32'));
  assert.deepEqual(result.auxiliary, ['energy', 'whiff', 'net', 'out', 'point', 'matchPoint']);
  assert.ok(result.auxiliary.every(id => !result.ids.includes(id)));
  assert.deepEqual(result.unknown, ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.ok(result.motion.every(ms => ms >= 140 && ms <= 220)); assert.deepEqual(errors, []);
  if (captureDir) {
    await page.setViewport({ width: 920, height: 680 });
    await page.evaluate((catalog) => {
      const sheet = document.createElement('div'); sheet.className = 'match-hud';
      sheet.style.cssText = 'position:fixed;inset:12px;width:auto;height:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:18px;z-index:100';
      for (const { id, col } of catalog) {
        const cell = document.createElement('div'); cell.style.cssText = 'display:flex;align-items:center;gap:10px';
        for (const mono of [false, true]) {
          const svg = StrokeIcons.create(id); svg.style.cssText = 'width:24px;height:24px;flex:none;color:' + (mono ? '#fff;--hud-ball:#fff' : col); cell.append(svg);
        }
        const label = document.createElement('span'); label.textContent = id; cell.append(label); sheet.append(cell);
      }
      document.body.append(sheet);
    }, catalog);
    await page.screenshot({ path: path.join(captureDir, 'match-hud-icons.png') });
  }
});

test('both confirmed contacts use the external palette, literal safe text and real metrics without quality grading', async (t) => {
  const { page, errors } = await setup(t, { width: 1280, height: 800 });
  const result = await page.evaluate(() => {
    const malicious = '<img src=x onerror="window.hudInjected=1">';
    fixture.send({ score: [7, 7], target: 21, rally: 9 }, { names: [malicious, 'Far Player'] });
    fixture.hit(1, 2, 'DRIVE'); fixture.hit(-1, 3, 'CHOP'); fixture.finish();
    const el = fixture.hud.element;
    return { names: [...el.querySelectorAll('.match-hud-name')].map(n => n.textContent),
      active: el.dataset.activeSide, contacts: [...el.querySelectorAll('.match-hud-contact')].map(c => ({
        icon: c.querySelector('svg').dataset.icon, color: getComputedStyle(c.querySelector('.match-hud-technique')).color,
        iconColor: getComputedStyle(c.querySelector('svg')).color,
        opacity: getComputedStyle(c.querySelector('.match-hud-contact-copy')).opacity,
        metrics: c.querySelector('.match-hud-metrics').textContent })),
      score: [...el.querySelectorAll('.match-hud-score')].map(n => n.textContent), target: el.querySelector('.match-hud-target').textContent,
      rally: el.querySelector('.match-hud-rally').textContent, injected: !!window.hudInjected || !!el.querySelector('img,script'),
      hasQuality: /97%|quality|\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e/i.test(el.textContent),
      liveCount: el.querySelectorAll('[aria-live]').length };
  });
  const rgb = (hex) => 'rgb(' + hex.slice(1).match(/../g).map(s => parseInt(s, 16)).join(', ') + ')';
  assert.match(result.names[0], /^<img/); assert.equal(result.injected, false); assert.equal(result.hasQuality, false);
  assert.equal(result.active, '-1'); assert.deepEqual(result.score, ['7', '7']);
  assert.equal(result.target, '\u0414\u043e 21'); assert.equal(result.rally, '\u00d79');
  for (const [i, id] of ['DRIVE', 'CHOP'].entries()) {
    assert.equal(result.contacts[i].icon, id); assert.equal(result.contacts[i].color, rgb(strokes[id].col));
    assert.equal(result.contacts[i].iconColor, rgb(strokes[id].col));
    assert.equal(result.contacts[i].metrics, '58 \u043a\u043c/\u044734 \u043e\u0431/\u0441');
  }
  assert.equal(Number(result.contacts[0].opacity), .62); assert.equal(Number(result.contacts[1].opacity), 1);
  assert.equal(result.liveCount, 1); assert.deepEqual(errors, []);
});

test('serve-family compositions stay distinct and HOOK/FADE are never side-mirrored', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    fixture.hit(1, 2, 'HOOK'); fixture.hit(-1, 3, 'HOOK'); fixture.finish();
    const cells = [...fixture.hud.element.querySelectorAll('.match-hud-technique-icon svg')];
    const hooks = cells.map(svg => ({ geometry: svg.innerHTML, transform: getComputedStyle(svg).transform }));
    const serves = StrokeIcons.ids.filter(id => id.startsWith('SERVE_')).map(id => {
      const svg = StrokeIcons.create(id); return { id, toss: !!svg.querySelector('.stroke-icon-toss'), geometry: svg.innerHTML };
    });
    fixture.hit(-1, 4, 'FADE'); fixture.finish();
    return { hooks, serves, fade: fixture.hud.element.querySelectorAll('.match-hud-technique-icon svg')[1].innerHTML };
  });
  assert.equal(result.hooks[0].geometry, result.hooks[1].geometry);
  assert.ok(result.hooks.every(icon => icon.transform === 'none')); assert.notEqual(result.fade, result.hooks[0].geometry);
  assert.equal(result.serves.length, 5); assert.ok(result.serves.every(s => s.toss));
  assert.equal(new Set(result.serves.map(s => s.geometry)).size, 5); assert.deepEqual(errors, []);
});

test('energy ticks keep the mounted DOM and never replay hits, schedule work or force layout', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    fixture.hit(1, 2, 'LOOP');
    const el = fixture.hud.element, nodes = [...el.querySelectorAll('*')], count = fixture.animations.length;
    const saved = [window.setTimeout, window.setInterval, window.requestAnimationFrame, window.getComputedStyle, Element.prototype.getBoundingClientRect];
    const forbidden = () => { throw Error('HUD tick used a timer, RAF or layout read'); };
    window.setTimeout = window.setInterval = window.requestAnimationFrame = window.getComputedStyle = forbidden;
    Element.prototype.getBoundingClientRect = forbidden;
    let caught;
    try { for (let i = 0; i < 120; i++) fixture.energy(48 + i / 20); } catch (e) { caught = e.message; }
    [window.setTimeout, window.setInterval, window.requestAnimationFrame, window.getComputedStyle, Element.prototype.getBoundingClientRect] = saved;
    return { caught, same: nodes.every((node, i) => node === el.querySelectorAll('*')[i]),
      count: nodes.length, afterCount: el.querySelectorAll('*').length, animations: fixture.animations.length - count,
      contact: el.querySelector('.match-hud-contact').dataset.eventId, energy: el.querySelector('.match-hud-energy-value').textContent };
  });
  assert.equal(result.caught, undefined); assert.equal(result.same, true); assert.equal(result.afterCount, result.count);
  assert.equal(result.animations, 0); assert.equal(result.contact, '2'); assert.equal(result.energy, '54'); assert.deepEqual(errors, []);
  const source = fs.readFileSync(path.join(__dirname, '../src/ui/match_hud.js'), 'utf8');
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame|getBoundingClientRect|offsetWidth|clientWidth|getComputedStyle/);
  for (const { col } of catalog) assert.ok(!source.includes(col), 'the HUD must not copy the STROKES palette');
});

test('stale/equal snapshots ignore data but still refresh names, palette, locale and motion in place', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    fixture.hit(1, 2, 'DRIVE'); fixture.energy(48);
    const el = fixture.hud.element, icon = el.querySelector('.match-hud-technique-icon svg'), count = fixture.animations.length;
    I18n.lang = 'en';
    fixture.hud.update({ ...fixture.latest, seq: 1, score: [99, 99], contacts: [fixture.contact(1, 1, 'SMASH'), null] }, { names: ['Renamed', 'Far Player'] });
    const stale = { stroke: el.querySelector('.match-hud-technique').textContent, energy: el.querySelector('.match-hud-energy-value').textContent,
      score: el.querySelector('.match-hud-score').textContent, name: el.querySelector('.match-hud-name').textContent };
    fixture.hud.update({ ...fixture.latest, score: [88, 88] }, { strokeCatalog: [{ id: 'DRIVE', col: '#123456' }] });
    const equal = { score: el.querySelector('.match-hud-score').textContent, color: getComputedStyle(el.querySelector('.match-hud-technique')).color };
    const reused = fixture.latest; reused.seq++; reused.players[0].energy = 44; fixture.hud.update(reused);
    return { stale, equal, sameIcon: icon === el.querySelector('.match-hud-technique-icon svg'),
      replayed: fixture.animations.length - count, reusedEnergy: el.querySelector('.match-hud-energy-value').textContent,
      meter: el.querySelector('[role=meter]').getAttribute('aria-valuetext') };
  });
  assert.deepEqual(result.stale, { stroke: 'Drive', energy: '48', score: '0', name: 'Renamed' });
  assert.deepEqual(result.equal, { score: '0', color: 'rgb(18, 52, 86)' });
  assert.equal(result.sameIcon, true); assert.equal(result.replayed, 0); assert.equal(result.reusedEnergy, '44');
  assert.equal(result.meter, '44 of 100; available maximum 70'); assert.deepEqual(errors, []);
});

test('point status stays in compact meta without replacing last contacts; old records never resurrect across rally/match/recovery', async (t) => {
  const { page, errors } = await setup(t, { reducedMotion: false });
  const result = await page.evaluate(() => {
    fixture.hit(1, 2, 'DRIVE'); fixture.hit(-1, 3, 'BLOCK'); fixture.energy(48);
    const el = fixture.hud.element, head = el.querySelector('.match-hud-head'), meter = el.querySelector('[role=meter]'), height = el.getBoundingClientRect().height;
    fixture.send({ phase: 'POINT', score: [1, 0], result: { id: 4, who: 1, reason: 'NET <img src=x>', winner: 0 }, event: { id: 4, type: 'point', side: 1 } });
    const resultAnimation = fixture.animations.findLast(r => r.node.classList.contains('match-hud-result'));
    fixture.energy(49); I18n.lang = 'en'; fixture.hud.update(fixture.latest);
    const point = { shown: !el.querySelector('.match-hud-result').hidden, inside: !!head.querySelector('.match-hud-meta > .match-hud-result'),
      reason: el.querySelector('.match-hud-result-reason').textContent, unsafe: !!el.querySelector('img'),
      title: el.querySelector('.match-hud-result').title, energy: meter.getAttribute('aria-valuenow'),
      contacts: [...el.querySelectorAll('.match-hud-contact')].map(c => c.dataset.eventId), sameHeight: el.getBoundingClientRect().height === height };
    fixture.send({ phase: 'SERVE_READY', event: { id: 5, type: 'serve', side: -1 }, server: -1 });
    const cleared = { result: el.querySelector('.match-hud-result').hidden, contacts: [...el.querySelectorAll('.match-hud-contact')].map(c => c.dataset.eventId),
      score: el.querySelector('.match-hud-score').textContent, energy: meter.getAttribute('aria-valuenow'), canceled: resultAnimation.cancelled > 0 };
    fixture.send({ phase: 'RALLY' });
    const noResurrection = [...el.querySelectorAll('.match-hud-contact')].every(c => !c.dataset.eventId);
    fixture.send({ rallyId: 2, contacts: [fixture.contact(1, 6, 'LOOP', { rallyId: 1 }), fixture.contact(-1, 7, 'PUSH', { rallyId: 2 })], result: null });
    const rally = [...el.querySelectorAll('.match-hud-contact')].map(c => c.dataset.eventId);
    const old = structuredClone(fixture.latest);
    fixture.hud.update({ ...old, seq: old.seq + 1, visible: false }); fixture.hud.update({ ...old, seq: old.seq + 2 });
    const recovery = { energy: meter.getAttribute('aria-valuenow'), same: head === el.querySelector('.match-hud-head') && meter === el.querySelector('[role=meter]') };
    fixture.hud.update(fixture.makeSnapshot({ matchId: 'match-b', contacts: old.contacts }));
    fixture.hud.update({ ...old, seq: 999 });
    return { point, cleared, noResurrection, rally, recovery, match: el.dataset.matchId,
      finalScore: el.querySelector('.match-hud-score').textContent, finalContacts: [...el.querySelectorAll('.match-hud-contact')].map(c => c.dataset.eventId) };
  });
  assert.deepEqual(result.point, { shown: true, inside: true, reason: 'Net', unsafe: false, title: 'en: NET <img src=x>', energy: '49', contacts: ['2', '3'], sameHeight: true });
  assert.deepEqual(result.cleared, { result: true, contacts: ['', ''], score: '1', energy: '49', canceled: true });
  assert.equal(result.noResurrection, true); assert.deepEqual(result.rally, ['', '7']);
  assert.deepEqual(result.recovery, { energy: '49', same: true }); assert.equal(result.match, 'match-b');
  assert.equal(result.finalScore, '0'); assert.deepEqual(result.finalContacts, ['', '']); assert.deepEqual(errors, []);
});

test('absolute 0..100 meters expose capacity, blocked fatigue and exact low-energy hysteresis', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    I18n.lang = 'en'; fixture.energy(48, 70); fixture.finish();
    const el = fixture.hud.element, meter = el.querySelector('[role=meter]');
    const sample = { min: meter.getAttribute('aria-valuemin'), max: meter.getAttribute('aria-valuemax'), now: meter.getAttribute('aria-valuenow'),
      description: meter.getAttribute('aria-valuetext'), fill: meter.querySelector('.match-hud-energy-fill').style.transform,
      fatigue: meter.querySelector('.match-hud-energy-fatigue').style.transform, label: el.querySelector('.match-hud-energy-value').textContent };
    const warnings = [], announcements = [];
    for (const energy of [25, 24.9, 27, 30, 30.01, 25, 24.99, 0]) {
      fixture.energy(energy, 55); warnings.push(!el.querySelector('.match-hud-low').hidden);
      announcements.push(el.querySelector('[aria-live]').textContent);
    }
    fixture.energy(NaN, Infinity);
    const invalid = { now: meter.getAttribute('aria-valuenow'), description: meter.getAttribute('aria-valuetext') };
    return { sample, warnings, announcements, invalid };
  });
  assert.deepEqual(result.sample, { min: '0', max: '100', now: '48', description: '48 of 100; available maximum 70', fill: 'scaleX(0.48)', fatigue: 'scaleX(0.3)', label: '48' });
  assert.deepEqual(result.warnings, [false, true, true, true, false, false, true, true]);
  assert.ok(result.announcements[1].includes('low energy'));
  assert.equal(result.announcements[1], result.announcements[2]); assert.equal(result.announcements[1], result.announcements[3]);
  assert.equal(result.invalid.now, '0'); assert.doesNotMatch(result.invalid.description, /NaN|Infinity/); assert.deepEqual(errors, []);
});

test('a restored serve tombstones cached hit, miss and result IDs before the next rally or locale refresh', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    fixture.hud.dispose(); fixture.hud = MatchHUD.mount(document.querySelector('.match-hud-slot'), fixture.options);
    const contact = fixture.contact(1, 2, 'SMASH');
    fixture.latest = fixture.makeSnapshot({ seq: 10, event: { id: 5, type: 'serve', side: 1 }, contacts: [contact, null],
      whiffs: [{ id: 3, swingId: 33 }, null], result: { id: 4, who: 1, reason: 'OUT', winner: 0 } });
    fixture.hud.update(fixture.latest); fixture.send({ phase: 'RALLY' }); I18n.lang = 'en'; fixture.hud.update(fixture.latest);
    const el = fixture.hud.element;
    const old = { contact: el.querySelector('.match-hud-contact').dataset.eventId,
      missed: !el.querySelector('.match-hud-whiff').hidden, result: !el.querySelector('.match-hud-result').hidden };
    fixture.hit(1, 6, 'BLOCK');
    return { old, newContact: el.querySelector('.match-hud-technique').textContent };
  });
  assert.deepEqual(result.old, { contact: '', missed: false, result: false }); assert.equal(result.newContact, 'Block'); assert.deepEqual(errors, []);
});

test('rapid successive points replace one score/status animation; a new serve cancels the compact status immediately', async (t) => {
  const { page, errors } = await setup(t, { reducedMotion: false });
  const result = await page.evaluate(() => {
    fixture.finish(); fixture.hit(1, 2, 'LOOP');
    fixture.send({ phase: 'POINT', score: [1, 0], result: { id: 3, who: 1, reason: 'OUT', winner: 0 }, event: { id: 3, type: 'point', side: 1 } });
    const first = fixture.animations.findLast(r => r.node.classList.contains('match-hud-result'));
    first.animation.pause(); first.animation.currentTime = 100;
    fixture.send({ score: [2, 0], result: { id: 4, who: 1, reason: 'NET', winner: 0 }, event: { id: 4, type: 'point', side: 1 } });
    const second = fixture.animations.findLast(r => r.node.classList.contains('match-hud-result'));
    const el = fixture.hud.element;
    const point = { score: el.querySelector('.match-hud-score').textContent, reason: el.querySelector('.match-hud-result-reason').textContent,
      oldIdle: first.animation.playState === 'idle', activeResults: fixture.animations.filter(r => r.node === first.node && r.animation.playState === 'running').length };
    fixture.send({ phase: 'SERVE_READY', event: { id: 5, type: 'serve', side: 1 }, result: null, contacts: [null, null] });
    return { point, resultHidden: el.querySelector('.match-hud-result').hidden, canceled: second.animation.playState === 'idle',
      score: el.querySelector('.match-hud-score').textContent, contacts: el.querySelectorAll('.match-hud-contact').length };
  });
  assert.deepEqual(result.point, { score: '2', reason: '\u0421\u0435\u0442\u043a\u0430', oldIdle: true, activeResults: 1 });
  assert.equal(result.resultHidden, true); assert.equal(result.canceled, true); assert.equal(result.score, '2'); assert.equal(result.contacts, 2); assert.deepEqual(errors, []);
});

test('whiffs do not change the confirmed technique or rally; no tick or hit is announced', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    I18n.lang = 'en'; fixture.hud.update(fixture.latest); const live = fixture.hud.element.querySelector('[aria-live]');
    const firstSpeech = live.textContent;
    fixture.hit(1, 2, 'PUSH'); fixture.send({ rally: 4 });
    fixture.send({ whiffs: [{ id: 3, swingId: 33 }, null], event: { id: 3, type: 'whiff', side: 1 } }); fixture.energy(48);
    const el = fixture.hud.element;
    const miss = { marker: !el.querySelector('.match-hud-whiff').hidden, stroke: el.querySelector('.match-hud-technique').textContent,
      event: el.querySelector('.match-hud-contact').dataset.eventId, rally: el.querySelector('.match-hud-rally').textContent,
      speech: live.textContent };
    fixture.hit(1, 4, 'BLOCK');
    const cleared = el.querySelector('.match-hud-whiff').hidden;
    fixture.send({ paused: true });
    return { firstSpeech, miss, cleared, paused: el.querySelector('.match-hud-marker-text').textContent, afterPause: live.textContent };
  });
  assert.deepEqual(result.miss, { marker: true, stroke: 'Push', event: '2', rally: '\u00d74', speech: result.firstSpeech });
  assert.equal(result.cleared, true); assert.equal(result.paused, 'Paused'); assert.equal(result.afterPause, result.firstSpeech); assert.deepEqual(errors, []);
});

test('free and unlimited modes do not invent scores or full meters; unknown techniques use key-only fallback', async (t) => {
  const { page, errors } = await setup(t);
  const result = await page.evaluate(() => {
    I18n.lang = 'en'; fixture.send({ free: true, staminaEnabled: false, score: [77, 88] }); fixture.hit(1, 2, 'UNRECOGNIZED');
    const el = fixture.hud.element;
    const free = { meters: el.querySelectorAll('[role=meter]').length, visibleScores: [...el.querySelectorAll('.match-hud-score-window')].filter(n => !n.hidden).length,
      unlimited: [...el.querySelectorAll('.match-hud-unlimited')].filter(n => !n.hidden).map(n => n.textContent),
      unknown: el.querySelector('.match-hud-technique').textContent, icon: el.querySelector('.match-hud-technique-icon svg').dataset.icon,
      low: [...el.querySelectorAll('.match-hud-low')].some(n => !n.hidden) };
    fixture.send({ free: false });
    const unlimitedScored = { meters: el.querySelectorAll('[role=meter]').length, score: el.querySelector('.match-hud-score-window').hidden };
    fixture.hud.update(fixture.latest, { t: null, names: [] });
    return { free, unlimitedScored, fallback: el.querySelector('.match-hud-technique').textContent, name: el.querySelector('.match-hud-name').textContent };
  });
  assert.deepEqual(result.free, { meters: 0, visibleScores: 0, unlimited: ['Unlimited', 'Unlimited'], unknown: 'Shot', icon: 'UNKNOWN', low: false });
  assert.deepEqual(result.unlimitedScored, { meters: 0, score: false }); assert.equal(result.fallback, 'hud.unknown');
  assert.equal(result.name, 'hud.near'); assert.deepEqual(errors, []);
});

for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844], [768, 1024], [1280, 480], [1280, 800]]) {
  test(`real match CSS, local fonts and 44px actions fit ${width}x${height} in RU/EN and pass input through`, async (t) => {
    const { page, errors } = await setup(t, { width, height });
    for (const lang of ['ru', 'en']) {
      const layout = await page.evaluate((lang) => {
        I18n.lang = lang;
        fixture.send({ score: [22, 21], target: 21, rally: 42, matchPoint: 1 },
          { names: ['\u041e\u0447\u0435\u043d\u044c \u0434\u043b\u0438\u043d\u043d\u043e\u0435 \u0438\u043c\u044f Near Player With A Long Surname', 'A Very Long Opponent Name \u0441 \u0444\u0430\u043c\u0438\u043b\u0438\u0435\u0439'], botLevel: 'Very long localized expert level' });
        fixture.hit(1, 50 + fixture.latest.seq, 'CHOP_BLOCK'); fixture.hit(-1, 100 + fixture.latest.seq, 'SERVE_NO_SPIN');
        fixture.energy(24, 55); fixture.finish();
        const el = fixture.hud.element, rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const hud = rect(el), buttons = [...document.querySelectorAll('.match-actions button')].map(rect);
        const primary = [...el.querySelectorAll('.match-hud-name,.match-hud-score,.match-hud-energy-value,.match-hud-technique')];
        const boxes = primary.map(n => ({ ...rect(n), size: parseFloat(getComputedStyle(n).fontSize), className: n.className }));
        const scores = [...el.querySelectorAll('.match-hud-score')].map(n => ({ text: rect(n), window: rect(n.parentElement) }));
        const probe = { x: hud.x + hud.width / 2, y: hud.y + hud.height / 2 };
        return { hud, buttons, boxes, scores, probe,
          icons: [...el.querySelectorAll('.match-hud-technique-icon')].map(rect), fonts: document.fonts.check('900 28px Unb') && document.fonts.check('800 11px Man'),
          through: document.elementFromPoint(probe.x, probe.y)?.id,
          overflow: document.documentElement.scrollWidth > innerWidth,
          metrics: getComputedStyle(el.querySelector('.match-hud-metrics')).display,
          cells: [...el.querySelectorAll('.match-hud-contact')].map(rect), hasLevel: !!el.querySelector('.match-hud-level') };
      }, lang);
      assert.equal(layout.hud.x, 12); assert.equal(layout.hud.y, 12);
      assert.equal(layout.hud.width, Math.min(352, width - 84)); assert.ok(layout.hud.height >= 60 && layout.hud.height <= 66);
      const previousArea = Math.min(400, width - 76) * (width <= 520 || height <= 640 ? 108 : 135);
      assert.ok(layout.hud.width * layout.hud.height <= previousArea * .6, 'only the upper-left score/energy/contact footprint is roughly halved');
      if (lang === 'en') t.diagnostic(`Measured HUD ${layout.hud.width}x${layout.hud.height}px with ${layout.buttons[0].width}x${layout.buttons[0].height}px actions`);
      assert.equal(layout.fonts, true, 'test measures the real local typefaces, not generic fallbacks'); assert.equal(layout.overflow, false);
      assert.ok(layout.buttons.every(b => b.width >= 44 && b.height >= 44));
      layout.buttons.forEach((b, i) => {
        assert.equal(b.width, 44); assert.equal(b.height, 44);
        assert.equal(b.x, width - 56 - (width <= 620 ? 0 : (2 - i) * 52));
        assert.equal(b.y, 12 + (width <= 620 ? i * 52 : 0));
      });
      assert.ok(layout.buttons.every(b => b.x >= layout.hud.right + 8 || b.y >= layout.hud.bottom + 8));
      assert.ok(layout.boxes.every(b => b.size >= 11 && b.x >= layout.hud.x && b.right <= layout.hud.right + .5), JSON.stringify(layout.boxes));
      assert.ok(layout.icons.every(b => b.width >= 24 && b.width <= 32 && b.height >= 24 && b.height <= 32));
      assert.ok(layout.scores.every(s => s.text.width <= s.window.width), 'two-digit scores must not clip inside their recessed windows');
      assert.equal(layout.through, 'hud-input-surface');
      assert.equal(layout.metrics, 'flex'); assert.equal(layout.cells.length, 2); assert.equal(layout.hasLevel, false);
      assert.ok(layout.cells.every(c => c.height >= 24 && c.height <= 28 && c.right <= layout.hud.right && c.bottom <= layout.hud.bottom));
      if (width <= 620) assert.ok(layout.buttons.every(b => b.x === layout.buttons[0].x));
      else assert.ok(layout.buttons.every(b => b.y === layout.buttons[0].y));
      if (lang === 'en') {
        await page.mouse.move(layout.probe.x - 20, layout.probe.y); await page.mouse.down();
        await page.mouse.move(layout.probe.x + 20, layout.probe.y + 20); await page.mouse.up();
        await page.click('.match-actions button');
      }
    }
    const input = await page.evaluate(() => ({ events: fixture.input, clicks: fixture.actionClicks }));
    assert.ok(input.events.includes('pointerdown') && input.events.includes('pointerup')); assert.equal(input.clicks, 1);
    if (captureDir) await page.screenshot({ path: path.join(captureDir, `match-hud-${width}.png`) });
    assert.deepEqual(errors, []);
  });
}

test('safe-area and Telegram offsets stay aligned with actions without counting the top inset twice', async (t) => {
  const { page, errors } = await setup(t, { width: 320, height: 568 });
  const result = await page.evaluate(() => {
    const css = document.documentElement.style;
    css.setProperty('--sat', '20px'); css.setProperty('--sab', '12px'); css.setProperty('--tgt', '0px'); css.setProperty('--tgb', '0px');
    const top = () => ({ hud: fixture.hud.element.getBoundingClientRect().top, actions: document.querySelector('.match-actions').getBoundingClientRect().top });
    fixture.finish(); const ordinary = top();
    document.body.classList.add('in-tg'); css.setProperty('--tgt', '50px'); css.setProperty('--tgb', '18px');
    return { ordinary, telegram: top(), height: fixture.hud.element.getBoundingClientRect().height };
  });
  assert.deepEqual(result.ordinary, { hud: 32, actions: 32 }); assert.deepEqual(result.telegram, { hud: 62, actions: 62 });
  assert.ok(result.height <= 66); assert.deepEqual(errors, []);
});

test('WAAPI is bounded, interruptible and inspectable mid-exchange at normal and quarter speed', async (t) => {
  const { page, errors } = await setup(t, { reducedMotion: false, width: 768, height: 1024 });
  const result = await page.evaluate(async () => {
    fixture.finish(); fixture.hit(1, 2, 'LOOP');
    const first = fixture.animations.findLast(r => r.node.classList.contains('stroke-icon-motion'));
    first.animation.pause(); first.animation.currentTime = first.timing.duration / 2;
    const middle = getComputedStyle(first.node).transform;
    const unchanged = [...fixture.hud.element.querySelectorAll('.match-hud-name,.match-hud-score,.match-hud-contact')].every(n => getComputedStyle(n).transform === 'none');
    fixture.hit(1, 3, 'LOOP'); const second = fixture.animations.findLast(r => r.node.classList.contains('stroke-icon-motion'));
    const canceled = first.animation.playState === 'idle' && first.cancelled === 1;
    second.animation.updatePlaybackRate(.25);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = second.animation.currentTime, wallStart = performance.now();
    await new Promise(resolve => setTimeout(resolve, 80));
    const advancement = second.animation.currentTime - before, elapsed = performance.now() - wallStart;
    fixture.hit(-1, 4, 'COUNTER');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const transitions = fixture.hud.element.getAnimations({ subtree: true }).filter(a => a.transitionProperty === 'opacity');
    transitions.forEach(a => { a.pause(); a.currentTime = 70; });
    const crossfade = [...fixture.hud.element.querySelectorAll('.match-hud-contact-copy')].map(n => Number(getComputedStyle(n).opacity));
    for (let i = 5; i <= 45; i++) fixture.hit(i % 2 ? 1 : -1, i, i % 2 ? 'LOOP' : 'COUNTER');
    const running = fixture.animations.filter(r => r.animation.playState === 'running' || r.animation.playState === 'paused');
    return { middle, unchanged, canceled, advancement, elapsed, crossfade, transitionCount: transitions.length,
      running: running.length, perNode: running.every((r, i) => running.findIndex(other => other.node === r.node) === i),
      last: fixture.hud.element.dataset.activeSide, records: fixture.hud.element.querySelectorAll('.match-hud-contact').length,
      duration: first.timing.duration, shift: Math.abs(new DOMMatrix(middle).m42) };
  });
  assert.notEqual(result.middle, 'none'); assert.equal(result.unchanged, true); assert.equal(result.canceled, true);
  assert.ok(result.advancement > 0 && result.advancement <= result.elapsed * .5 + 10, `quarter-speed advance: ${result.advancement}ms over ${result.elapsed}ms`);
  assert.ok(result.transitionCount >= 2); assert.ok(result.crossfade.every(n => n > .62 && n < 1), JSON.stringify(result.crossfade));
  assert.ok(result.running <= 4); assert.equal(result.perNode, true); assert.equal(result.records, 2);
  assert.equal(result.last, '1'); assert.equal(result.duration, 210); assert.ok(result.shift <= 4); assert.deepEqual(errors, []);
});

test('reduced-motion switches cancel movement/trails immediately; dispose removes media listeners and every animation', async (t) => {
  const { page, errors } = await setup(t, { reducedMotion: false });
  const toggled = await page.evaluate(() => {
    fixture.finish(); fixture.hit(1, 2, 'SMASH'); fixture.energy(45); fixture.hud.update(fixture.latest, { reducedMotion: true });
    const el = fixture.hud.element, stopped = fixture.animations.every(r => r.animation.playState === 'finished' || r.animation.playState === 'idle');
    fixture.hit(-1, 3, 'HOOK');
    const last = fixture.animations.findLast(r => r.node.classList.contains('stroke-icon-motion'));
    return { stopped, reduced: el.classList.contains('is-reduced'), onlyOpacity: last.frames.every(f => !f.transform), duration: last.timing.duration,
      trail: getComputedStyle(el.querySelector('.match-hud-energy-trail')).display,
      fillTransition: getComputedStyle(el.querySelector('.match-hud-energy-fill')).transitionDuration,
      mediaCount: fixture.listenerCount(fixture.media[0], 'change') };
  });
  assert.deepEqual(toggled, { stopped: true, reduced: true, onlyOpacity: true, duration: 80, trail: 'none', fillTransition: '0s', mediaCount: 1 });
  await page.evaluate(() => fixture.hud.update(fixture.latest, { reducedMotion: false }));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.waitForFunction(() => fixture.hud.element.classList.contains('is-reduced'));
  const disposed = await page.evaluate(() => {
    fixture.hit(1, 4, 'BANANA'); const el = fixture.hud.element; fixture.hud.dispose(); fixture.hud.dispose();
    const count = fixture.animations.length; fixture.hud.update(fixture.latest, { reducedMotion: false });
    fixture.media[0].dispatchEvent(new Event('change'));
    for (let i = 0; i < 5; i++) { const hud = MatchHUD.mount(document.querySelector('.match-hud-slot'), fixture.options); hud.update(fixture.makeSnapshot()); hud.dispose(); }
    return { connected: el.isConnected, sameCount: fixture.animations.length === count + 10,
      listeners: fixture.media.map(media => fixture.listenerCount(media, 'change')), roots: document.querySelectorAll('.match-hud').length,
      active: fixture.animations.filter(r => ['running', 'paused'].includes(r.animation.playState)).length };
  });
  assert.equal(disposed.connected, false); assert.equal(disposed.sameCount, true); assert.equal(disposed.roots, 0);
  assert.ok(disposed.listeners.every(n => n === 0)); assert.equal(disposed.active, 0); assert.deepEqual(errors, []);
});

// These tests exercise shell presentation without starting Chromium or the engine.
function presentationFixture() {
  const sizes = [];
  class TrackedSet extends Set { add(n) { super.add(n); sizes.push(this.size); return this; } }
  const context = vm.createContext({ Set: TrackedSet });
  for (const file of ['ui/stroke_icons.js', 'ui/match_hud.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  const summary = context.MatchHUD.createSummary();
  let snapshot = { schema: 1, matchId: 'presentation-match', seq: 0, rallyId: 1, phase: 'SERVE_READY', score: [0, 0],
    rally: 0, contacts: [null, null], event: { id: 1, type: 'serve', side: 1 } };
  const send = changes => { snapshot = { ...snapshot, seq: snapshot.seq + 1, ...changes }; return summary.accept(snapshot); };
  const hit = (side, stroke = 'DRIVE', kmh = 40, rps = 0) => {
    const id = snapshot.event.id + 1, contacts = snapshot.contacts.slice();
    contacts[side === 1 ? 0 : 1] = { matchId: snapshot.matchId, rallyId: snapshot.rallyId, side, eventId: id, stroke, kmh, rps };
    return send({ phase: 'RALLY', rally: snapshot.rally + 1, contacts, event: { id, type: 'hit', side } });
  };
  return { summary, send, hit, sizes, ids: context.StrokeIcons.ids, snapshot: () => snapshot };
}
const plainPresentation = n => JSON.parse(JSON.stringify(n));

test('presentation summary deduplicates accepted contacts and freezes exact per-side counts, speed and total spin', () => {
  const f = presentationFixture(); f.send(); f.hit(1); f.hit(-1, 'CHOP', 60, 12); f.hit(1, 'BLOCK', 20, 4);
  for (let i = 0; i < 20; i++) f.send();
  assert.equal(f.summary.accept({ ...f.snapshot(), seq: 1 }), false);
  assert.equal(f.summary.accept({ ...f.snapshot(), seq: 100, matchId: 'other-match' }), false);
  const end = { stats: { shots: 2 }, ai: { shots: 1 }, bestRally: 3 }, frozen = f.summary.freeze(end);
  assert.equal(frozen.coverage, 'complete'); assert.equal(frozen.bestRally, 3);
  assert.deepEqual(plainPresentation(frozen.players.map(p => ({ hits: p.hits, observed: p.observedHits, by: p.byStroke, speed: p.speed, spin: p.spin }))), [
    { hits: 2, observed: 2, by: { DRIVE: 1, BLOCK: 1 }, speed: { avg: 30, max: 40, samples: 2, coverage: 'complete' }, spin: { avg: 2, max: 4, samples: 2, coverage: 'complete' } },
    { hits: 1, observed: 1, by: { CHOP: 1 }, speed: { avg: 60, max: 60, samples: 1, coverage: 'complete' }, spin: { avg: 12, max: 12, samples: 1, coverage: 'complete' } }
  ]);
  end.stats.shots = 999; f.snapshot().contacts[0].kmh = 999;
  assert.equal(f.summary.accept({ ...f.snapshot(), seq: 999, phase: 'REPLAY' }), false);
  assert.equal(f.hit(-1, 'SMASH', 99, 99), false); f.summary.recover();
  assert.equal(f.summary.freeze({ stats: { shots: 999 } }), frozen);
  assert.ok(Object.isFrozen(frozen) && Object.isFrozen(frozen.players) && frozen.players.every(p => Object.isFrozen(p) && Object.isFrozen(p.byStroke) && Object.isFrozen(p.speed) && Object.isFrozen(p.spin)));
  assert.equal(frozen.players[0].speed.max, 40); assert.equal(frozen.recovered, false);
});

test('presentation recovery retains contacts, rejects cached replays and uses only observed metric denominators', () => {
  const f = presentationFixture(); f.send(); f.hit(1, 'SERVE_NO_SPIN', 20, 0); f.hit(-1, 'LOOP', 30, 10);
  f.summary.recover(); f.send({ visible: false }); f.send({ visible: true }); f.hit(1, 'BLOCK', 50, 6);
  const frozen = f.summary.freeze({ stats: { shots: 100, byStroke: { SMASH: 100 }, maxSpeed: 999, maxSpin: 999 }, ai: { shots: 1 }, bestRally: 8 });
  assert.equal(frozen.coverage, 'partial'); assert.equal(frozen.recovered, true);
  assert.equal(frozen.players[0].hits, 100); assert.equal(frozen.players[0].observedHits, 2);
  assert.deepEqual(plainPresentation(frozen.players[0].byStroke), { SERVE_NO_SPIN: 1, BLOCK: 1 });
  assert.equal(frozen.players[0].speed.avg, 35); assert.equal(frozen.players[0].speed.max, 50); assert.equal(frozen.players[0].speed.samples, 2);
  assert.equal(frozen.players[0].spin.avg, 3); assert.equal(frozen.players[0].spin.coverage, 'partial');
  assert.equal(frozen.bestRally, 8); assert.equal(frozen.bestRallyCoverage, 'partial');
});

test('presentation late mounts, event gaps, missing metrics and unknown strokes cannot become complete or zero-filled', () => {
  const f = presentationFixture(), contact = { matchId: 'presentation-match', rallyId: 1, eventId: 29, side: 1, stroke: '__proto__', kmh: 0, rps: -5 };
  f.send({ seq: 8, phase: 'RALLY', contacts: [contact, null], event: { id: 30, type: 'whiff', side: -1 } });
  const frozen = f.summary.freeze();
  assert.equal(frozen.coverage, 'partial'); assert.equal(frozen.players[0].hits, 1); assert.equal(frozen.players[1].hits, null);
  assert.deepEqual(plainPresentation(frozen.players[0].byStroke), { UNKNOWN: 1 });
  assert.equal(frozen.players[0].speed.avg, 0); assert.equal(frozen.players[0].speed.coverage, 'partial');
  assert.equal(frozen.players[0].spin.max, null); assert.equal(frozen.players[0].spin.coverage, 'missing');
  const gap = presentationFixture(); gap.send(); gap.send({ event: { id: 3, type: 'point', side: 1 } });
  assert.equal(gap.summary.freeze().coverage, 'partial');
  const missing = presentationFixture(); missing.send(); missing.send({ event: { id: 2, type: 'hit', side: -1 } });
  assert.equal(missing.summary.freeze().coverage, 'partial');
  const counter = presentationFixture(); counter.send(); counter.hit(1);
  assert.equal(counter.summary.freeze({ stats: { shots: 2 } }).coverage, 'partial', 'engine counters expose dropped coverage even with contiguous observed IDs');
});

test('presentation distinguishes a verified empty match from missing data and partial engine counter fallbacks', () => {
  const absent = presentationFixture().summary.freeze();
  assert.equal(absent.coverage, 'missing'); assert.equal(absent.bestRally, null);
  assert.ok(absent.players.every(p => p.hits === null && p.speed.max === null && p.spin.max === null));
  const empty = presentationFixture(); empty.send();
  const verified = empty.summary.freeze({ stats: { shots: 0 }, ai: { shots: 0 }, bestRally: 0 });
  assert.equal(verified.coverage, 'complete'); assert.equal(verified.bestRally, 0);
  assert.ok(verified.players.every(p => p.hits === 0 && p.coverage === 'complete' && p.strokeCoverage === 'complete' && p.speed.max === null));
  const fallback = presentationFixture().summary.freeze({ stats: { shots: 5, byStroke: { DRIVE: 5 }, maxSpeed: 60, maxSpin: 0 },
    ai: { shots: 4, byStroke: { BLOCK: 4 }, avgOut: 12, maxOut: 15 }, bestRally: 10 });
  assert.equal(fallback.coverage, 'partial'); assert.equal(fallback.players[0].hits, 5); assert.equal(fallback.players[1].hits, 4);
  assert.equal(fallback.players[0].speed.max, 60, 'player maxSpeed telemetry is already km/h');
  assert.equal(fallback.players[1].speed.max, 54, 'AI output telemetry is m/s');
  assert.ok(fallback.players.every(p => p.speed.avg === null && p.speed.samples === 0 && p.speed.coverage === 'partial'));
  assert.equal(fallback.players[0].spin.max, 0); assert.equal(fallback.players[0].spin.coverage, 'partial');
  assert.equal(fallback.players[1].spin.max, null);
  const zero = presentationFixture().summary.freeze({ stats: { shots: 0, maxSpeed: 0 } });
  assert.equal(zero.players[0].hits, 0); assert.equal(zero.players[0].coverage, 'partial'); assert.equal(zero.players[1].hits, null);
});

test('presentation stroke buckets and ID retention remain bounded across long matches and recovery', () => {
  const f = presentationFixture(); f.send();
  for (let i = 0; i < 600; i++) f.hit(i % 2 ? -1 : 1, f.ids[i % f.ids.length], 30, i % 5);
  const old = { matchId: 'presentation-match', rallyId: 1, eventId: 2, side: 1, stroke: 'SMASH', kmh: 999, rps: 999 };
  f.summary.recover(); f.send({ contacts: [old, f.snapshot().contacts[1]], event: { id: 602, type: 'serve', side: 1 }, phase: 'SERVE_READY' });
  const frozen = f.summary.freeze();
  assert.deepEqual(plainPresentation(frozen.players.map(p => p.observedHits)), [300, 300]);
  assert.ok(f.sizes.every(n => n <= 257), 'retains at most 256 IDs after each insertion');
  assert.ok(frozen.players.every(p => Object.keys(p.byStroke).length <= 20 && p.speed.max === 30 && p.spin.max === 4));
  const all = presentationFixture(); all.send();
  for (const id of all.ids) all.hit(1, id, 25, id === 'SERVE_NO_SPIN' ? 0 : 6);
  const by = all.summary.freeze().players[0].byStroke;
  assert.deepEqual(Object.keys(by), [...all.ids]); assert.ok(Object.values(by).every(n => n === 1));
});

for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844], [768, 1024], [1280, 480], [1280, 800]]) {
  test(`single-column report keeps one scroll region and a usable safe-area footer at ${width}x${height}`, async t => {
    browser ||= await launchBrowser();
    const { page, errors } = await pageFixture(t, browser, ['result'], { width, height, persisted: true, raw: { xp: 100, xpMax: 1800 } });
    await page.evaluate(async () => {
      const summary = MatchHUD.createSummary();
      let snapshot = { schema: 1, matchId: 'layout-report', seq: 1, rallyId: 1, phase: 'SERVE_READY', rally: 0,
        score: [0, 0], contacts: [null, null], event: { id: 1, type: 'serve', side: 1 } };
      summary.accept(snapshot);
      for (const stroke of StrokeIcons.ids) for (const side of [1, -1]) {
        const id = snapshot.event.id + 1, contacts = snapshot.contacts.slice();
        contacts[side === 1 ? 0 : 1] = { matchId: snapshot.matchId, rallyId: 1, eventId: id, side, stroke, kmh: side === 1 ? 40.5 : 30.2, rps: side === 1 ? 0 : 12 };
        snapshot = { ...snapshot, seq: snapshot.seq + 1, phase: 'RALLY', rally: snapshot.rally + 1, contacts, event: { id, type: 'hit', side } };
        summary.accept(snapshot);
      }
      fixture.names = ['Очень длинное имя <Player> With A Long Surname', 'An Entire Opponent Identity С Фамилией'];
      fixture.resultData = { win: true, me: 22, op: 20, opp: 0, names: fixture.names, stats: {},
        presentation: summary.freeze({ stats: { shots: 20 }, ai: { shots: 20 }, bestRally: 40 }),
        quests: [{ id: 'win1', t: 'Win one', claimed: false }],
        coach: { n: 40, hit: 30, side: 36, fwd: 150, back: 100, dots: [{ dx: 10, dy: -20, contact: true }] } };
      await fixture.Router.go('result', { data: fixture.resultData });
      await document.fonts.ready;
      fixture.awarded = JSON.stringify(S);
    });
    for (const lang of ['en', 'ru']) {
      const layout = await page.evaluate(lang => {
        I18n.lang = lang; fixture.Router.refreshLocale();
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const report = document.querySelector('.res-report'), scroll = document.querySelector('.res-scroll'), footer = document.querySelector('.res-btns');
        const buttons = [...footer.querySelectorAll('button')]; buttons[0].focus();
        return { device: rect(document.querySelector('#device')), report: rect(report), scroll: rect(scroll), footer: rect(footer), buttons: buttons.map(rect),
          scrollRegions: document.querySelectorAll('.res .scroll').length, strokes: document.querySelectorAll('.res-strokes tbody tr').length,
          names: [...document.querySelectorAll('.res-score .rs-p b')].map(n => n.textContent), score: document.querySelector('.rs-n').textContent,
          average: document.querySelector('[data-metric="speed-avg"]').textContent, zero: document.querySelector('[data-metric="spin-avg"]').textContent,
          focused: document.activeElement === buttons[0], hitTargets: buttons.map(button => { const r = button.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button; }),
          unchanged: JSON.stringify(S) === fixture.awarded, outcome: document.querySelector('.res-title').textContent,
          column: getComputedStyle(document.querySelector('.res')).flexDirection, reportMax: getComputedStyle(report).maxWidth,
          overflow: document.documentElement.scrollWidth > innerWidth || scroll.scrollWidth > scroll.clientWidth };
      }, lang);
      assert.equal(layout.column, 'column'); assert.equal(layout.reportMax, '460px'); assert.equal(layout.scrollRegions, 1);
      assert.equal(layout.strokes, 20); assert.deepEqual(layout.names, ['Очень длинное имя <Player> With A Long Surname', 'An Entire Opponent Identity С Фамилией']);
      assert.equal(layout.score, '22:20'); assert.equal(layout.average, lang === 'ru' ? '40,5' : '40.5'); assert.equal(layout.zero, '0');
      assert.equal(layout.outcome, lang === 'ru' ? 'Победа' : 'Victory'); assert.equal(layout.unchanged, true); assert.equal(layout.overflow, false);
      assert.equal(layout.focused, true); assert.ok(layout.hitTargets.every(Boolean)); assert.ok(layout.buttons.every(b => b.width >= 44 && b.height >= 48));
      assert.ok(layout.buttons[0].right + 12 <= layout.buttons[1].x + .5);
      assert.ok(layout.scroll.bottom <= layout.footer.y + .5 && layout.footer.bottom <= layout.device.bottom + .5);
      assert.ok(layout.report.width <= 460 && layout.report.x >= layout.device.x && layout.report.right <= layout.device.right);
      assert.ok(Math.abs((layout.report.x + layout.report.right) / 2 - (layout.device.x + layout.device.right) / 2) < 1, 'the existing device/frame policy centers the same column');
    }
    await page.focus('.res-analysis summary'); await page.keyboard.press('Enter');
    const expanded = await page.evaluate(() => {
      const scroll = document.querySelector('.res-scroll'), footer = document.querySelector('.res-btns');
      scroll.scrollTop = scroll.scrollHeight;
      const details = document.querySelector('.res-analysis'), a = details.getBoundingClientRect(), b = scroll.getBoundingClientRect(), f = footer.getBoundingClientRect();
      return { open: details.open, top: scroll.scrollTop, contentBottom: a.bottom, scrollBottom: b.bottom, footerTop: f.top };
    });
    assert.equal(expanded.open, true); assert.ok(expanded.top > 0); assert.ok(expanded.contentBottom <= expanded.scrollBottom && expanded.scrollBottom <= expanded.footerTop);
    const safe = await page.evaluate(() => {
      const css = document.documentElement.style, scroll = document.querySelector('.res-scroll'), footer = document.querySelector('.res-btns');
      const read = () => ({ top: getComputedStyle(scroll).paddingTop, bottom: getComputedStyle(footer).paddingBottom });
      css.setProperty('--sat', '20px'); css.setProperty('--sab', '12px'); css.setProperty('--tgt', '0px'); css.setProperty('--tgb', '0px');
      const ordinary = read(); document.body.classList.add('in-tg'); css.setProperty('--tgt', '50px'); css.setProperty('--tgb', '18px');
      return { ordinary, telegram: read(), buttons: [...footer.querySelectorAll('button')].every(button => button.getBoundingClientRect().bottom <= footer.getBoundingClientRect().bottom - 18) };
    });
    assert.deepEqual(safe.ordinary, { top: '34px', bottom: '24px' }); assert.deepEqual(safe.telegram, { top: '64px', bottom: '30px' });
    assert.equal(safe.buttons, true); assert.equal(await page.evaluate(() => fixture.resultData.applied), true); assert.deepEqual(errors, []);
  });
}
