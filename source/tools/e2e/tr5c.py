"""Boot timing diagnosis: how far does boot get on this box, and when?"""
import asyncio, time, os, sys
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
APP = f'file://{ROOT}/index.html'

async def main():
    t0 = time.time()
    def log(*a): print(f'[{time.time()-t0:6.1f}s]', *a, flush=True)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--disable-gpu'])
        log('launched')
        pg = await b.new_page(viewport={'width': 390, 'height': 844})
        pg.on('pageerror', lambda e: log('PAGEERR', str(e)[:200]))
        pg.on('console', lambda m: log('console', m.type, m.text[:160]) if m.type in ('error', 'warning') else None)
        await pg.goto(APP, timeout=180000)
        log('goto done')
        for i in range(40):
            st = await pg.evaluate("""() => {
                const cur = document.querySelector('.screen.current');
                const bar = document.querySelector('#bootFill, .ld-fill, [class*=fill]');
                return cur ? cur.dataset.s + ' / fill=' + (bar ? bar.style.width || getComputedStyle(bar).width : '-') : 'NO-SCREEN';
            }""")
            log('state:', st)
            if st.startswith('hub'): break
            await pg.wait_for_timeout(5000)
        await b.close()
        log('done')

asyncio.run(main())
