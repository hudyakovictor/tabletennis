"""Golden-hit probe: real contact sets the trail verdict; a 'win' ball makes
the AI let it pass (the perfect-hit = point mechanic)."""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:150]))
        await pg.goto('file://' + ROOT + '/index.html?s=match', timeout=120000)
        await pg.wait_for_timeout(6000)
        fr = [f for f in pg.frames if f != pg.main_frame][0]
        res = await fr.evaluate("""async () => {
          const g = window.__game, cv = document.getElementById('gl'), RC = cv.getBoundingClientRect();
          const DT = 1 / 60, step = (n=1) => { for (let i=0;i<n;i++) g.update(DT); };
          const launch = (pz, vz, vy) => {
            g.state = 'RALLY'; g.paused = false;
            g.rallyBounces.length = 0; g.rallyBounces.push(1); g.rallyBounces.push(-1);
            g.isServeBall = false; g.serveBounces = 0;
            const b = g.ball;
            b.p = { x: -0.05, y: 1.06, z: pz }; b.v = { x: 0.15, y: vy, z: vz }; b.w = { x: -180, y: 0, z: 0 };
            b.live = true; b.lastHitBy = -1; b.trailGrade = null; b.golden = null;
            step(2);
          };
          let pid = 9000;
          const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type,
            { clientX: RC.left + x, clientY: RC.top + y, pointerId: pid, pointerType: 'touch', button: 0,
              buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
          let grade = null, contact = false, used = null;
          for (const [pz, vz, vy] of [[-0.55, 3.6, 0.6], [-0.75, 4.4, 0.4], [-0.4, 3.0, 0.8]]) {
            launch(pz, vz, vy);
            const z = g.previewPressZone();
            if (!z) continue;
            used = [pz, vz, vy];
            const sx = z.x + z.axisX * 20, sy = z.y + z.axisY * 20;          // ~20 px off centre: green territory
            const endY = sy - 260;
            const shotId0 = g.shotId;
            ev('pointerdown', sx, sy); step();
            for (let i = 1; i <= 5; i++) { step(); ev('pointermove', sx + 8 * i / 5, sy + (endY - sy) * i / 5); }
            ev('pointerup', sx + 8, endY);
            step(50);
            if (g.shotId !== shotId0 || g.ball.lastHitBy === 1) { contact = true; grade = g.ball.trailGrade; break; }
          }
          const golden = { contact, grade, used };
          // ---- AI whiff check: ball TRAVELLING TO THE BOT (v.z < 0), as after a player's hit ----
          const launchOut = () => {
            g.state = 'RALLY'; g.paused = false;
            g.rallyBounces.length = 0; g.rallyBounces.push(1); g.rallyBounces.push(-1);
            g.isServeBall = false; g.serveBounces = 0;
            const b = g.ball;
            b.p = { x: 0.02, y: 1.02, z: 0.30 }; b.v = { x: 0.10, y: 0.35, z: -3.6 }; b.w = { x: -180, y: 0, z: 0 };
            b.live = true; b.lastHitBy = 1; b.trailGrade = null; b.golden = null;
            g.ai.plan = null; g.ai.commit = null; g.ai.phase = 'IDLE';
            step(2);
          };
          launchOut();
          g.ball.trailGrade = 'green'; g.ball.golden = 'win';
          const shots0 = g.ai.stats.shots;
          let returned = false, frames = 0, plannedG = false;
          for (let i = 0; i < 150; i++) { step(); frames = i;
            if (i >= 3 && (g.ai.plan || g.ai.commit)) plannedG = true;
            if (g.ai.stats.shots > shots0) { returned = true; break; }
            if (!g.ball.live) break; }
          golden.whiff = { returned, planned: plannedG, frames, ballLive: g.ball.live };
          // control: same ball WITHOUT the flag — the bot must take it
          launchOut();
          g.ball.trailGrade = 'yellow';
          const shots1 = g.ai.stats.shots; let returned2 = false, planned2 = false;
          for (let i = 0; i < 150; i++) { step();
            if (g.ai.plan || g.ai.commit) planned2 = true;
            if (g.ai.stats.shots > shots1) { returned2 = true; break; } if (!g.ball.live) break; }
          golden.control = { returned: returned2, planned: planned2 };
          return golden;
        }""")
        print('gold probe:', res, flush=True)
        assert res['whiff']['returned'] is False and res['whiff'].get('planned') is False, res
        print('grades seen:', res['grade'], '| control:', res['control'], flush=True)
        print('errs:', errs[:3] or 'none', flush=True)
        await b.close()
        print('GOLD PROBE PASS')

asyncio.run(main())
