"""Career from a real match: precise bot plays a quick match → result → achievement pop(s) → profile radar & achievements."""
import asyncio, time, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.removeItem('ttu-match-log'); localStorage.removeItem('ttu-zone-stats'); localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true })); }")
        await pg.goto('file://' + ROOT + '/index.html?s=hub'); await pg.wait_for_timeout(800)
        await pg.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        t0 = time.time()
        while time.time() - t0 < 300 and await pg.evaluate("Router.cur") == 'match':
            if await pg.evaluate("document.querySelector('.mx-replay')===null && !document.querySelector('.m-final')"): await fr.evaluate("window.__bot2(60)")
            else: await pg.wait_for_timeout(200)
        shot = False
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.ach-pop.on')"):
                await pg.wait_for_timeout(700); await pg.screenshot(path=HERE + '/shots/a_pop.png'); shot = True; break
            await pg.wait_for_timeout(250)
        print('pop seen', shot)
        print('car', await pg.evaluate("S.car"))
        print('ach', await pg.evaluate("Object.keys(S.ach || {})"))
        await pg.wait_for_timeout(4000)
        await pg.evaluate("Router.go('profile')"); await pg.wait_for_timeout(3000)
        print('radar', await pg.evaluate("Career.radar().map(([k, v]) => k + ' ' + v.toFixed(2)).join(', ')"))
        print('ach title', await pg.evaluate("document.querySelector('.screen.current .sec-title .dim').textContent"))
        await pg.evaluate("() => { const c = document.querySelector('.screen.current .skills'); c.closest('.scroll').scrollTop = c.offsetTop - 90; }")
        await pg.wait_for_timeout(900); await pg.screenshot(path=HERE + '/shots/a_profile.png')
        print('errs', errs); await b.close()
asyncio.run(main())
