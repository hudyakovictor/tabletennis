"""Illustration check shots: pass, shop, mm, result win/lose."""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        for name, url, wait in [('pass','?s=pass',1800),('shop','?s=shop',1800),('mm','?s=mm',2500)]:
            await pg.goto('file://' + ROOT + '/index.html' + url, wait_until='domcontentloaded')
            await pg.wait_for_timeout(wait)
            await pg.screenshot(path=f'{HERE}/shots/ill_{name}.png')
        await pg.goto('file://' + ROOT + '/index.html?s=result', wait_until='domcontentloaded'); await pg.wait_for_timeout(1400)
        await pg.screenshot(path=f'{HERE}/shots/ill_win.png')
        await pg.evaluate("() => Router.go('result', Demo.result(false))")
        await pg.wait_for_timeout(1400)
        await pg.screenshot(path=f'{HERE}/shots/ill_lose.png')
        print('errs', errs)
        await b.close()
asyncio.run(main())
