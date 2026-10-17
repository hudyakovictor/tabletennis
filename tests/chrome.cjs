/* Real Chromium for the browser test suite — on every platform.
 *
 * The @sparticuz/chromium package ships a LINUX-only binary, so it cannot
 * be used on macOS or Windows: `chromium.executablePath()` resolves to an
 * ELF executable and the spawn fails with ENOEXEC. Its argument list is
 * also tuned for AWS Lambda: --single-process, --no-zygote,
 * --in-process-gpu, --headless='shell' and --disable-setuid-sandbox make
 * a desktop Chrome crash on startup (two conflicting --headless modes,
 * and an in-process GPU service the desktop build does not tolerate).
 *
 * So: pick the browser per platform, and drop the Lambda-only flags
 * unless we really are running the Lambda build.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

/* Flags that only make sense for the Lambda build. */
const LAMBDA_ONLY_ARGS = new Set([
  '--single-process',
  '--no-zygote',
  '--in-process-gpu',
  '--headless=shell',
  "--headless='shell'",
  '--headless',
  '--disable-setuid-sandbox',
]);

/* Where a desktop Chrome / Chromium usually lives. */
const DESKTOP_CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

/** The first desktop browser that actually exists on this machine. */
function findDesktopBrowser(platform = process.platform) {
  const candidates = DESKTOP_CANDIDATES[platform] || [];
  for (const raw of candidates) {
    const p = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw;
    try { if (fs.existsSync(p)) return p; } catch (_) { /* unreadable path */ }
  }
  return null;
}

/**
 * Decide which browser to launch and with which arguments.
 * @returns {{executablePath: string, args: string[], env: object, lambda: boolean}}
 */
async function resolveBrowser(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = { ...process.env };

  /* 1. An explicit CHROME_BIN always wins. */
  const explicit = opts.chromeBin || process.env.CHROME_BIN;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`CHROME_BIN is set to ${explicit}, but that file does not exist.`);
    }
    return { executablePath: explicit, args: desktopArgs(opts.extraArgs), env, lambda: false };
  }

  /* 2. Linux: the bundled Lambda build works well and is the CI default. */
  if (platform === 'linux') {
    const chromium = require('@sparticuz/chromium');
    const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
    if (!fs.existsSync(path.join(libs, 'lib'))) {
      // Minimal Linux images may lack NSS. The Chromium npm package ships it.
      fs.mkdirSync(libs, { recursive: true });
      const archive = path.join(
        path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
      execFileSync('tar', ['xf', '-', '-C', libs], {
        input: zlib.brotliDecompressSync(fs.readFileSync(archive)),
      });
    }
    env.LD_LIBRARY_PATH = [path.join(libs, 'lib'), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    return {
      executablePath: await chromium.executablePath(),
      args: chromium.args.concat(opts.extraArgs || []),
      env,
      lambda: true,
    };
  }

  /* 3. macOS / Windows: a desktop Chrome. The npm binary is the wrong
   *    architecture and cannot be executed here at all. */
  const desktop = findDesktopBrowser(platform);
  if (!desktop) {
    throw new Error(
      `No Chrome/Chromium found on ${platform}.\n` +
      'Install Google Chrome, or point CHROME_BIN at a browser executable:\n' +
      '  CHROME_BIN="/path/to/chrome" npm run test:browser');
  }
  return { executablePath: desktop, args: desktopArgs(opts.extraArgs), env, lambda: false };
}

/** Arguments for a desktop browser: no Lambda-only flags. */
function desktopArgs(extra = []) {
  let base;
  try {
    /* Reuse the Lambda list so the two stay in sync (the software-GL
     * flags in it are exactly what headless Chrome needs for WebGL). */
    base = require('@sparticuz/chromium').args;
  } catch (_) {
    base = [
      '--ash-no-nudges',
      '--disable-domain-reliability',
      '--disable-print-preview',
      '--disk-cache-size=33554432',
      '--no-default-browser-check',
      '--no-pings',
      '--font-render-hinting=none',
      '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-web-security',
      '--no-sandbox',
    ];
  }
  const kept = base.filter(a => !LAMBDA_ONLY_ARGS.has(a));
  /* puppeteer adds its own --headless; the Lambda build's --headless='shell'
   * would be a second, conflicting one. */
  return kept.concat(extra);
}

module.exports = { resolveBrowser, findDesktopBrowser, desktopArgs, LAMBDA_ONLY_ARGS };
