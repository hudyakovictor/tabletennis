"""UI audit on a 360×740 phone (small Android) and 390×844: per screen
 - tap targets smaller than 40×40 css px (buttons, [data-a], [data-act], [data-go], a, .chip[onclick], [role=button])
 - elements sticking out horizontally past the screen (overflow → sideways scroll / clipped text)
 - text clipped inside its own box (scrollWidth > clientWidth with overflow hidden and no ellipsis)
 - text smaller than 10 px
 - console errors"""
import asyncio, os, sys, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SCREENS = sys.argv[1].split(',') if len(sys.argv) > 1 else ['splash', 'hub', 'shop', 'pass', 'ranks', 'profile', 'train', 'result', 'chest', 'mm', 'vs', 'settings', 'zone', 'match', 'pause']
SIZES = [(360, 740), (390, 844)]
JS = r"""() => {
  const scr = document.querySelector('.screen.current') || document.body, W = innerWidth, out = { small: [], overflow: [], clipped: [], tiny: [] };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight * 3; };
  const name = (e) => (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' «' + (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 22) + '»');
  const roots = [scr, document.querySelector('#nav'), document.querySelector('.sheet')].filter(Boolean);
  const seen = new Set();
  roots.forEach((root) => root.querySelectorAll('button,a,[data-a],[data-act],[data-go],[role=button],.tab,.chip[data-v],input,select').forEach((e) => {
    if (seen.has(e) || !vis(e)) return; seen.add(e);
    if (e.closest('[aria-hidden=true]') || e.disabled) return;
    let r = e.getBoundingClientRect(); const pb = getComputedStyle(e, '::before');   // invisible extended hit area (inset < 0)
    if (pb.content !== 'none' && pb.position === 'absolute' && parseFloat(pb.top) < 0) { const t = -parseFloat(pb.top), l = -parseFloat(pb.left) || t; r = { width: r.width + 2 * l, height: r.height + 2 * t }; }
    if (r.width < 40 || r.height < 40) out.small.push(name(e) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }));
  roots.forEach((root) => root.querySelectorAll('*').forEach((e) => {
    if (!vis(e)) return; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if ((r.right > W + 1 || r.left < -1) && !e.closest('.reel,.strip,.hscroll,[data-hscroll],.marquee,.mq,.fan,.carousel') && cs.position !== 'fixed') {
      let p = e.parentElement, clipped = false; while (p && p !== document.body) { const pc = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(pc.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1 && pr.left >= -1) { clipped = true; break; } } p = p.parentElement; }
      if (!clipped) out.overflow.push(name(e) + ' x ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      let fs = parseFloat(cs.fontSize); const svg = e.ownerSVGElement;   // SVG text: scale user units to rendered px
      if (svg && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) fs = Math.round(fs * svg.getBoundingClientRect().width / svg.viewBox.baseVal.width * 10) / 10;
      if (fs < 10) out.tiny.push(name(e) + ' ' + fs + 'px');
      if (e.scrollWidth > e.clientWidth + 1 && /(hidden|clip)/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'normal') out.clipped.push(name(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    }
  }));
  for (const k in out) out[k] = [...new Set(out[k])];
  out.docScrollX = document.documentElement.scrollWidth > W + 1;
  return out;
}"""
async def main():
    total = 0; report = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        for (w, h) in SIZES:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True)
            await ctx.add_init_script("localStorage.setItem('ttu-v2', JSON.stringify({ tutorialDone: true }))")
            for s in SCREENS:
                pg = await ctx.new_page(); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Fullscreen' not in m.text and 'requestFullscreen' not in m.text else None)
                base = {'settings': 'hub', 'zone': 'hub', 'pause': 'match'}.get(s, s)
                await pg.goto('file://' + ROOT + '/index.html' + ('' if s == 'splash' else '?s=' + base), wait_until='domcontentloaded'); await pg.wait_for_timeout(1800)
                if base == 'match':
                    for i in range(60):
                        if await pg.evaluate("!!document.querySelector('.screen.current[data-id=match] .mx.live')"): break
                        await pg.wait_for_timeout(250)
                if s == 'settings': await pg.evaluate("openSettings()")
                if s == 'zone': await pg.evaluate("zoneStatsSheet()")
                if s == 'pause': await pg.evaluate("Router.screens.match.pause()")
                if s in ('settings', 'zone', 'pause'): await pg.wait_for_timeout(900)
                r = await pg.evaluate(JS); r['errs'] = errs
                n = sum(len(v) for k, v in r.items() if isinstance(v, list)) + (1 if r['docScrollX'] else 0)
                total += n; report[f'{w}x{h} {s}'] = r
                print(f'{w}x{h} {s:8s} issues {n}')
                for k in ('small', 'overflow', 'clipped', 'tiny', 'errs'):
                    for it in r[k][:12]: print('   ', k, it)
                if r['docScrollX']: print('    docScrollX')
                await pg.close()
            await ctx.close()
        await b.close()
    json.dump(report, open(os.path.join(HERE, 'shots', 'audit.json'), 'w'), ensure_ascii=False, indent=1)
    print('TOTAL', total)
    return total
sys.exit(1 if asyncio.run(main()) else 0)
