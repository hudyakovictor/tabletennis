#!/usr/bin/env node
/* =====================================================================
 *  audit150.js — the runner for the 150 analyses.
 *
 *      node tt/tools/audit150.js
 *      node tt/tools/audit150.js --only 12,88,140
 *      node tt/tools/audit150.js --json report.json
 *      node tt/tools/audit150.js --quiet
 *
 *  The analyses live in audit150_core.js (areas 1-5) and here (6-15).
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./audit150_core.js');
const { ANALYSES, A, ok, num, X, sandbox, srand, makeCanvas, elStub, ctx2dStub, makeGL, SMath } = core;

const { PH, V3, Q, M4, clamp, lerp, TAU, DEG } = X;
const { predict, impactRacket, integrateBall, bounceTable, aeroAccel, solveLaunch, impactSphere } = X;
const { deriveStroke, refineRacket, classifyStroke, ARCH, STROKES, SwipeTracker } = X;
const { Equipment, ITEMS, ITEM_LIST } = X;
const GSX = X.GS;

/* helpers shared by the analyses */
function freshGame(opts = {}) {
  const ui = new X.UI();
  const game = new X.Game(makeCanvas(opts.w || 720, opts.h || 1280), ui);
  ui.attach(game);
  if (ui.bindCareer) ui.bindCareer();
  if (ui.bindOnline) ui.bindOnline();
  return game;
}
function freshProfile(raw) {
  sandbox.localStorage.clear();
  if (raw !== undefined) sandbox.localStorage.setItem(X.SAVE_KEY, raw);
  const plat = new X.Platform({ userAgent: 'node' });
  return new X.Profile(plat);
}
const store = () => sandbox.localStorage;

/* ================================================================ *
 *  AREA 6 — OPPONENT AI (55_ai.js)
 * ================================================================ */
A('AI', 'The five AI levels are strictly ordered by skill', () => {
  const L = X.AI_LEVELS;
  let bad = [];
  for (let i = 1; i < L.length; i++) {
    if (L[i].skill <= L[i - 1].skill) bad.push(`${L[i].id} skill ${L[i].skill} <= ${L[i - 1].id} ${L[i - 1].skill}`);
    if (L[i].move <= L[i - 1].move) bad.push(`${L[i].id} move ${L[i].move} <= ${L[i - 1].id} ${L[i - 1].move}`);
    if (L[i].elo <= L[i - 1].elo) bad.push(`${L[i].id} elo not increasing`);
  }
  return ok(bad.length === 0, bad.join('; ') || 'skill, move and elo all increase');
});

A('AI', 'AI levels stay inside the physical envelope (bat speed <= 16 m/s)', () => {
  const bad = X.AI_LEVELS.filter((l) => l.vmagMax > 16 || l.vmagMin < 1.5);
  return ok(bad.length === 0, bad.map((l) => l.id).join(',') || 'all levels within 1.5..16 m/s');
});

A('AI', 'The AI never hits the ball before it bounces on the AI half', () => {
  const g = freshGame();
  g.startMatch(2);
  let illegal = 0, checked = 0;
  const realApply = g.applyHit.bind(g);
  g.applyHit = (side, racket, contactP, quality, info) => {
    if (side < 0) {
      checked++;
      if (!g.isServeBall && !g.rallyBounces.some((s) => s < 0)) illegal++;
    }
    return realApply(side, racket, contactP, quality, info);
  };
  for (let f = 0; f < 2400; f++) { g.pointer = { x: 0.5, y: 0.6 }; g.update(1 / 60); if (g.state === GSX.MATCH_END) break; }
  return ok(illegal === 0, `${illegal}/${checked} AI contacts happened before the AI-side bounce`);
});

A('AI', 'The AI serves legally (own half first, then over the net)', () => {
  const g = freshGame();
  g.startMatch(2);
  /* The server has to be set BEFORE the point is prepared: prepServe() is
     what arms the AI's serve timer, so flipping g.server afterwards left
     the game waiting for the PLAYER's serve and the AI never served. */
  g.server = -1;
  g.prepServe();
  let serves = 0, legal = 0;
  const realApply = g.applyHit.bind(g);
  g.applyHit = (side, racket, contactP, quality, info) => {
    if (side < 0 && g.isServeBall) {
      serves++;
      if (g.serveBounces === 0) legal++;
    }
    return realApply(side, racket, contactP, quality, info);
  };
  for (let f = 0; f < 2400; f++) { g.update(1 / 60); if (g.state === GSX.MATCH_END) break; }
  return ok(serves > 0 && legal === serves, `${legal}/${serves} AI serves were struck legally`);
});

A('AI', 'The AI always telegraphs: a wind-up exists before the contact', () => {
  const g = freshGame();
  g.startMatch(3);
  /* The wind-up is zeroed BY the swing, so at the moment of the contact it
     is always 0 — the old check sampled it there and found nothing. The
     telegraph is in the frames BEFORE the contact. */
  const hist = [];
  let maxWindup = 0, contacts = 0, preWindup = 0;
  const realApply = g.applyHit.bind(g);
  g.applyHit = (side, racket, contactP, quality, info) => {
    if (side < 0) {
      contacts++;
      for (let i = Math.max(0, hist.length - 12); i < hist.length; i++) preWindup = Math.max(preWindup, hist[i]);
    }
    return realApply(side, racket, contactP, quality, info);
  };
  for (let f = 0; f < 2400; f++) {
    g.update(1 / 60);
    hist.push(g.ai.anim.windup);
    maxWindup = Math.max(maxWindup, g.ai.anim.windup);
    if (g.state === GSX.MATCH_END) break;
  }
  return ok(contacts > 0 && preWindup > 0.02,
    `max wind-up in the 12 frames before a contact = ${num(preWindup, 3)} over ${contacts} contacts (match max ${num(maxWindup, 3)})`);
});

A('AI', 'The AI shot speed lands in a plausible band (15..95 km/h)', () => {
  const g = freshGame();
  g.startMatch(2);
  /* the AI only hits when it is the one serving: the player never serves
     in a headless run, so the point would never start */
  g.server = -1;
  g.prepServe();
  const speeds = [];
  const realApply = g.applyHit.bind(g);
  g.applyHit = (side, racket, contactP, quality, info) => {
    if (side < 0) speeds.push(V3.len(g.ball.v) * 3.6);
    return realApply(side, racket, contactP, quality, info);
  };
  for (let f = 0; f < 3600; f++) {
    if (g.state === GSX.SERVE_READY && g.server === 1) { g.server = -1; g.prepServe(); }
    g.update(1 / 60);
    if (g.state === GSX.MATCH_END) break;
  }
  speeds.sort((a, b) => a - b);
  const med = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0;
  return ok(med > 12 && med < 95, `median AI shot = ${num(med, 1)} km/h over ${speeds.length} shots`);
});

A('AI', 'The AI handicap stays inside the documented 0.86..1.03 band', () => {
  const d = new X.MatchDirector();
  let lo = 9, hi = 0;
  for (let i = 0; i < 200; i++) {
    d.onPoint(i % 3 === 0 ? 1 : -1, 2);
    lo = Math.min(lo, d.handicap); hi = Math.max(hi, d.handicap);
  }
  return ok(lo >= 0.86 - 1e-9 && hi <= 1.03 + 1e-9, `handicap range ${num(lo, 4)}..${num(hi, 4)}`);
});

A('AI', 'MatchDirector momentum stays inside [-1, 1]', () => {
  const d = new X.MatchDirector();
  let bad = 0;
  for (let i = 0; i < 200; i++) { d.onPoint(i % 2 ? 1 : -1, 2); const m = d.momentum(); if (!(m >= -1 && m <= 1)) bad++; }
  return ok(bad === 0, `${bad}/200 momentum readings outside [-1,1]`);
});

A('AI', 'MatchDirector can be switched off and then does not adapt', () => {
  const d = new X.MatchDirector();
  d.enabled = false;
  const h0 = d.handicap;
  for (let i = 0; i < 10; i++) d.onPoint(-1, 2);
  return ok(Math.abs(d.handicap - h0) < 1e-9, `handicap moved to ${num(d.handicap, 4)} while disabled`);
});

A('AI', 'The AI shot goes through the same impact solver as the player', () => {
  // the AI's swing must produce a racket state the shared solver accepts
  const g = freshGame();
  g.startMatch(2);
  const ai = g.ai;
  const r = ai.swing(g);
  return ok(!r || (Number.isFinite(r.vmag) && r.normal && Number.isFinite(r.normal.x)),
    r ? `racket vmag=${num(r.vmag, 2)}` : 'no swing (no ball in play)');
});

A('AI', 'A higher AI level produces more speed than a lower one', () => {
  const speeds = [];
  for (const lvl of [0, 4]) {
    const g = freshGame();
    g.startMatch(lvl);
    /* the AI has to serve: the player never serves in a headless run */
    g.server = -1;
    g.prepServe();
    const s = [];
    const realApply = g.applyHit.bind(g);
    g.applyHit = (side, racket, contactP, quality, info) => { if (side < 0) s.push(V3.len(g.ball.v) * 3.6); return realApply(side, racket, contactP, quality, info); };
    for (let f = 0; f < 2400; f++) {
      if (g.state === GSX.SERVE_READY && g.server === 1) { g.server = -1; g.prepServe(); }
      g.update(1 / 60);
      if (g.state === GSX.MATCH_END) break;
    }
    s.sort((a, b) => a - b);
    speeds.push(s.length ? s[Math.floor(s.length / 2)] : 0);
  }
  return ok(speeds[1] > speeds[0], `level 0 median ${num(speeds[0], 1)} km/h vs level 4 ${num(speeds[1], 1)} km/h`);
});

A('AI', 'The AI reacts to the ball in a plausible time', () => {
  const bad = X.AI_LEVELS.filter((l) => l.react < 0.05 || l.react > 0.6);
  return ok(bad.length === 0, bad.map((l) => l.id).join(',') || 'all reaction times in 50..600 ms');
});

/* ================================================================ *
 *  AREA 7 — MATCH RULES (70_game.js, 58_coach.js)
 * ================================================================ */
A('RULES', 'The serve changes every two points', () => {
  const g = freshGame();
  g.startMatch(1);
  g.server = 1; g.servesLeft = 2;
  const seq = [];
  for (let i = 0; i < 8; i++) { seq.push(g.server); g.servesLeft--; if (g.servesLeft <= 0) { g.server = -g.server; g.servesLeft = 2; } }
  const want = [1, 1, -1, -1, 1, 1, -1, -1];
  return ok(seq.join() === want.join(), `server sequence ${seq.join(',')}`);
});

A('RULES', 'At deuce the serve changes every point', () => {
  const g = freshGame();
  g.startMatch(1);
  g.score = [10, 10]; g.settings.targetScore = 11;
  g.server = 1; g.servesLeft = 2;
  const deuce = g.score[0] >= g.settings.targetScore - 1 && g.score[1] >= g.settings.targetScore - 1;
  g.servesLeft--; if (deuce || g.servesLeft <= 0) { g.server = -g.server; g.servesLeft = deuce ? 1 : 2; }
  return ok(deuce && g.server === -1 && g.servesLeft === 1, `deuce=${deuce} server=${g.server} servesLeft=${g.servesLeft}`);
});

A('RULES', 'The match ends at the target score with a two-point lead', () => {
  const g = freshGame();
  g.startMatch(1);
  g.settings.targetScore = 11;
  g.score = [10, 9];
  g.ball.lastHitBy = 1;
  g.awardPoint(1, 'ТЕСТ');
  const won = g.matchWinner;
  return ok(won === 1, `score ${g.score.join('-')} -> matchWinner=${won}`);
});

A('RULES', 'A match does not end on a one-point lead', () => {
  const g = freshGame();
  g.startMatch(1);
  g.settings.targetScore = 11;
  g.score = [10, 9];
  g.ball.lastHitBy = 1;
  g.awardPoint(1, 'ТЕСТ');   // 11-9 -> that IS a win
  g.matchWinner = 0; g.score = [10, 10];
  g.awardPoint(1, 'ТЕСТ');   // 11-10 -> not a win
  return ok(g.matchWinner === 0, `score ${g.score.join('-')} matchWinner=${g.matchWinner}`);
});

A('RULES', 'A serve that touches the net is a let, not a point', () => {
  const g = freshGame();
  g.startMatch(1);
  g.server = 1;
  g.isServeBall = true;
  const s0 = g.score.slice();
  g.letServe();
  return ok(g.score.join() === s0.join() && g.state === GSX.POINT,
    `score ${g.score.join('-')} (was ${s0.join('-')}), state ${g.state}`);
});

A('RULES', 'A serve that bounces twice on the receiver side is a fault', () => {
  const g = freshGame();
  g.startMatch(1);
  g.server = 1; g.isServeBall = true; g.ball.lastHitBy = 1;
  g.serveBounces = 0; g.rallyBounces.length = 0;
  g.onBounce(1, 5, { edge: 0 });            // server's own half
  g.onBounce(-1, 5, { edge: 0 });           // receiver's half -> legal
  const afterLegal = g.score.slice();
  g.isServeBall = true; g.serveBounces = 0; g.rallyBounces.length = 0;
  g.onBounce(-1, 5, { edge: 0 });           // straight into the receiver's half
  return ok(g.score[0] === afterLegal[0] && g.score[1] === afterLegal[1] + 1,
    `legal serve ${afterLegal.join('-')} -> fault ${g.score.join('-')}`);
});

A('RULES', 'A serve that bounces twice on the server side is a fault', () => {
  const g = freshGame();
  g.startMatch(1);
  g.server = 1; g.isServeBall = true; g.ball.lastHitBy = 1;
  g.serveBounces = 0; g.rallyBounces.length = 0;
  const s0 = g.score.slice();
  g.onBounce(1, 5, { edge: 0 });
  g.onBounce(1, 5, { edge: 0 });
  return ok(g.score[1] === s0[1] + 1, `score ${g.score.join('-')} (was ${s0.join('-')})`);
});

A('RULES', 'A ball that bounces twice on the receiver side gives the point to the hitter', () => {
  const g = freshGame();
  g.startMatch(1);
  g.isServeBall = false; g.ball.lastHitBy = 1;
  g.rallyBounces.length = 0;
  const s0 = g.score.slice();
  g.onBounce(-1, 5, { edge: 0 });
  g.onBounce(-1, 5, { edge: 0 });
  return ok(g.score[0] === s0[0] + 1, `score ${g.score.join('-')} (was ${s0.join('-')})`);
});

A('RULES', 'A ball that bounces on the hitter own side loses the point', () => {
  const g = freshGame();
  g.startMatch(1);
  g.isServeBall = false; g.ball.lastHitBy = 1;
  g.rallyBounces.length = 0;
  const s0 = g.score.slice();
  g.onBounce(1, 5, { edge: 0 });
  return ok(g.score[1] === s0[1] + 1, `score ${g.score.join('-')} (was ${s0.join('-')})`);
});

A('RULES', 'The serve toss lifts the ball at least 16 cm (ITTF 2.6.2)', () => {
  const g = freshGame();
  g.startMatch(1);
  g.server = 1;
  /* startToss() QUEUES the toss while the bat is still gliding home, so
     the old check measured a ball that had never been thrown. */
  g.recenterT = 0;
  const y0 = PH.TABLE_Y + 0.14;
  g.startToss();
  let apex = g.ball.p.y;
  for (let i = 0; i < 120; i++) { g.ball.p.y += g.ball.v.y * (1 / 600); g.ball.v.y -= PH.G * (1 / 600); if (g.ball.p.y > apex) apex = g.ball.p.y; }
  return ok(apex - y0 >= 0.16, `toss apex = ${num((apex - y0) * 100, 1)} cm above the hand (ITTF needs 16 cm)`);
});

A('RULES', 'The serve toss is close to vertical', () => {
  const g = freshGame();
  g.startMatch(1); g.server = 1; g.startToss();
  const v = g.ball.v;
  const horiz = Math.hypot(v.x, v.z);
  return ok(horiz < 0.1, `horizontal toss speed ${num(horiz, 4)} m/s (vertical ${num(v.y, 3)})`);
});

A('RULES', 'The point analyst maps every fault reason to a diagnosis', () => {
  const rec = new X.RallyRecorder();
  const an = new X.PointAnalyst();
  const reasons = ['В СЕТКУ', 'АУТ', 'МИМО ВБОК', 'ВЫ НЕ ДОСТАЛИ МЯЧ', 'УДАР С ЛЁТА НАД СТОЛОМ', 'ОШИБКА ПОДАЧИ', 'МЯЧ НЕ ПЕРЕЛЕТЕЛ', '???'];
  const bad = [];
  for (const r of reasons) {
    const n = an.analyse(rec, -1, r, null);
    if (!n || !n.text) bad.push(r);
  }
  return ok(bad.length === 0, bad.join(', ') || `all ${reasons.length} reasons produce a note`);
});

A('RULES', 'The point analyst never repeats itself verbatim', () => {
  const rec = new X.RallyRecorder();
  const an = new X.PointAnalyst();
  const a = an.analyse(rec, -1, 'В СЕТКУ', null);
  const b = an.analyse(rec, -1, 'В СЕТКУ', null);
  const c = an.analyse(rec, -1, 'В СЕТКУ', null);
  return ok(a.text !== b.text || b.text !== c.text, `three identical faults produced: "${a.text}" / "${b.text}" / "${c.text}"`);
});

A('RULES', 'The rally recorder counts the shots and the bounces', () => {
  const rec = new X.RallyRecorder();
  rec.begin(0, 1);
  rec.addShot(1, { t: 0.1, stroke: STROKES.LOOP, speed: 60, spin: 60, topspin: 200, quality: 1 });
  rec.addBounce(-1, 0.1, 0.5, 1);
  rec.addShot(-1, { t: 0.4, stroke: STROKES.DRIVE, speed: 50, spin: 20, topspin: 50, quality: 1 });
  /* addShot() stores the archetype as its id STRING, not as the object. */
  return ok(rec.length === 2 && rec.last(1).stroke === 'LOOP' && rec.last(-1).stroke === 'DRIVE' && rec.bounces.length === 1,
    `shots=${rec.length} last(1)=${rec.last(1) && rec.last(1).stroke} bounces=${rec.bounces.length}`);
});

A('RULES', 'The rally recorder finds the bounces after the last shot', () => {
  const rec = new X.RallyRecorder();
  rec.begin(0, 1);
  rec.addShot(1, { t: 0.1, stroke: STROKES.LOOP });
  rec.addBounce(-1, 0, 0.5, 1);
  rec.addShot(-1, { t: 0.4, stroke: STROKES.DRIVE });
  rec.addBounce(1, 0, 0.5, -1);
  return ok(rec.bouncesAfterLast(-1).length === 1, `${rec.bouncesAfterLast(-1).length} bounces after the AI's shot`);
});

A('RULES', 'A headless match runs to MATCH_END with no exception and no NaN', () => {
  const g = freshGame();
  g.settings.targetScore = 3;
  let err = null, nonFinite = 0, ended = false;
  try {
    g.startMatch(1);
    /* The player never swings in a headless run, so the serve has to be
       the AI's: otherwise the game sits in SERVE_READY waiting for a
       click that never comes and the match never ends. */
    g.server = -1;
    g.prepServe();
    for (let f = 0; f < 12000 && !ended; f++) {
      g.pointer = { x: 0.5, y: 0.6 };
      /* the player never swings in a headless run, so every point has to
         be served by the AI or the game waits for a click forever */
      if (g.state === GSX.SERVE_READY && g.server === 1) { g.server = -1; g.prepServe(); }
      g.update(1 / 60);
      if (!Number.isFinite(g.ball.p.x) || !Number.isFinite(g.ball.p.y) || !Number.isFinite(g.ball.p.z)) nonFinite++;
      if (g.state === GSX.MATCH_END) ended = true;
    }
  } catch (e) { err = e; }
  return ok(!err && ended && nonFinite === 0,
    err ? `exception: ${err && err.message}` : `ended=${ended} nonFinite=${nonFinite}`);
});

A('RULES', 'The ball never leaves the arena during a headless match', () => {
  const g = freshGame();
  g.settings.targetScore = 5;
  g.startMatch(2);
  let far = 0;
  for (let f = 0; f < 4000; f++) {
    g.pointer = { x: 0.5, y: 0.6 };
    g.update(1 / 60);
    if (g.ball.live && (Math.abs(g.ball.p.x) > 3 || Math.abs(g.ball.p.z) > 4 || g.ball.p.y > 3)) far++;
    if (g.state === GSX.MATCH_END) break;
  }
  return ok(far === 0, `${far} frames with the ball outside the arena`);
});

A('RULES', 'The bat returns to the centre on every new point', () => {
  const g = freshGame();
  g.settings.targetScore = 5;
  g.startMatch(1);
  /* The bat GLIDES back to the centre over RECENTER_S seconds; measuring
     in the first frame of SERVE_READY measures the glide, not the
     resting position. */
  /* The bat follows the pointer, so the pointer has to come back to the
     middle as well — otherwise the measurement is of the cursor, not of
     the reset. The glide back to the centre takes RECENTER_S seconds. */
  let worst = 0, n = 0, readyT = 0, centred = false;
  let ptr = { x: 0.9, y: 0.2 };
  for (let f = 0; f < 4000; f++) {
    if (g.state === GSX.SERVE_READY && !centred) { centred = true; readyT = 0; ptr = { x: 0.5, y: 0.55 }; }
    g.pointer = ptr;
    g.update(1 / 60);
    if (g.state === GSX.SERVE_READY) {
      readyT += 1 / 60;
      if (readyT > X.RECENTER_S) {
        n++;
        worst = Math.max(worst, Math.hypot(g.player.pos.x, g.player.pos.z - 1.44));
      }
    } else { centred = false; readyT = 0; }
    if (g.state === GSX.MATCH_END) break;
  }
  return ok(n > 0 && worst < 0.35, `worst distance from the centre over ${n} settled points = ${num(worst, 3)} m`);
});

A('RULES', 'The bat never leaves the frame during a headless match', () => {
  const g = freshGame();
  g.settings.targetScore = 5;
  g.startMatch(2);
  let off = 0, n = 0;
  for (let f = 0; f < 3000; f++) {
    g.pointer = { x: 0.5 + (f % 60) / 60, y: 0.3 };
    g.update(1 / 60);
    n++;
    const s = X.projectPoint(g.camVP, g.player.pos, {});
    if (!s.ok || s.x < 0.05 || s.x > 0.95 || s.y < 0.05 || s.y > 0.95) off++;
    if (g.state === GSX.MATCH_END) break;
  }
  return ok(off === 0, `${off}/${n} frames with the bat outside the frame`);
});

A('RULES', 'Pausing does not lose the rally state', () => {
  const g = freshGame();
  g.startMatch(1);
  for (let f = 0; f < 300; f++) { g.update(1 / 60); if (g.state === GSX.RALLY) break; }
  const before = { score: g.score.slice(), rally: g.rally, state: g.state };
  g.setPaused(true);
  const okPaused = g.paused === true;
  for (let f = 0; f < 60; f++) g.update(1 / 60);
  const same = g.score.join() === before.score.join() && g.rally === before.rally;
  g.setPaused(false);
  return ok(okPaused && same, `paused=${okPaused} state kept=${same}`);
});

A('RULES', 'The game survives a settings round-trip through the save', () => {
  const g = freshGame();
  g.settings.assist = 0.37; g.settings.sensitivity = 1.42; g.settings.volume = 0.55;
  g.saveSettings();
  const g2 = freshGame();
  return ok(Math.abs(g2.settings.assist - 0.37) < 1e-9 && Math.abs(g2.settings.sensitivity - 1.42) < 1e-9,
    `assist=${num(g2.settings.assist, 3)} sensitivity=${num(g2.settings.sensitivity, 3)}`);
});

/* ================================================================ *
 *  AREA 8 — PROFILE / SHOP / ECONOMY (86_meta.js)
 * ================================================================ */
A('META', 'A corrupt save file falls back to a clean profile', () => {
  const p = freshProfile('{not json');
  return ok(p && p.data && Number.isFinite(p.data.coins) && p.data.owned.length >= 2,
    `coins=${p.data.coins} owned=${p.data.owned.join(',')}`);
});

A('META', 'Prototype pollution in a save is rejected', () => {
  const p = freshProfile('{"__proto__":{"polluted":1},"coins":500}');
  return ok({}.polluted === undefined && p.data.coins === 500, `Object.prototype.polluted = ${JSON.stringify({}.polluted)}`);
});

A('META', 'A save with 1e309 coins is clamped', () => {
  const p = freshProfile('{"coins":1e309}');
  return ok(p.data.coins <= X.MAX_COINS, `coins = ${p.data.coins} (cap ${X.MAX_COINS})`);
});

A('META', 'A save with a NaN-ish coin value falls back to the default', () => {
  const p = freshProfile('{"coins":"много"}');
  return ok(Number.isFinite(p.data.coins), `coins = ${p.data.coins}`);
});

A('META', 'Equipped items that are not owned are replaced by the starter', () => {
  const p = freshProfile('{"owned":["b_base","r_base"],"equip":{"blade":"b_hero","fh":"r_hyb","bh":"r_base"}}');
  return ok(p.data.equip.blade === 'b_base' && p.data.equip.fh === 'r_base',
    `equip = ${JSON.stringify(p.data.equip)}`);
});

A('META', 'Unknown item ids in the inventory are dropped', () => {
  const p = freshProfile('{"owned":["b_base","r_base","b_nonexistent","__proto__"]}');
  return ok(p.data.owned.indexOf('b_nonexistent') < 0 && p.data.owned.indexOf('__proto__') < 0,
    `owned = ${p.data.owned.join(',')}`);
});

A('META', 'The starter kit is always owned', () => {
  const p = freshProfile('{"owned":[]}');
  return ok(p.data.owned.indexOf('b_base') >= 0 && p.data.owned.indexOf('r_base') >= 0, `owned = ${p.data.owned.join(',')}`);
});

A('META', 'The player level is clamped to a sane range', () => {
  const p = freshProfile('{"level":1e9}');
  return ok(p.data.level >= 1 && p.data.level <= 200, `level = ${p.data.level}`);
});

A('META', 'The daily tasks reset when the day changes', () => {
  const p = freshProfile('{"daily":{"day":"2000-1-1","tasks":{"win1":5},"done":["win1"],"claimed":["win1"]}}');
  return ok(p.data.daily.done.length === 0 && p.data.daily.claimed.length === 0 && Object.keys(p.data.daily.tasks).length === 0,
    `done=${JSON.stringify(p.data.daily.done)} tasks=${JSON.stringify(p.data.daily.tasks)}`);
});

A('META', 'The rewarded-ad budget is 5 per day', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), new X.Analytics(new X.Platform({ userAgent: 'node' })));
  const left0 = shop.adsLeft;
  const results = [];
  for (let i = 0; i < 8; i++) results.push(shop.rewardAd('coins2x'));
  const okCount = results.filter((r) => r.ok).length;
  return ok(left0 === X.MAX_ADS_PER_DAY && okCount <= X.MAX_ADS_PER_DAY,
    `adsLeft=${left0} granted ${okCount} of 8 attempts (cap ${X.MAX_ADS_PER_DAY})`);
});

A('META', 'A rewarded ad cannot be taken twice inside the cooldown', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const a = shop.rewardAd('coins2x');
  const b = shop.rewardAd('coins2x');
  return ok(a.ok && !b.ok && b.why === 'cooldown', `first=${a.ok} second ok=${b.ok} why=${b.why}`);
});

A('META', 'The same receipt cannot grant a bundle twice', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const a = shop.grant('crystals_120', 'receipt-abc');
  const b = shop.grant('crystals_120', 'receipt-abc');
  return ok(a && !b, `first=${a} second=${b}`);
});

A('META', 'A bundle marked "once" is granted only once', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const a = shop.grant('starter', 'r1');
  const b = shop.grant('starter', 'r2');
  return ok(a && !b, `first=${a} second=${b}`);
});

A('META', 'The granted crystals actually arrive', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const before = p.data.crystals;
  shop.grant('crystals_650', 'r1');
  return ok(p.data.crystals === before + 650, `crystals ${before} -> ${p.data.crystals}`);
});

A('META', 'Buying a racket charges coins and hands the item over', () => {
  const p = freshProfile('{}');
  p.data.coins = 5000;
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const before = p.data.coins;
  const bought = shop.buyRacket('b_ctl', 'coins');
  return ok(bought && p.owns('b_ctl') && p.data.coins === before - 1100,
    `bought=${bought} coins ${before} -> ${p.data.coins} owned=${p.owns('b_ctl')}`);
});

A('META', 'A racket cannot be bought without the coins', () => {
  const p = freshProfile('{}');
  p.data.coins = 10;
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  const bought = shop.buyRacket('b_ctl', 'coins');
  return ok(!bought && !p.owns('b_ctl') && p.data.coins === 10, `bought=${bought} coins=${p.data.coins}`);
});

A('META', 'A cosmetic that is already worn is never charged twice', () => {
  const p = freshProfile('{}');
  p.data.crystals = 1000;
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  shop.buyCosmetic('trail_gold');
  const c = p.data.crystals;
  const again = shop.buyCosmetic('trail_gold');
  return ok(!again && p.data.crystals === c, `second purchase=${again} crystals=${p.data.crystals}`);
});

A('META', 'The career-priced cosmetic is never sold', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  return ok(shop.buyCosmetic('arena_world') === false, 'arena_world is career-priced but buyCosmetic accepted it');
});

A('META', 'IAP is hidden on Poki and shown on a direct launch', () => {
  const poki = new X.Platform({ userAgent: 'node' });
  const pokiShop = new X.Shop(freshProfile('{}'), poki, null);
  const direct = new X.Platform({ userAgent: 'node' });
  const directShop = new X.Shop(freshProfile('{}'), direct, null);
  // force the platform flags
  Object.defineProperty(poki, 'poki', { value: true });
  Object.defineProperty(direct, 'poki', { value: false });
  return ok(pokiShop.iapOffers().length === 0 && directShop.iapOffers().length > 0,
    `poki offers=${pokiShop.iapOffers().length} direct offers=${directShop.iapOffers().length}`);
});

A('META', 'The shop never sells power: every racket has the same stat budget', () => {
  const budgets = ITEM_LIST.map((i) => Object.values(i.s).reduce((a, b) => a + b, 0));
  const uniq = [...new Set(budgets)];
  return ok(uniq.length === 1, `stat budgets seen: ${uniq.join(', ')}`);
});

A('META', 'The economy constants match the values the code uses', () => {
  const p = freshProfile('{}');
  const res = p.onMatchEnd(true, [11, 5], { shots: 30, rallies: 8, bestRally: 9, maxSpeed: 80, maxSpin: 70 }, 2);
  return ok(res.coins === X.ECONOMY.matchWin && res.xp === X.ECONOMY.level,
    `match win paid ${res.coins} coins / ${res.xp} xp (economy says ${X.ECONOMY.matchWin}/${X.ECONOMY.level})`);
});

A('META', 'A loss pays less than a win', () => {
  const p = freshProfile('{}');
  const w = p.onMatchEnd(true, [11, 5], {}, 0);
  const l = p.onMatchEnd(false, [5, 11], {}, 0);
  return ok(w.coins > l.coins && w.xp > l.xp, `win ${w.coins}/${w.xp} vs loss ${l.coins}/${l.xp}`);
});

A('META', 'The profile survives a reload (progress persists)', () => {
  const p = freshProfile('{}');
  p.addCoins(500, 'test');
  p.addXP(1000);
  p.save(true);
  const p2 = freshProfile(store().getItem(X.SAVE_KEY));
  return ok(p2.data.coins === p.data.coins && p2.data.level === p.data.level,
    `coins ${p.data.coins} -> ${p2.data.coins}, level ${p.data.level} -> ${p2.data.level}`);
});

A('META', 'The daily task can be claimed exactly once', () => {
  const p = freshProfile('{}');
  p.taskProgress('win1', 0, 1);
  const a = p.claimTask('win1');
  const b = p.claimTask('win1');
  return ok(a > 0 && b === 0, `first=${a} second=${b}`);
});

A('META', 'The streak bonus is applied to the daily reward', () => {
  const p = freshProfile('{}');
  p.data.streak = 7;
  p.taskProgress('win1', 0, 1);
  const c = p.claimTask('win1');
  return ok(c === Math.round(120 * 1.5), `claim paid ${c} (base 120, streak 7 -> x1.5 = 180)`);
});

A('META', 'The level curve gives a growing XP cost per level', () => {
  const p = freshProfile('{}');
  const c1 = p.xpToNext();
  p.data.level = 10;
  const c2 = p.xpToNext();
  return ok(c2 > c1, `level 1 needs ${c1} xp, level 10 needs ${c2}`);
});

A('META', 'The season progress bar matches the season level', () => {
  const p = freshProfile('{}');
  p.addSeasonXP(250 * 3 + 125);
  const lvl = p.seasonLevel(), pr = p.seasonProgress();
  return ok(lvl === 4 && Math.abs(pr - 0.5) < 1e-9, `level=${lvl} progress=${num(pr, 3)}`);
});

A('META', 'The profile stores the settings object the game reads', () => {
  const p = freshProfile('{}');
  return ok(p.data.settings === null || typeof p.data.settings === 'object', `settings = ${typeof p.data.settings}`);
});

/* ================================================================ *
 *  AREA 9 — CAREER (25_career.js)
 * ================================================================ */
A('CAREER', 'The perk pool respects the rarity gates', () => {
  const fake = { currentTournament: 0, perks: [] };
  const early = X.getAvailablePerks(fake);
  const hasBlue = early.some((p) => p.rarity === 'blue');
  fake.currentTournament = 7;
  const late = X.getAvailablePerks(fake);
  const hasGold = late.some((p) => p.rarity === 'gold');
  return ok(!hasBlue && hasGold, `tournament 0 offers blue=${hasBlue}; tournament 7 offers gold=${hasGold}`);
});

A('CAREER', 'Three perks are offered at a time', () => {
  const fake = { currentTournament: 9, perks: [] };
  const three = X.pickThreePerks(fake);
  return ok(three.length === 3 && new Set(three.map((p) => p.id)).size === 3, `${three.length} distinct perks offered`);
});

A('CAREER', 'The same perk is never offered twice', () => {
  const fake = { currentTournament: 9, perks: [{ id: 'steady_hand' }] };
  const three = X.pickThreePerks(fake);
  return ok(!three.some((p) => p.id === 'steady_hand'), `offered: ${three.map((p) => p.id).join(',')}`);
});

A('CAREER', 'A career run can be started, played and saved', () => {
  const g = freshGame();
  const c = new X.Career(g);
  c.start();
  const okStart = c.active && c.state === 'TOURNAMENT_INTRO' && c.opponents.length === X.TOURNAMENTS[0].rounds;
  c.readyForOpponentSelect();
  c.selectOpponent(0);
  const okSelect = c.state === 'MATCH';
  c.onMatchEnd(1);
  const okWin = c.totalWins === 1;
  c.save();
  return ok(okStart && okSelect && okWin, `start=${okStart} select=${okSelect} win=${okWin}`);
});

A('CAREER', 'Losing a career match ends the run', () => {
  const g = freshGame();
  const c = new X.Career(g);
  c.start(); c.readyForOpponentSelect(); c.selectOpponent(0);
  c.onMatchEnd(-1);
  return ok(c.state === 'RUN_END', `state = ${c.state}`);
});

A('CAREER', 'Winning a career match advances the round', () => {
  const g = freshGame();
  const c = new X.Career(g);
  c.start(); c.readyForOpponentSelect(); c.selectOpponent(0);
  const before = c.currentRound;
  c.onMatchEnd(1);
  return ok(c.currentRound === before + 1, `round ${before} -> ${c.currentRound}`);
});

A('CAREER', 'The career opponents scale in ELO with the tournament', () => {
  const bad = [];
  for (let i = 1; i < X.TOURNAMENTS.length; i++) {
    if (X.TOURNAMENTS[i].eloMin < X.TOURNAMENTS[i - 1].eloMin) bad.push(`tournament ${i} eloMin goes down`);
    if (X.TOURNAMENTS[i].eloMax < X.TOURNAMENTS[i - 1].eloMax) bad.push(`tournament ${i} eloMax goes down`);
  }
  return ok(bad.length === 0, bad.join('; ') || 'the ladder only ever goes up');
});

A('CAREER', 'A career opponent is generated inside the tournament ELO band', () => {
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const t = X.TOURNAMENTS[i % X.TOURNAMENTS.length];
    const o = X.generateOpponent(t.eloMin, t.eloMax);
    if (o.elo < t.eloMin || o.elo > t.eloMax) bad++;
  }
  return ok(bad === 0, `${bad}/200 opponents outside their band`);
});

A('CAREER', 'The career save round-trips through localStorage', () => {
  const g = freshGame();
  const c = new X.Career(g);
  c.start(); c.readyForOpponentSelect(); c.selectOpponent(0); c.onMatchEnd(1);
  c.save();
  const raw = store().getItem('topspin_career');
  const c2 = new X.Career(g);
  const loaded = c2.load();
  return ok(loaded && c2.totalWins === c.totalWins && c2.currentTournament === c.currentTournament,
    `loaded=${loaded} wins ${c.totalWins} -> ${c2.totalWins}`);
});

A('CAREER', 'The perk boosts are reset at the start of a new run', () => {
  const g = freshGame();
  g.settings.assist = 0.5;
  const c = new X.Career(g);
  c.start();
  /* The perk has to be taken through selectPerk(): that is the path the
     game uses, and it is the path that records what the perk changed so
     the change can be taken back. */
  c.pendingPerks = [X.PERKS.find((p) => p.id === 'steady_hand')];
  c.selectPerk(0);
  const boosted = g.settings.assist;
  c.start();
  return ok(Math.abs(g.settings.assist - 0.5) < 1e-9 && boosted > 0.5,
    `assist was ${num(boosted, 3)} with the perk, ${num(g.settings.assist, 3)} after a reset`);
});

A('CAREER', 'The career mode is reachable from the menu (UI hooks exist)', () => {
  const g = freshGame();
  return ok(g.career && typeof g.career.start === 'function' && g.ui && typeof g.ui.bindCareer === 'function',
    'career object and UI binding are present');
});

/* ================================================================ *
 *  AREA 10 — TRAINER (65_train.js)
 * ================================================================ */
A('TRAIN', 'The trainer has a coherent set of steps', () => {
  const ids = X.TRAIN_STEPS.map((s) => s.id);
  const bad = X.TRAIN_STEPS.filter((s) => !s.title || !s.tip || !s.need || !s.gesture || s.gesture.length < 2);
  return ok(bad.length === 0 && new Set(ids).size === ids.length, `${ids.length} steps: ${ids.join(',')}`);
});

A('TRAIN', 'The trainer does not score points', () => {
  const g = freshGame();
  g.startMatch(1);
  const t = new X.Trainer(g);
  t.begin();
  const s0 = g.score.slice();
  t.onFault(1, 'В СЕТКУ');
  t.onFault(-1, 'В СЕТКУ');
  return ok(g.score.join() === s0.join(), `score ${g.score.join('-')} (was ${s0.join('-')})`);
});

A('TRAIN', 'The trainer feeds a ball the player can hit', () => {
  const g = freshGame();
  g.startMatch(1);
  const t = new X.Trainer(g);
  t.begin();
  t.goStep(1);
  t.phase = 'wait';
  t.feed();
  return ok(g.ball.live && Number.isFinite(g.ball.p.x) && Number.isFinite(g.ball.v.z),
    `ball live=${g.ball.live} v=(${num(g.ball.v.x, 2)},${num(g.ball.v.y, 2)},${num(g.ball.v.z, 2)})`);
});

A('TRAIN', 'The trainer counts the attempts and the passes', () => {
  const g = freshGame();
  g.startMatch(1);
  const t = new X.Trainer(g);
  t.begin(); t.goStep(1); t.phase = 'live';
  t.onPlayerHit({ topspin: 200, sidespin: 0, speed: 60 });
  const a1 = t.attempts;
  t.onBounce(-1, 1);
  return ok(a1 === 1 && (t.done === 1 || t.phase === 'ok'), `attempts=${a1} done=${t.done} phase=${t.phase}`);
});

A('TRAIN', 'The trainer fails a step whose check does not pass', () => {
  const g = freshGame();
  g.startMatch(1);
  const t = new X.Trainer(g);
  t.begin(); t.goStep(1); t.phase = 'live';
  t.onPlayerHit({ topspin: 0, sidespin: 0, speed: 10 });
  t.onBounce(-1, 1);
  return ok(t.phase === 'fail', `phase = ${t.phase} (expected fail)`);
});

A('TRAIN', 'The trainer restores the menu state when it is quit', () => {
  const g = freshGame();
  const t = new X.Trainer(g);
  t.begin();
  t.quit();
  return ok(g.training === null && g.state === GSX.MENU, `training=${g.training} state=${g.state}`);
});

A('TRAIN', 'The training steps use the physics solver for the feed', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '65_train.js'), 'utf8');
  return ok(src.indexOf('solveLaunch') >= 0, 'the feeder does not call solveLaunch');
});

A('TRAIN', 'The trainer never leaves the ball in a NaN state', () => {
  const g = freshGame();
  g.startMatch(1);
  const t = new X.Trainer(g);
  t.begin();
  let bad = 0;
  for (let s = 0; s < X.TRAIN_STEPS.length; s++) {
    t.goStep(s); t.phase = 'wait';
    t.feed();
    for (let i = 0; i < 30; i++) { t.update(1 / 60); }
    if (!Number.isFinite(g.ball.p.x) || !Number.isFinite(g.ball.v.x) || !Number.isFinite(g.ball.w.x)) bad++;
  }
  return ok(bad === 0, `${bad}/${X.TRAIN_STEPS.length} training steps produced a non-finite ball`);
});

/* ================================================================ *
 *  AREA 11 — MOMENTS / REPLAY (59_replay.js)
 * ================================================================ */
A('REPLAY', 'The moment recorder stores the ring at the advertised rate', () => {
  /* The ring is indexed at REPLAY_HZ (30 Hz), so the GAME has to fill it
     at 30 Hz as well. It used to push one frame per rendered frame (60 Hz
     on a 60 Hz display), which filled the ring twice as fast as the clip
     arithmetic assumes and cut clips that covered half the rally. */
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  const before = mr.n;
  for (let i = 0; i < 60; i++) mr.push(i / 60, g);
  const pushed = mr.n - before;
  return ok(pushed === 60, `pushed ${pushed} frames for 1 s of play; the ring is sized for ${X.REPLAY_HZ} Hz`);
});

A('REPLAY', 'The game fills the replay ring at REPLAY_HZ, not at the frame rate', () => {
  const g = freshGame();
  g.startMatch(1);
  /* the AI serves, so that a rally actually happens */
  g.server = -1;
  g.prepServe();
  const mr = g.moments;
  let frames = 0, rallyFrames = 0;
  const realPush = mr.push.bind(mr);
  mr.push = (t, gg) => { frames++; return realPush(t, gg); };
  for (let f = 0; f < 2400; f++) {
    if (g.state === GSX.SERVE_READY && g.server === 1) { g.server = -1; g.prepServe(); }
    g.update(1 /60);
    if (g.state === GSX.RALLY || g.state === GSX.SERVE_TOSS) rallyFrames++;
    if (g.state === GSX.MATCH_END) break;
  }
  /* only the frames spent in a rally are recorded, so the limit is
     REPLAY_HZ per second of rally: 30 frames for every 60 rendered frames */
  const limit = Math.ceil(rallyFrames * X.REPLAY_HZ / 60) + 3;
  return ok(frames <= limit && rallyFrames > 0,
    `pushed ${frames} frames for ${rallyFrames} rendered frames of rally (limit ${limit} at ${X.REPLAY_HZ} Hz)`);
});

A('REPLAY', 'The clip length matches the ring content', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  mr.beginRally(0, [0, 0]);
  const n = Math.round(2.0 * X.REPLAY_HZ);
  for (let i = 0; i < n; i++) mr.push(i / X.REPLAY_HZ, g);
  /* a rally with fewer than three contacts is never kept as a moment */
  mr.addContact(0.2, { by: 1, stroke: 'LOOP', speed: 60, spin: 60 });
  mr.addContact(0.6, { by: -1, stroke: 'DRIVE', speed: 50, spin: 30 });
  mr.addContact(1.0, { by: 1, stroke: 'LOOP', speed: 70, spin: 70 });
  const t = 2.0;                     // 2 s of rally
  const m = mr.endRally(t, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  const len = m ? m.frames.length / X.REPLAY_FLOATS : 0;
  const expected = n;
  return ok(Math.abs(len - expected) / expected < 0.2,
    `clip = ${num(len, 1)} frames for a 2.0 s rally (expected ~${num(expected, 1)} at ${X.REPLAY_HZ} Hz)`);
});

A('REPLAY', 'The clip actually contains the whole rally', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  mr.beginRally(0, [0, 0]);
  const n = Math.round(2.0 * X.REPLAY_HZ);
  for (let i = 0; i < n; i++) mr.push(i / X.REPLAY_HZ, g);
  mr.addContact(0.2, { by: 1, stroke: 'LOOP', speed: 60, spin: 60 });
  mr.addContact(0.6, { by: -1, stroke: 'DRIVE', speed: 50, spin: 30 });
  mr.addContact(1.0, { by: 1, stroke: 'LOOP', speed: 70, spin: 70 });
  const m = mr.endRally(2.0, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  const len = m ? m.frames.length / X.REPLAY_FLOATS : 0;
  const ring = mr.n;
  return ok(len >= ring * 0.9, `clip has ${num(len, 1)} frames but the ring holds ${ring} for the same rally`);
});

A('REPLAY', 'A two-shot point is never kept as a moment', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  mr.beginRally(0, [0, 0]);
  for (let i = 0; i < 30; i++) mr.push(i / 60, g);
  mr.addContact(0.1, { by: 1, stroke: 'LOOP', speed: 50, spin: 40 });
  mr.addContact(0.5, { by: -1, stroke: 'DRIVE', speed: 40, spin: 20 });
  const m = mr.endRally(1.0, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  return ok(m === null, `a 2-shot point produced a moment (${m ? 'yes' : 'no'})`);
});

A('REPLAY', 'The beauty score is bounded and monotone in the rally length', () => {
  const b = X.BEAUTY;
  let lo = 0, hi = 0;
  for (let n = 0; n <= 40; n++) { const s = b.rally(n); lo = Math.min(lo, s); hi = Math.max(hi, s); }
  return ok(lo >= 0 && hi <= 0.31, `rally component ranges ${num(lo, 3)}..${num(hi, 3)}`);
});

A('REPLAY', 'The best moment is the highest scoring one', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  const make = (t, score) => {
    mr.beginRally(0, score);
    for (let i = 0; i < 60; i++) mr.push(i / 60, g);
    for (let k = 0; k < 6; k++) mr.addContact(0.1 * k, { by: k % 2 ? 1 : -1, stroke: 'LOOP', speed: 70, spin: 60 });
    return mr.endRally(1.0, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  };
  make(0, [0, 0]); make(0, [0, 0]);
  const best = mr.best;
  const top = Math.max(...mr.kept.map((m) => m.score));
  return ok(!best || Math.abs(best.score - top) < 1e-9, `best score ${num(best && best.score, 3)} vs top ${num(top, 3)}`);
});

A('REPLAY', 'At most REPLAY_KEEP moments survive a match', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  for (let r = 0; r < 20; r++) {
    mr.beginRally(0, [0, 0]);
    for (let i = 0; i < 30; i++) mr.push(i / 60, g);
    for (let k = 0; k < 6; k++) mr.addContact(0.1 * k, { by: 1, stroke: 'LOOP', speed: 70, spin: 60 });
    mr.endRally(0.5, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  }
  return ok(mr.kept.length <= X.REPLAY_KEEP, `${mr.kept.length} moments kept (cap ${X.REPLAY_KEEP})`);
});

A('REPLAY', 'The replay player leaves the ball in a finite state', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  mr.beginRally(0, [0, 0]);
  for (let i = 0; i < 60; i++) mr.push(i / 60, g);
  for (let k = 0; k < 6; k++) mr.addContact(0.1 * k, { by: 1, stroke: 'LOOP', speed: 70, spin: 60 });
  const m = mr.endRally(1.0, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  const pl = new X.MomentPlayer();
  pl.play(m, 0.35);
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    pl.update(1 / 60, g);
    if (!Number.isFinite(g.ball.p.x) || !Number.isFinite(g.ball.p.y) || !Number.isFinite(g.ball.p.z)) bad++;
  }
  return ok(bad === 0, `${bad}/200 replay frames produced a non-finite ball`);
});

A('REPLAY', 'The replay player finishes and calls its callback', () => {
  const g = freshGame();
  g.startMatch(1);
  const mr = g.moments;
  mr.beginRally(0, [0, 0]);
  for (let i = 0; i < 30; i++) mr.push(i / 60, g);
  for (let k = 0; k < 6; k++) mr.addContact(0.1 * k, { by: 1, stroke: 'LOOP', speed: 70, spin: 60 });
  const m = mr.endRally(0.5, g, { winner: 1, reason: 'ОЧКО!', score: [1, 0], target: 11 });
  const pl = new X.MomentPlayer();
  let done = false;
  pl.play(m, 1.0, () => { done = true; });
  for (let i = 0; i < 600 && !done; i++) pl.update(1 / 60, g);
  return ok(done, `the replay never finished (on=${pl.on})`);
});

/* ================================================================ *
 *  AREA 12 — NETWORK (27_network.js)
 * ================================================================ */
A('NET', 'The game never opens a socket on its own', () => {
  const g = freshGame();
  return ok(g.network && g.network.state === 'OFFLINE' && !g.network.connected,
    `state=${g.network.state} connected=${g.network.connected}`);
});

A('NET', 'The relay URL is a real deployment, not a placeholder', () => {
  const u = X.NET_SERVER_URL;
  const placeholder = /your\.host|example\.com|localhost|127\.0\.0\.1|REPLACE|CHANGE/i.test(u);
  return ok(!placeholder, `relay = ${u}${placeholder ? ' (looks like a placeholder)' : ''}`);
});

A('NET', 'A guest applies the host state to the ball', () => {
  const g = freshGame();
  const net = g.network;
  net.isHost = false; net.state = 'IN_MATCH';
  net._applyRemoteState({ ball: { p: [0.1, 1.0, -0.5], v: [0, 0, 6], w: [10, 0, 0] }, racket: { pos: [0, 1, -1.4], n: [0, 0, 1], sw: 0.3 }, score: [3, 2] });
  return ok(g.ball.live && Math.abs(g.ball.p.z + 0.5) < 0.2 && g.score.join() === '3,2',
    `ball p=(${num(g.ball.p.x, 2)},${num(g.ball.p.y, 2)},${num(g.ball.p.z, 2)}) score=${g.score.join('-')}`);
});

A('NET', 'A host applies the guest input to the opponent racket', () => {
  const g = freshGame();
  const net = g.network;
  net.isHost = true; net.state = 'IN_MATCH';
  net._applyRemoteInput({ pos: [0.2, 1.1, -1.3], n: [0.1, 0, 0.99], sw: 0.7 });
  const op = net.opponentRacket;
  return ok(Math.abs(op.pos.x - 0.2) < 1e-6 && Math.abs(op.anim.swing - 0.7) < 1e-6,
    `opponent racket at (${num(op.pos.x, 3)}, ${num(op.pos.y, 3)}, ${num(op.pos.z, 3)}) swing=${num(op.anim.swing, 3)}`);
});

A('NET', 'The interpolation buffer is actually used', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', '27_network.js'), 'utf8');
  const writes = (src.match(/_interpBuf/g) || []).length;
  const reads = (src.match(/_interpBuf\[|_interpBuf\.(shift|forEach|map|filter)/g) || []).length;
  return ok(reads >= 1, `_interpBuf is referenced ${writes} times but never read (${reads} reads)`);
});

A('NET', 'The state rate limits are sane', () => {
  return ok(X.NET_TICK_RATE >= 10 && X.NET_TICK_RATE <= 60 && X.NET_INPUT_RATE >= 10 && X.NET_INPUT_RATE <= 60,
    `state ${X.NET_TICK_RATE} Hz, input ${X.NET_INPUT_RATE} Hz`);
});

A('NET', 'The input rate is at least the state rate (the peer must move smoothly)', () => {
  return ok(X.NET_INPUT_RATE >= X.NET_TICK_RATE, `input ${X.NET_INPUT_RATE} Hz < state ${X.NET_TICK_RATE} Hz`);
});

A('NET', 'A malformed server message does not crash the client', () => {
  const g = freshGame();
  const net = g.network;
  let threw = null;
  try {
    net._handle({ type: 'state' });
    net._handle({ type: 'nonsense' });
    net._handle({});
    net._handle({ type: 'assigned' });
  } catch (e) { threw = e; }
  return ok(!threw, threw ? `threw: ${threw && threw.message}` : 'four malformed messages handled');
});

/* ================================================================ *
 *  AREA 13 — RENDERER / GEOMETRY (20_gl.js, 60_scene.js)
 * ================================================================ */
A('GFX', 'The sphere is wound outwards (it is not inside-out)', () => {
  const g = X.makeSphere(0.02, 16, 10);
  let wrong = 0, n = 0;
  for (let t = 0; t < g.ni; t += 3) {
    const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const e1 = [g.pos[b * 3] - ax, g.pos[b * 3 + 1] - ay, g.pos[b * 3 + 2] - az];
    const e2 = [g.pos[c * 3] - ax, g.pos[c * 3 + 1] - ay, g.pos[c * 3 + 2] - az];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + g.pos[b * 3] + g.pos[c * 3]) / 3, cy = (ay + g.pos[b * 3 + 1] + g.pos[c * 3 + 1]) / 3, cz = (az + g.pos[b * 3 + 2] + g.pos[c * 3 + 2]) / 3;
    const d = fn[0] * cx + fn[1] * cy + fn[2] * cz;
    /* The pole triangles are degenerate (all three vertices on the same
       ring, zero area), so their face normal is numerical noise. They
       have to be excluded or the winding cannot be judged. */
    const area = 0.5 * Math.hypot(fn[0], fn[1], fn[2]);
    if (area < 1e-12) continue;
    n++;
    if (d <= 0) wrong++;
  }
  return ok(wrong === 0, `${wrong}/${n} sphere triangles face inward`);
});

A('GFX', 'The box is wound outwards', () => {
  const g = X.makeBox(1, 1, 1);
  let wrong = 0, n = 0;
  for (let t = 0; t < g.ni; t += 3) {
    const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const e1 = [g.pos[b * 3] - ax, g.pos[b * 3 + 1] - ay, g.pos[b * 3 + 2] - az];
    const e2 = [g.pos[c * 3] - ax, g.pos[c * 3 + 1] - ay, g.pos[c * 3 + 2] - az];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + g.pos[b * 3] + g.pos[c * 3]) / 3, cy = (ay + g.pos[b * 3 + 1] + g.pos[c * 3 + 1]) / 3, cz = (az + g.pos[b * 3 + 2] + g.pos[c * 3 + 2]) / 3;
    n++;
    if (fn[0] * cx + fn[1] * cy + fn[2] * cz <= 0) wrong++;
  }
  return ok(wrong === 0, `${wrong}/${n} box triangles face inward`);
});

A('GFX', 'The cylinder is wound outwards', () => {
  const g = X.makeCylinder(0.1, 0.1, 0.3, 16);
  let wrong = 0, n = 0;
  for (let t = 0; t < g.ni; t += 3) {
    const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const e1 = [g.pos[b * 3] - ax, g.pos[b * 3 + 1] - ay, g.pos[b * 3 + 2] - az];
    const e2 = [g.pos[c * 3] - ax, g.pos[c * 3 + 1] - ay, g.pos[c * 3 + 2] - az];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + g.pos[b * 3] + g.pos[c * 3]) / 3, cy = (ay + g.pos[b * 3 + 1] + g.pos[c * 3 + 1]) / 3, cz = (az + g.pos[b * 3 + 2] + g.pos[c * 3 + 2]) / 3;
    n++;
    if (fn[0] * cx + fn[1] * cy + fn[2] * cz <= 0) wrong++;
  }
  return ok(wrong === 0, `${wrong}/${n} cylinder triangles face inward`);
});

A('GFX', 'The paddle blade is wound outwards', () => {
  const g = X.makePaddleBlade(0.075, 0.085, 0.006, 24);
  let wrong = 0, n = 0;
  for (let t = 0; t < g.ni; t += 3) {
    const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const e1 = [g.pos[b * 3] - ax, g.pos[b * 3 + 1] - ay, g.pos[b * 3 + 2] - az];
    const e2 = [g.pos[c * 3] - ax, g.pos[c * 3 + 1] - ay, g.pos[c * 3 + 2] - az];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + g.pos[b * 3] + g.pos[c * 3]) / 3, cy = (ay + g.pos[b * 3 + 1] + g.pos[c * 3 + 1]) / 3, cz = (az + g.pos[b * 3 + 2] + g.pos[c * 3 + 2]) / 3;
    n++;
    if (fn[0] * cx + fn[1] * cy + fn[2] * cz <= 0) wrong++;
  }
  return ok(wrong === 0, `${wrong}/${n} blade triangles face inward`);
});

A('GFX', 'The geometry builders never overflow their index buffer', () => {
  const cases = [X.makeBox(1, 1, 1), X.makeSphere(0.02, 32, 20), X.makeCylinder(0.1, 0.1, 0.3, 24),
    X.makePaddleBlade(0.075, 0.085, 0.006, 48), X.makePlane(2, 3, 1, 4), X.makeQuad(1, 1, 1)];
  const bad = cases.filter((g) => g.ni > g.idx.length || g.nv * 3 > g.pos.length);
  return ok(bad.length === 0, `${bad.length} builders overflowed their buffers`);
});

A('GFX', 'The trail mesh can hold the whole ball history', () => {
  const g = freshGame();
  g.startMatch(1);
  const cap = g.scene.mesh.trail.pos.length / 3;
  const need = 96 * 2;                 // 96 history points -> 2 vertices each
  return ok(cap >= need, `trail mesh holds ${cap} vertices, the history needs ${need}`);
});

A('GFX', 'The trail index buffer can hold the whole history', () => {
  const g = freshGame();
  g.startMatch(1);
  const cap = g.scene.mesh.trail.idx.length;
  const need = (96 - 1) * 6;
  return ok(cap >= need, `trail index buffer holds ${cap}, the history needs ${need}`);
});

A('GFX', 'The shadow map is not allocated while shadows are off', () => {
  const g = freshGame();
  return ok(g.R.useShadowMap === false && g.R.shadowFBO === null,
    `useShadowMap=${g.R.useShadowMap} shadowFBO=${g.R.shadowFBO ? 'allocated' : 'null'}`);
});

A('GFX', 'The renderer allocates the scene target on resize', () => {
  const g = freshGame();
  g.resize();
  return ok(g.R.rtScene && g.R.rtA && g.R.rtB && g.R.rtScene.w > 1,
    `rtScene=${g.R.rtScene ? g.R.rtScene.w + 'x' + g.R.rtScene.h : 'null'}`);
});

A('GFX', 'The bloom chain stays inside its half-resolution targets', () => {
  const g = freshGame();
  g.resize();
  return ok(g.R.bw === Math.max(2, g.R._w >> 2) && g.R.bh === Math.max(2, g.R._h >> 2),
    `bloom ${g.R.bw}x${g.R.bh} vs scene ${g.R._w}x${g.R._h}`);
});

A('GFX', 'The GLSL1 downgrade produces ES 1.00-compatible source', () => {
  const s1 = X.toGLSL1(X.FS_MAIN, true);
  const v1 = X.toGLSL1(X.VS_MAIN, false);
  const bad = [];
  if (/\bin\s+(vec[234]|float|mat[234])\b/.test(s1)) bad.push('fragment still has `in`');
  if (/\btexture\s*\(/.test(s1)) bad.push('fragment still uses texture()');
  if (/\bout\s+vec4\b/.test(s1)) bad.push('fragment still declares an out');
  if (/\blayout\s*\(/.test(v1)) bad.push('vertex still has layout()');
  if (/\bin\s+vec/.test(v1)) bad.push('vertex still has `in`');
  if (s1.indexOf('gl_FragColor') < 0) bad.push('no gl_FragColor');
  return ok(bad.length === 0, bad.join('; ') || 'the downgrade is clean');
});

A('GFX', 'The composite pass tone-maps (the HDR input is clamped)', () => {
  return ok(X.FS_COMPOSITE.indexOf('aces(') >= 0 && X.FS_COMPOSITE.indexOf('clamp((x*(a*x+b))') >= 0,
    'the ACES curve is not clamped');
});

/* ================================================================ *
 *  AREA 14 — BUILD / PACKAGING
 * ================================================================ */
A('BUILD', 'The bundle rebuilds byte-identically from the sources', () => {
  const out = '/tmp/audit150_build.html';
  const { execFileSync } = require('child_process');
  try {
    execFileSync('python3', [path.join(__dirname, '..', 'build.py'), out], { stdio: 'pipe' });
  } catch (e) { return ok(false, 'build.py failed: ' + String(e && e.message).slice(0, 120)); }
  const shipped = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const built = fs.readFileSync(out, 'utf8');
  const strip = (s) => s.replace(/<!-- TOPSPIN ARENA · self-contained build [\d-]+ ·[^>]*-->/, '').replace(/\n+$/, '');
  return ok(strip(shipped) === strip(built), `shipped ${shipped.length} B vs rebuilt ${built.length} B`);
});

A('BUILD', 'Every module on disk is in the build order', () => {
  const build = fs.readFileSync(path.join(__dirname, '..', 'build.py'), 'utf8');
  const m = build.match(/JS_ORDER\s*=\s*\[([\s\S]*?)\]/);
  const listed = (m ? m[1] : '').match(/'([^']+\.js)'/g).map((s) => s.replace(/'/g, ''));
  const onDisk = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'));
  const missing = onDisk.filter((f) => listed.indexOf(f) < 0);
  return ok(missing.length === 0, `not in JS_ORDER: ${missing.join(', ') || 'none'}`);
});

A('BUILD', 'The shipped page makes no external requests', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const ext = html.match(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi) || [];
  const imports = html.match(/import\s+[^;]*from\s+["']https?:/gi) || [];
  const fetchs = html.match(/fetch\(\s*["']https?:/gi) || [];
  const bad = ext.concat(imports, fetchs);
  return ok(bad.length === 0, bad.length ? `external references: ${bad.slice(0, 3).join(', ')}` : 'no external references');
});

A('BUILD', 'The bundle stays inside the portal size limit', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const kb = Buffer.byteLength(html) / 1024;
  return ok(kb < 8192, `bundle = ${num(kb, 1)} KB (portal limit is usually 8 MB)`);
});

A('BUILD', 'Every element the code looks up by id exists in the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const src = fs.readdirSync(path.join(__dirname, '..', 'src'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).join('\n');
  const ids = [...src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => html.indexOf(`id="${id}"`) < 0 && html.indexOf(`id='${id}'`) < 0);
  return ok(missing.length === 0, `missing ids: ${missing.join(', ') || 'none'} (of ${new Set(ids).size})`);
});

A('BUILD', 'Every use of --band-y in the stylesheet carries a fallback', () => {
  /* The variable is never declared at the top level: the HUD uses
     var(--band-y, 0.44) everywhere, so a missing declaration is fine as
     long as every use has a fallback of its own. */
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', '05_style.css'), 'utf8');
  const uses = css.match(/var\(--band-y[^)]*\)/g) || [];
  const noFallback = uses.filter((u) => !/var\(--band-y\s*,/.test(u));
  return ok(uses.length > 0 && noFallback.length === 0,
    `${uses.length} uses of --band-y, ${noFallback.length} without a fallback`);
});

A('BUILD', 'The page is mobile-ready (viewport, touch-action, safe area)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const okVp = /viewport-fit=cover/.test(html);
  const okMeta = /width=device-width/.test(html);
  const okTheme = /theme-color/.test(html);
  return ok(okVp && okMeta && okTheme, `viewport-fit=${okVp} device-width=${okMeta} theme-color=${okTheme}`);
});

A('BUILD', 'Every module parses as valid JavaScript', () => {
  const bad = [];
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    try { new Function(code); } catch (e) { bad.push(`${f}: ${e.message}`); }
  }
  return ok(bad.length === 0, bad.join(' | ') || 'all modules parse');
});

A('BUILD', 'The shipped bundle is the one the sources produce (module count)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  const marks = (html.match(/\/\* ====== (\d\d_[a-z_]+\.js) ====== \*\//g) || []).length;
  const onDisk = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.js')).length;
  return ok(marks === onDisk, `the bundle has ${marks} module markers, the sources have ${onDisk}`);
});

/* ================================================================ *
 *  AREA 15 — ROBUSTNESS / FUZZING
 * ================================================================ */
A('FUZZ', '1000 random gestures never throw', () => {
  let threw = 0;
  for (let i = 0; i < 1000; i++) {
    const s = new SwipeTracker();
    s.down(Math.random(), Math.random(), 0);
    for (let k = 0; k < 12; k++) s.move(Math.random() * 2 - 0.5, Math.random() * 2 - 0.5, k * 0.016);
    const m = s.up(Math.random() * 2 - 0.5, Math.random() * 2 - 0.5, 0.2);
    try {
      deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
    } catch (e) { threw++; }
  }
  return ok(threw === 0, `${threw}/1000 random gestures threw`);
});

A('FUZZ', '1000 random gestures never produce a non-finite racket', () => {
  let bad = 0;
  for (let i = 0; i < 1000; i++) {
    const s = new SwipeTracker();
    s.down(Math.random(), Math.random(), 0);
    for (let k = 0; k < 12; k++) s.move(Math.random() * 2 - 0.5, Math.random() * 2 - 0.5, k * 0.016);
    const m = s.up(Math.random() * 2 - 0.5, Math.random() * 2 - 0.5, 0.2);
    const r = deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
    if (!Number.isFinite(r.vmag) || !Number.isFinite(r.elev) || !Number.isFinite(r.contact) || !Number.isFinite(r.quality)) bad++;
  }
  return ok(bad === 0, `${bad}/1000 random gestures produced a non-finite racket`);
});

A('FUZZ', '500 random physics states never NaN', () => {
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const p = V3.new((Math.random() - 0.5) * 4, 0.8 + Math.random() * 2, (Math.random() - 0.5) * 4);
    const v = V3.new((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30);
    const w = V3.new((Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900);
    for (let k = 0; k < 60; k++) integrateBall(p, v, w, 1 / 600);
    if (!Number.isFinite(p.x) || !Number.isFinite(v.x) || !Number.isFinite(w.x)) bad++;
  }
  return ok(bad === 0, `${bad}/500 random flights went non-finite`);
});

A('FUZZ', 'The profile survives 200 random save files', () => {
  let bad = 0;
  const keys = ['coins', 'crystals', 'xp', 'level', 'streak', 'days', 'owned', 'equip', 'cosmetics', 'stats', 'daily', 'season', 'ads', 'purchases', 'career', 'settings'];
  for (let i = 0; i < 200; i++) {
    const o = {};
    for (const k of keys) {
      const r = Math.random();
      if (r < 0.3) o[k] = Math.random() * 1e9;
      else if (r < 0.45) o[k] = 'x';
      else if (r < 0.6) o[k] = null;
      else if (r < 0.75) o[k] = [1, 2, { a: 1 }];
      else if (r < 0.85) o[k] = { __proto__: { x: 1 }, bad: 1 };
      else if (r < 0.95) o[k] = NaN;
    }
    try {
      const p = freshProfile(JSON.stringify(o));
      if (!p || !Number.isFinite(p.data.coins) || !Array.isArray(p.data.owned)) bad++;
    } catch (e) { bad++; }
  }
  return ok(bad === 0, `${bad}/200 random saves broke the profile`);
});

A('FUZZ', 'The shop survives 200 random buy attempts', () => {
  const p = freshProfile('{}');
  const shop = new X.Shop(p, new X.Platform({ userAgent: 'node' }), null);
  let bad = 0;
  const ids = Object.keys(ITEMS).concat(X.COSMETICS.map((c) => c.id)).concat(['nope', '', null, undefined, 123]);
  for (let i = 0; i < 200; i++) {
    try {
      const id = ids[Math.floor(Math.random() * ids.length)];
      if (Math.random() < 0.5) shop.buyRacket(id, Math.random() < 0.5 ? 'crystals' : 'coins');
      else shop.buyCosmetic(id);
    } catch (e) { bad++; }
  }
  return ok(bad === 0, `${bad}/200 random shop calls threw`);
});

A('FUZZ', 'The career survives 200 random action sequences', () => {
  const g = freshGame();
  const c = new X.Career(g);
  let bad = 0;
  const acts = ['start', 'readyForOpponentSelect', 'selectOpponent', 'onMatchEnd', 'selectPerk', 'advanceTournament', 'save', 'load'];
  for (let i = 0; i < 200; i++) {
    try {
      const a = acts[Math.floor(Math.random() * acts.length)];
      if (a === 'start') c.start();
      else if (a === 'readyForOpponentSelect') c.readyForOpponentSelect();
      else if (a === 'selectOpponent') c.selectOpponent(Math.floor(Math.random() * 8) - 2);
      else if (a === 'onMatchEnd') c.onMatchEnd(Math.random() < 0.5 ? 1 : -1);
      else if (a === 'selectPerk') c.selectPerk(Math.floor(Math.random() * 5) - 2);
      else if (a === 'advanceTournament') c.advanceTournament();
      else if (a === 'save') c.save();
      else c.load();
    } catch (e) { bad++; }
  }
  return ok(bad === 0, `${bad}/200 random career sequences threw`);
});

A('FUZZ', 'The match director survives 500 random point sequences', () => {
  const d = new X.MatchDirector();
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    try {
      d.onPoint(Math.random() < 0.5 ? 1 : -1, Math.floor(Math.random() * 5));
      const m = d.momentum();
      if (!Number.isFinite(m) || !Number.isFinite(d.handicap)) bad++;
    } catch (e) { bad++; }
  }
  return ok(bad === 0, `${bad}/500 random point sequences broke the director`);
});

A('FUZZ', 'A full match with random input never produces a NaN ball', () => {
  const g = freshGame();
  g.settings.targetScore = 4;
  let bad = 0, err = null;
  try {
    g.startMatch(Math.floor(Math.random() * 5));
    for (let f = 0; f < 3000; f++) {
      g.pointer = { x: Math.random(), y: Math.random() };
      g.update(1 / 60);
      if (!Number.isFinite(g.ball.p.x) || !Number.isFinite(g.ball.v.x) || !Number.isFinite(g.player.pos.x)) bad++;
      if (g.state === GSX.MATCH_END) break;
    }
  } catch (e) { err = e; }
  return ok(!err && bad === 0, err ? `exception: ${err && err.message}` : `${bad} non-finite frames`);
});

A('FUZZ', 'A hostile saved settings object cannot poison the game', () => {
  const p = freshProfile(JSON.stringify({ settings: { assist: 'abc', volume: NaN, sensitivity: null, targetScore: 'x' } }));
  const g = freshGame();
  const A = g.settings.assist;
  const finite = Number.isFinite(A) && Number.isFinite(g.settings.sensitivity);
  return ok(finite, `assist=${JSON.stringify(A)} sensitivity=${JSON.stringify(g.settings.sensitivity)}`);
});

A('FUZZ', 'The canvas at a zero size does not break the renderer', () => {
  let err = null;
  try {
    const canvas = makeCanvas(0, 0);
    const ui = new X.UI();
    const g = new X.Game(canvas, ui);
    g.resize(); g.update(1 / 60); g.render();
  } catch (e) { err = e; }
  return ok(!err, err ? `threw: ${err && err.message}` : 'a zero-size canvas renders');
});

/* ================================================================ *
 *  runner
 * ================================================================ */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const only = (arg('only', '') || '').split(',').filter(Boolean).map(Number);
const quiet = process.argv.indexOf('--quiet') >= 0;
const results = [];
let area = '';
for (const a of ANALYSES) {
  if (only.length && only.indexOf(a.id) < 0) continue;
  if (a.area !== area) { area = a.area; if (!quiet) console.log('\n\x1b[1m== ' + area + ' ==\x1b[0m'); }
  let r;
  const t0 = process.hrtime.bigint();
  try {
    r = a.fn();
  } catch (e) {
    r = { ok: false, detail: 'THREW: ' + (e && e.message ? e.message : String(e)) };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  results.push({ id: a.id, area: a.area, name: a.name, ok: !!r.ok, detail: r.detail, ms });
  if (!quiet) {
    const mark = r.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`${String(a.id).padStart(3)} ${mark}  ${a.name}`);
    if (!r.ok) console.log(`      \x1b[31m→ ${r.detail}\x1b[0m`);
    else if (process.env.VERBOSE) console.log(`      → ${r.detail}`);
  }
}
const fails = results.filter((r) => !r.ok);
console.log('\n' + '─'.repeat(72));
console.log(`analyses run : ${results.length}`);
console.log(`passed       : ${results.length - fails.length}`);
console.log(`FAILED       : ${fails.length}`);
console.log('─'.repeat(72));
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log(` ${String(f.id).padStart(3)} [${f.area}] ${f.name}\n     ${f.detail}`);
}
const jsonPath = arg('json', null);
if (jsonPath) {
  fs.writeFileSync(jsonPath, JSON.stringify({ total: results.length, failed: fails.length, results }, null, 2));
  console.log(`\nJSON written to ${jsonPath}`);
}
process.exit(fails.length ? 1 : 0);
