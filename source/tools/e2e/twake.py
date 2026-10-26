"""Sleep/wake of the hidden game: hub lobby → shop (hidden: frozen) → hub (lobby runs again) → match."""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
G = "GameHost.frame.contentWindow.__game"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({tutorialDone: true}))")
        await pg.goto('file://' + ROOT + '/index.html', wait_until='domcontentloaded')   # through the splash
        for i in range(60):
            if await pg.evaluate("!!(GameHost.frame && GameHost.frame.contentWindow.__game)"): break
            await pg.wait_for_timeout(100)
        if await pg.evaluate("Router.cur") == 'splash':
            t0 = await pg.evaluate(f"{G}.time"); await pg.wait_for_timeout(700)
            print('splash game time +%.2f' % (await pg.evaluate(f"{G}.time") - t0), 'cur', await pg.evaluate("Router.cur"))
        for i in range(100):
            if await pg.evaluate("Router.cur") == 'hub': break
            await pg.wait_for_timeout(100)
        async def adv(label):
            t0 = await pg.evaluate(f"{G}.time"); await pg.wait_for_timeout(2500); t1 = await pg.evaluate(f"{G}.time")
            print(label, 'game time +%.2f' % (t1 - t0), 'asleep', await pg.evaluate("!!GameHost._asleep"), 'layer', await pg.evaluate("document.querySelector('#gamelayer').className"))
        for i in range(40):
            if await pg.evaluate("GameHost.ready && !!GameHost.frame.contentWindow.__game"): break
            await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(1500)
        await adv('hub lobby')
        await pg.evaluate("Router.go('shop')"); await pg.wait_for_timeout(1200)
        await adv('shop')
        await pg.evaluate("Router.go('hub')"); await pg.wait_for_timeout(800)
        await adv('hub again')
        print('demo', await pg.evaluate(f"[{G}.demoMode, Object.keys(GameHost.frame.contentWindow.eval('GS')).find(k => GameHost.frame.contentWindow.eval('GS')[k] === {G}.state)]"))
        await pg.evaluate("() => { MODE = MODES[0]; Router.go('mm'); }"); await pg.wait_for_timeout(900)
        await adv('matchmaking')
        await pg.evaluate("() => { Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        await adv('match live')
        print('errs', errs); await b.close()
asyncio.run(main())
