import asyncio, time
from playwright.async_api import async_playwright
import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
G="GameHost.frame.contentWindow.__game"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('CON '+m.text) if m.type=='error' else None)
        await pg.goto('' + 'file://' + ROOT + '/index.html?s=hub')
        await pg.wait_for_timeout(800)
        await pg.evaluate("() => { MODE = MODES[1]; S.tutorialDone = true; window.__log = []; GameHost.on((m) => { if (['point','matchEnd','replayEnd','paused'].includes(m.type)) window.__log.push(m.type + (m.score ? ':' + m.score.join('-') : '') + (m.matchPoint ? ':MP' + m.matchPoint : '') + (m.type === 'matchEnd' ? ':won=' + m.won + ':rep=' + m.hasReplay + ':best=' + m.bestRally : '')); }); return GameHost.subs.size; }")
        print('subs0', await pg.evaluate("GameHost.subs.size"))
        await pg.evaluate("Router.go('match')")
        await pg.wait_for_timeout(300)
        print('subs1', await pg.evaluate("GameHost.subs.size"))
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open('' + HERE + '/bot2.js').read())
        print('subs', await pg.evaluate("GameHost.subs.size"), await pg.evaluate("typeof window.__log"), await pg.evaluate("location.href"))
        shots=0; t0=time.time()
        while time.time()-t0 < 240:
            cur = await pg.evaluate('Router.cur')
            if cur != 'match': break
            if await pg.evaluate("document.querySelector('.mx-replay')===null && !document.querySelector('.m-final')"): await fr.evaluate("window.__bot2(60)")
            else: await pg.wait_for_timeout(200)
            await pg.wait_for_timeout(30)
            vig = await pg.evaluate("!!document.querySelector('.m-vig.mp')")
            fin = await pg.evaluate("!!document.querySelector('.m-final')")
            rep = await pg.evaluate("!!document.querySelector('.mx-replay')")
            if vig and shots==0: await pg.screenshot(path=HERE + '/shots/f_mp.png'); shots=1
            if fin and shots<2: await pg.screenshot(path=HERE + '/shots/f_final.png'); shots=2
            if rep and shots<3: await pg.screenshot(path=HERE + '/shots/f_replay.png'); shots=3
        await pg.wait_for_timeout(1500)
        print('cur', await pg.evaluate('Router.cur'), 't', int(time.time()-t0))
        print('log', await pg.evaluate('__log'))
        await pg.screenshot(path=HERE + '/shots/f_result.png')
        print('result text', (await pg.evaluate("document.querySelector('.screen.current').innerText"))[:300].replace('\n',' | '))
        print('errs', errs)
        await b.close()
asyncio.run(main())
