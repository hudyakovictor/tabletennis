"""Fast check of the result screen with «Разбор матча» from shots/z_attempts.json."""
import asyncio, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/index.html?s=hub', wait_until='domcontentloaded'); await pg.wait_for_timeout(1500)
        L = open(HERE + '/shots/z_attempts.json').read()
        for win in (False, True):
            await pg.evaluate("([L, win]) => { localStorage.setItem('ttu-zone-stats', L); ZoneStats.mem = JSON.parse(L); const d = Demo.result(win); d.coach = ZoneStats.matchSummary(0); Router.go('result', { data: d }); }", [L, win])
            await pg.wait_for_timeout(11000)
            print(win, await pg.evaluate("() => { const c = document.querySelector('.screen.current .rc.coach'); const r = c.getBoundingClientRect(); return [c.innerText.replace(/\\n+/g, ' | '), Math.round(r.top), Math.round(r.bottom)] }"))
            await pg.screenshot(path=HERE + f'/shots/c_result_{int(win)}.png')
        print('errs', errs); await b.close()
asyncio.run(main())
