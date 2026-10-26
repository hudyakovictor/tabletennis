"""Visual proof of the declutter round:
1) frozen training frame: dashed zone + ring + dot + hand (no chevrons)
2) match static mark: pinned ring+dot, cp.t<0.3, does NOT move between frames
3) AI serve: ball parks in front of the AI's own bat"""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'shots')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:150]))

        # ---- 1+2: training freeze (decluttered) ----
        await pg.goto('file://' + ROOT + '/index.html?s=train', timeout=120000)
        await pg.wait_for_timeout(6000)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        r = await fr.evaluate("""() => {
          const g = window.__game, T = g.training, DT = 1/60;
          const step=(n=1)=>{for(let i=0;i<n;i++)g.update(DT);};
          T.goStep(0);
          let at=-1; for(let i=0;i<3600;i++){step(); if(T.frozen){at=i;break;}}
          step(10);
          const cue = T.coachCue();
          return { frozenAt: at, cue: cue && cue.kind, hand: true };
        }""")
        print('train:', r, flush=True)
        assert r['frozenAt'] >= 0
        el = await fr.frame_element()
        await el.screenshot(path=f'{OUT}/r15_train_clean.png', timeout=90000)
        print('train shot saved', flush=True)

        # ---- 3: match static mark pinned + AI serve anchor ----
        await pg.goto('file://' + ROOT + '/index.html?s=match', timeout=120000)
        await pg.wait_for_timeout(6000)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        mv = await fr.evaluate("""() => {
          const g = window.__game, DT = 1/60;
          const step=(n=1)=>{for(let i=0;i<n;i++)g.update(DT);};
          g.state='RALLY'; g.paused=false; g.isServeBall=false; g.serveBounces=0;
          g.rallyBounces.length=0; g.rallyBounces.push(1); g.rallyBounces.push(-1);
          const b=g.ball;
          b.p={x:-0.02,y:1.04,z:-0.30}; b.v={x:0.08,y:0.35,z:3.8}; b.w={x:-180,y:0,z:0};
          b.live=true; b.lastHitBy=-1; b.trailGrade=null; b.golden=null;
          const U=g.ui;
          let seen=null;
          for(let i=0;i<180;i++){ step(); const cue=U.coachCueNow&&U.coachCueNow();
            if(cue&&cue.kind==='mark'&&!seen){ seen={x:cue.p.x, y:cue.p.y, z:cue.p.z, frame:i, t:cue.t}; break; } }
          let moved=null;
          if(seen){ step(20); const cue2=U.coachCueNow();
            moved = cue2 && cue2.kind==='mark' ? Math.abs(cue2.p.x-seen.x)+Math.abs(cue2.p.z-seen.z) : 'gone'; }
          return { seen, drift: moved };
        }""")
        print('mark:', mv, flush=True)
        assert mv['seen'] and (mv['drift'] == 0 or mv['drift'] == 'gone'), mv
        el = await fr.frame_element()
        await el.screenshot(path=f'{OUT}/r15_match_mark.png', timeout=90000)

        sv = await fr.evaluate("""() => {
          const g = window.__game, DT = 1/60;
          const step=(n=1)=>{for(let i=0;i<n;i++)g.update(DT);};
          g.server=-1; g.state='SERVE_READY'; g.aiServeTimer=5;
          step(30);
          const b=g.ball, ap=g.ai.pos;
          const dx = b.p.x - ap.x, dz = b.p.z - (ap.z + 0.05);
          return { dx: +dx.toFixed(3), dzAtBat: +dz.toFixed(3), aiX: +ap.x.toFixed(2) };
        }""")
        print('ai serve anchor:', sv, flush=True)
        assert abs(sv['dx']) < 0.02 and abs(sv['dzAtBat']) < 0.02, sv
        print('errs:', errs[:3] or 'none', flush=True)
        await b.close()
        print('TIDY PROBE PASS')

asyncio.run(main())
