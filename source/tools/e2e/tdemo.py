import os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':390,'height':844})
        await pg.add_init_script("window.requestAnimationFrame = function(){ return 0 };")
        await pg.goto('file://' + ROOT + '/game_build.html'); await pg.wait_for_timeout(800)
        print(await pg.evaluate("""() => { const g = window.__game; g.settings.targetScore = 11; g.startDemo(1);
          let hits = 0, best = 0; const oh = g.applyHit; g.applyHit = function (side) { if (side > 0) hits++; return oh.apply(this, arguments); };
          for (let i = 0; i < 60 * 240 && g.state !== window.eval('GS').MATCH_END; i++) g.update(1/60);
          return { score: g.score, best: g.bestRally, hits, state: g.state, shots: g.stats }; }"""))
        await b.close()
asyncio.run(main())
