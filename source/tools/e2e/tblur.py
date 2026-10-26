import asyncio
from playwright.async_api import async_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
G="(GameHost.frame && GameHost.frame.contentWindow.__game)"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('' + 'file://' + ROOT + '/index.html?s=train')
        for i in range(40):
            if await pg.evaluate(f"() => !!({G} && {G}.training)"): break
            await pg.wait_for_timeout(300)
        await pg.evaluate("() => { const w = GameHost.frame.contentWindow; w.__rx = []; w.addEventListener('message', (e) => w.__rx.push(e.data.type)); }")
        await pg.mouse.click(195, 600); await pg.wait_for_timeout(300)
        print('focus in iframe', await pg.evaluate("() => document.activeElement && document.activeElement.tagName"))
        await pg.click('[data-act=skip]'); await pg.wait_for_timeout(1500)
        print('after skip: paused', await pg.evaluate(f"() => {G}.paused"), 'step', await pg.evaluate(f"() => {G}.training.step"), 'sheet', await pg.evaluate("() => !!Sheet.cur"))
        await pg.evaluate("() => { S.tutorialDone = true; MODE = MODES[1]; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("() => !!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        await pg.mouse.click(195, 600); await pg.wait_for_timeout(300)
        print('rx', await pg.evaluate('() => GameHost.frame.contentWindow.__rx'), await pg.evaluate('() => [GameHost.ready, GameHost.q.length]'))
        print('state', await pg.evaluate(f"() => [{G}.state, {G}.paused, !!{G}.training]"))
        await pg.click('[data-act=pause]'); await pg.wait_for_timeout(1200)
        print('match pause: paused', await pg.evaluate(f"() => {G}.paused"), 'sheet', await pg.evaluate("() => !!Sheet.cur"))
        await pg.click('[data-a=resume]'); await pg.wait_for_timeout(1200)
        print('resumed: paused', await pg.evaluate(f"() => {G}.paused"), 'sheet', await pg.evaluate("() => !!Sheet.cur"))
        print('errs', errs)
        await b.close()
asyncio.run(main())
