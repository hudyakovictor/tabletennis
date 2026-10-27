#!/usr/bin/env python3
"""Собрать всё приложение (оболочка + встроенный движок) в ОДИН файл.

    python3 source/build.py              → play/index.html   (единственная сборка в репозитории)
    python3 source/build.py /tmp/x.html  → указанный путь    (проверка свежести в тестах)

В папке source/ лежат только исходники; готовый HTML живёт только в play/.
"""
import base64, re, pathlib, hashlib, sys

SOURCE_DIR = pathlib.Path(__file__).resolve().parent
REPO = SOURCE_DIR.parent
root = SOURCE_DIR / 'src'
html = (root/'index.tpl.html').read_text()
def b64(p): return 'data:font/woff2;base64,' + base64.b64encode((root/p).read_bytes()).decode()
CSS_ORDER = ['css/base.css','css/screens_hub.css','css/screens_battle.css','css/screens_meta.css','css/screens_misc.css']
css = '\n'.join((root/f).read_text() for f in CSS_ORDER)
for k,f in {'__UNB900__':'unb900.woff2','__UNB600__':'unb600.woff2','__MAN600__':'man600.woff2','__MAN800__':'man800.woff2'}.items():
    css = css.replace(k, b64(f))
import glob
av = {pathlib.Path(f).stem: 'data:image/webp;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob(str(root/'av'/'*.webp')))}
import json
avjs = 'const AVATARS = ' + json.dumps(av) + ';\n'
ill = {pathlib.Path(f).stem: 'data:image/webp;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob(str(root/'ill'/'*.webp')))}
illjs = 'const ILL = ' + json.dumps(ill) + ';\n'
# Порядок = слои архитектуры (см. docs/ARCHITECTURE.ru.md): сначала ядро и
# данные, потом UI-примитивы и сервисы, экраны — последними, boot в конце.
# Файл, отсутствующий в этом списке, в сборку НЕ попадёт.
order = ['core/util.js','core/i18n.js','locales/ru.js','locales/en.js','core/state.js','core/platform.js','core/audio.js','core/ui_core.js','core/dev.js',
         'data/leagues.js','ui/art.js','ui/fx.js','services/economy.js','ui/bg.js','engine2d/engine.js',
         'ui/ui.js','services/miss_shots.js','services/game_host.js','services/diagnostics.js','services/career.js',
         'screens/hub.js','screens/settings.js','screens/matchmaking.js','screens/online.js','screens/battle_common.js',
         'screens/match.js','screens/training.js','screens/result.js',
         'ui/item_art.js','data/catalog.js','screens/shop.js','data/season.js','screens/pass.js','screens/ranks.js','screens/profile.js','main.js']
# --- настоящий движок: собираем game/ и встраиваем как строку для iframe srcdoc ---
import subprocess, tempfile, os
gtmp = tempfile.mktemp(suffix='.html')
subprocess.run(['python3', str(SOURCE_DIR/'game'/'tt'/'build.py'), gtmp], check=True, env=dict(os.environ, TT_NO_LOGO='1'))
ghtml = open(gtmp, encoding='utf-8').read(); os.remove(gtmp)
gamejs = 'const GAME_HTML = ' + json.dumps(ghtml, ensure_ascii=False).replace('<', '\\u003c') + ';\n'
js = gamejs + avjs + illjs + '\n'.join(f'/* ==== {n} ==== */\n' + (root/n).read_text() for n in order if (root/n).exists())
# Identify the actual shell independently of the embedded engine build.
shell_fingerprint = hashlib.sha256((html + '\n' + css + '\n' + js).encode('utf-8')).hexdigest()[:12]
js = 'const SHELL_BUILD = ' + json.dumps('shell ' + shell_fingerprint) + ';\n' + js
html = html.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
out = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO/'play'/'index.html'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
print('built', out, len(html)//1024, 'KB')
