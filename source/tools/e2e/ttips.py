"""Miss tips in a real match (bot with human-like scatter) + tutorial reward card."""
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
        await pg.evaluate("() => { MODE = MODES[0]; S.tutorialDone = true; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        await fr.evaluate("() => { window.__b2jit = { px: 70, lead: 0.3 }; }")
        tips = []; shot = False; t0 = time.time()
        while time.time() - t0 < 150 and len(tips) < 2:
            if await pg.evaluate("Router.cur") != 'match': break
            for k in range(6):
                await fr.evaluate("() => { window.__bot2(10); window.__game.ui.tick(1 / 6); }")
                t = await fr.evaluate("() => { const e = document.getElementById('shot'); return e.dataset.tone === 'tip' && e.classList.contains('on') ? document.getElementById('shotStatus').textContent : null }")
                if t and (not tips or tips[-1] != t):
                    tips.append(t)
                    if not shot: await pg.screenshot(path=HERE + '/shots/t_tip.png'); shot = True
        print('tips', tips)
        # tutorial reward
        await pg.evaluate("() => { S.tutorialRewarded = false; S.coins = 1840; S.gems = 46; Router.go('train'); }")
        await pg.wait_for_timeout(3500)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate("() => window.__game.ui.trainDone(window.__game.training || {})")
        await pg.wait_for_timeout(1700); await pg.screenshot(path=HERE + '/shots/t_reward1.png')
        await pg.wait_for_timeout(3500); await pg.screenshot(path=HERE + '/shots/t_reward2.png')
        print('wallet', await pg.evaluate("() => [S.coins, S.gems, S.tutorialRewarded, Router.cur, !!document.querySelector('.screen.current .tx-done.on')]"))
        print('errs', errs)
        await b.close()
asyncio.run(main())
