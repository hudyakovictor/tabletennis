/**
 * UI smoke harness — renders the whole SPA in jsdom against a live server.
 *
 * There is no headless Chromium in this environment, so this is the closest we can
 * get to a real browser: jsdom supplies the DOM, the page loads the exact same
 * ES modules the browser loads, and every render goes through the real HTTP API.
 * It catches the class of bugs that unit tests cannot see: undefined data paths,
 * broken imports, event-handler wiring and view crashes.
 *
 * Usage: `npm run test:ui` (development only; jsdom is a devDependency).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.UI_SMOKE_PORT || 4199);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-ui-'));

const nativeFetch = globalThis.fetch;
const errors = [];
const warnings = [];

function fail(where, err) {
  errors.push(`${where}: ${err?.stack || err?.message || err}`);
}

/* ------------------------------- server ---------------------------------- */
const server = spawn(process.execPath, ['--no-warnings', 'src/server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    CRM_DB_PATH: path.join(TMP, 'ui.sqlite'),
    CRM_ARCHIVE_DB_PATH: path.join(TMP, 'ui-archive.sqlite'),
    ADMIN_ALLOWED_ORIGINS: BASE,
    CRM_SCHEDULER_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } });
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT', err?.stack || err);
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED', err?.stack || err);
});

const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await nativeFetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${serverLog.join('')}`);
}

/* --------------------------------- DOM ----------------------------------- */
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let cookieJar = '';
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => fail('jsdom', e));
virtualConsole.on('error', (msg) => errors.push(`console.error: ${msg}`));
virtualConsole.on('warn', (msg) => warnings.push(String(msg)));

const dom = new JSDOM(html, {
  url: `${BASE}/`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const { document } = window;

function setCookieHeader(setCookieList) {
  const jar = new Map(cookieJar.split('; ').filter(Boolean).map((c) => {
    const idx = c.indexOf('=');
    return [c.slice(0, idx), c.slice(idx + 1)];
  }));
  for (const raw of setCookieList || []) {
    const pair = raw.split(';')[0];
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    if (value === '' || /Max-Age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, value);
  }
  cookieJar = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  // api.js reads the CSRF token from document.cookie (double-submit pattern).
  const csrf = jar.get('topspin_csrf');
  document.cookie = csrf ? `topspin_csrf=${csrf}; path=/` : 'topspin_csrf=; Max-Age=0; path=/';
}

// Node's fetch ignores the jsdom cookie jar, so inject it explicitly.
window.fetch = async (input, init = {}) => {
  const url = String(input).startsWith('http') ? String(input) : `${BASE}${String(input)}`;
  const headers = { ...(init.headers || {}) };
  if (cookieJar) headers.cookie = cookieJar;
  const res = await nativeFetch(url, { ...init, headers, redirect: 'manual' });
  setCookieHeader(res.headers.getSetCookie?.() || []);
  return res;
};
window.EventSource = class {
  constructor() {
    this.readyState = 1;
    setTimeout(() => this.dispatchEvent?.({ type: 'open' }), 0);
  }
  addEventListener() {}
  removeEventListener() {}
  close() { this.readyState = 2; }
};
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.scrollTo = () => {};
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  // Permissive 2D stub: every unknown member is a no-op function or a number,
  // so chart code paths run fully without a real rasteriser.
  const state = {
    canvas: this,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    shadowBlur: 0, shadowColor: '', lineCap: 'butt', lineJoin: 'miter', textAlign: 'left',
    textBaseline: 'alphabetic', filter: 'none', globalCompositeOperation: 'source-over',
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (x = 0, y = 0, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      }
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
};

const globals = {
  window,
  document,
  location: window.location,
  navigator: window.navigator,
  history: window.history,
  localStorage: window.localStorage,
  sessionStorage: window.sessionStorage,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  FormData: window.FormData,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: () => {},
  fetch: window.fetch,
  EventSource: window.EventSource,
  matchMedia: window.matchMedia,
  ResizeObserver: window.ResizeObserver,
  scrollTo: window.scrollTo,
  alert: () => {},
  confirm: () => true,
};
for (const [key, value] of Object.entries(globals)) {
  if (value === undefined) continue;
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    // Some Node globals (navigator) are getter-only; a shadow is not required.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, { timeout = 6000, label = 'condition' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (predicate()) return true;
    } catch (err) {
      fail(label, err);
      return false;
    }
    await sleep(50);
  }
  throw new Error(`timeout waiting for ${label}`);
}

/* --------------------------------- run ----------------------------------- */
const results = [];

async function main() {
  await waitForServer();
  window.addEventListener('error', (e) => fail('window.error', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => fail('unhandledrejection', e.reason || 'unknown'));

  const originalError = console.error;
  console.error = (...args) => {
    errors.push(`console.error: ${args.map(String).join(' ')}`);
    originalError(...args);
  };

  // The package is CommonJS, so `.js` files would be parsed as CJS. Copy the SPA
  // into a temporary ESM package to import exactly the browser modules.
  const esmRoot = path.join(TMP, 'spa');
  fs.cpSync(path.join(ROOT, 'public/assets/js'), esmRoot, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
  await import(pathToFileURL(path.join(esmRoot, 'main.js')).href);
  document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

  await waitFor(() => !document.getElementById('login-screen').classList.contains('hidden'), { label: 'login screen' });
  results.push(['boot', document.getElementById('login-screen').classList.contains('hidden') === false]);

  // Login through the real form handler.
  document.getElementById('login-username').value = 'owner@topspin.arena';
  document.getElementById('login-password').value = 'TopspinAdmin2026!';
  document.getElementById('login-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => !document.getElementById('app').classList.contains('hidden'), { label: 'app shell', timeout: 12000 });
  results.push(['login', document.getElementById('user-name').textContent.length > 0]);

  const tabs = ['overview', 'director', 'ops', 'fraud', 'balance', 'market', 'lab', 'observability', 'liveops', 'players', 'governance', 'settings'];
  for (const tab of tabs) {
    const before = errors.length;
    window.location.hash = `#/${tab}`;
    await sleep(900);
    const outlet = document.getElementById('view') || document.getElementById('main-outlet');
    const text = (outlet?.textContent || '').trim();
    const ok = errors.length === before && text.length > 120;
    results.push([tab, ok, `${text.length} chars${errors.length > before ? `, ${errors.length - before} errors` : ''}`]);
    if (process.env.UI_SMOKE_DUMP) {
      fs.mkdirSync(process.env.UI_SMOKE_DUMP, { recursive: true });
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${tab}.txt`), (outlet?.innerHTML || ''));
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${tab}.text`), text);
    }
  }

  // Deep links and drawers.
  const deepLinks = [
    ['#/governance?tab=roles', 'governance roles tab'],
    ['#/governance?tab=readiness', 'governance readiness tab'],
    ['#/settings?tab=scheduler', 'settings scheduler tab'],
    ['#/settings?tab=sessions', 'settings sessions tab'],
    ['#/observability?tab=slo', 'observability slo tab'],
    ['#/liveops?tab=news', 'liveops news tab'],
    ['#/liveops?tab=maintenance', 'liveops maintenance tab'],
  ];
  for (const [hash, label] of deepLinks) {
    const before = errors.length;
    window.location.hash = hash;
    await sleep(700);
    const text = (document.getElementById('view')?.textContent || '').trim();
    results.push([label, errors.length === before && text.length > 100]);
  }

  // Palette + notification popover wiring.
  document.getElementById('search-trigger')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  results.push(['command palette opens', !document.getElementById('palette-overlay').classList.contains('hidden')]);
  const input = document.getElementById('palette-input');
  if (input) {
    input.value = 'plr';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(600);
    results.push(['palette search results', (document.getElementById('palette-body')?.textContent || '').length > 0]);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  results.push(['no runtime errors', errors.length === 0]);
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  fail('fatal', err);
  exitCode = 1;
} finally {
  for (const [label, ok, extra] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  }
  if (errors.length) {
    console.log('\n--- errors ---');
    for (const e of errors.slice(0, 25)) console.log(e);
    exitCode = 1;
  }
  if (warnings.length) {
    console.log(`\nwarnings: ${warnings.length}`);
    for (const w of warnings.slice(0, 8)) console.log(`  ${w}`);
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  server.kill('SIGTERM');
  dom.window.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(exitCode);
}
