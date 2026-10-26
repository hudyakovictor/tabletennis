"""Match visual probe: opponent serves, wait until the contact ring is live,
drive a few hundred frames (smoothing engaged), screenshot the game frame —
expect a smooth ring + yellow dot, no flicker. Also: desktop layout has no
dev panel anymore."""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        # --- 1. desktop layout: dev panel gone ---
        pgd = await b.new_page(viewport={'width': 1280, 'height': 800})
        await pgd.goto('file://' + ROOT + '/index.html', timeout=120000)
        await pgd.wait_for_timeout(2500)
        panel = await pgd.evaluate("() => { const a = document.getElementById('deskPanel'); return a ? getComputedStyle(a).display : 'REMOVED' }")
        print('deskPanel:', panel, flush=True)
        assert panel == 'REMOVED' or panel == 'none'
        await pgd.screenshot(path=os.path.join(HERE, 'shots', 'r14_desktop.png'), timeout=90000)
        await pgd.close()

        # --- 2. match ring with dot ---
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:150]))
        await pg.goto('file://' + ROOT + '/index.html?s=match', timeout=120000)
        await pg.wait_for_timeout(6000)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        res = await fr.evaluate("""() => {
          const g = window.__game, DT = 1 / 60;
          const step = (n=1) => { for (let i=0;i<n;i++) g.update(DT); };
          // fabricate an incoming returnable ball (the probe doesn't play the real rally)
          g.state = 'RALLY'; g.paused = false;
          g.rallyBounces.length = 0; g.rallyBounces.push(1);
          const b = g.ball; let cp = null, used = null;
          for (const [pz, vz, vy] of [[-0.55, 3.6, 0.6], [-0.75, 4.4, 0.4], [-0.4, 3.0, 0.8], [-0.9, 5.2, 0.2]]) {
            b.p = { x: -0.05, y: 1.06, z: pz }; b.v = { x: 0.15, y: vy, z: vz }; b.w = { x: -180, y: 0, z: 0 };
            b.live = true; b.lastHitBy = -1; g.state = 'RALLY';
            step(3);
            cp = g.contactPrediction();
            if (cp && cp.t > 0.25 && cp.t < 1.10) { used = [pz, vz, vy]; break; }
          }
          step(2);
          return { hint: g.hintContact, used, cp: cp && { t: +cp.t.toFixed(2), x: +cp.p.x.toFixed(2) } };
        }""")
        print('ring setup:', res, flush=True)
        assert res['used'] and res['hint'] is True, res
        await pg.wait_for_timeout(900)   # real rAF frames: smoothing/hold active
        el = await fr.frame_element()
        await el.screenshot(path=os.path.join(HERE, 'shots', 'r14_match_ring.png'), timeout=90000)
        print('match shot saved', flush=True)
        print('errs:', errs[:3] or 'none', flush=True)
        await b.close()
        print('RING PROBE PASS')

asyncio.run(main())
