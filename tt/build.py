#!/usr/bin/env python3
"""Bundle every source file into one standalone, offline-capable HTML."""
import os, re, sys, datetime, base64
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(SRC), '..', 'table-tennis-topspin.html')

JS_ORDER = ['10_math.js','12_match_rules.js','20_gl.js','25_career.js','27_network.js','30_physics.js','38_paddle_motion.js','40_swipe.js','42_shot_diagnostics.js','43_input_telemetry.js','50_audio.js',
            '55_ai.js','56_rig.js','57_camera.js','58_coach.js','59_replay.js','60_scene.js',
            '65_train.js','75_feedback.js','75_music.js','76_emotion.js','81_uiAnim.js','84_racket.js',
            '86_meta.js','70_game.js','80_ui.js','90_boot.js']

# Every module in src/ MUST be in JS_ORDER: a file that is present on disk
# but missing here builds a bundle that throws on boot and shows "WebGL
# недоступен" instead of the game. It happened. It will not happen again.
_missing = sorted(set(f for f in os.listdir(SRC) if f.endswith('.js')) - set(JS_ORDER))
_extra = sorted(set(JS_ORDER) - set(os.listdir(SRC)))
if _missing or _extra:
    raise SystemExit('build.py: JS_ORDER out of sync — missing: %s, unknown: %s'
                     % (_missing, _extra))

css  = open(os.path.join(SRC,'05_style.css'),encoding='utf-8').read()
body = open(os.path.join(SRC,'02_body.html'),encoding='utf-8').read()
with open(os.path.join(os.path.dirname(SRC), 'assets', 'table-tennis-ultimate.png'), 'rb') as asset:
    logo = 'data:image/png;base64,' + base64.b64encode(asset.read()).decode('ascii')
body = body.replace('{{BRAND_LOGO}}', logo)
js_parts=[]
for f in JS_ORDER:
    p=os.path.join(SRC,f)
    s=open(p,encoding='utf-8').read()
    # only the first 'use strict' is needed; drop the rest to keep the bundle clean
    if js_parts: s=re.sub(r"^'use strict';\s*$", '', s, count=1, flags=re.M)
    js_parts.append(f"/* ====== {f} ====== */\n"+s)
js="\n\n".join(js_parts)

# Recorded audio: embed the sample files as base64 data-URIs and expose them
# through a global the AudioEngine decodes on unlock. Injected as a SEPARATE
# <script> (not a literal inside 50_audio.js) so the node test suite can still
# load that file directly. If the sounds folder is absent (a fresh clone without
# assets) the game still builds and every sound falls back to the runtime synth.
import json
_snd_dir = os.path.join(os.path.dirname(SRC), '..', 'sounds')
_mime = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'}
_want = {'tileA': 'tile_hard_a.wav', 'tileB': 'tile_hard_b.wav',
         'applause': 'apl.wav', 'menu': 'short.mp3'}
_sounds = {}
if os.path.isdir(_snd_dir):
    for _key, _fn in _want.items():
        _fp = os.path.join(_snd_dir, _fn)
        if not os.path.isfile(_fp):
            continue
        with open(_fp, 'rb') as _asset:
            _ext = os.path.splitext(_fn)[1].lower()
            _sounds[_key] = 'data:%s;base64,%s' % (_mime.get(_ext, 'application/octet-stream'),
                                                   base64.b64encode(_asset.read()).decode('ascii'))
samples_script = ('<script>window.__AUDIO_SAMPLES__ = %s;</script>' % json.dumps(_sounds)) if _sounds else ''
print('audio samples:', ', '.join(_sounds) or 'none (synth fallback)')

stamp = datetime.datetime.utcnow().strftime('%Y-%m-%d')
html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#05070c">
<meta name="description" content="TOPSPIN ARENA — демо настольного тенниса: физика ITTF, эффект Магнуса, удары управляются свайпом.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>TOPSPIN ARENA — настольный теннис · физика ITTF · свайп-управление</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='%23fbfbf7'/><path d='M3 16h26' stroke='%23888' stroke-width='1.6'/></svg>">
<style>
{css}
</style>
</head>
<body>
{body}
{samples_script}
<script>
const BUILD_VERSION = 'self-contained build {stamp}';
{js}
</script>
<!-- TOPSPIN ARENA · self-contained build {stamp} · no external assets, no network required -->
</body>
</html>
"""
with open(OUT,'w',encoding='utf-8') as f: f.write(html)
if len(sys.argv) <= 1:
    with open(os.path.join(os.path.dirname(SRC), '..', 'play', 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)
print(f"built {OUT}  ({len(html)/1024:.1f} KB)")
