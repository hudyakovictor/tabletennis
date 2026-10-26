"""Outcome map runner. Usage: tzmap.py [trials] [viewport] [preset] [tag] [json opts]
Writes shots/zmap_<tag>.json and prints the agreement between the press gate and the physics."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 400
W, H = map(int, (sys.argv[2] if len(sys.argv) > 2 else '390x844').split('x'))
PRESET = sys.argv[3] if len(sys.argv) > 3 else 'BROADCAST'
TAG = sys.argv[4] if len(sys.argv) > 4 else 'base'
OPTS = sys.argv[5] if len(sys.argv) > 5 else '{}'
def report(T):
    import collections
    acc = [t for t in T if not t['gate']]; rej = [t for t in T if t['gate']]
    c = collections.Counter(t['outcome'] for t in T)
    print('trials', len(T), dict(c))
    print('accepted', len(acc), 'of which in', sum(t['outcome'] == 'in' for t in acc), 'miss', sum(t['outcome'] == 'miss' for t in acc),
          'net', sum(t['outcome'] == 'net' for t in acc), 'out', sum(t['outcome'] == 'out' for t in acc))
    # grid: dy rows × lead cols, cell = share of 'in' among accepted and acceptance share
    rows = [(-130, -90), (-90, -40), (-40, 0), (0, 40), (40, 80), (80, 120), (120, 170), (170, 230)]; cols = [(0, .04), (.04, .08), (.08, .12), (.12, .16), (.16, .24)]
    print('IN-rate of accepted (gate ok) | dy rows (px below contact) × lead cols (s); n in brackets; |dx|<=45')
    for r in rows:
        line = f'{r[0]:>4}..{r[1]:<4}'
        for cl in cols:
            cell = [t for t in T if r[0] <= t['dy'] < r[1] and cl[0] <= t['lead'] < cl[1] and abs(t['dx']) <= 45]
            a = [t for t in cell if not t['gate']]
            ins = sum(t['outcome'] == 'in' for t in a)
            line += f" | {('%3d%%' % (100 * ins / len(a))) if a else '  - '} ({len(a)}/{len(cell)})"
        print(line)
    print('IN-rate by |dx| (accepted), lead .04-.12, dy 0..80')
    for lo, hi in ((0, 15), (15, 30), (30, 45), (45, 60), (60, 90), (90, 130)):
        a = [t for t in T if lo <= abs(t['dx']) < hi and .04 <= t['lead'] < .12 and 0 <= t['dy'] < 80 and not t['gate']]
        r_ = [t for t in T if lo <= abs(t['dx']) < hi and .04 <= t['lead'] < .12 and 0 <= t['dy'] < 80 and t['gate']]
        print(f'  |dx| {lo}-{hi}: accepted {len(a)} in {sum(t["outcome"]=="in" for t in a)} miss {sum(t["outcome"]=="miss" for t in a)} | rejected {len(r_)}')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1, has_touch=True, is_mobile=True)
        await ctx.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true }))")
        pg = await ctx.new_page()
        await pg.goto('file://' + ROOT + '/index.html?s=hub', wait_until='domcontentloaded'); await pg.wait_for_timeout(900)
        await pg.evaluate("() => { MODE = MODES[0]; Router.go('match'); }")
        for i in range(80):
            if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
            await pg.wait_for_timeout(250)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        await fr.evaluate(open(HERE + '/tzmap.js').read())
        await fr.evaluate(f"() => {{ __game.settings.targetScore = 999; __game.setCameraPreset('{PRESET}'); }}")
        T = []
        while len(T) < N:
            r = await fr.evaluate(f"__zmap({min(150, N - len(T))}, {OPTS})")
            T += r['trials']
            if not r['trials']: break
        json.dump(T, open(os.path.join(HERE, 'shots', f'zmap_{TAG}.json'), 'w'))
        report(T)
        await b.close()
if __name__ == '__main__': asyncio.run(main())
