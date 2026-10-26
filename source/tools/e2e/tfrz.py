import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
import asyncio
from playwright.async_api import async_playwright
G="(GameHost.frame && GameHost.frame.contentWindow.__game)"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        await pg.goto('file://' + ROOT + '/index.html?s=train')
        for i in range(60):
            if await pg.evaluate(f"() => !!({G} && {G}.training && {G}.training.frozen)"): break
            await pg.wait_for_timeout(400)
        await pg.wait_for_timeout(700); await pg.screenshot(path=HERE + '/shots/z1.png')
        await pg.evaluate(f"() => {G}.training.goStep(2)")
        for i in range(40):
            if await pg.evaluate(f"() => {{ const c = {G}.training.coachCue(); return !!(c && c.kind === 'tap'); }}"): break
            await pg.wait_for_timeout(300)
        for k in range(4):
            print(await pg.evaluate(f"() => {{ const g = {G}; const t = g.training; return [g.state, t.phase, t.coachText, document.querySelector('.tc-text').textContent, t.coachCue() && t.coachCue().kind] }}"))
            await pg.wait_for_timeout(400)
        await b.close()
asyncio.run(main())
