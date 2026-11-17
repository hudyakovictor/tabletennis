'use strict';
// End-to-end: outgoing engine vectors -> iframe bridge -> shell HUD SVG.
const assert = require('node:assert/strict');
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
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const frame = await appFrame(page);
    const eventId = await frame.evaluate(() => {
      const g = window.__game;
      g.paused = false; g.setState(GS.RALLY);
      V3.set(g.ball.v, .4, 2, -5); V3.set(g.ball.w, 0, -50, 0);
      g.shotId++;
      g._publishMatchContact(1, { stroke: STROKES.SIDE }, V3.clone(g.ball.p), .8, .9);
      // A subsequent bounce must not mutate this contact.
      V3.set(g.ball.v, 0, -2, 5); V3.set(g.ball.w, 0, 60, 0);
      return g._matchContacts[0].eventId;
    });
    await page.waitForFunction(id => GameHost.matchSnapshot?.contacts?.[0]?.eventId === id, {}, eventId);
    await page.waitForFunction(() => document.querySelector('.match-hud-contact[data-side="1"] svg')?.dataset.source === 'measured');
    const state = await page.evaluate(() => {
      const contact = GameHost.matchSnapshot.contacts[0];
      const svg = document.querySelector('.match-hud-contact[data-side="1"] svg');
      return { velocity: contact.velocity, omega: contact.angularVelocity, spin: svg.dataset.spin,
        direction: svg.dataset.direction, flight: svg.dataset.flight, source: svg.dataset.source,
        balls: svg.querySelectorAll('.stroke-icon-ball').length, arcs: svg.querySelectorAll('.stroke-icon-spin').length };
    });
    assert.deepEqual(state, { velocity: { x: .4, y: 2, z: -5 }, omega: { x: 0, y: -50, z: 0 },
      spin: 'side', direction: '-1', flight: 'up', source: 'measured', balls: 1, arcs: 1 });
    console.log('PASS engine contact vectors reach the shell HUD and remain fixed after the ball changes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
