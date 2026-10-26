"""Раунд 17 — UI/UX аудит: скриншоты всех экранов + поведенческие пробы.
Запуск: python3 taudit17.py  → shots/ui17/*.png + probes17.txt
"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'shots', 'ui17'); os.makedirs(OUT, exist_ok=True)
import asyncio
from playwright.async_api import async_playwright

URL = 'file://' + ROOT + '/index.html'

async def snap(pg, name, wait=0):
    if wait: await pg.wait_for_timeout(wait)
    await pg.screenshot(path=f'{OUT}/{name}.png')
    print('shot', name)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

        # instrumentation: лог команд GameHost
        await pg.add_init_script("""() => {
            window.__gh = [];
            const orig = null;
            document.addEventListener('DOMContentLoaded', () => {
              const t = () => { if (window.GameHost && !GameHost.__hooked) { GameHost.__hooked = 1;
                const s = GameHost.send.bind(GameHost);
                GameHost.send = (cmd, data) => { window.__gh.push(cmd); return s(cmd, data); }; } else setTimeout(t, 300); };
              t();
            });
        }""")

        # ---------- 1. SPLASH ----------
        await pg.goto(URL)
        await pg.wait_for_timeout(1200); await snap(pg, '01_splash')
        # дождаться хаба
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        await pg.wait_for_timeout(3000); await snap(pg, '02_hub')

        # ---------- 2. HUB sheets ----------
        await pg.click('[data-act=mode]'); await pg.wait_for_timeout(700); await snap(pg, '03_sheet_mode')
        # выбрать «С другом» и попробовать старт
        btns = await pg.query_selector_all('.mcard')
        for bb in btns:
            if (await bb.get_attribute('data-m')) == 'friend':
                await bb.click(); break
        await pg.wait_for_timeout(700)
        await pg.click('[data-act=play]')
        await pg.wait_for_timeout(1000)
        print('friend -> Router.cur =', await pg.evaluate('() => Router.cur'))
        await pg.wait_for_timeout(300); await snap(pg, '04_friend_starts')   # ожидаем обман: поиск матча с ботом
        # вернуться в хаб
        await pg.evaluate('() => Router.go("hub")')
        await pg.wait_for_timeout(900)
        await pg.click('[data-act=quests]'); await pg.wait_for_timeout(600); await snap(pg, '05_sheet_quests')

        # --- проба: задание фармится бесконечно? ---
        g0 = await pg.evaluate('() => S.gems')
        qb = await pg.query_selector('[data-q]')
        if qb:
            await qb.click(); await pg.wait_for_timeout(200)
        g1 = await pg.evaluate('() => S.gems')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
        await pg.click('[data-act=quests]'); await pg.wait_for_timeout(500)
        qb2 = await pg.query_selector('[data-q]')
        if qb2:
            await qb2.click(); await pg.wait_for_timeout(200)
        g2 = await pg.evaluate('() => S.gems')
        print(f'QUEST FARM: gems {g0} -> {g1} -> {g2} (farm={g2 > g0})')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)

        # --- проба: locked-сундук без открывающегося = тупик ---
        await pg.evaluate('() => { S.chests[1].state = "ready"; }')
        r = await pg.evaluate('''() => { const el = document.querySelectorAll('.slot.lock')[0];
            const before = S.chests[2].state; Router.screens.hub.chestTap(2, el);
            return { before, after: S.chests[2].state, dead: before === S.chests[2].state } }''')
        print('LOCKED CHEST DEAD-END:', r)
        await pg.evaluate('() => { S.chests[1].state = "unlocking"; S.chests[1].endsAt = Date.now()+7200000; }')

        # тап по unlocking-сундуку → sheet skip
        slots = await pg.query_selector_all('[data-chest]')
        for s_ in slots:
            if 'unl' in (await s_.get_attribute('class') or ''):
                await s_.click(); break
        await pg.wait_for_timeout(600); await snap(pg, '06_sheet_chest_skip')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)

        # --- подарок: статичный 3:59:59 ---
        await pg.click('[data-act=free]'); await pg.wait_for_timeout(400)
        ft = await pg.evaluate('() => document.querySelector("#freeT").textContent')
        await pg.wait_for_timeout(2500)
        ft2 = await pg.evaluate('() => document.querySelector("#freeT").textContent')
        print(f'FREE GIFT: label1="{ft}" label2="{ft2}" (stuck={ft=="3:59:59" and ft2=="3:59:59"})')

        # ---------- 3. MM ----------
        await pg.evaluate('() => { MODE = MODES.find(m => m.id === "ranked"); Router.go("mm"); }')
        await pg.wait_for_timeout(1800); await snap(pg, '07_mm')
        # таймер mm: проверка формата m:ss
        await pg.evaluate('() => { const t = document.querySelector(".mm-time"); }')
        await pg.wait_for_timeout(3800)  # ~5.6s — рил крутится
        await snap(pg, '08_mm_reel')
        await pg.wait_for_selector('.vs-half', timeout=12000)
        await pg.wait_for_timeout(1000); await snap(pg, '09_vs')
        # ---------- 4. MATCH ----------
        await pg.wait_for_selector('.mx-intro', timeout=15000)
        await pg.wait_for_timeout(1500); await snap(pg, '10_match_intro')
        await pg.wait_for_timeout(8000); await snap(pg, '11_match_live')
        # пауза
        await pg.click('[data-act=pause]'); await pg.wait_for_timeout(700); await snap(pg, '12_sheet_pause')
        # настройки из паузы → баг: resume при открытых настройках
        await pg.evaluate('() => window.__gh = []')
        btns = await pg.query_selector_all('[data-a]')
        for bb in btns:
            if (await bb.get_attribute('data-a')) == 'settings':
                await bb.click(); break
        await pg.wait_for_timeout(900)
        gh1 = await pg.evaluate('() => [...window.__gh]')
        sheet_open = await pg.evaluate('() => !!Sheet.cur')
        print(f'PAUSE->SETTINGS: cmds={gh1} sheetStillOpen={sheet_open}')
        await snap(pg, '13_sheet_settings')
        # закрыть настройки
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(500)
        gh2 = await pg.evaluate('() => [...window.__gh]')
        print(f'AFTER SETTINGS CLOSE: cmds={gh2}')
        # выход из паузы → сдаться
        await pg.click('[data-act=pause]'); await pg.wait_for_timeout(600)
        btns = await pg.query_selector_all('[data-a]')
        for bb in btns:
            if (await bb.get_attribute('data-a')) == 'quit':
                await bb.click(); break
        await pg.wait_for_timeout(800)

        # ---------- 5. RESULT (lose via quit) ----------
        await pg.wait_for_selector('.res-title', timeout=10000)
        await pg.wait_for_timeout(2500); await snap(pg, '14_result_lose')

        # ---------- 6. RESULT WIN: рейтинг теряется при быстром выходе? ----------
        await pg.evaluate('() => Router.go("result", { data: Demo.result(true) })')
        await pg.wait_for_selector('.res-title'); await pg.wait_for_timeout(400)
        r0 = await pg.evaluate('() => S.rating')
        await pg.click('[data-act=next]'); await pg.wait_for_timeout(900)
        r1 = await pg.evaluate('() => S.rating')
        await pg.evaluate('() => Router.go("result", { data: Demo.result(true) })')
        await pg.wait_for_selector('.res-title'); await pg.wait_for_timeout(6500)
        r2 = await pg.evaluate('() => S.rating'); await snap(pg, '15_result_win')
        print(f'RESULT RATING: before={r0} after-left-early={r1} after-stayed={r2} (lost-if-early={r1==r0})')

        # ---------- 7. PASS: двойное событие после покупки premium ----------
        await pg.evaluate('() => Router.go("pass")')
        await pg.wait_for_timeout(1400); await snap(pg, '16_pass')
        # клейм готовых (не более одного раза на ячейку)
        claimed_before = await pg.evaluate('() => JSON.stringify(S.claimed)')
        cells = await pg.query_selector_all('.pc.f.ready')
        if cells: await cells[0].click()
        await pg.wait_for_timeout(300)
        same = await pg.query_selector_all('.pc.f.ready')
        if same:
            for c in same:
                await c.click(); await pg.wait_for_timeout(120)
        claimed_after = await pg.evaluate('() => JSON.stringify(S.claimed)')
        print('PASS CLAIMS:', claimed_before, '->', claimed_after)

        # нав-дот «2» после полного клейма + перезагрузки
        await pg.evaluate('''() => { for (let l = 1; l <= 7; l++) if (!S.claimed.f.includes(l)) S.claimed.f.push(l); save(); }''')
        await pg.reload(); await pg.wait_for_timeout(2500)
        await pg.evaluate('() => Router.go("hub")'); await pg.wait_for_timeout(800)
        dot = await pg.evaluate('''() => { const d = document.querySelector('#nav .tab[data-tab=pass] .dot'); return d ? d.textContent : null }''')
        claimable = await pg.evaluate('''() => { let n = 0; for (let l = 1; l <= S.passLvl; l++) if (!S.claimed.f.includes(l)) n++; return n }''')
        print(f'NAV DOT: shows="{dot}" but claimable={claimable} (stale={dot and int(dot) > claimable})')

        # ---------- 8. RANKS ----------
        await pg.evaluate('() => Router.go("ranks")'); await pg.wait_for_timeout(1500); await snap(pg, '17_ranks')
        # вкладка друзья
        seg = await pg.query_selector_all('#rkSeg button')
        if len(seg) > 1:
            await seg[1].click(); await pg.wait_for_timeout(900); await snap(pg, '18_ranks_friends')

        # ---------- 9. PROFILE ----------
        await pg.evaluate('() => Router.go("profile")'); await pg.wait_for_timeout(2200); await snap(pg, '19_profile_top')
        # скролл к экипировке
        await pg.evaluate('''() => { const sc = document.querySelector(".screen.current .scroll"); sc.scrollTop = sc.scrollHeight; }''')
        await pg.wait_for_timeout(900); await snap(pg, '20_profile_bottom')
        eqtxt = await pg.evaluate('''() => Array.from(document.querySelectorAll('.eq .icard')).map(c => c.textContent.trim().slice(0, 40))''')
        print('PROFILE EQUIP:', eqtxt)

        # ---------- 10. SHOP ----------
        await pg.evaluate('() => Router.go("shop")'); await pg.wait_for_timeout(1500); await snap(pg, '21_shop')
        card = await pg.query_selector('[data-item=r-coral]')
        if card:
            await card.click(); await pg.wait_for_timeout(900); await snap(pg, '22_sheet_product')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
        await pg.evaluate('''() => { const sc = document.querySelector(".screen.current .scroll"); sc.scrollTop = sc.scrollHeight; }''')
        await pg.wait_for_timeout(600); await snap(pg, '23_shop_bottom')
        # stars-оплата
        stars = await pg.query_selector('[data-act=stars][data-amt="349"]')
        if stars:
            await stars.click(); await pg.wait_for_timeout(700); await snap(pg, '24_sheet_stars')
            await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)

        # ---------- 11. TRAIN ----------
        await pg.evaluate('() => Router.go("train", { data: { then: "hub" } })')
        await pg.wait_for_timeout(2500); await snap(pg, '25_train_title')
        await pg.wait_for_timeout(4200); await snap(pg, '26_train_frozen')
        await pg.click('[data-act=exit]'); await pg.wait_for_timeout(700); await snap(pg, '27_train_exit')

        # ---------- 12. CHEST ----------
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
        await pg.evaluate('() => Router.go("chest", { data: { kind: "gold", slot: 0 } })')
        await pg.wait_for_timeout(1200); await snap(pg, '28_chest')
        await pg.click('.cho-chest'); await pg.wait_for_timeout(2400); await snap(pg, '29_chest_card')
        await pg.evaluate('() => Router.screens.chest.summary(document.querySelector(".screen.current"))')
        await pg.wait_for_timeout(1600); await snap(pg, '30_chest_summary')

        print('ERRORs:', json.dumps(errs[:20], ensure_ascii=False))
        await b.close()

asyncio.run(main())
