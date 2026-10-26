import asyncio
from playwright.async_api import async_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('' + 'file://' + ROOT + '/index.html?s=train'); await pg.wait_for_timeout(4500)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        for i in range(30):
            if await fr.evaluate('!!(window.__game&&window.__game.training)'): break
            await pg.wait_for_timeout(500)
        print(await fr.evaluate(open('' + HERE + '/tdet.js').read()))
        print('errs', errs)
        await b.close()
asyncio.run(main())
