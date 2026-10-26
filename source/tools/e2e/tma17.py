"""TMA17 — финальная верификация раунда аудита. Только логи PASS/FAIL, без скриншотов.
Пробы по исправленным багам: режимы, задания, сундуки, подарок, результат,
пауза→настройки, бадж навигации, экипировка, подача, формат таймера, каркас TMA.
"""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
import asyncio
from playwright.async_api import async_playwright

URL = 'file://' + ROOT + '/index.html'
PASS, FAIL = [], []
def ok(name, cond, extra=''):
    (PASS if cond else FAIL).append(name + (f' | {extra}' if extra else ''))
    print(('PASS ' if cond else 'FAIL ') + name + (f' | {extra}' if extra else ''))

async def dclick(pg, sel, attr=None, val=None):
    js = """([sel, attr, val]) => { for (const b of document.querySelectorAll(sel)) {
        if (!attr || b.getAttribute(attr) === val) { b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); b.click(); return true; } } return false; }"""
    return await pg.evaluate(js, [sel, attr, val])

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        # ---------- мобильный вьювпорт ----------
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()

        # 1) каркас: никакой рамки телефона на мобильном
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        dev = await pg.evaluate("""() => { const cs = getComputedStyle(document.getElementById('device'));
          return { r: cs.borderTopLeftRadius, w: cs.width, h: cs.height, shadow: cs.boxShadow }; }""")
        ok('mobile: device full-bleed, no bezel', dev['r'] == '0px' and dev['w'] == '390px', json.dumps(dev)[:120])

        # 2) модалка режимов: 3 карточки, «С другом» убран
        await dclick(pg, '[data-act=mode]'); await pg.wait_for_timeout(700)
        mcards = await pg.evaluate("() => Array.from(document.querySelectorAll('.mcard')).map(c => c.dataset.m)")
        ok('mode sheet: 3 modes, no friend', len(mcards) == 3 and 'friend' not in mcards, str(mcards))
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(300)

        # 3) задания: клейм один раз, состояние переживает переоткрытие листа
        g0 = await pg.evaluate('() => S.gems')
        await dclick(pg, '[data-act=quests]'); await pg.wait_for_timeout(600)
        await dclick(pg, '[data-q]', 'data-q', 'q_perf10'); await pg.wait_for_timeout(250)
        g1 = await pg.evaluate('() => S.gems')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(400)
        await dclick(pg, '[data-act=quests]'); await pg.wait_for_timeout(500)
        again = await pg.evaluate("() => !!document.querySelector('[data-q=q_perf10]')")
        g2 = await pg.evaluate('() => S.gems')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(300)
        ok('quest: single claim', g1 == g0 + 8 and g2 == g1 and not again, f'{g0}->{g1}->{g2} reopen-has-btn={again}')

        # 4) сундуки: locked запускается если очередь свободна; busy — отказ
        await pg.evaluate('() => { S.chests[1].state = "ready"; }')   # освобождаем очередь
        r1 = await pg.evaluate("""() => { const el = document.querySelector('.slot.lock');
            Router.screens.hub.chestTap(2, el);
            return { st: S.chests[2].state, ends: S.chests[2].endsAt > Date.now() }; }""")
        ok('locked chest starts unlock', r1['st'] == 'unlocking' and r1['ends'], str(r1))
        r2 = await pg.evaluate("""() => { S.chests[3] = { id:'c4', kind:'wood', state:'locked' };
            const el = document.createElement('div'); Router.screens.hub.chestTap(3, el);
            return { st: S.chests[3].state }; }""")
        ok('locked chest busy-queue refused', r2['st'] == 'locked', str(r2))
        await pg.evaluate('() => { S.chests[3] = null; }')

        # 5) подарок: тап → кулдаун + живой таймер; истёк → кнопка снова активна
        f1 = await pg.evaluate("() => ({ freeAt: S.freeAt || 0 })")
        await dclick(pg, '[data-act=free]'); await pg.wait_for_timeout(300)
        f2 = await pg.evaluate("() => ({ freeAt: S.freeAt, label: document.querySelector('#freeT').textContent })")
        ok('gift: cooldown set + live timer', f2['freeAt'] > 0 and ':' in f2['label'], str(f2))
        await pg.evaluate("() => { S.freeAt = Date.now() - 1000; }")
        await pg.wait_for_timeout(1300)
        f3 = await pg.evaluate("""() => ({ label: document.querySelector('#freeT').textContent,
          cls: document.querySelector('[data-act=free]').className })""")
        ok('gift: re-arms after cooldown', f3['label'] == 'Подарок' and 'free' in f3['cls'], str(f3))
        await dclick(pg, '[data-act=free]'); await pg.wait_for_timeout(300)
        f4 = await pg.evaluate("() => ({ freeAt: S.freeAt })")
        ok('gift: clicks again after re-arm', f4['freeAt'] >= f2['freeAt'], str(f4))

        # 6) результат: рейтинг применяется немедленно; ранний выход ничего не теряет
        r0 = await pg.evaluate('() => S.rating')
        await pg.evaluate('() => Router.go("result", { data: Demo.result(true) })')
        await pg.wait_for_selector('.res-title'); await pg.wait_for_timeout(350)
        r1 = await pg.evaluate('() => S.rating')
        await dclick(pg, '[data-act=next]'); await pg.wait_for_timeout(900)
        r2 = await pg.evaluate('() => S.rating')
        ok('result: rating applied upfront', r1 == r0 + 24 and r2 == r1, f'{r0}->{r1}->{r2}')

        # 7) пауза → настройки: движок снимается с паузы лишь когда листов нет
        await pg.goto(URL + '?s=match')
        await pg.wait_for_selector('[data-act=pause]', timeout=25000)
        await pg.evaluate("""() => { window.__gh = [];
          const s = GameHost.send.bind(GameHost);
          GameHost.send = (cmd, data) => { window.__gh.push(cmd); return s(cmd, data); };
          return 1; }""")
        await pg.wait_for_timeout(6500)   # дай интро пройти
        await dclick(pg, '[data-act=pause]'); await pg.wait_for_timeout(700)
        sh = await pg.evaluate('() => !!Sheet.cur')
        ghp = await pg.evaluate('() => window.__gh.slice()')
        await dclick(pg, '[data-a]', 'data-a', 'settings'); await pg.wait_for_timeout(800)
        gh1 = await pg.evaluate('() => window.__gh.slice()')
        await pg.evaluate('() => Sheet.close()'); await pg.wait_for_timeout(600)
        gh2 = await pg.evaluate('() => window.__gh.slice()')
        ok('pause: sheet opened', sh and 'pause' in ghp, str(ghp))
        ok('pause→settings: engine stays paused', 'resume' not in gh1, str(gh1))
        ok('pause→settings: resume after close', 'resume' in gh2, str(gh2))

        # 8) бадж навигации: считается из состояния; после клеймов исчезает
        # дефолт: f[1..5] клеймлено, passLvl 7 → доступны 6 и 7
        dot0 = await pg.evaluate("""() => { const d = document.querySelector('#nav .tab[data-tab=pass] .dot'); return d ? d.textContent : null }""") 
        await pg.goto(URL + '?s=pass')
        await pg.wait_for_selector('.pc', timeout=25000)
        await pg.wait_for_timeout(400)
        await dclick(pg, '.pc.f.ready'); await pg.wait_for_timeout(250)
        await dclick(pg, '.pc.f.ready'); await pg.wait_for_timeout(250)
        dot1 = await pg.evaluate("""() => { const d = document.querySelector('#nav .tab[data-tab=pass] .dot'); return d ? d.textContent : null }""") 
        await pg.reload(); await pg.wait_for_timeout(2500)
        for _ in range(15):
            if await pg.evaluate('() => !!document.querySelector("[data-act=play]")'): break
            await pg.wait_for_timeout(1000)
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        dot2 = await pg.evaluate("""() => { const d = document.querySelector('#nav .tab[data-tab=pass] .dot'); return d ? d.textContent : null }""") 
        ok('nav dot: real count', dot0 == '2', f'initial={dot0}')
        ok('nav dot: updates on claim', dot1 is None or dot1 == '0', f'after-claim={dot1}')
        ok('nav dot: not stale after reload', dot2 is None, f'after-reload={dot2}')

        # 9) экипировка профиля: след — след, накладка — накладка
        await pg.evaluate('() => Router.go("profile")')
        await pg.wait_for_selector('.eq .icard', timeout=15000)
        eqtxt = await pg.evaluate("() => Array.from(document.querySelectorAll('.eq .icard')).map(c => (c.querySelector('.ic-n').textContent + '|' + c.querySelector('.ic-t').textContent))")
        ok('profile equip correct', any('след' in t for t in eqtxt) and any('Накладка' in t for t in eqtxt) and any('Основание' in t for t in eqtxt), str(eqtxt))

        # 10) подсказка подачи: при подаче бота её нет
        await pg.goto(URL + '?s=match')
        await pg.wait_for_selector('[data-act=pause]', timeout=25000)
        await pg.wait_for_timeout(6500)
        srv = await pg.evaluate("""() => { const el = document.querySelector('.m-serve');
          const rs = Router.screens.match;
          rs.onMsg({ type: 'serve', server: -1 });
          const off = !el.classList.contains('on');
          rs.onMsg({ type: 'serve', server: 1 });
          const on = el.classList.contains('on');
          return { off, on }; }""")
        ok('serve hint: only for player serve', srv['off'] and srv['on'], str(srv))

        # 11) mm таймер: формат m:ss
        await pg.goto(URL + '?s=mm')
        await pg.wait_for_selector('.mm-time', timeout=25000)
        t0 = await pg.evaluate("() => document.querySelector('.mm-time').textContent")
        await pg.wait_for_timeout(1700)
        await pg.wait_for_timeout(0)
        t1 = await pg.evaluate("() => document.querySelector('.mm-time').textContent")
        import re as _re
        ok('mm timer format m:ss', _re.match(r'^\d+:\d\d$', t0 or '') and _re.match(r'^\d+:\d\d$', t1 or '') and t1 != t0, f'{t0}->{t1}')
        mmchip = await pg.evaluate("""() => { const c = document.querySelector('.mm-top .chip'); const r = c.getBoundingClientRect();
          return { wrap: getComputedStyle(c).whiteSpace, h: Math.round(r.height) }; }""")
        ok('mm chip: nowrap fits', mmchip['wrap'] == 'nowrap' and mmchip['h'] <= 34, str(mmchip))

        # 12) TGX без Telegram не ломает (guard/fullscreen безопасны)
        err = await pg.evaluate("""() => { try { TGX.guard(true); TGX.guard(false); TGX.fullscreen(true); TGX.fullscreen(false); return null; } catch (e) { return String(e); } }""")
        ok('TGX stubs safe outside TG', err is None, str(err))

        await pg.close()

        # ---------- десктопный вьювпорт: никакой рамки-телефона ----------
        ctx2 = await b.new_context(viewport={'width':1280,'height':800}, device_scale_factor=1)
        pg = await ctx2.new_page()
        await pg.goto(URL + '?s=hub')
        await pg.wait_for_selector('[data-act=play]', timeout=25000)
        dev2 = await pg.evaluate("""() => { const cs = getComputedStyle(document.getElementById('device'));
          const dw = document.getElementById('deviceWrap').getBoundingClientRect();
          return { r: cs.borderTopLeftRadius, w: Math.round(dw.width), shadow: cs.boxShadow.slice(0, 60) }; }""")
        ok('desktop: slim column, no phone bezel', dev2['w'] <= 470 and dev2['r'] != '52px' and '11px' not in dev2['shadow'] and '10px' not in dev2['shadow'], json.dumps(dev2)[:140])
        await pg.close()

        await b.close()
        print()
        print(f'== ИТОГ: {len(PASS)} PASS / {len(FAIL)} FAIL ==')
        for f in FAIL: print('  FAIL:', f)
        if FAIL: raise SystemExit(1)

asyncio.run(main())
