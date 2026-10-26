"""Startup & hub performance with CPU throttling (default 4× — a mid-range phone).
Prints: DOMContentLoaded, splash → hub, engine ready, long tasks, hub FPS with the lobby running."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RATE = float(sys.argv[1]) if len(sys.argv) > 1 else 4
INIT = """
window.__perf = { lt: [], hub: null, ready: null };
new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
const iv = setInterval(() => { try {
  if (!window.__perf.hub && Router.cur === 'hub') window.__perf.hub = Math.round(performance.now());
  if (!window.__perf.ready && GameHost.ready) window.__perf.ready = Math.round(performance.now());
  if (window.__perf.hub && window.__perf.ready) clearInterval(iv);
} catch (e) {} }, 20);
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg); await cdp.send('Emulation.setCPUThrottlingRate', {'rate': RATE})
        await pg.add_init_script(INIT)
        await pg.goto('file://' + ROOT + '/index.html', wait_until='domcontentloaded')
        dcl = await pg.evaluate("Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd)")
        for i in range(300):
            if await pg.evaluate("!!(__perf.hub && __perf.ready)"): break
            await pg.wait_for_timeout(100)
        await pg.wait_for_timeout(1500)
        fps = await pg.evaluate("new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round(n / (performance.now() - t0) * 1000)); }; requestAnimationFrame(f); })")
        FPS = "new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round(n / (performance.now() - t0) * 1000)); }; requestAnimationFrame(f); })"
        await pg.evaluate("Router.go('shop')"); await pg.wait_for_timeout(2500)
        shop_sleep = await pg.evaluate(FPS)
        await pg.evaluate("GameHost.frame.contentWindow.postMessage({ __tt: 1, type: 'wake' }, '*')"); await pg.wait_for_timeout(800)
        shop_awake = await pg.evaluate(FPS)
        P = await pg.evaluate("__perf")
        lt = P['lt']; big = sorted(lt, key=lambda x: -x[1])[:5]
        print(json.dumps({'cpu': RATE, 'dcl_ms': dcl, 'hub_ms': P['hub'], 'engine_ready_ms': P['ready'], 'ready_after_hub_ms': (P['ready'] or 0) - (P['hub'] or 0),
            'longtasks': len(lt), 'longtask_total_ms': sum(x[1] for x in lt), 'top5': big, 'hub_fps': fps, 'shop_fps_engine_asleep': shop_sleep, 'shop_fps_engine_awake_old_behaviour': shop_awake}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
