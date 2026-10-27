"""Выбор сложности бота: панель в хабе, сегмент в настройках, бейдж в HUD
и — главное — что выбранный уровень РЕАЛЬНО уезжает в движок (settings.difficulty
и OpponentAI.L), а не живёт только в профиле.

  python3 tdiff.py
Скриншоты: shots/diff_hub.png, diff_wtf.png, diff_settings.png, diff_hud.png, diff_vs.png
"""
import os
import asyncio
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PLAY = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'play'))
URL = 'file://' + PLAY + '/index.html'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
SHOTS = os.path.join(HERE, 'shots')


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        raise SystemExit(1)


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                                  has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))

        # ---------- 1. панель сложности в хабе ----------
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_timeout(7000)
        chips = await pg.evaluate("() => [...document.querySelectorAll('.dchip')].map(b => b.textContent.trim())")
        on = await pg.evaluate("() => [...document.querySelectorAll('.dchip')].map(b => b.classList.contains('on'))")
        print('chips', chips, on)
        check(chips == ['EASY', 'MEDIUM', 'HARD', 'WTF'], 'в хабе ровно 4 ступеньки EASY/MEDIUM/HARD/WTF')
        check(on == [False, True, False, False], 'по умолчанию выбран MEDIUM')
        print('sub', await pg.evaluate("() => document.querySelector('.diffbar .db-l small').textContent"))
        await pg.screenshot(path=os.path.join(SHOTS, 'diff_hub.png'))

        # ---------- 2. выбор WTF: профиль, тост, сохранение ----------
        await pg.click('.dchip.wtf')
        await pg.wait_for_timeout(900)
        got = await pg.evaluate("() => [S.diff, JSON.parse(localStorage.getItem('ttu-v2')).diff,"
                                " document.querySelector('.dchip.wtf').classList.contains('on'),"
                                " (document.querySelector('.toast') || {}).textContent || '']")
        print('wtf', got)
        check(got[0] == 3 and got[1] == 3, 'WTF записан в профиль и в localStorage')
        check(got[2] is True, 'чип WTF активен')
        check('WTF' in got[3], 'игрок получил тост про WTF: ' + got[3])
        await pg.screenshot(path=os.path.join(SHOTS, 'diff_wtf.png'))

        # выбор переживает перезагрузку
        await pg.reload()
        await pg.wait_for_timeout(7000)
        kept = await pg.evaluate("() => [S.diff, [...document.querySelectorAll('.dchip')].findIndex(b => b.classList.contains('on'))]")
        check(kept == [3, 3], 'после перезагрузки уровень снова WTF: %s' % (kept,))

        # ---------- 3. настройки ----------
        await pg.goto(URL + '?s=profile')
        await pg.wait_for_timeout(2500)
        await pg.click('[data-act=settings]')
        await pg.wait_for_timeout(700)
        seg = await pg.evaluate("() => [...document.querySelectorAll('#dseg .seg-i, #dseg button, #dseg [data-v]')]"
                                ".map(b => b.textContent.trim())")
        print('settings seg', seg)
        check(len(seg) == 4, 'в настройках четыре варианта сложности')
        await pg.screenshot(path=os.path.join(SHOTS, 'diff_settings.png'))
        await pg.click('#dseg >> text=EASY')
        await pg.wait_for_timeout(500)
        check(await pg.evaluate("() => S.diff") == 0, 'смена уровня в настройках идёт в профиль')

        # ---------- 4. HARD уезжает в движок ----------
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_timeout(7000)
        await pg.click('.dchip[data-diff="2"]')
        await pg.wait_for_timeout(600)
        await pg.click('[data-modebtn="free"]')
        await pg.wait_for_timeout(9000)
        hud = await pg.evaluate("() => { const b = document.querySelector('.ai-lvl'); return b ? [b.textContent.trim(), b.dataset.l] : null }")
        print('hud badge', hud)
        check(hud == ['HARD', '2'], 'в HUD бейдж HARD')
        eng = await pg.evaluate("() => { const g = GameHost.frame.contentWindow.__game;"
                                " return [g.settings.difficulty, g.ai.levelIndex, g.ai.L.name, g.ai.L.style, g.ai.L.errBase] }")
        print('engine', eng)
        check(eng[0] == 2 and eng[1] == 2, 'движок получил difficulty=2 и ai.levelIndex=2')
        check(eng[2] == 'HARD' and eng[3] == 'ATTACK', 'бот реально переключён на HARD: %s' % (eng,))
        await pg.screenshot(path=os.path.join(SHOTS, 'diff_hud.png'))

        # ---------- 5. экран VS показывает уровень до первого мяча ----------
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_timeout(6000)
        await pg.evaluate("() => { S.diff = 3; save(); }")
        await pg.click('[data-modebtn="ranked"]')
        for _ in range(14):
            await pg.wait_for_timeout(1000)
            if await pg.evaluate("() => !!document.querySelector('.vs-diff')"):
                break
        vs = await pg.evaluate("() => { const d = document.querySelector('.vs-diff'); return d ? d.textContent.trim() : null }")
        print('vs chip', vs)
        check(vs is not None and 'WTF' in vs, 'на экране VS виден уровень бота')
        await pg.screenshot(path=os.path.join(SHOTS, 'diff_vs.png'))

        print('errs', errs)
        await b.close()
        if errs:
            raise SystemExit(1)


asyncio.run(main())
