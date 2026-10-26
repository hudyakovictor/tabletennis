"""Zone A/B tooling: rules from a link → engine uses them; real attempts carry the zone signature;
stats sheet compares settings; export copies JSON; link button round-trips."""
import asyncio, time, os, json, base64
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
def enc(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        legacy = open(HERE + '/shots/z_attempts.json').read()
        await pg.add_init_script("if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.removeItem('ttu-rules-dev'); localStorage.setItem('ttu-zone-stats', %s); localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true })); }" % json.dumps(legacy))
        rules = {'contactSideTouchPx': 40, 'captureRadius': 0.26, 'evil': 5, 'contactBackPx': 999}
        await pg.goto('file://' + ROOT + '/index.html?s=hub&dev=1&rules=' + enc(rules))
        tt = []
        for i in range(24):
            tt = await pg.evaluate("[...document.querySelectorAll('#toasts .toast')].map(e => e.innerText)")
            if tt: break
            await pg.wait_for_timeout(250)
        print('stored', await pg.evaluate("localStorage.getItem('ttu-rules-dev')"))
        print('toast', tt)
        for i in range(40):
            if await pg.evaluate("GameHost.ready"): break
            await pg.wait_for_timeout(250)
        print('engine', await pg.evaluate("(() => { const R = GameHost.frame.contentWindow.eval('MATCH_RULES'); return [R.contactSideTouchPx, R.captureRadius, R.contactBackPx, R.evil]; })()"))
        await pg.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/bot2.js').read())
        n0 = await pg.evaluate("ZoneStats.all().length"); t0 = time.time()
        while time.time() - t0 < 120 and await pg.evaluate("ZoneStats.all().length") < n0 + 12 and await pg.evaluate("Router.cur") == 'match':
            if await pg.evaluate("document.querySelector('.mx-replay')===null && !document.querySelector('.m-final')"): await fr.evaluate("window.__bot2(40)")
            else: await pg.wait_for_timeout(200)
        print('new sigs', await pg.evaluate("[...new Set(ZoneStats.all().slice(%d).map(a => a.sig))]" % n0), 'sigNow', await pg.evaluate("ZoneStats.sigNow('touch')"))
        print('compare', await pg.evaluate("ZoneStats.compare('touch')"))
        await pg.evaluate("() => document.querySelector('.screen.current[data-id=match] [data-act=dev]').click()"); await pg.wait_for_timeout(600)
        await pg.evaluate("() => document.querySelector('#sheets [data-a=stats]').click()"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=HERE + '/shots/l_cur.png')
        await pg.evaluate("() => document.querySelector('#sheets [data-a=all]').click()"); await pg.wait_for_timeout(1200)
        print('scope all', await pg.evaluate("document.querySelector('#sheets .zs-scope .on').textContent"), await pg.evaluate("document.querySelectorAll('#sheets .zc-row').length"))
        await pg.evaluate("() => { const c = document.querySelector('#sheets .zs-cmp'); let sc = c.parentElement; while (sc && sc.scrollHeight <= sc.clientHeight + 2) sc = sc.parentElement; if (sc && sc !== document.body && sc !== document.documentElement) sc.scrollTop = sc.scrollHeight; }"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=HERE + '/shots/l_cmp.png')
        await pg.evaluate("() => document.querySelector('#sheets [data-a=export]').click()"); await pg.wait_for_timeout(800)
        print('export toast', await pg.evaluate("[...document.querySelectorAll('.toast, #toasts *')].map(e => e.innerText).filter(Boolean).slice(-1)"))
        print('roundtrip', await pg.evaluate("(() => { const o = { contactSideTouchPx: 52, captureRadius: .24, autoFootwork: false }; const u = RulesLink.url(o); const back = RulesLink.clean(RulesLink.dec(u.split('rules=')[1])); return [u.split('?')[1].slice(0, 12), Object.keys(o).every((k) => back[k] === o[k]) && Object.keys(back).length === Object.keys(o).length]; })()"))
        print('errs', errs); await b.close()
asyncio.run(main())
