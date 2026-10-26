"""Lost WebGL context → the host rebuilds the engine and resumes: match (same score), hub lobby, training step.
Plus the portrait-only overlay in phone landscape."""
import asyncio, time, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
LOSE = "() => { window.__old = 1; const c = document.getElementById('gl'); const gl = c.getContext('webgl2') || c.getContext('webgl'); gl.getExtension('WEBGL_lose_context').loseContext(); return true; }"
def frame(pg): return [f for f in pg.frames if f != pg.main_frame][-1]
async def wait_ready(pg, label):
    seen = False
    for i in range(120):
        on = await pg.evaluate("document.querySelector('#glRecover').classList.contains('on')"); seen = seen or on
        if await pg.evaluate("GameHost.ready && GameHost.frame && !GameHost.frame.contentWindow.__old && !!GameHost.frame.contentWindow.__game"): break
        await pg.wait_for_timeout(50)
    print(label, 'overlay seen', seen, 'ready', await pg.evaluate("GameHost.ready"), 'frames', len(pg.frames) - 1)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await (await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true }))")
        await pg.goto('file://' + ROOT + '/index.html?s=hub'); await pg.wait_for_timeout(800)
        # --- match
        await pg.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = frame(pg); await fr.evaluate(open(HERE + '/bot2.js').read())
        t0 = time.time()
        while time.time() - t0 < 90 and await fr.evaluate("window.__game.score[0] + window.__game.score[1]") < 3:
            await fr.evaluate("window.__bot2(40)")
        while await fr.evaluate("window.eval('GS').RALLY === window.__game.state || window.eval('GS').POINT === window.__game.state"):
            await fr.evaluate("window.__bot2(20)")
        before = await fr.evaluate("[window.__game.score.slice(), window.__game.server]")
        host_before = await pg.evaluate("[document.querySelector('#scP').textContent, document.querySelector('#scO').textContent]")
        print('before', before, 'host', host_before)
        await fr.evaluate(LOSE)
        await pg.wait_for_timeout(400); await pg.screenshot(path=HERE + '/shots/g_recover.png')
        await wait_ready(pg, 'match')
        fr = frame(pg)
        after = await fr.evaluate("[window.__game.score.slice(), window.__game.server, Object.keys(window.eval('GS')).find(k => window.eval('GS')[k] === window.__game.state), window.__game.demoMode]")
        print('after', after, 'same score', after[0] == before[0])
        await fr.evaluate(open(HERE + '/bot2.js').read())
        t0 = time.time(); s0 = sum(after[0])
        while time.time() - t0 < 60 and await fr.evaluate("window.__game.score[0] + window.__game.score[1]") < s0 + 2:
            await fr.evaluate("window.__bot2(40)")
        await pg.wait_for_timeout(300)
        print('continued', await fr.evaluate("window.__game.score.slice()"), 'host', await pg.evaluate("[document.querySelector('#scP').textContent, document.querySelector('#scO').textContent]"))
        # --- hub lobby
        await pg.evaluate("() => { GameHost.send('quit'); Router.go('hub'); }"); await pg.wait_for_timeout(2500)
        await frame(pg).evaluate(LOSE); await wait_ready(pg, 'lobby')
        await pg.wait_for_timeout(1500)
        print('lobby demo', await frame(pg).evaluate("window.__game.demoMode"), await pg.evaluate("document.querySelector('#gamelayer').className"))
        # --- training
        await pg.evaluate("Router.go('train', { data: { step: 2, then: 'hub' } })"); await pg.wait_for_timeout(4000)
        print('train step before', await frame(pg).evaluate("window.__game.training && window.__game.training.step"))
        await frame(pg).evaluate(LOSE); await wait_ready(pg, 'train')
        await pg.wait_for_timeout(1200)
        print('train step after', await frame(pg).evaluate("window.__game.training && window.__game.training.step"))
        print('errs', errs)
        # --- landscape
        pl = await (await b.new_context(viewport={'width':844,'height':390}, has_touch=True, is_mobile=True)).new_page()
        await pl.goto('file://' + ROOT + '/index.html?s=hub', wait_until='domcontentloaded'); await pl.wait_for_timeout(1500)
        print('rotate shown', await pl.evaluate("getComputedStyle(document.getElementById('rotate')).display"))
        await pl.screenshot(path=HERE + '/shots/g_rotate.png')
        # --- rotate mid-match → pause sheet
        pr = await (await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)).new_page()
        await pr.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true }))")
        await pr.goto('file://' + ROOT + '/index.html?s=hub'); await pr.wait_for_timeout(800)
        await pr.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
        for i in range(80):
            if await pr.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pr.wait_for_timeout(250)
        await pr.set_viewport_size({'width': 844, 'height': 390}); await pr.wait_for_timeout(700)
        print('rotated: sheet', await pr.evaluate("!!Sheet.cur"), 'host paused', await pr.evaluate("GameHost.paused"), 'game paused', await frame(pr).evaluate("window.__game.paused"))
        await b.close()
asyncio.run(main())
