"""Снимает карту эффективной области удара для собранной страницы игры.
python3 hitmap.py game.html out.json [lead] [type]"""
import asyncio, json, sys
from playwright.async_api import async_playwright
SRC = sys.argv[1]; OUT = sys.argv[2]
LEAD = float(sys.argv[3]) if len(sys.argv) > 3 else .14
TYPE = sys.argv[4] if len(sys.argv) > 4 else 'touch'
STEP = int(sys.argv[5]) if len(sys.argv) > 5 else 20
RULES = sys.argv[6] if len(sys.argv) > 6 else '{}'
STEPI = int(sys.argv[7]) if len(sys.argv) > 7 else 1
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        await pg.add_init_script("window.requestAnimationFrame = function(){ return 0 }; window.__TT_RULES = " + RULES + ";")
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + SRC); await pg.wait_for_timeout(800)
        await pg.add_script_tag(path=__file__.replace('hitmap.py', 'hitmap.js'))
        rng = list(range(-140, 141, STEP))
        res = {'grid': await pg.evaluate(f"__hitmap({{xs:{rng}, ys:{rng}, lead:{LEAD}, type:'{TYPE}', step:{STEPI}}})")}
        leads = [round(-.15 + i * .025, 3) for i in range(25)]
        res['timing'] = await pg.evaluate(f"__hitmap({{xs:[0], ys:[0], leads:{leads}, type:'{TYPE}', step:{STEPI}}})")
        json.dump(res, open(OUT, 'w')); print('errors', errs[:3])
        await b.close()
asyncio.run(main())
