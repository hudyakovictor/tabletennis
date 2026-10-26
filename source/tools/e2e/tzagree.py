"""Gate ↔ physics agreement from no-gate outcome maps (tzmap.py noGate runs record `would` = gate verdict).
recall    = share of physically returnable presses the gate admits
precision = share of admitted presses (after the direction rule) the physics returns
Usage: tzagree.py label:file_up,file_down [label:...]"""
import json, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
def load(f): return json.load(open(os.path.join(HERE, 'shots', f)))
for arg in sys.argv[1:]:
    label, files = arg.split(':'); ups, downs = files.split(',')
    rows = [(t, 1) for t in load(ups)] + [(t, -1) for t in load(downs)]
    if os.environ.get('TIMED'): rows = [(t, d) for t, d in rows if .04 <= t['lead'] <= .16]   # sane timing only
    def adm(t, d): return bool(t.get('would')) and (t['dy'] * d >= -4)   # upstream of the meeting point along the swipe
    ok = [(t, d) for t, d in rows if t['outcome'] == 'in']
    A = [(t, d) for t, d in rows if adm(t, d)]
    rec = sum(adm(t, d) for t, d in ok) / max(1, len(ok)); prec = sum(t['outcome'] == 'in' for t, d in A) / max(1, len(A))
    by = lambda dd: (sum(adm(t, d) for t, d in ok if d == dd) / max(1, sum(1 for t, d in ok if d == dd)))
    print(f"{label:6s} trials {len(rows)} returnable {len(ok)} | recall {rec*100:.0f}% (swipe up {by(1)*100:.0f}%, push down {by(-1)*100:.0f}%) | precision {prec*100:.0f}% | admitted {len(A)}")
