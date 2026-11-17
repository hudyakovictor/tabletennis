'use strict';
// Diagnostic, not a pass/fail test: synthetic PointerEvents drive the actual
// browser game with deterministic fixed-step updates. Run: node tests/serve-motion-probe.cjs
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { appFrame } = require('./helpers.cjs');

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  fs.mkdirSync(libs, { recursive: true });
  const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
  execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args,
    headless: true, env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  try {
    for (const [width, height] of [[1280, 760], [390, 844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, hasTouch: width < 600 });
      const frame = await appFrame(page);
      const results = await frame.evaluate(() => {
        const g = window.__game, output = [];
        g.paused = true;
        let seed = 2;
        Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        const send = (type, x, y, pointerType) => {
          const r = g.canvas.getBoundingClientRect();
          g.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 81, pointerType, button: 0,
            buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x, clientY: r.top + y,
            bubbles: true, cancelable: true }));
        };
        for (const pointerType of ['mouse', 'touch']) for (const scale of [1, .3]) {
          for (const initial of ['home', 'bottom', 'wide', 'near']) {
            g.startMatch(0); g.server = 1; g.prepServe(); g.paused = false; g.recenterT = 0;
            g.setInspectSlowmo(scale < 1); g.timeScale = scale; g.targetTimeScale = scale; g._acc = 0;
            if (initial === 'bottom') {
              const rect = g.canvas.getBoundingClientRect();
              send('pointermove', rect.width * .5, rect.height * .98, pointerType);
              for (let i = 0; i < 60; i++) g.update(1 / 60);
              g.prepServe();
            } else if (initial !== 'home') {
              // Explicit reachable states exercise recovery after a previous rally.
              const p = initial === 'wide' ? [.7, PH.TABLE_Y + .2, 1.8] : [0, PH.TABLE_Y + .12, 1.1];
              V3.set(g.player.pos, ...p); g.clampPaddleVolume(); g.holdPaddlePose();
            }
            g.update(1 / 60);
            const p = g.project(g.ball.p, {}), r = g.canvas.getBoundingClientRect();
            const x = p.x * r.width, y = p.y * r.height;
            const initialPos = V3.clone(g.player.pos);
            let contact = null;
            const original = g.tryPlayerHit;
            g.tryPlayerHit = function (...args) {
              const before = V3.clone(this.player.pos), roll = this.player.roll;
              const normal = V3.clone(this.player.normal), hit = this.ball.lastHitBy;
              const result = original.apply(this, args);
              if (hit === 0 && this.ball.lastHitBy === 1) {
                contact = { delta: V3.dist(before, this.player.pos), before, after: V3.clone(this.player.pos),
                  rollBefore: roll, rollAfter: this.player.roll, normalBefore: normal,
                  normalAfter: V3.clone(this.player.normal) };
              }
              return result;
            };
            try {
              send('pointerdown', x, y + 50, pointerType); g.update(.04);
              send('pointermove', x, y - 50, pointerType); g.update(.04);
              send('pointerup', x, y - 50, pointerType);
              let minY = Infinity, maxDelta = 0, maxRot = 0;
              const prev = V3.clone(g.player.pos), prevQ = Q.copy(Q.new(), g.player.q);
              for (let i = 0; i < 180 && g.state === GS.SERVE_TOSS; i++) {
                g.update(1 / 60);
                const pad = g.player, q = pad.q;
                const angle = 2 * Math.acos(Math.min(1, Math.abs(q.x * prevQ.x + q.y * prevQ.y + q.z * prevQ.z + q.w * prevQ.w)));
                minY = Math.min(minY, pad.pos.y); maxDelta = Math.max(maxDelta, V3.dist(prev, pad.pos));
                maxRot = Math.max(maxRot, angle); V3.copy(prev, pad.pos); Q.copy(prevQ, q);
              }
              output.push({ pointerType, scale, initial, initialPos, hit: g.ball.lastHitBy,
                shots: g.stats.shots, state: g.state, minY, maxFrameDistance: maxDelta,
                maxFrameAngleDeg: maxRot * 180 / Math.PI, contact });
            } finally { g.tryPlayerHit = original; }
          }
        }
        g.paused = true;
        return output;
      });
      for (const result of results) console.log(JSON.stringify({ viewport: [width, height], ...result }));
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
