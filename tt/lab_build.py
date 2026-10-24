#!/usr/bin/env python3
"""Bundle the LAB core loop into one standalone, offline-capable HTML.

The lab build is deliberately separate from the legacy bundle (tt/build.py):
it loads only the modules the core loop actually uses — math, WebGL
renderer, physics, paddle rig, scene, audio — plus tt/src/lab/*.
"""
import os
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
LAB = os.path.join(SRC, 'lab')
ROOT = os.path.dirname(HERE)

OUT = sys.argv[1] if len(sys.argv) > 1 else None
TARGETS = [OUT] if OUT else [os.path.join(ROOT, 'play', 'index.html'),
                            os.path.join(ROOT, 'table-tennis-topspin.html')]

JS_ORDER = [
    '10_math.js',
    '20_gl.js',
    '30_physics.js',
    'lab/00_lab_config.js',
    'lab/10_lab_shots.js',
    'lab/20_lab_input.js',
    'lab/30_lab_ball.js',
    '56_rig.js',
    '60_scene.js',
    '50_audio.js',
    'lab/40_lab_game.js',
    'lab/50_lab_ui.js',
    'lab/60_lab_boot.js',
]

for rel in JS_ORDER:
    if not os.path.exists(os.path.join(SRC, rel)):
        raise SystemExit('lab_build.py: missing source %s' % rel)

css = open(os.path.join(LAB, '05_lab_style.css'), encoding='utf-8').read()
body = open(os.path.join(LAB, '02_lab_body.html'), encoding='utf-8').read()

parts = []
for rel in JS_ORDER:
    s = open(os.path.join(SRC, rel), encoding='utf-8').read()
    if parts:
        s = s.replace("'use strict';", '', 1)
    parts.append('/* ====== %s ====== */\n%s' % (rel, s))
js = '\n\n'.join(parts)

stamp = datetime.datetime.utcnow().strftime('%Y-%m-%d')
TEMPLATE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#04070c">
<meta name="description" content="TOPSPIN LAB — отладочный режим настольного тенниса: восемь свайпов, калибровка зоны удара, статистика.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<title>TOPSPIN LAB — калибровка ударов</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='13' fill='%23fbfbf7'/><path d='M3 16h26' stroke='%23888' stroke-width='1.6'/></svg>">
<style>
__CSS__
</style>
</head>
<body>
__BODY__
<script>
const BUILD_VERSION = 'lab build __STAMP__';
__JS__
</script>
<!-- TOPSPIN LAB · built __STAMP__ · no external assets -->
</body>
</html>
"""
html = (TEMPLATE.replace('__CSS__', css)
                .replace('__BODY__', body)
                .replace('__JS__', js)
                .replace('__STAMP__', stamp))

for target in TARGETS:
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'w', encoding='utf-8') as f:
        f.write(html)
    print('built %s (%.1f KB)' % (target, len(html) / 1024))
