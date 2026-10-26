"""Fast re-shoot of the stats sheet from shots/z_attempts.json (made by tzstats.py)."""
import asyncio, os, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/index.html?s=hub&dev=1', wait_until='domcontentloaded'); await pg.wait_for_timeout(1500)
        L = open(HERE + '/shots/z_attempts.json').read()
        await pg.evaluate("(L) => { localStorage.setItem('ttu-zone-stats', L); ZoneStats.mem = JSON.parse(L); zoneStatsSheet(); }", L)
        await pg.wait_for_timeout(1000); await pg.screenshot(path=HERE + '/shots/z_stats2.png'); print('errs', errs)
        await b.close()
asyncio.run(main())
