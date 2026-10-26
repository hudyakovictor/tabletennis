import asyncio, json, sys
from playwright.async_api import async_playwright
DX=sys.argv[7] if len(sys.argv)>7 else '0'
ST=sys.argv[6] if len(sys.argv)>6 else '1'
SRC=sys.argv[1]; RULES=sys.argv[2]; X=sys.argv[3] if len(sys.argv)>3 else '0'; Y=sys.argv[4] if len(sys.argv)>4 else '0'; L=sys.argv[5] if len(sys.argv)>5 else '0'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)
        await pg.add_init_script("window.requestAnimationFrame = function(){ return 0 }; window.__TT_RULES="+RULES)
        await pg.goto('file://'+SRC); await pg.wait_for_timeout(800)
        await pg.add_script_tag(path='/home/user/ttu-v2/game/tools/hitmap.js')
        for r in await pg.evaluate(f"__hitmap({{probe:1,lanes:[-.2,0,.2],step:{ST},xs:[{X}],ys:[{Y}],lead:{L},swipeDx:{DX}}})"): print(r)
        await b.close()
asyncio.run(main())
