/* Real Chromium + WebGL smoke/regression tests, no external requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { root } = require('./helpers.cjs');
(async () => {
  // Minimal Linux images may lack NSS. The Chromium npm package ships it.
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  let count = 0;
  try {
    for (const [width, height] of [[1280, 760], [390, 844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, isMobile:width<600, hasTouch:width<600 });
      await page.evaluateOnNewDocument(seed => {
        let state = seed;
        Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
      }, width);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
      await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
      // The long synchronous suite used to run before offline music init
      // resolved, hiding exceptions that only happen later in real play.
      await page.waitForFunction(() => window.__game.music._initialized);
      const results = await page.evaluate(() => {
        const g = window.__game, results = [];
        const check = (name, fn) => { try { if (!fn()) throw Error('assertion failed'); results.push({ name, ok: true }); }
          catch (e) { results.push({ name, ok: false, error: e.message }); } };
        const near = (a,b) => Math.abs(a-b) < 1e-9;
        g.paused = true; // freeze RAF; tests advance the actual game deterministically
        check('boot and render', () => g.R.drawCalls > 0 && !!g.R.camPos);
        check('restored menu difficulty', () => g.ui.pendingDiff === g.settings.difficulty);
        check('idle paddle never accumulates rotation at 30, 60 or 120 FPS', () => {
          for (const fps of [30, 60, 120]) {
            g.startMatch(2);g.ball.live=false;g.recenterT=0;g.swipe.cancel();
            g.pointer={x:.5,y:.55};g.camVPReady=false;
            for(let i=0;i<fps*12;i++)g.updatePlayerPaddle(1/fps);
            const n=V3.clone(g.player.normal);
            if(n.z>-.99 || !Object.values(n).every(Number.isFinite))return false;
            for(let i=0;i<fps*12;i++)g.updatePlayerPaddle(1/fps);
            if(V3.dist(n,g.player.normal)>1e-8)return false;
          }
          g.returnToMenu();return true;
        });
        check('paddles remain forward-facing through lateral sweeps and rendering is read-only', () => {
          g.startMatch(2);g.ball.live=false;g.recenterT=0;g.swipe.cancel();g.camVPReady=false;
          for(const hand of ['right','left']) {
            g.settings.hand=hand;
            for(const x of [.1,.9,.1,.9,.5]) {
              g.pointer={x,y:.55};
              for(let i=0;i<30;i++) {
                g.updatePlayerPaddle(1/60);
                if(g.player.normal.z>-.85 || Math.abs(g.player.roll)>1.55001)return false;
              }
            }
            const pose=JSON.stringify(g.player);
            for(let i=0;i<20;i++)g.render();
            if(JSON.stringify(g.player)!==pose)return false;
          }
          g.settings.hand='right';g.returnToMenu();return true;
        });
        check('player has relaxed ready grip, asymmetric strokes and swipe-driven forward pitch', () => {
          g.startMatch(2);g.ball.live=false;g.recenterT=0;g.camVPReady=false;
          const settle = () => { for(let i=0;i<120;i++)g.updatePlayerPaddle(1/60); };
          for(const hand of ['right','left']) {
            g.settings.hand=hand;g.swipe.cancel();g.pointerDown=false;
            g.pointer={x:.5,y:.55};settle();
            const ready=g.player.roll;
            if(Math.abs(ready)<.2 || Math.abs(ready)>.4)return false;
            if((hand==='right'?1:-1)*ready<=0)return false;
            const pitch=g.player.pitch;
            g.swipe.down(.5,.55,g.time-.08);
            g.swipe.move(.5,.35,g.time);
            g.pointer={x:.5,y:.35};g.pointerDown=true;settle();
            if(g.player.pitch>=pitch-.12)return false;
            g.swipe.cancel();g.pointerDown=false;g.pointer={x:.5,y:.55};settle();
            if(Math.abs(g.player.roll-ready)>.01 || Math.abs(g.player.pitch-pitch)>.01)return false;
          }
          g.settings.hand='right';g.returnToMenu();return true;
        });
        check('input instructions use pointer capabilities, not viewport width', () => {
          return g.ui.inputMode===(navigator.maxTouchPoints>0 ? 'touch' : 'mouse');
        });
        check('all six training tips are brief and specific to the active input', () => {
          g.startTraining();
          for(let step=0;step<TRAIN_STEPS.length;step++) {
            g.training.goStep(step);g.ui.setInputMode('touch');
            const touch=document.getElementById('trTip').textContent;
            if(touch.length>40 || /ЛКМ|мыш|колес|ПКМ/i.test(touch))return false;
            g.ui.setInputMode('mouse');const mouse=document.getElementById('trTip').textContent;
            if(mouse.length>40 || !mouse.includes('ЛКМ') || /пал|свайп/i.test(mouse))return false;
          }
          g.returnToMenu();return true;
        });
        check('touch event switches copy immediately on a hybrid device', () => {
          g.ui.setInputMode('mouse');
          document.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch'}));
          const touch=g.ui.inputMode==='touch' && !g.ui.hasFinePointer && !/Колесо|ПКМ/.test(document.getElementById('cameraHelp').textContent);
          document.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse'}));
          return touch && g.ui.inputMode==='mouse' && document.getElementById('cameraHelp').textContent.includes('высота');
        });
        check('only fixed camera presets are available in settings, no camera sliders', () => {
          g.ui.openSettings();document.querySelector('[data-camera="DYNAMIC"]').click();
          const selected=g.settings.camera==='DYNAMIC' && !document.getElementById('rCameraHeight');
          document.getElementById('camReset').click();g.ui.closeSettings();
          return selected && g.settings.camera==='BROADCAST' && g.cameraControls.height===0 && g.cameraControls.zoom===1;
        });
        check('touch play cannot adjust the camera, including two fingers', () => {
          g.startMatch(2);g.server=-1;g.prepServe();
          g.ui.setInputMode('mouse');g.cameraControls.height=1;g.cameraControls.zoom=.8;
          g.ui.setInputMode('touch');
          // Use the real input handlers, but synthetic pointer IDs cannot be captured.
          const capture=g.canvas.setPointerCapture;g.canvas.setPointerCapture=()=>{};
          try {
            for(const id of [71,72])g.canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:id,pointerType:'touch',button:0,clientX:180,clientY:400}));
            for(const id of [71,72])g.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerId:id,pointerType:'touch',buttons:1,clientX:230,clientY:180}));
            for(const id of [71,72])g.canvas.dispatchEvent(new PointerEvent('pointerup',{pointerId:id,pointerType:'touch',button:0,clientX:230,clientY:180}));
            return g.cameraControls.height===0 && g.cameraControls.zoom===1;
          } finally {g.canvas.setPointerCapture=capture;g.cancelInput();g.returnToMenu();}
        });
        const incomingBall = () => {
          g.startMatch(2); g.setState(GS.RALLY); g.time+=1;
          g.isServeBall=false;g.rallyBounces=[1];g.ball.live=true;g.ball.lastHitBy=-1;
          V3.copy(g.ball.p,g.player.pos);V3.set(g.ball.v,0,-.1,4);V3.zero(g.ball.w);g.swipe.cancel();
        };
        check('no swipe means no automatic return, even at the racket centre', () => {
          incomingBall();g.tryPlayerHit(V3.clone(g.ball.p));return g.ball.lastHitBy===-1;
        });
        check('holding a button and tapping without movement cannot hit', () => {
          incomingBall();g.swipe.down(.5,.6,g.time);g.tryPlayerHit(V3.clone(g.ball.p));
          if(g.ball.lastHitBy!==-1)return false;
          g.swipe.up(.5,.6,g.time+.01);g.swipeReleasedAt=g.time;g.tryPlayerHit(V3.clone(g.ball.p));
          return g.ball.lastHitBy===-1;
        });
        check('a deliberate swipe hits once and cannot return the next ball automatically', () => {
          incomingBall();g.swipe.down(.5,.8,g.time-.12);g.swipe.move(.5,.55,g.time-.04);
          g.swipe.up(.5,.45,g.time);g.swipeReleasedAt=g.time;g.tryPlayerHit(V3.clone(g.ball.p));
          if(g.ball.lastHitBy!==1)return false;
          g.ball.lastHitBy=-1;V3.copy(g.ball.p,g.player.pos);V3.set(g.ball.v,0,0,4);
          g.tryPlayerHit(V3.clone(g.ball.p));return g.ball.lastHitBy===-1 && !g.swipe.lastReleased;
        });
        check('old released or held swipe cannot hit a later ball', () => {
          incomingBall();g.swipe.down(.5,.8,g.time-.6);g.swipe.move(.5,.5,g.time-.4);
          g.tryPlayerHit(V3.clone(g.ball.p));if(g.ball.lastHitBy!==-1)return false;
          g.swipe.up(.5,.4,g.time-.3);g.swipeReleasedAt=g.time-.3;
          g.tryPlayerHit(V3.clone(g.ball.p));return g.ball.lastHitBy===-1;
        });
        check('complete AI serves cannot be returned by an idle player or pointer hovering', () => {
          g.startMatch(2);g.server=-1;g.prepServe();
          let playerHits=0,incoming=false;const apply=g.applyHit;
          g.applyHit=function(side,...args){if(side===1)playerHits++;return apply.call(this,side,...args);};
          try {
            for(let i=0;i<60*30;i++) {
              g.pointer={x:.5+Math.sin(i*.1)*.3,y:.55}; // cursor motion, no stroke
              g.update(1/60);
              incoming ||= g.ball.lastHitBy===-1 && g.ball.p.z>.5;
            }
            if(!(incoming && playerHits===0 && g.score[1]>=1))throw Error(JSON.stringify({incoming,playerHits,score:g.score,state:g.state,time:g.time})); return true;
          } finally {g.applyHit=apply;}
        });
        check('one real return followed by no input never produces a second return', () => {
          incomingBall();let playerHits=0;const apply=g.applyHit;
          g.applyHit=function(side,...args){if(side===1)playerHits++;return apply.call(this,side,...args);};
          try {
            g.swipe.down(.5,.8,g.time-.12);g.swipe.move(.5,.55,g.time-.04);
            g.swipe.up(.5,.45,g.time);g.swipeReleasedAt=g.time;g.tryPlayerHit(V3.clone(g.ball.p));
            for(let i=0;i<60*20;i++)g.update(1/60);
            return playerHits===1;
          } finally {g.applyHit=apply;}
        });
        check('leaving demo clears its synthetic swipe and cannot keep playing for you', () => {
          g.startDemo(2);g.swipe.down(.5,.8,g.time);g.swipe.move(.5,.4,g.time+.1);
          g._demoGesture={active:true};g.stopDemo();
          if(g.demoMode || g.swipe.active || g.swipe.lastReleased || g._demoGesture)return false;
          g.server=-1;g.prepServe();let playerHits=0;const apply=g.applyHit;
          g.applyHit=function(side,...args){if(side===1)playerHits++;return apply.call(this,side,...args);};
          try {for(let i=0;i<60*20;i++)g.update(1/60);return playerHits===0;}
          finally {g.applyHit=apply;}
        });
        check('normal match shows just one short status below the table', () => {
          g.startMatch(2);g.server=1;g.prepServe();g.ui.showNote({text:'Explanatory text',col:'#fff'});
          g.ui.tick(0);
          const ids=['msgs','note','shot','rally','mpInd','mnToast','timingCue','gestureCue'];
          const onServe=!document.getElementById('playStatus').hidden;
          g.setState(GS.RALLY);g.ui.tick(0);
          return onServe && document.getElementById('playStatus').hidden && ids.every(id=>getComputedStyle(document.getElementById(id)).display==='none');
        });
        check('logo is embedded in splash and menu, no external assets', () => {
          const imgs=[...document.querySelectorAll('.brand-logo,.splash-brand img')];
          return imgs.length===2 && imgs.every(img=>img.src.startsWith('data:image/png;base64,') && img.complete && img.naturalWidth>0);
        });
        check('full table and opponent swing volume have safe headroom', () => {
          for(let i=0;i<80;i++)g.updateCamera(.1);
          const b=tableScreenBounds(g.R.viewProj);
          return b.top>0 && b.bottom<.91 && opponentScreenTop(g.R.viewProj)>=CAMERA_HEADROOM-.001;
        });
        check('replay skip is a visible touch target only during replay and returns focus safely', () => {
          const skip=document.getElementById('reelSkip'),reel=document.getElementById('reel');
          const hidden=getComputedStyle(skip).visibility==='hidden' && reel.getAttribute('aria-hidden')==='true';
          skip.focus();const notFocusable=document.activeElement!==skip;
          g.ui.replayShow(true,{finish:'DRIVE',winner:1,shots:3,speed:42,spin:5},false);
          const box=skip.getBoundingClientRect();
          const active=getComputedStyle(skip).visibility==='visible' && reel.getAttribute('aria-hidden')==='false' &&
            skip.tabIndex===0 && box.width>=44 && box.height>=44 && skip.getAttribute('aria-label');
          skip.focus();g.ui.replayShow(false);
          return hidden && notFocusable && active && document.activeElement!==skip;
        });
        check('score is upper-left and does not overlap right-hand controls', () => {
          const score=document.getElementById('score').getBoundingClientRect();
          const controls=document.getElementById('topright').getBoundingClientRect();
          return score.left<=20 && score.top<=20 && score.right<controls.left;
        });
        check('all reading cues are placed below the full table', () => {
          const band=document.getElementById('playband').getBoundingClientRect();
          const b=tableScreenBounds(g.camVP);
          return band.top>b.bottom*window.innerHeight && document.getElementById('train').parentElement.id==='playband';
        });
        check('ball trail uses 20 percent opacity', () => {
          const oldDraw=g.R.draw, oldHist=g.ball.hist; let opacity;
          g.ball.hist=[0,1,0, .05,1,.1, .1,1,.2, .15,1,.3];
          g.R.draw=function(mesh,matrix,mat){if(mesh===g.scene.mesh.trail)opacity=mat.opacity;};
          try {g.drawFX();} finally {g.R.draw=oldDraw;g.ball.hist=oldHist;}
          return opacity===.2;
        });
        check('pause control pauses first, then exits to MENU without further scoring', () => {
          g.startMatch(2); g.server = -1; g.prepServe();
          const menu = document.getElementById('btnMenu');
          menu.click();
          const paused = g.paused && document.body.classList.contains('is-paused') && menu.getAttribute('aria-label') === 'В главное меню';
          menu.click();
          const t = g.time, score = g.score.join();
          for (let i=0; i<360; i++) g.update(1/60);
          return paused && g.state === GS.MENU && !g.ball.live && g.time === t && g.score.join() === score;
        });
        check('R in menu does not start an invisible game', () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })); return g.state === GS.MENU;
        });
        check('keyboard shortcuts ignore text fields', () => {
          const input = document.createElement('input'); document.body.append(input);
          const camera = g.settings.camera;
          input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true })); input.remove();
          return camera === g.settings.camera;
        });
        check('settings pause a live match and resume it on close', () => {
          g.startMatch(2); g.ui.openSettings(); const paused=g.paused;
          g.ui.closeSettings(); return paused && !g.paused;
        });
        check('settings opened from pause do not unpause via bubbling', () => {
          g.setPaused(true); document.getElementById('pauseSettings').click();
          const paused=g.paused; g.ui.closeSettings(); return paused && g.paused;
        });
        check('invalid dt does not corrupt game time', () => {
          g.startMatch(2); const t=g.time; g.update(NaN); g.update(-1); return g.time===t;
        });
        check('pause cancels gesture', () => {
          g.swipe.down(.5,.8,g.time); g.pointerDown = true; g.setPaused(true);
          return !g.swipe.active && !g.pointerDown;
        });
        check('pointercancel does not release or retain an old shot', () => {
          g.setPaused(false); g.swipe.down(.5,.8,g.time); g.swipe.up(.5,.4,g.time+.1);
          g.swipe.down(.5,.8,g.time); g.pointerDown=true;
          g.canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
          return !g.swipe.active && !g.pointerDown && !g.swipe.lastReleased;
        });
        check('explicit input reset cancels gesture', () => {
          // cancelInput is also used for blur/visibility and abandoned multi-touch IDs.
          g.swipe.down(.5,.8,g.time); g.cancelInput(); return !g.swipe.active;
        });
        check('blur pauses and clears controls', () => {
          g.setPaused(false); g.swipe.down(.5,.8,g.time); window.dispatchEvent(new Event('blur'));
          return g.paused && !g.swipe.active;
        });
        check('training clears autoplay and career', () => {
          g.career.start(); g.demoMode=true; g.startTraining();
          return !!g.training && !g.demoMode && !g.career.active && g.slowmo.allowed;
        });
        check('career settings saved without temporary perk modifiers', () => {
          g.returnToMenu(); g.settings.assist=.6; g.settings.posAssist=.7; g.career.start();
          PERKS.find(p=>p.id==='steady_hand').apply(g); g.saveSettings();
          return near(g.profile.data.settings.assist,.6) && near(g.settings.assist,.68);
        });
        check('career intro clears stale opponent buttons', () => {
          g.career.readyForOpponentSelect(); g.ui.showCareerOpponentSelect(g.career);
          const had = document.querySelectorAll('#crOppList button').length > 0;
          g.ui.showCareerIntro(g.career);
          return had && document.querySelectorAll('#crOppList button').length===0 && !document.getElementById('crReady').hidden;
        });
        check('career selection hides ready button', () => {
          g.ui.showCareerOpponentSelect(g.career); return document.getElementById('crReady').hidden;
        });
        check('career end names current, not previous tournament', () => {
          g.career.currentTournament=3; g.career.state='RUN_END'; g.ui.showCareerRunEnd(g.career);
          return document.getElementById('crEndSub').textContent.includes(TOURNAMENTS[3].name);
        });
        check('completed career cannot be resurrected by end-of-frame save', () => {
          g.career.save(); return localStorage.getItem('topspin_career')===null;
        });
        check('bad persisted settings are bounded and unknown keys ignored', () => {
          const raw = JSON.parse('{"assist":-20,"volume":999,"sensitivity":"bad","difficulty":99,"camera":"missing","quality":"broken","targetScore":0,"__proto__":{"evil":true},"unknown":123}');
          g.profile.data.settings=raw; g.loadSettings();
          return g.settings.assist===0 && g.settings.volume===1 && g.settings.difficulty===4 &&
            CAMERA_ORDER.includes(g.settings.camera) && [5,11,21].includes(g.settings.targetScore) &&
            !g.settings.evil && !g.settings.unknown && Number.isFinite(g.settings.sensitivity);
        });
        check('sound toggle is persisted', () => {
          const prev=g.settings.sound; document.getElementById('btnSound').click();
          return g.profile.data.settings.sound===!prev;
        });
        check('legal net-cord serve is a let only after receiver bounce', () => {
          g.startMatch(2); g.setState(GS.RALLY); g.ball.lastHitBy=1; g.isServeBall=true;
          g.netTouched=true; g.serveBounces=0; g.rallyBounces=[];
          g.onBounce(1,3); const first=g.state===GS.RALLY; g.onBounce(-1,3);
          return first && g.state===GS.POINT && g.score.join()==='0,0' && !g.ball.live;
        });
        check('net serve that never reaches receiver loses a point', () => {
          g.startMatch(2); g.setState(GS.RALLY); g.ball.lastHitBy=1; g.isServeBall=true;
          g.netTouched=true; g.serveBounces=1; g.onFloor(); return g.score.join()==='0,1';
        });
        check('net-cord serve landing twice on server side is a fault', () => {
          g.startMatch(2); g.setState(GS.RALLY); g.ball.lastHitBy=1; g.isServeBall=true;
          g.netTouched=true; g.serveBounces=0; g.rallyBounces=[]; g.onBounce(1,3); g.onBounce(1,3);
          return g.score.join()==='0,1';
        });
        check('low-level AI impact preserves solver launch velocity/spin', () => {
          for (const level of [0,1]) {
            g.startMatch(level); g.isServeBall=true;
            V3.set(g.ball.v,.2,-2,6); V3.set(g.ball.w,180,20,0);
            const before=[g.ball.v.x,g.ball.v.y,g.ball.v.z,g.ball.w.x,g.ball.w.y,g.ball.w.z].join();
            const r=makeRacket(-1,'SERVE_FAST',{quality:1}); g.applyHit(-1,r,V3.clone(g.ball.p),1,{});
            if (before!==[g.ball.v.x,g.ball.v.y,g.ball.v.z,g.ball.w.x,g.ball.w.y,g.ball.w.z].join()) return false;
          } return true;
        });
        check('initialized music climax and emotional winner effects cannot interrupt updates', () => {
          g.startDemo(2);g.audio.init();g.audio.setMuted(false);
          g.music._triggerClimax();
          g.emotion._onWinner(g);
          g.music._playResolution(MUSIC_STATE.RESOLUTION_WIN);
          g.audio.setMuted(true);g.returnToMenu();return true;
        });
        check('five consecutive match/replay/restart cycles release old clips and callbacks', () => {
          for(let match=0;match<5;match++) {
            g.startDemo(2);
            if(g.moments.kept.length || g.moments.lastClip || g.replayer.onEnd || g.replayer.moment)return false;
            for(let i=0;i<4;i++)g.moments.push(g.time+i/30,g);
            const clip=g.moments.captureClip(g.time+.1);
            const moment={...clip,shots:3,speed:30,spin:4,finish:'DRIVE',winner:1};
            g.setState(GS.MATCH_END);
            for(let view=0;view<3;view++) {
              let completed=0;
              g.watchMoment(moment,true,()=>completed++);
              for(let i=0;i<200 && g.replayer.on;i++)g.replayer.update(.1,g);
              if(g.state!==GS.MATCH_END || completed!==1 || g.replayer.moment)return false;
            }
            g.missedRallies=[moment,moment];
            let completed=0;
            g.playAllMissesSequential(()=>completed++);g.skipReplay();
            if(g.currentMissIndex!==1 || !g.replayer.on)return false;
            for(let i=0;i<200 && g.replayer.on;i++)g.replayer.update(.1,g);
            if(completed!==1 || g.state!==GS.MATCH_END)return false;
            g.watchMiss(0);
            for(let i=0;i<200;i++)g.replayer.update(.1,g);
            if(!g.replayer.on || !g.replayer.moment)return false;
            g.returnToMenu();
            if(g.replayer.on || g.replayer.onEnd || g.replayer.moment || g.state!==GS.MENU)return false;
          }
          return true;
        });
        check('demo cannot farm currency and match statistics', () => {
          g.startDemo(2); g.matchWinner=1; const coins=g.profile.data.coins, matches=g.profile.data.stats.matches;
          g.settleMatch(); return g.profile.data.coins===coins && g.profile.data.stats.matches===matches;
        });
        for (const level of [0,1,2,3,4]) check(`full demo match finishes with finite state, level ${level}`, () => {
          g.settings.targetScore=5; g.startDemo(level);
          for(let i=0;i<60*180 && g.state!==GS.MATCH_END;i++) g.update(1/60);
          return g.state===GS.MATCH_END && Math.max(...g.score)>=5 &&
            [g.ball.p.x,g.ball.p.y,g.ball.p.z,g.time].every(Number.isFinite);
        });
        g.ui.showMainMenu(); g.paused = true;
        return results;
      });
      for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'} ${width}x${height}: ${r.name}${r.error ? ' — '+r.error : ''}`); count++; }
      assert.deepEqual(results.filter(r => !r.ok), []);
      const frameBefore = await page.evaluate(() => {
        const g=window.__game;
        g.startDemo(2);g.ball.live=false;g.setState(GS.RALLY);
        g.lastShotInfo={speed:100};g.emotion.lastBigMoment=g.time-3;
        return g.frame;
      });
      // Exercise the real RAF after asynchronous music init, not just a
      // synchronous direct update. Before the fix this lost its next frame.
      await page.waitForFunction(before => window.__game.frame > before+4, {}, frameBefore);
      await page.evaluate(() => { window.__game.returnToMenu();window.__game.paused=true; });
      console.log(`PASS ${width}x${height}: real animation loop survives winner effect after music initialization`);count++;
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.waitForFunction(() => window.__game && window.__game.reducedMotion);
      const reducedMotionWorks = await page.evaluate(() => {
        const g = window.__game;
        g.shake = 0; g.shakeIt(.8);
        const noShake = g.shake === 0;
        const camera = [g.camPos.x, g.camPos.y, g.camPos.z, g.camLook.x, g.camLook.y, g.camLook.z, g.fov];
        g.replayer.on = true; g.updateCameraReplay(1 / 60); g.replayer.on = false;
        const fixedCamera = camera.every((v, i) => Math.abs(v - [g.camPos.x, g.camPos.y, g.camPos.z, g.camLook.x, g.camLook.y, g.camLook.z, g.fov][i]) < 1e-8);
        g.particles.n=0;g.marks.length=0;g.emitParticles(0,0,0,4,.5,.4,.01,1,1,1);g.addMark(0,0,5);
        const noImpactVfx=g.particles.n===0 && g.marks.length===0;
        const oldTrail=g.settings.showTrail,oldHist=g.ball.hist;g.settings.showTrail=true;g.ball.hist=[0,1,0,.1,1,0,.2,1,0];g.buildTrail();
        const noTrail=g.scene.mesh.trail.count===0;g.settings.showTrail=oldTrail;g.ball.hist=oldHist;
        const oldRipples=g.ui.ripples.length;g.ui.ripple(.5,.5,'#fff');
        const noUiRipple=g.ui.ripples.length===oldRipples;g.ui._lastRibbon={pts:[],fade:1,col:'#fff'};g.ui.drawOverlay(1/60);
        const noUiRibbon=g.ui._lastRibbon===null;
        g.setState(GS.RALLY);g.ball.live=true;g.ball.lastHitBy=-1;
        V3.set(g.ball.p,0,PH.TABLE_Y+1,0);V3.set(g.ball.v,1,0,0);V3.zero(g.ball.w);
        g.R.post.radial=.5;g.R.post.flash=.2;
        const beforeX=g.ball.p.x,beforeTime=g.time;g.update(1/60);
        const physicsContinues=g.time>beforeTime && g.ball.p.x!==beforeX;
        const noPostFx=g.R.post.radial===0 && g.R.post.flash===0;
        g.returnToMenu();
        return g.reducedMotion && g.ui.reducedMotion && noShake && fixedCamera && noImpactVfx && noTrail &&
          noUiRipple && noUiRibbon && noPostFx && physicsContinues;
      });
      assert.equal(reducedMotionWorks, true, 'reduced motion suppresses optional camera, particle, trail, post-processing and UI movement while preserving ball simulation');
      count++; console.log(`PASS ${width}x${height}: reduced motion suppresses optional VFX and UI motion, physics remains active`);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await page.waitForFunction(() => window.__game && !window.__game.reducedMotion);
      await page.evaluate(() => {
        const g = window.__game;
        g.settings.hitZone = .42; g.settings.volume = .13; g.settings.sound = false;
        g.saveSettings(); g.profile.save(true);
      });
      await page.reload();
      await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
      assert.equal(await page.evaluate(() => {
        const g = window.__game;
        return g.settings.hitZone === .42 && g.settings.volume === .13 && !g.settings.sound &&
          document.querySelectorAll('#btnSound line').length === 2;
      }), true, 'warm reload preserves hit-zone, volume and mute icon');
      count++; console.log(`PASS ${width}x${height}: warm reload preserves settings and mute icon`);
      await page.waitForFunction(() => document.getElementById('loading').classList.contains('off'));
      await page.click('#play');
      await page.waitForFunction(() => !!window.__game.audio.master);
      assert.equal(await page.evaluate(() => {
        const a = window.__game.audio;
        return !!a.master && a.master.gain.value === 0;
      }), true, 'first user gesture does not bypass saved mute');
      count++; console.log(`PASS ${width}x${height}: saved mute survives AudioContext creation`);
      await page.evaluate(()=>window.__game.startDemo(2));
      await page.mouse.move(width*.5,height*.65);await page.mouse.down();
      assert.equal(await page.evaluate(()=>!window.__game.demoMode && !window.__game._demoGesture && !document.getElementById('pauseDemo')),true);
      await page.mouse.up();
      count++;console.log(`PASS ${width}x${height}: real mouse takes control from demo without a hidden autoplay toggle`);
      await page.evaluate(() => {
        const g=window.__game; g.server=1; g.prepServe(); g.camReset();
      });
      await page.mouse.move(width*.5,height*.45);
      await page.mouse.wheel({deltaY:-120});
      await page.waitForFunction(()=>window.__game.cameraControls.zoom<1);
      assert.equal(await page.evaluate(()=>window.__game.swipe.active),false);
      count++; console.log(`PASS ${width}x${height}: real mouse wheel zooms without a stroke`);
      const zoomBeforeHeight=await page.evaluate(()=>window.__game.cameraControls.zoom);
      await page.mouse.down({button:'right'});
      await page.mouse.move(width*.5,height*.45-35,{steps:4});
      assert.equal(await page.evaluate(zoom=>window.__game.cameraControls.zoom===zoom && window.__game.cameraControls.height>.4 && !window.__game.swipe.active,zoomBeforeHeight),true);
      count++; console.log(`PASS ${width}x${height}: right vertical drag raises height independently of wheel zoom`);
      await page.mouse.move(width*.5+35,height*.45-35,{steps:4});
      await page.mouse.up({button:'right'});
      assert.equal(await page.evaluate(()=>window.__game.cameraControls.yaw===undefined && !window.__game.pointerDown && !window.__game.swipe.active),true);
      count++; console.log(`PASS ${width}x${height}: right horizontal drag does not rotate camera and releases cleanly`);
      await page.keyboard.press('c');
      assert.equal(await page.evaluate(()=>{
        const c=window.__game.cameraControls;return c.zoom===1 && c.height===0;
      }),true);
      count++; console.log(`PASS ${width}x${height}: C restores the default framing`);
      if(width<600) {
        const tap=async selector=>{
          const pt=await page.$eval(selector,el=>{el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
          await page.touchscreen.tap(pt.x,pt.y);
        };
        await tap('#btnSettings');
        assert.equal(await page.evaluate(()=>window.__game.ui.inputMode==='touch' && !/Колесо|ПКМ/.test(document.getElementById('cameraHelp').textContent)),true);
        await tap('[data-camera="DYNAMIC"]');
        assert.equal(await page.evaluate(()=>window.__game.settings.camera==='DYNAMIC'),true);
        await tap('#camReset');await tap('#setClose');
        count++;console.log(`PASS ${width}x${height}: actual touch switches instructions and selects a camera without a mouse`);
        await tap('#btnMenu');
        assert.equal(await page.evaluate(()=>window.__game.paused&&document.body.classList.contains('is-paused')),true);
        await tap('#pauseSettings');
        assert.equal(await page.evaluate(()=>window.__game.paused&&document.getElementById('settings').classList.contains('on')),true);
        await tap('#setClose');
        assert.equal(await page.evaluate(()=>window.__game.paused&&!document.getElementById('settings').classList.contains('on')),true);
        await tap('#pauseResume');
        assert.equal(await page.evaluate(()=>!window.__game.paused),true);
        await tap('#btnMenu');await tap('#btnMenu');
        assert.equal(await page.evaluate(()=>window.__game.state===GS.MENU&&document.getElementById('menu').classList.contains('on')),true);
        const soundBefore=await page.evaluate(()=>window.__game.settings.sound);await tap('#menuSound');
        assert.equal(await page.evaluate(before=>window.__game.settings.sound!==before&&
          document.getElementById('menuSound').getAttribute('aria-pressed')===String(!before)&&
          document.getElementById('btnSound').getAttribute('aria-pressed')===String(!before),soundBefore),true);
        count++;console.log(`PASS ${width}x${height}: real touch pauses, opens settings safely, resumes, exits, and toggles sound`);
      }
      const audioRender = await page.evaluate(async () => {
        const context = new OfflineAudioContext(2, 44100 * 4, 44100);
        const a = new AudioEngine(); a.ctx=context;a.ok=true;a.muted=false;
        a.bus=context.createGain();a.bus.connect(context.destination);
        a._noiseBuf=context.createBuffer(1,44100*2,44100);
        const noise=a._noiseBuf.getChannelData(0);for(let i=0;i<noise.length;i++)noise[i]=Math.random()*2-1;
        a.applause(1.6);a.onRallyHit(4);
        const scheduled=a._audienceSources.size;
        const buffer=await context.startRendering();let energy=0,peak=0,tail=0;
        for(let channel=0;channel<2;channel++) {
          const data=buffer.getChannelData(channel);
          for(let i=0;i<data.length;i++) {
            if(!Number.isFinite(data[i]))return {finite:false};
            energy+=data[i]*data[i];peak=Math.max(peak,Math.abs(data[i]));
            if(i>44100*3)tail+=data[i]*data[i];
          }
        }
        return {finite:true,scheduled,energy,peak,tail,remaining:a._audienceSources.size};
      });
      assert.equal(audioRender.finite,true);assert.equal(audioRender.scheduled,38);
      assert.ok(audioRender.energy>0 && audioRender.peak>0 && audioRender.peak<.25);
      assert.equal(audioRender.tail,0);assert.equal(audioRender.remaining,0);
      count++;console.log(`PASS ${width}x${height}: small audience renders finite unclipped stereo, ends in silence and cleans up`);
      if(width>620) {
        await page.click('#btnFullscreen');
        await page.waitForFunction(()=>!!document.fullscreenElement);
        assert.equal(await page.evaluate(()=>document.fullscreenElement.id==='app' && document.getElementById('btnFullscreen').getAttribute('aria-pressed')==='true'),true);
        await page.setViewport({width:1920,height:1080});
        assert.equal(await page.evaluate(()=>{
          const g=window.__game;g.camReset();for(let i=0;i<80;i++)g.updateCamera(.1);
          const b=tableScreenBounds(g.camVP);
          return b.top>0 && b.bottom<1 && b.left>0 && b.right<1 && opponentScreenTop(g.camVP)>=CAMERA_HEADROOM-.001;
        }),true);
        await page.keyboard.press('f');await page.waitForFunction(()=>!document.fullscreenElement);
        count++;console.log(`PASS ${width}x${height}: fullscreen button, 1920×1080 framing and F exit`);
      }
      assert.equal(await page.evaluate(async()=>{
        const app=document.getElementById('app'), request=app.requestFullscreen;
        app.requestFullscreen=async()=>{throw new Error('Embedding policy denied fullscreen');};
        try {await window.__game.ui.toggleFullscreen();return !document.fullscreenElement && Number.isFinite(window.__game.R.aspect());}
        finally {app.requestFullscreen=request;}
      }),true);
      count++;console.log(`PASS ${width}x${height}: denied fullscreen leaves a working normal viewport`);
      assert.deepEqual(errors, [], 'uncaught browser exceptions');
      await page.close();
    }
    console.log(`Browser: ${count} checks passed, desktop + mobile, no uncaught exceptions.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
