"""Profile «Техника удара» card: empty state, then a seeded 10-match history (visual check of the component)."""
import asyncio, os, json, random
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await (await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)).new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.removeItem('ttu-match-log')")
        await pg.goto('file://' + ROOT + '/index.html?s=profile', wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        print('empty', await pg.evaluate("() => document.querySelector('.screen.current .tq').innerText.replace(/\\n+/g,' | ')"))
        random.seed(3); keys = ['side','racket','racket','early','racket','side','racket','good','racket','good']
        log = [{'t': 1792700000000 + i * 3600e3, 'pct': p_, 'n': 20 + i, 'win': w, 'key': k} for i, (p_, w, k) in enumerate(zip([34,41,38,47,52,49,58,63,61,72], [0,0,1,0,1,0,1,1,0,1], keys))]
        await pg.evaluate("(L) => { localStorage.setItem('ttu-match-log', JSON.stringify(L)); ZoneStats.memLog = L; Router.go('hub'); setTimeout(() => Router.go('profile'), 1200); }", log)
        await pg.wait_for_timeout(4500); print('cur', await pg.evaluate('Router.cur'))
        print('card', await pg.evaluate("() => document.querySelector('.screen.current .tq').innerText.replace(/\\n+/g,' | ')"))
        await pg.evaluate("() => { const c = document.querySelector('.screen.current .tq'); const sc = c.closest('.scroll'); sc.scrollTop = c.offsetTop - 120; }")
        await pg.wait_for_timeout(800); await pg.screenshot(path=HERE + '/shots/p_tech.png')
        print('errs', errs); await b.close()
asyncio.run(main())
