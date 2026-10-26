"""Round-13 regression probe (lite): slow-box tolerant. GPU off; only DOM
asserts + two screenshots (chest summary, result)."""
import asyncio, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = f'file://{ROOT}/index.html'
OUT = os.path.join(HERE, 'shots'); os.makedirs(OUT, exist_ok=True)
SHOTS = os.environ.get('SHOTS', '1') == '1'

async def shot(pg, name):
    if not SHOTS: return
    try:
        await pg.screenshot(path=f'{OUT}/{name}.png', timeout=90000)
        print('shot', name, flush=True)
    except Exception as e:
        print('shot FAIL', name, str(e)[:80], flush=True)

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=[
            '--disable-gpu', '--disable-features=Vulkan',
            '--js-flags=--max-old-space-size=768'])
        pg = await b.new_page(viewport={'width': 390, 'height': 844})
        pg.on('pageerror', lambda e: print('PAGEERR', str(e)[:160], flush=True))
        await pg.goto(APP, timeout=120000)
        # boot is heavy on this box: the real hub can take a minute; just wait
        try:
            await pg.wait_for_selector('.screen.current[data-s="hub"]', timeout=150000)
        except Exception:
            await pg.evaluate("() => { try { Router.go('hub'); } catch(e){} }")
            await pg.wait_for_selector('.screen.current[data-s="hub"]', timeout=60000)
        print('stage: hub reached', flush=True)

        hub_txt = await pg.evaluate("() => (document.querySelector('.arena-title')||{}).innerText || 'MISSING'")
        print('hub title:', hub_txt.replace('\n', ' | '), flush=True)
        assert 'Топспин' in hub_txt and 'Неонов' not in hub_txt, hub_txt

        await pg.evaluate("() => Router.go('pass')")
        await pg.wait_for_selector('.ph-t', timeout=30000); await pg.wait_for_timeout(300)
        pass_txt = await pg.evaluate("() => document.querySelector('.ph-t').innerText")
        print('pass head:', pass_txt.replace('\n', ' | '), flush=True)
        assert 'Неонов' not in pass_txt
        nav = await pg.evaluate("() => [...document.querySelectorAll('#nav .nv, #nav .nl, #nav span')].map(e => e.textContent.trim()).filter(Boolean)")
        print('nav bits:', [t for t in nav if t in ('Сезон', 'Пропуск')], flush=True)
        assert 'Пропуск' not in nav

        # chest: single tap => auto everything
        await pg.evaluate("() => Router.go('chest', {data:{kind:'gold'}})")
        await pg.wait_for_selector('.cho-chest', timeout=30000); await pg.wait_for_timeout(400)
        coins0, gems0 = await pg.evaluate("() => [S.coins, S.gems]")
        await pg.click('.cho-chest')
        # wait for the auto chain to credit and return to hub (no clicks!)
        await pg.wait_for_function("() => document.querySelector('.screen.current') && document.querySelector('.screen.current').dataset.s === 'hub'", timeout=60000)
        coins1, gems1 = await pg.evaluate("() => [S.coins, S.gems]")
        take = await pg.evaluate("() => !![...document.querySelectorAll('[data-act=take]')].length || 'gone'")
        print(f'chest: coins {coins0}->{coins1} gems {gems0}->{gems1}', flush=True)
        assert coins1 > coins0 and gems1 - gems0 >= 8, (coins0, coins1, gems0, gems1)

        # result: no rays, podium renders
        await pg.evaluate("() => Router.go('result', {data:{win:true, p:3, a:1, mmr:+21, stats:{dur:'3:12'}, from:'climb'}})")
        await pg.wait_for_selector('.res', timeout=30000); await pg.wait_for_timeout(1500)
        rays = await pg.evaluate("() => !!document.querySelector('.res-rays')")
        assert not rays
        print('result: rays gone =', not rays, flush=True)
        await shot(pg, 'r13_result')

        # chest summary shot: re-open, tap, wait for sum grid, shoot
        await pg.evaluate("() => Router.go('chest', {data:{kind:'gold'}})")
        await pg.wait_for_selector('.cho-chest', timeout=30000)
        await pg.click('.cho-chest')
        await pg.wait_for_selector('.sum-grid .sg', timeout=60000)
        await pg.wait_for_timeout(600)
        await shot(pg, 'r13_chest_sum')

        print('R13 PROBE PASS', flush=True)
        await b.close()

asyncio.run(main())
