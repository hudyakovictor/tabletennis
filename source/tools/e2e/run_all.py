"""Run the e2e suite one script at a time (never in parallel: swiftshader + several
Chromiums hang the sandbox) and print a pass/fail table.
  python3 run_all.py            # fast suite (~6 min)
  python3 run_all.py --long     # + long scattered-bot runs (tzstats, tcoach, ttips)
  python3 run_all.py tdet twake # only these
A script fails on a non-zero exit, a timeout, or a page error in its `errs` line
(the Telegram «requestFullscreen not supported» console line outside Telegram is ignored)."""
import subprocess, sys, time, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
FAST = ['tdet', 'tserve', 'tblur', 'thub', 'twake', 'tfull', 'tautohint', 'tcareer', 'tresult', 'tprofile', 'tzsheet', 'tlink', 'tgl', 'taudit']
LONG = ['ttips', 'tcoach', 'tzstats']
args = [a for a in sys.argv[1:] if not a.startswith('--')]
suite = args or (FAST + (LONG if '--long' in sys.argv else []))
IGN = re.compile(r"'CON \[Telegram\.WebApp\][^']*',?\s*")
rows = []
for name in suite:
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, os.path.join(HERE, name + '.py')], cwd=HERE, capture_output=True, text=True, timeout=900)
        out = r.stdout + r.stderr; code = r.returncode
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'').decode() if isinstance(e.stdout, bytes) else (e.stdout or ''); code = 'timeout'
    errs = [l for l in out.splitlines() if l.startswith('errs')]
    bad = [l for l in errs if IGN.sub('', l).strip() not in ('errs []', 'errs')]
    ok = code == 0 and not bad
    rows.append((name, 'PASS' if ok else 'FAIL', int(time.time() - t0), '' if ok else (bad[0] if bad else out.strip().splitlines()[-1] if out.strip() else str(code))[:160]))
    print(f"{rows[-1][1]:4}  {name:10} {rows[-1][2]:4}s  {rows[-1][3]}", flush=True)
print('\n%d/%d passed' % (sum(r[1] == 'PASS' for r in rows), len(rows)))
sys.exit(0 if all(r[1] == 'PASS' for r in rows) else 1)
