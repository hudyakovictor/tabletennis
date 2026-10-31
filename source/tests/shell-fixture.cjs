/* Isolated shell sources in real Chromium; no engine build or network service. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const gameRequire = createRequire(path.join(__dirname, '../game/package.json'));
const puppeteer = gameRequire('puppeteer-core');
const read = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

async function launchBrowser() {
  const executablePath = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await gameRequire('@sparticuz/chromium').executablePath());
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
}

async function pageFixture(t, browser, screens = [], { width = 390, height = 844, main = false } = {}) {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.setViewport({ width, height });
  await page.setRequestInterception(true); page.on('request', (request) => request.abort());
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const stubs = `
    const trace = { saves: [], host: [], audio: [], fx: [], demos: 0, destroyed: 0, grants: 0 };
    const S = { name: 'Test Player', nick: '@test', club: 'Club', rating: 1000, level: 1, coins: 1000, gems: 250, passSeason: 4, passLvl: 20, passXp: 0, premium: true, claimed: { f: [], p: [] }, owned: ['r-teal', 'b-ink', 't-coral'], equipped: { rubber: 'r-teal', blade: 'b-ink', trail: 't-coral' }, rewardReceipts: [], chests: [null,null,null,null], quality: 'low', rm: true, vibro: false, diff: 1, lang: null, sfx: true };
    const saveNow = () => trace.saves.push(JSON.parse(JSON.stringify(S))); const save = saveNow;
    const Sfx = new Proxy({}, { get: (_, key) => () => trace.audio.push(key) });
    const Art = new Proxy({ CHEST: { wood: { rar: 'common' }, silver: { rar: 'rare' }, gold: { rar: 'epic' }, epic: { rar: 'leg' } }, chestName: (kind) => kind }, { get: (obj, key) => obj[key] || (() => '<span aria-hidden="true" data-art="' + key + '"></span>') });
    const FX = new Proxy({ pt: (el) => { if (!el) throw Error('missing FX anchor'); return {x:0,y:0}; }, fly: () => Promise.resolve(), init() {}, resize() {} }, { get: (obj, key) => obj[key] || (() => trace.fx.push(key)) });
    const TGX = { inTG: false, w: null, init() {}, load: () => Promise.resolve(false), dispose() {}, back() {}, fullscreen() {}, guard() {} };
    const haptic = () => {}, setQuality = () => {}, openSettings = () => {};
    const BG = { init() {}, resize() {}, mood() {} }, Dev = { mark() {}, build() {} };
    const ILL = {}, ItemArt = { of: (it) => Art.rubber(it.col) };
    const Daily = { ready: () => 0, items: () => [] };
    const Api = { enabled: false };
    const Progress = { board: null, boardSubs: [], reconcileSeason() {}, watchSeason() {}, boot() {}, leaderboard: async () => null, onBoard(fn) { this.boardSubs.push(fn); return () => { this.boardSubs = this.boardSubs.filter((x) => x !== fn); }; } };
    const GameHost = { ready: true, ensure: () => trace.host.push('ensure'), send: (cmd) => trace.host.push(cmd), show: (on) => trace.host.push(on ? 'show' : 'hide') };
    const TT = { Game: class { constructor() { trace.demos++; this.dead = false; } serve() { trace.host.push('demo-serve'); } destroy() { if (!this.dead) trace.destroyed++; this.dead = true; } } };
    const PEOPLE = [{n:'One Player',s:'One Player',r:1200,club:'Club',wr:50,c:['#fff','#ccc']}, {n:'Two Player',s:'Two Player',r:1100,club:'Club',wr:50,c:['#fff','#ccc']}, {n:'Three Player',s:'Three Player',r:1050,club:'Club',wr:50,c:['#fff','#ccc']}, {n:'Four Player',s:'Four Player',r:950,club:'Club',wr:50,c:['#fff','#ccc']}, {n:'Five Player',s:'Five Player',r:900,club:'Club',wr:50,c:['#fff','#ccc']}, {n:'Six Player',s:'Six Player',r:850,club:'Club',wr:50,c:['#fff','#ccc']}];
    const leagueOf = () => ({id:'bronze',min:0}), nextLeague = () => null, leagueName = () => 'Bronze';
    const MM_POOL = { bronze: [0] }; let BATTLE = {opp:0};
    Date.now = () => Date.parse('2026-10-20T00:00:00Z');
    const listenerRecords = new WeakMap(), addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;
    const listenerKey = (event, options) => event + ':' + !!(typeof options === 'boolean' ? options : options && options.capture);
    EventTarget.prototype.addEventListener = function(event, fn, options) { const map = listenerRecords.get(this) || new Map(), key = listenerKey(event,options), set = map.get(key) || new Set(); set.add(fn); map.set(key,set); listenerRecords.set(this,map); return addListener.call(this,event,fn,options); };
    EventTarget.prototype.removeEventListener = function(event, fn, options) { const map = listenerRecords.get(this); if (map) map.get(listenerKey(event,options))?.delete(fn); return removeListener.call(this,event,fn,options); };
    window.fixture = { S, trace, listenerCount: (target,event,capture=false) => listenerRecords.get(target)?.get(event + ':' + capture)?.size || 0 };
  `;
  const modules = ['core/util.js', 'core/i18n.js', 'locales/ru.js', 'locales/en.js', 'core/ui_core.js', 'ui/ui.js', 'services/economy.js', 'data/catalog.js', 'data/season.js', ...screens.map((id) => 'screens/' + id + '.js'), ...(main ? ['main.js'] : [])];
  const script = stubs + '\n' + modules.map(read).join('\n') + '\nfixture.Router = Router; fixture.Sheet = Sheet; fixture.UI = UI; fixture.Progress = Progress; fixture.Rewards = Rewards; fixture.mode = () => typeof MODE === "undefined" ? null : MODE.id; fixture.battle = () => BATTLE;';
  const css = ['css/base.css', 'css/screens_hub.css', 'css/screens_meta.css'].map(read).join('\n');
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="rm"><div id="desk"><div id="deviceWrap"><div id="device"><div id="gamelayer"></div><div id="screens"><button id="opener">Open</button></div><nav id="nav"></nav><div id="sheets"></div><div id="wipe"></div><div id="toasts"></div><div id="flash"></div></div></div></div></body></html>`);
  await page.addScriptTag({ content: script });
  if (main) await page.waitForFunction(() => fixture.Router.cur && !fixture.Router.busy);
  return { page, errors };
}

module.exports = { launchBrowser, pageFixture };
