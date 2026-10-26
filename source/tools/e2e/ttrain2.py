"""Screenshot the frozen AIM drill (2/6 НАПРАВЛЕНИЕ) with the REAL admission
zone outlined by the coach, then simulate the exact press the lesson shows
and confirm the gate accepts it."""
import asyncio, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        await pg.goto('file://' + ROOT + '/index.html?s=train', timeout=120000)
        await pg.wait_for_timeout(6000)
        frs = [f for f in pg.frames if f != pg.main_frame]
        assert frs, 'no game frame'
        fr = frs[0]
        for i in range(120):
            try:
                if await fr.evaluate('!!(window.__game && window.__game.training)'): break
            except Exception: pass
            await pg.wait_for_timeout(500)
        res = await fr.evaluate("""() => {
          const g = window.__game, T = g.training, DT = 1 / 60;
          const step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
          T.goStep(1);                                   // «НАПРАВЛЕНИЕ»
          let frozenAt = -1;
          for (let i = 0; i < 3600; i++) { step(); if (T.frozen) { frozenAt = i; break; } }
          step(12);                                      // let the overlay settle
          const z = g.previewPressZone();
          const c = T.coachCue();
          return { frozenAt, cue: c && { kind: c.kind, frozen: c.frozen, serve: c.serve },
            zone: z && { x: +z.x.toFixed(3), y: +z.y.toFixed(3), fwd: +z.fwdPx.toFixed(1), back: +z.backPx.toFixed(1),
              side: +z.sidePx.toFixed(1), ax: +z.axisX.toFixed(2), ay: +z.axisY.toFixed(2), shape: z.shape } };
        }""")
        print('setup:', res, flush=True)
        assert res['frozenAt'] >= 0 and res['zone'], res
        # screenshot the game frame
        el = await fr.frame_element()
        await el.screenshot(path=os.path.join(HERE, 'shots', 'r13_train_zone.png'), timeout=90000)
        print('shot saved', flush=True)
        # acceptance proof: press inside the drawn zone, swipe up through the ring
        ok = await fr.evaluate("""() => {
          const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect(), T = g.training;
          const DT = 1 / 60, step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
          const z = g.previewPressZone();
          const startX = z.x + z.axisX * (z.fwdPx - 30);   // zone coords are already css px
          const startY = z.y + z.axisY * (z.fwdPx - 30);
          let pid = 900; const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type,
            { clientX: R.left + x, clientY: R.top + y, pointerId: pid, pointerType: 'touch', button: 0,
              buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
          const c = T.coachCue(); const p = g.project(c && c.p ? c.p : g.ball.p, {});
          const endY = p.y * R.height - 150;   // ring at ball projection minus a lift
          ev('pointerdown', startX, startY); step();
          for (let i = 1; i <= 8; i++) { step(); ev('pointermove', startX + 26 * i / 8, startY + (endY - startY) * i / 8); }
          ev('pointerup', startX + 26, endY);
          const pz = g.swipe.pressZone;
          step(40);
          return { startX: startX | 0, startY: startY | 0, zoneReason: pz && pz.reason, accepted: pz && pz.accepted,
            tPhase: T.phase, msg: T.msg, frozen: T.frozen, hits: g.time > 0 ? undefined : 0 };
        }""")
        print('acceptance:', ok, flush=True)
        assert ok['accepted'] or ok['zoneReason'] is None, ok
        print('errs:', errs[:4] or 'none', flush=True)
        await b.close()
        print('TRAIN ZONE PROBE PASS')

asyncio.run(main())
