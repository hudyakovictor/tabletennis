'use strict';
// Integration smoke test against the built application, including the real render path.
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
    const frame = await appFrame(page);
    const result = await frame.evaluate(() => {
      const g = window.__game;
      g.startMatch(0); g.setPaused(false); g.setState(GS.RALLY);
      V3.set(g.ball.p, 0, PH.TABLE_Y + .16, .7); V3.set(g.ball.v, 0, -1.2, .2);
      V3.zero(g.ball.w); g.ball.live = true; g.ball.lastHitBy = 1; g.rallyBounces = [-1];
      g.awardPoint(1, 'TEST');
      const score = g.score.slice(), ball = JSON.stringify(g.ball.p);
      let rendered = 0, bounced = false, lowest = Infinity, highestAfter = -Infinity;
      const original = g.R.draw;
      g.R.draw = function (mesh, ...args) {
        if (mesh === g.scene.mesh.ball) rendered++;
        return original.call(this, mesh, ...args);
      };
      try {
        for (let i = 0; i < 50; i++) {
          g.update(1 / 60); g.drawDynamic(false);
          const b = g._pointBall;
          lowest = Math.min(lowest, b.p.y);
          if (b.v.y > .2) { bounced = true; highestAfter = Math.max(highestAfter, b.p.y); }
        }
      } finally { g.R.draw = original; }
      const visualMoved = g._pointBall.p.y !== PH.TABLE_Y + .16;
      const liveUnchanged = JSON.stringify(g.ball.p) === ball && !g.ball.live;
      const scoreUnchanged = JSON.stringify(score) === JSON.stringify(g.score);
      g.server = 1; g.prepServe();
      const cleared = g._pointBall === null, ready = g.state === GS.SERVE_READY;
      // An actual second table bounce scores inside the physics loop. The
      // scenery ball must start with the already-reflected upward velocity.
      g.startMatch(0); g.setPaused(false); g.setState(GS.RALLY); g.isServeBall = false;
      V3.set(g.ball.p, 0, PH.TABLE_Y + PH.R + .04, -.7); V3.set(g.ball.v, 0, -1.5, -.1);
      V3.zero(g.ball.w); g.ball.live = true; g.ball.lastHitBy = 1; g.rallyBounces = [-1];
      for (let i = 0; i < 12 && g.state === GS.RALLY; i++) g.update(1 / 60);
      const scoreBounce = g.state === GS.POINT && g._pointBall && g._pointBall.v.y > 0 && !g.ball.live;
      const yAtScore = g._pointBall?.p.y;
      g.update(1 / 60);
      const risesAfterScore = g._pointBall && g._pointBall.p.y > yAtScore;
      return { rendered, bounced, lowest, highestAfter, visualMoved, liveUnchanged, scoreUnchanged,
        cleared, ready, scoreBounce, risesAfterScore };
    });
    assert.ok(result.rendered >= 50, JSON.stringify(result));
    assert.ok(result.bounced && result.visualMoved && result.highestAfter > result.lowest + .03, JSON.stringify(result));
    assert.ok(result.liveUnchanged && result.scoreUnchanged && result.cleared && result.ready, JSON.stringify(result));
    assert.ok(result.scoreBounce && result.risesAfterScore, JSON.stringify(result));
    console.log('PASS point ball keeps rendering, falls and bounces without changing the rally; next serve clears it');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
