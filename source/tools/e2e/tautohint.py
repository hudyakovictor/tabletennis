"""Adaptive ring full cycle in a real match: scattered bot → ring on; precise bot → ring off after 2 contacts.
Then the match is played out and must land in the profile technique log."""
import asyncio, time, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.removeItem('ttu-match-log'); localStorage.removeItem('ttu-zone-stats')")
        await pg.goto('file://' + ROOT + '/index.html?s=hub'); await pg.wait_for_timeout(800)
        await pg.evaluate("() => { MODE = MODES[0]; S.tutorialDone = true; S.hint = false; window.__ah = []; GameHost.on((m) => { if (m.type === 'autoHint') window.__ah.push(m.on); }); Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        await fr.evaluate("() => { window.__b2jit = { px: 80, lead: 0.3 }; }")
        t0 = time.time(); phase = 'scatter'
        while time.time() - t0 < 500:
            if await pg.evaluate("Router.cur") != 'match': break
            if await pg.evaluate("document.querySelector('.mx-replay')!==null || !!document.querySelector('.m-final')"):
                await pg.wait_for_timeout(300); continue
            await fr.evaluate("() => { window.__bot2(20); }")
            ah = await pg.evaluate("__ah")
            if phase == 'scatter' and ah == [True]:
                phase = 'precise'; await fr.evaluate("() => { window.__b2jit = null; }")
                print('ring on at score', await pg.evaluate("document.querySelector('.screen.current .m-sb, .screen.current .mx').innerText.slice(0, 40).replace(/\\n/g, ' ')"))
            if phase == 'precise' and len(ah) >= 2 and ph != 'done':
                ph = 'done'; print('ring off, hintContact =', await fr.evaluate("window.__game.hintContact"))
            ph = locals().get('ph', '')
        for i in range(60):
            if await pg.evaluate("Router.cur") == 'result': break
            await pg.wait_for_timeout(500)
        print('autoHint seq', await pg.evaluate("__ah"))
        print('match log', await pg.evaluate("ZoneStats.matches()"))
        print('errs', errs); await b.close()
asyncio.run(main())
