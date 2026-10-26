"""Раунд 17b — устойчивый аудит: скриншоты с таймаутом, пробы."""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'shots', 'ui17'); os.makedirs(OUT, exist_ok=True)
import asyncio
from playwright.async_api import async_playwright

URL = 'file://' + ROOT + '/index.html'

START = int(__import__('sys').argv[1]) if len(__import__('sys').argv) > 1 else 0

async def snap(pg, name, wait=0, still=True):
    if wait: await pg.wait_for_timeout(wait)
    if still:
        try: await pg.evaluate("() => GameHost.frame && GameHost.send('sleep')")
        except Exception: pass
        await pg.wait_for_timeout(260)
    try: await pg.screenshot(path=f'{OUT}/{name}.png', timeout=20000)
    except Exception as e: print('SHOT FAIL', name, str(e)[:80])
    if still:
        try: await pg.evaluate("() => GameHost.frame && GameHost.send('wake')")
        except Exception: pass
        await pg.wait_for_timeout(150)
    print('shot', name)

async def dclick(pg, sel, attr=None, val=None):
    js = """([sel, attr, val]) => { for (const b of document.querySelectorAll(sel)) {
        if (!attr || b.getAttribute(attr) === val) { b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); b.click(); return true; } } return false; }"""
    return await pg.evaluate(js, [sel, attr, val])

async def tap_first(pg, sel, attr, val):
    for bb in await pg.query_selector_all(sel):
        if (await bb.get_attribute(attr)) == val:
            await bb.click(); return True
    return False

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script("""() => { try { const s = JSON.parse(localStorage.getItem('ttu-v2') || '{}'); s.tutorialDone = true; s.tutorialRewarded = true; localStorage.setItem('ttu-v2', JSON.stringify(s)); } catch(e) {} }""")

    # ============ ПАКЕТ A: хаб + листы + пробы ============
        pg = await ctx.new_page()
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        if START == 0 or START == -1:
            await snap(pg, '02_hub', 3500)
            # friend-режим
            await pg.click('[data-act=mode]'); await pg.wait_for_timeout(700); await snap(pg, '03_sheet_mode')
            for bb in await pg.query_selector_all('.mcard'):
                if (await bb.get_attribute('data-m')) == 'friend': await bb.click(); break
            await pg.wait_for_timeout(700)
            await pg.click('[data-act=play]')
            await pg.wait_for_timeout(1400)
            print('friend -> Router.cur =', await pg.evaluate('() => Router.cur'))
            await snap(pg, '04_friend_starts', 200)
            await pg.evaluate('() => Router.go("hub")'); await pg.wait_for_timeout(1200)
            # задания + фарм
            await pg.click('[data-act=quests]'); await pg.wait_for_timeout(700); await snap(pg, '05_sheet_quests')
            g0 = await pg.evaluate('() => S.gems')
            await tap_first(pg, '[data-q]', 'data-q', '1'); await pg.wait_for_timeout(200)
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(500)
            await pg.click('[data-act=quests]'); await pg.wait_for_timeout(600)
            ok2 = await tap_first(pg, '[data-q]', 'data-q', '1'); await pg.wait_for_timeout(200)
            g2 = await pg.evaluate('() => S.gems')
            print(f'QUEST FARM: {g0} -> {g2} re-claim-possible={ok2} farm={g2 > g0}')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
            # locked-сундук тупик
            await pg.evaluate('() => { S.chests[1].state = "ready"; }')
            r = await pg.evaluate('''() => { const el = document.querySelector('.slot.lock');
                const before = S.chests[2].state; Router.screens.hub.chestTap(2, el);
                return { before, after: S.chests[2].state, dead: before === S.chests[2].state } }''')
            print('LOCKED CHEST DEAD-END:', r)
            await pg.evaluate('() => { S.chests[1].state = "unlocking"; S.chests[1].endsAt = Date.now()+7200000; }')
            await pg.evaluate('() => Router.go("hub")'); await pg.wait_for_timeout(900)
            for s_ in await pg.query_selector_all('[data-chest]'):
                if 'unl' in ((await s_.get_attribute('class')) or ''): await s_.click(); break
            await snap(pg, '06_sheet_chest_skip', 700)
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
            # подарок
            free = await pg.query_selector('[data-act=free]')
            if free:
                await free.click(); await pg.wait_for_timeout(300)
                ft = await pg.evaluate('() => document.querySelector("#freeT").textContent')
                await pg.wait_for_timeout(2200)
                ft2 = await pg.evaluate('() => document.querySelector("#freeT") ? document.querySelector("#freeT").textContent : "(gone)"')
                print(f'FREE GIFT: "{ft}" -> "{ft2}" stuck={ft==ft2=="3:59:59"}')
        await pg.close()
    # ============ ПАКЕТ B: mm → vs → match → pause ============
        pg = await ctx.new_page()
        HOOK = """() => { if (typeof GameHost !== 'undefined' && !GameHost.__hooked) { window.__gh = window.__gh || [];
          GameHost.__hooked = 1; const s = GameHost.send.bind(GameHost);
          GameHost.send = (cmd, data) => { window.__gh.push(cmd); return s(cmd, data); }; }
          return typeof GameHost !== 'undefined'; }"""
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        print('hook:', await pg.evaluate(HOOK))
        if START == 1 or START == -1:
            await pg.goto(URL + '?s=mm')
            await pg.wait_for_selector('.mm-time', timeout=20000)
            print('hook-mm:', await pg.evaluate(HOOK))
            await pg.wait_for_selector('.mm-time', timeout=20000)
            await snap(pg, '07_mm', 1500)
            await pg.goto(URL + '?s=vs')
            await pg.evaluate(HOOK)
            await pg.wait_for_selector('.vs-half', timeout=20000)
            await snap(pg, '09_vs', 1400)
            await pg.goto(URL + '?s=match')
            await pg.evaluate(HOOK)
            await pg.wait_for_selector('.mx-intro', timeout=20000)
            await snap(pg, '10_match_intro', 1300)
            await snap(pg, '11_match_live', 9000)
            # пауза → настройки → проверка resume
            print('pause click ->', await dclick(pg, '[data-act=pause]')); await pg.wait_for_timeout(700); await snap(pg, '12_sheet_pause')
            print('sheet open?', await pg.evaluate('() => !!Sheet.cur'))
            await pg.evaluate('() => window.__gh = []')
            print('settings click ->', await dclick(pg, '[data-a]', 'data-a', 'settings')); await pg.wait_for_timeout(900)
            gh1 = await pg.evaluate('() => [...window.__gh]')
            so = await pg.evaluate('() => !!Sheet.cur')
            print(f'PAUSE->SETTINGS: cmds={gh1} sheetOpen={so}')
            await snap(pg, '13_sheet_settings')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(600)
            gh2 = await pg.evaluate('() => [...window.__gh]')
            print(f'AFTER CLOSE: cmds={gh2}')
            print('pause2 ->', await dclick(pg, '[data-act=pause]')); await pg.wait_for_timeout(600)
            print('quit ->', await dclick(pg, '[data-a]', 'data-a', 'quit')); await pg.wait_for_timeout(900)
            try:
                await pg.wait_for_selector('.res-title', timeout=8000)
                await snap(pg, '14_result_lose', 2600)
            except Exception: print('no result after quit')
        await pg.close()
    # ============ ПАКЕТ C: result/pass/ranks/profile/shop ============
        pg = await ctx.new_page()
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        if START == 2 or START == -1:
            # рейтинг теряется при раннем выходе
            r0 = await pg.evaluate('() => S.rating')
            await pg.evaluate('() => Router.go("result", { data: Demo.result(true) })')
            await pg.wait_for_selector('.res-title'); await pg.wait_for_timeout(350)
            await pg.click('[data-act=next]'); await pg.wait_for_timeout(800)
            r1 = await pg.evaluate('() => S.rating')
            print(f'RESULT EARLY EXIT: {r0} -> {r1} lost={r1 == r0}')
            await pg.wait_for_timeout(1600)
            await pg.evaluate('() => Router.go("result", { data: Demo.result(true) })')
            await pg.wait_for_selector('.res-title')
            await snap(pg, '15_result_win', 6000)
            r2 = await pg.evaluate('() => S.rating')
            print(f'RESULT STAYED: {r2}')
            await pg.wait_for_timeout(1600)
            await pg.evaluate('() => Router.go("result", { data: Demo.result(false) })')
            await pg.wait_for_selector('.res-title')
            await snap(pg, '15b_result_lose_full', 5500)
            # pass
            await pg.evaluate('() => Router.go("pass")'); await pg.wait_for_timeout(1600); await snap(pg, '16_pass')
            cb = await pg.evaluate('() => JSON.stringify(S.claimed)')
            await dclick(pg, '.pc.f.ready')
            await pg.wait_for_timeout(250)
            await dclick(pg, '.pc.f.ready')
            await pg.wait_for_timeout(250)
            ca = await pg.evaluate('() => JSON.stringify(S.claimed)')
            print('PASS CLAIMS:', cb, '->', ca)
            # нав-дот
            await pg.evaluate('''() => { for (let l = 1; l <= 20; l++) { if (!S.claimed.f.includes(l)) S.claimed.f.push(l); } save(); }''')
            await pg.reload(); await pg.wait_for_timeout(2600)
            await pg.evaluate('() => Router.go("hub")'); await pg.wait_for_timeout(900)
            dot = await pg.evaluate('''() => { const d = document.querySelector('#nav .tab[data-tab=pass] .dot'); return d ? d.textContent : null }''')
            claimable = await pg.evaluate('''() => { let n = 0; for (let l = 1; l <= S.passLvl; l++) if (!S.claimed.f.includes(l)) n++; return n }''')
            print(f'NAV DOT: "{dot}" claimable={claimable} stale={bool(dot) and int(dot) > claimable}')
            # ranks
            await pg.evaluate('() => Router.go("ranks")'); await pg.wait_for_timeout(1500); await snap(pg, '17_ranks')
            seg = await pg.query_selector_all('#rkSeg button')
            if len(seg) > 1:
                await seg[1].click(); await pg.wait_for_timeout(900); await snap(pg, '18_ranks_friends')
            # profile
            await pg.evaluate('() => Router.go("profile")'); await pg.wait_for_timeout(2300); await snap(pg, '19_profile_top')
            await pg.evaluate('''() => { const sc = document.querySelector(".screen.current .scroll"); sc.scrollTop = sc.scrollHeight; }''')
            await pg.wait_for_timeout(900); await snap(pg, '20_profile_bottom')
            eqtxt = await pg.evaluate('''() => Array.from(document.querySelectorAll('.eq .icard')).map(c => c.textContent.trim().slice(0, 60))''')
            print('PROFILE EQUIP:', eqtxt)
            # profile settings
            await pg.evaluate('() => openSettings()'); await pg.wait_for_timeout(700); await snap(pg, '20b_sheet_settings')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
            # shop
            await pg.evaluate('() => Router.go("shop")'); await pg.wait_for_timeout(1600); await snap(pg, '21_shop')
            card = await pg.query_selector('[data-item=r-coral]')
            if card:
                await card.click(); await pg.wait_for_timeout(1000); await snap(pg, '22_sheet_product')
                await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
            await pg.evaluate('''() => { const sc = document.querySelector(".screen.current .scroll"); sc.scrollTop = sc.scrollHeight; }''')
            await pg.wait_for_timeout(700); await snap(pg, '23_shop_bottom')
            stars = await pg.query_selector('[data-act=stars][data-amt="349"]')
            if stars:
                await stars.click(); await pg.wait_for_timeout(800); await snap(pg, '24_sheet_stars')
                await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
        await pg.close()
    # ============ ПАКЕТ D: train + chest ============
        pg = await ctx.new_page()
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        if START == 3 or START == -1:
            await pg.evaluate('() => Router.go("train", { data: { then: "hub" } })')
            await snap(pg, '25_train_title', 2400)
            await snap(pg, '26_train_frozen', 4400)
            await pg.click('[data-act=exit]'); await pg.wait_for_timeout(800); await snap(pg, '27_train_exit')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
            await pg.evaluate('() => Router.go("chest", { data: { kind: "gold", slot: 0 } })')
            await snap(pg, '28_chest', 1300)
            await dclick(pg, '.cho-chest'); await snap(pg, '29_chest_card', 2500)
            await pg.evaluate('() => Router.screens.chest.summary(document.querySelector(".screen.current"))')
            await snap(pg, '30_chest_summary', 1700)
        print('ERRORs:', json.dumps(errs[:20], ensure_ascii=False))
        await b.close()

asyncio.run(main())
