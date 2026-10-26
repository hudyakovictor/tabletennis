"""Zone × camera audit: where must the finger go to return a ball (rally and serve receive),
and how does that depend on the camera preset and the phone. Usage: tzaudit.py [shots] [presets] [viewports]"""
import asyncio, os, sys, json, statistics as st
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 24
PRESETS = sys.argv[2].split(',') if len(sys.argv) > 2 else ['BROADCAST', 'DYNAMIC', 'LOW']
VPS = [tuple(map(int, v.split('x'))) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [(360, 740), (390, 844), (430, 932), (768, 1024)]
def med(xs):
    xs = [x for x in xs if x is not None and x == x]
    return round(st.median(xs), 2) if xs else None
def pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return round(xs[min(len(xs) - 1, int(p * len(xs)))], 2) if xs else None
def summary(recs):
    out = {}
    for kind, rs in (('rally', [r for r in recs if not r['serve']]), ('serve', [r for r in recs if r['serve']])):
        if not rs: continue
        ob = [r['onBall'] for r in rs]; b4 = [r['below40'] for r in rs]
        out[kind] = {'n': len(rs), 'flight_s': med([r['flight'] for r in rs]), 'afterBounce_s': med([r['afterBounce'] for r in rs]),
            'contact_y_frac': med([r['cfrac'][1] for r in rs]), 'contact_y_frac_p90': pct([r['cfrac'][1] for r in rs], .9),
            'contact_x_frac_min_max': [pct([r['cfrac'][0] for r in rs], 0), pct([r['cfrac'][0] for r in rs], .99)],
            'px_per_cm_x': med([r['pxX'] for r in rs]), 'px_per_cm_y': med([r['pxY'] for r in rs]),
            'zone_cm_side': med([r['zoneCm']['side'] for r in rs]), 'zone_cm_back': med([r['zoneCm']['back'] for r in rs]), 'zone_cm_fwd': med([r['zoneCm']['fwd'] for r in rs]),
            'ball_px_s': med([r['ballPxPerS'] for r in rs]),
            'onBall_ok%': round(100 * sum(1 for w in ob if w) / len(rs)), 'onBall_window_ms': med([(w[1] - w[0]) * 1000 for w in ob if w]),
            'below40_ok%': round(100 * sum(1 for w in b4 if w) / len(rs)), 'below40_window_ms': med([(w[1] - w[0]) * 1000 for w in b4 if w]),
            'drift_px_t30': med([r['drift']['t30'] for r in rs]), 'drift_px_t20': med([r['drift']['t20'] for r in rs]), 'drift_px_t10': med([r['drift']['t10'] for r in rs]),
            'clipBottom%': round(100 * sum(1 for r in rs if r['clipBottom']) / len(rs)), 'clipSide%': round(100 * sum(1 for r in rs if r['clipSide']) / len(rs)), 'unreachable%': round(100 * sum(1 for r in rs if r.get('unreachable')) / len(rs)), 'zone_px': [med([r['zonePx'][i] for r in rs if r.get('zonePx')]) for i in range(3)]}
    return out
async def main():
    allres = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        for (w, h) in VPS:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, has_touch=True, is_mobile=True)
            await ctx.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true }))")
            pg = await ctx.new_page()
            await pg.goto('file://' + ROOT + '/index.html?s=hub', wait_until='domcontentloaded'); await pg.wait_for_timeout(900)
            await pg.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
            for i in range(80):
                if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
                await pg.wait_for_timeout(250)
            fr = [f for f in pg.frames if f != pg.main_frame][0]
            await fr.evaluate(open(HERE + '/bot2.js').read()); await fr.evaluate(open(HERE + '/tzaudit.js').read())
            await fr.evaluate("() => { const g = __game; g.settings.targetScore = 99; }")
            for pr in PRESETS:
                r = await fr.evaluate(f"__zaudit({N}, '{pr}')")
                key = f'{w}x{h} {pr}'; allres[key] = {'summary': summary(r['recs']), 'recs': r['recs']}
                print(key, json.dumps(allres[key]['summary'], ensure_ascii=False))
            await ctx.close()
        await b.close()
    json.dump(allres, open(os.path.join(HERE, 'shots', os.environ.get('ZOUT', 'zaudit.json')), 'w'), ensure_ascii=False, indent=1)
asyncio.run(main())
