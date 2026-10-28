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
const apiFailures = [];
const refreshCalls = [];
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
  if (url.endsWith('/api/admin/auth/refresh')) refreshCalls.push(res.status);
  // `/auth/me` answering 401 before login is the probe itself, not a failure.
  // A 401 from `/auth/refresh` is the recovery probe failing on purpose.
  const expectedProbe = res.status === 401 && (url.endsWith('/api/admin/auth/me') || url.endsWith('/api/admin/auth/refresh'));
  if (url.includes('/api/') && res.status >= 400 && !expectedProbe) {
    apiFailures.push(`${String(init.method || 'GET').padEnd(6)} ${res.status} ${url.replace(BASE, '')}`);
  }
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

/* ------------------------------ a11y checks ------------------------------ */
// A button whose only content is an SVG icon has no accessible name; the same is
// true for an input with neither a wrapping <label> nor aria-label/aria-labelledby.
// Both are invisible in a screenshot and painful for screen-reader users, so they
// are treated as failures rather than warnings.
const a11yIssues = [];

function auditA11y(scopeLabel, explicitRoot = null) {
  const root = explicitRoot || document.getElementById('view') || document.body;
  for (const btn of root.querySelectorAll('button')) {
    const name = (btn.textContent || '').trim() || btn.getAttribute('aria-label') || btn.getAttribute('title');
    if (!name) a11yIssues.push(`${scopeLabel}: button without an accessible name (${btn.className || 'no class'})`);
  }
  for (const input of root.querySelectorAll('input, select, textarea')) {
    if (input.type === 'hidden' || input.type === 'checkbox' || input.type === 'radio') continue;
    const wrapped = input.closest('label');
    const labelled = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || input.id && document.querySelector(`label[for="${input.id}"]`);
    if (!wrapped && !labelled) a11yIssues.push(`${scopeLabel}: form field without a label (${input.name || input.id || input.tagName})`);
  }
  for (const img of root.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) a11yIssues.push(`${scopeLabel}: image without alt`);
  }
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
    const hasCard = Boolean(outlet?.querySelector('.card, .kpi, .empty'));
    const hasErrorPanel = Boolean(outlet?.querySelector('.error-panel'));
    const ok = errors.length === before && text.length > 120 && hasCard && !hasErrorPanel;
    results.push([tab, ok, `${text.length} chars${hasCard ? '' : ', no card'}${hasErrorPanel ? ', ERROR PANEL' : ''}${errors.length > before ? `, ${errors.length - before} errors` : ''}`]);
    auditA11y(tab);
    if (process.env.UI_SMOKE_DUMP) {
      fs.mkdirSync(process.env.UI_SMOKE_DUMP, { recursive: true });
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${tab}.txt`), (outlet?.innerHTML || ''));
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${tab}.text`), text);
    }
  }

  // Deep links and drawers. Each link also names the content it must actually show:
  // a tab that renders a shell and no data used to pass the old length check.
  const deepLinks = [
    ['#/governance?tab=roles', 'governance roles tab', ['Матрица', 'прав']],
    ['#/governance?tab=readiness', 'governance readiness tab', ['Готовность']],
    ['#/settings?tab=scheduler', 'settings scheduler tab', ['Планировщик']],
    ['#/settings?tab=sessions', 'settings sessions tab', ['Сесси']],
    ['#/settings?tab=backups', 'settings backups tab', ['Хранятся', 'Сделать бэкап', 'политик']],
    ['#/governance?tab=legal', 'governance legal tab', ['Запросы субъектов ПДн', 'срок', 'Право']],
    ['#/observability?tab=slo', 'observability slo tab', ['SLO']],
    ['#/observability?tab=postmortems', 'observability postmortems tab', ['Без обвинений', 'Разборов']],
    ['#/liveops?tab=news', 'liveops news tab', ['Новост']],
    ['#/liveops?tab=maintenance', 'liveops maintenance tab', ['Техработ']],
  ];
  for (const [hash, label, must = []] of deepLinks) {
    const before = errors.length;
    window.location.hash = hash;
    await sleep(700);
    const outlet = document.getElementById('view');
    const text = (outlet?.textContent || '').trim();
    const missing = must.filter((needle) => !text.includes(needle));
    results.push([
      label,
      errors.length === before && text.length > 100 && missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : undefined,
    ]);
    if (process.env.UI_SMOKE_DUMP) {
      const slug = label.replace(/[^a-z0-9]+/gi, '-');
      fs.mkdirSync(process.env.UI_SMOKE_DUMP, { recursive: true });
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${slug}.txt`), (outlet?.innerHTML || ''));
      fs.writeFileSync(path.join(process.env.UI_SMOKE_DUMP, `${slug}.text`), text);
    }
  }

  /* ------------------------------ interactions ------------------------------ */
  const overlayOpen = (id) => !document.getElementById(id).classList.contains('hidden');
  const closeWithEscape = async (id) => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    return !overlayOpen(id);
  };

  // Player 360 drawer: a real click on a table row must fetch and render the profile.
  window.location.hash = '#/players';
  await sleep(900);
  const playerRow = document.querySelector('#view tbody tr[data-key]');
  if (playerRow) {
    playerRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => overlayOpen('drawer-overlay') && (document.getElementById('drawer-body').textContent || '').length > 200,
      { label: 'player drawer', timeout: 6000 });
    const drawerText = document.getElementById('drawer-body').textContent;
    auditA11y('player drawer', document.getElementById('drawer-overlay'));
    results.push(['player drawer renders 360 profile',
      /Согласи/.test(drawerText) && /Сессии|Платежи|Тикеты/.test(drawerText), `${drawerText.length} chars`]);
    results.push(['drawer closes on Escape', await closeWithEscape('drawer-overlay')]);
  } else {
    results.push(['player drawer renders 360 profile', false, 'no table rows']);
  }

  // Governance → roles: the permission matrix drawer must open for a role.
  window.location.hash = '#/governance?tab=roles';
  await sleep(900);
  const roleBtn = document.querySelector('#view [data-role]');
  if (roleBtn) {
    roleBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => overlayOpen('drawer-overlay'), { label: 'role drawer', timeout: 4000 });
    const roleText = document.getElementById('drawer-body').textContent || '';
    auditA11y('role drawer', document.getElementById('drawer-overlay'));
    results.push(['role permission drawer lists capabilities', roleText.includes(':') && roleText.length > 80, `${roleText.length} chars`]);
    await closeWithEscape('drawer-overlay');
  } else {
    results.push(['role permission drawer lists capabilities', false, 'no role buttons']);
  }

  // Governance → legal: the DSAR intake drawer must be usable (a queue with no
  // intake would be a read-only screen pretending to be a workflow).
  window.location.hash = '#/governance?tab=legal';
  await sleep(900);
  const intakeBtn = document.getElementById('new-dsar');
  if (intakeBtn) {
    intakeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => overlayOpen('drawer-overlay') && (document.getElementById('drawer-body').textContent || '').length > 60,
      { label: 'dsar intake drawer', timeout: 4000 });
    const intakeText = document.getElementById('drawer-body').textContent || '';
    const hasTypeChoice = /Доступ/.test(intakeText) && /Удаление/.test(intakeText)
      && Boolean(document.querySelector('#drawer-body select[name="requestType"]'));
    auditA11y('dsar intake', document.getElementById('drawer-overlay'));
    results.push(['dsar intake drawer offers export and erasure', hasTypeChoice, `${intakeText.length} chars`]);
    await closeWithEscape('drawer-overlay');
  } else {
    results.push(['dsar intake drawer offers export and erasure', false, 'no #new-dsar button']);
  }

  // Settings → backups: verifying a snapshot must open the recovery report, not a toast.
  window.location.hash = '#/settings?tab=backups';
  await sleep(1000);
  const verifyBtn = document.querySelector('#view [data-verify-backup]');
  if (verifyBtn) {
    verifyBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => overlayOpen('drawer-overlay') && /integrity/i.test(document.getElementById('drawer-body').textContent || ''),
      { label: 'backup verification drawer', timeout: 8000 });
    const verifyText = document.getElementById('drawer-body').textContent || '';
    auditA11y('backup verification', document.getElementById('drawer-overlay'));
    results.push(['backup verification reports integrity and audit head',
      /integrity_check/.test(verifyText) && /Head снимка/.test(verifyText) && /цепочк/i.test(verifyText) && /таблиц/.test(verifyText),
      `${verifyText.length} chars`]);
    await closeWithEscape('drawer-overlay');
  } else {
    results.push(['backup verification reports integrity and audit head', false, 'no [data-verify-backup] button']);
  }

  // LiveOps → maintenance dialog must render the 503 contract before anything is applied.
  window.location.hash = '#/liveops';
  await sleep(900);
  const maintBtn = document.getElementById('toggle-maint');
  if (maintBtn) {
    maintBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => overlayOpen('drawer-overlay'), { label: 'maintenance drawer', timeout: 4000 });
    const form = document.getElementById('maint-form');
    auditA11y('maintenance drawer', document.getElementById('drawer-overlay'));
    results.push(['maintenance dialog renders 503 contract',
      Boolean(form) && Boolean(form.querySelector('[name="bannerRu"]')) && Boolean(form.querySelector('[name="grace"]'))]);
    await closeWithEscape('drawer-overlay');
  } else {
    results.push(['maintenance dialog renders 503 contract', false, 'no toggle button']);
  }

  // Theme toggle flips the document attribute and survives a re-render.
  const themeBtn = document.getElementById('theme-btn');
  const themeBefore = document.documentElement.dataset.theme;
  themeBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  results.push(['theme toggle switches the document theme', document.documentElement.dataset.theme !== themeBefore]);
  themeBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);

  // Notification centre opens and lists something (or an explicit empty state).
  document.getElementById('notif-btn')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(400);
  const notifPopover = document.getElementById('notif-popover');
  results.push(['notification popover opens', Boolean(notifPopover) && !notifPopover.classList.contains('hidden')]);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(150);

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

  // ---- A3: silent session renewal, recovery banner, deep-link restore ----------
  window.location.hash = '#/governance?tab=legal';
  await sleep(600);
  const beforeExpiry = refreshCalls.length;
  window.dispatchEvent(new window.CustomEvent('crm:auth-expired'));
  await sleep(1200);
  const appVisible = !document.getElementById('app').classList.contains('hidden');
  const loginHidden = document.getElementById('login-screen').classList.contains('hidden');
  const stillOnLegal = window.location.hash.includes('governance') && window.location.hash.includes('legal');
  results.push([
    'expired session renews silently instead of kicking the operator out',
    appVisible && loginHidden && stillOnLegal && refreshCalls.slice(beforeExpiry).includes(200),
    `refresh=${refreshCalls.slice(beforeExpiry).join(',') || 'none'} hash=${window.location.hash}`,
  ]);

  // The renewal strip appears only when the session is genuinely close to ending.
  const sessionBar = document.getElementById('session-bar');
  window.dispatchEvent(new window.CustomEvent('crm:session', {
    detail: { expiresAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(), warning: true },
  }));
  const warnShown = !sessionBar.classList.contains('hidden') && sessionBar.dataset.tone === 'warn';
  window.dispatchEvent(new window.CustomEvent('crm:session', {
    detail: { expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(), warning: true },
  }));
  const dangerShown = !sessionBar.classList.contains('hidden') && sessionBar.dataset.tone === 'danger';
  window.dispatchEvent(new window.CustomEvent('crm:session', {
    detail: { expiresAt: new Date(Date.now() + 10 * 3600 * 1000).toISOString(), warning: false },
  }));
  results.push([
    'session banner escalates warn → danger → hidden after renewal',
    warnShown && dangerShown && sessionBar.classList.contains('hidden'),
    `warn=${warnShown} danger=${dangerShown} hidden=${sessionBar.classList.contains('hidden')}`,
  ]);

  // Deep-link restore: a reload with no hash returns to the last worked-on screen.
  const remembered = localStorage.getItem('topspin.crm.lastRoute') || '';
  results.push([
    'last visited screen is remembered for deep-link restore',
    remembered.startsWith('#/'),
    remembered || 'empty',
  ]);

  results.push(['no accessibility gaps in rendered views', a11yIssues.length === 0]);
  results.push(['no failed API calls', apiFailures.length === 0]);
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
  if (a11yIssues.length) {
    console.log('\n--- a11y issues ---');
    for (const issue of [...new Set(a11yIssues)].slice(0, 30)) console.log(`  ${issue}`);
    exitCode = 1;
  }
  if (apiFailures.length) {
    console.log('\n--- API failures ---');
    for (const f of [...new Set(apiFailures)].slice(0, 30)) console.log(f);
    exitCode = 1;
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
