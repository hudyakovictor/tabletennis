"""Shop art shots: list, rubber product page, blade product page, profile equipment. Saves to shots/shop_*.png"""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TAG = sys.argv[1] if len(sys.argv) > 1 else 'now'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/index.html?s=shop', wait_until='domcontentloaded'); await pg.wait_for_timeout(2200)
        await pg.evaluate("() => { const s = document.querySelector('.screen.current .scroll'); if (s) s.scrollTop = 330; }"); await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{HERE}/shots/shop_{TAG}_list.png')
        for iid in ['r-coral', 'b-ink']:
            await pg.click(f".screen.current [data-item='{iid}']"); await pg.wait_for_timeout(1300)
            await pg.screenshot(path=f'{HERE}/shots/shop_{TAG}_{iid}.png')
            await pg.evaluate("() => { const x = document.querySelector('.sheet [data-close], .sheet .x, .sheet-bg, .scrim'); if (x) x.click(); }"); await pg.wait_for_timeout(900)
        print('errs', errs)
        await b.close()
asyncio.run(main())
