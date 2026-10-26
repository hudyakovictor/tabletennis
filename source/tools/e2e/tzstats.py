"""Zone-statistics e2e: a bot with human-like scatter plays a ranked match,
then the «Статистика зоны» sheet is opened and screenshotted."""
import asyncio, time, os, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('CON '+m.text) if m.type=='error' else None)
        await pg.goto('file://' + ROOT + '/index.html?s=hub&dev=1')
        await pg.wait_for_timeout(800)
        await pg.evaluate("() => { ZoneStats.clear(); MODE = MODES[1]; S.tutorialDone = true; }")
        await pg.evaluate("Router.go('match')")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        await fr.evaluate("() => { window.__b2jit = { px: 48, lead: 0.16 }; }")
        t0 = time.time()
        while time.time() - t0 < 700:
            if await pg.evaluate("Router.cur") != 'match':
                await pg.evaluate("Router.go('match')")
                for i in range(80):
                    if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
                    await pg.wait_for_timeout(250)
                continue
            if await pg.evaluate("ZoneStats.all().length") >= 38: break
            if await pg.evaluate("document.querySelector('.mx-replay')===null && !document.querySelector('.m-final')"): await fr.evaluate("window.__bot2(60)")
            else: await pg.wait_for_timeout(200)
        L = await pg.evaluate("ZoneStats.all()")
        print('attempts', len(L))
        from collections import Counter
        print('contact', sum(a['contact'] for a in L), 'outside', sum(not a['accepted'] for a in L), 'reasons', Counter(a['reason'] for a in L if not a['contact']))
        print('sample', json.dumps(L[:3], ensure_ascii=False))
        json.dump(L, open(HERE + '/shots/z_attempts.json', 'w'), ensure_ascii=False)
        # the real path a tester uses: ⚙ dev button in the match → «Статистика попаданий»
        await pg.evaluate("() => document.querySelector('.screen.current[data-id=match] [data-act=dev]').click()")
        await pg.wait_for_timeout(700)
        await pg.evaluate("() => document.querySelector('#sheets [data-a=stats]').click()")
        await pg.wait_for_timeout(1200)
        print('sheet open', await pg.evaluate("!!document.querySelector('#sheets .zs-plot')"))
        await pg.screenshot(path=HERE + '/shots/z_stats.png')
        print('recs', await pg.evaluate("[...document.querySelectorAll('.zs-rec')].map(e => e.innerText)"))
        print('errs', errs)
        await b.close()
asyncio.run(main())
