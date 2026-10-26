"""Adaptive ring + «Разбор матча»: a scattered bot plays a quick match to the result screen."""
import asyncio, time, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/index.html?s=hub')
        await pg.wait_for_timeout(800)
        await pg.evaluate("() => { MODE = MODES[0]; S.tutorialDone = true; S.hint = false; window.__ah = []; GameHost.on((m) => { if (m.type === 'autoHint') window.__ah.push(m.on); }); Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        await fr.evaluate("() => { window.__b2jit = { px: 62, lead: 0.24 }; }")
        tips = []; ringShot = False; t0 = time.time()
        while time.time() - t0 < 400:
            if await pg.evaluate("Router.cur") != 'match': break
            if await pg.evaluate("document.querySelector('.mx-replay')!==null || !!document.querySelector('.m-final')"):
                await pg.wait_for_timeout(300); continue
            await fr.evaluate("() => { window.__bot2(10); window.__game.ui.tick(1 / 6); }")
            t = await fr.evaluate("() => { const e = document.getElementById('shot'); return e.dataset.tone === 'tip' && e.classList.contains('on') ? document.getElementById('shotStatus').textContent : null }")
            if t and (not tips or tips[-1] != t): tips.append(t)
            if not ringShot and await fr.evaluate("() => window.__game.hintContact && window.__game.state === window.eval('GS').RALLY && window.__game.ball.lastHitBy === -1"):
                await fr.evaluate("() => window.__game.render()"); await pg.screenshot(path=HERE + '/shots/c_ring.png'); ringShot = True
        print('tips', tips)
        print('autoHint', await pg.evaluate("__ah"))
        for i in range(60):
            if await pg.evaluate("Router.cur") == 'result': break
            await pg.wait_for_timeout(500)
        await pg.wait_for_timeout(5500)
        print('coach', await pg.evaluate("() => { const c = document.querySelector('.rc.coach, .rc.tip'); return c && c.innerText }"))
        await pg.evaluate("() => { const c = document.querySelector('.rc.coach, .rc.tip'); c && c.scrollIntoView({ block: 'center' }); }")
        await pg.wait_for_timeout(600); await pg.screenshot(path=HERE + '/shots/c_result.png')
        print('errs', errs)
        await b.close()
asyncio.run(main())
