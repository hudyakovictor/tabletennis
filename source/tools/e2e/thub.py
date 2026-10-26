import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + ROOT + '/index.html?s=hub')
        await pg.wait_for_timeout(9000)
        await pg.screenshot(path=HERE + '/shots/hub_lobby.png')
        print(await pg.evaluate("() => { const g = GameHost.frame.contentWindow.__game; return [g.state, g.demoMode, g.score, g.rally] }"))
        await pg.wait_for_timeout(1000)
        await pg.screenshot(path=HERE + '/shots/hub_lobby2.png')
        print(await pg.evaluate("() => { const g = GameHost.frame.contentWindow.__game; return [g.state, g.demoMode, g.score, g.rally] }"))
        # любой из режимных входов на хабе (быстрый матч / онлайн / практика / карьера)
        await pg.click('[data-modebtn]'); await pg.wait_for_timeout(800)
        print('mode sheet', await pg.evaluate("() => !!Sheet.cur || location.hash.includes('mm')"))
        print('errs', errs)
        await b.close()
asyncio.run(main())
