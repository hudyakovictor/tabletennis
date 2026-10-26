"""Round-13 regression probe: chest auto-flow, result without rays, new naming,
in-match tip style. Screenshots into shots/r13_*.png"""
import asyncio, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = f'file://{ROOT}/index.html'
OUT = os.path.join(HERE, 'shots'); os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP)
        await pg.wait_for_selector('.screen.current', timeout=15000)
        await pg.evaluate("() => { try { localStorage.clear(); } catch(e) {} }")
        try:
            await pg.wait_for_selector('.screen.current[data-s="hub"]', timeout=12000)
        except Exception:
            await pg.evaluate("() => Router.go('hub')")
            await pg.wait_for_selector('.screen.current[data-s="hub"]', timeout=8000)
        await pg.wait_for_timeout(1200)

        # 1. hub naming
        await pg.screenshot(path=f'{OUT}/r13_hub.png', timeout=60000)
        hub_txt = await pg.evaluate("() => (document.querySelector('.arena-title')||{}).innerText || 'MISSING'")
        assert 'Топспин' in hub_txt and 'Неонов' not in hub_txt, hub_txt
        print('hub title:', hub_txt.replace('\n',' | '))

        # 2. pass naming
        await pg.evaluate("() => Router.go('pass')"); await pg.wait_for_timeout(800)
        pass_txt = await pg.evaluate("() => (document.querySelector('.ph-t')||{}).innerText || 'MISSING'")
        assert 'Неонов' not in pass_txt, pass_txt
        await pg.screenshot(path=f'{OUT}/r13_pass.png', timeout=60000)
        print('pass head:', pass_txt.replace('\n',' | '))
        nav = await pg.evaluate("() => [...document.querySelectorAll('#nav .ni l, #nav *')].map(e=>e.textContent.trim()).filter(t=>t==='Сезон'||t==='Пропуск')")
        print('nav labels seen:', set(nav))
        assert 'Пропуск' not in nav

        # 3. chest: ONE tap -> auto reveal -> auto credit -> auto close. No extra clicks.
        await pg.evaluate("() => Router.go('hub')"); await pg.wait_for_timeout(400)
        coins0 = await pg.evaluate("() => S.coins")
        await pg.evaluate("() => Router.go('chest', {data:{kind:'gold'}})")
        await pg.wait_for_timeout(900)
        await pg.screenshot(path=f'{OUT}/r13_chest_0.png', timeout=60000)
        # give the chest a slot so slot-clearing path runs
        await pg.evaluate("() => { S.chests[0] = { kind:'gold', t: Date.now() }; save(); LOCATION.mm; }")
        await pg.click('.cho-chest')                      # the ONLY user action allowed
        await pg.wait_for_timeout(1900)
        await pg.screenshot(path=f'{OUT}/r13_chest_1.png', timeout=60000)   # should be mid auto-reveal
        await pg.wait_for_timeout(2600)
        await pg.screenshot(path=f'{OUT}/r13_chest_2.png', timeout=60000)   # summary + auto crediting
        take = await pg.query_selector('[data-act=take]')
        assert take is None, 'take button must be gone'
        await pg.wait_for_timeout(3400)                       # auto-close to hub
        scr = await pg.evaluate("() => document.querySelector('.screen.current').dataset.s")
        coins1 = await pg.evaluate("() => S.coins")
        gems1 = await pg.evaluate("() => S.gems")
        print('after chest: screen=', scr, 'coins', coins0, '->', coins1, 'gems=', gems1)
        assert scr == 'hub', scr
        assert coins1 > coins0 and gems1 >= 8, (coins0, coins1, gems1)
        await pg.screenshot(path=f'{OUT}/r13_chest_done.png', timeout=60000)

        # 4. result screen: no rays element, podium art visible
        await pg.evaluate("() => Router.go('result', {data:{win:true, p:3, a:1, mmr:+21, newBest:true, stats:{dur:'3:12', rallies:[0,0,0], shots:[['LOOP',2]], tops:[3,2], maxRally:4}, from:'climb'}})")
        await pg.wait_for_timeout(1700)
        rays = await pg.query_selector('.res-rays')
        assert rays is None, 'res-rays still in DOM'
        await pg.screenshot(path=f'{OUT}/r13_result.png', timeout=60000)
        print('result ok, rays gone')

        # 5. in-match tip: force a miss with a long backswing and check style
        await pg.evaluate("() => Router.go('match', {data:{}})")
        await pg.wait_for_timeout(2500)
        await pg.evaluate("""() => {
          const g = window.GAME && window.GAME.g; if (!g) return;
          g.state = g.GS ? g.GS.RALLY : g.state;
        }""")
        # fabricate the DOM node as the embed would, to verify the new style
        ok = await pg.evaluate("""() => {
          document.getElementById('shot').setAttribute('data-tone','tip');
          document.getElementById('shotName').textContent = 'Совет';
          document.getElementById('shotStatus').textContent = 'Тест длины и размера подсказки';
          const st = getComputedStyle(document.getElementById('shotStatus'));
          return { fs: st.fontSize, tipBg: getComputedStyle(document.getElementById('shot')).backgroundColor };
        }""")
        print('tip style:', ok)
        assert float(ok['fs'].replace('px','')) >= 16
        await pg.screenshot(path=f'{OUT}/r13_match_tip.png', timeout=60000)

        print('console errors:', errs[:5] or 'none')
        await b.close()

asyncio.run(main())
print('R13 PROBE PASS')
