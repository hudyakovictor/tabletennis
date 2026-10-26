import base64, re, pathlib
root = pathlib.Path(__file__).parent / 'src'
html = (root/'index.tpl.html').read_text()
def b64(p): return 'data:font/woff2;base64,' + base64.b64encode((root/p).read_bytes()).decode()
css = (root/'styles.css').read_text() + '\n' + (root/'screens.css').read_text()
for k,f in {'__UNB900__':'unb900.woff2','__UNB600__':'unb600.woff2','__MAN600__':'man600.woff2','__MAN800__':'man800.woff2'}.items():
    css = css.replace(k, b64(f))
import glob
av = {pathlib.Path(f).stem: 'data:image/webp;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob(str(root/'av'/'*.webp')))}
import json
avjs = 'const AVATARS = ' + json.dumps(av) + ';\n'
ill = {pathlib.Path(f).stem: 'data:image/webp;base64,'+base64.b64encode(open(f,'rb').read()).decode() for f in sorted(glob.glob(str(root/'ill'/'*.webp')))}
illjs = 'const ILL = ' + json.dumps(ill) + ';\n'
order = ['core.js','art.js','fx.js','bg.js','engine.js','ui.js','game_host.js','career.js','scr_hub.js','scr_battle.js','scr_meta.js','main.js']
# --- настоящий движок: собираем game/ и встраиваем как строку для iframe srcdoc ---
import subprocess, tempfile, os
gtmp = tempfile.mktemp(suffix='.html')
subprocess.run(['python3', str(pathlib.Path(__file__).parent/'game'/'tt'/'build.py'), gtmp], check=True, env=dict(os.environ, TT_NO_LOGO='1'))
ghtml = open(gtmp, encoding='utf-8').read(); os.remove(gtmp)
gamejs = 'const GAME_HTML = ' + json.dumps(ghtml, ensure_ascii=False).replace('<', '\\u003c') + ';\n'
js = gamejs + avjs + illjs + '\n'.join(f'/* ==== {n} ==== */\n' + (root/n).read_text() for n in order if (root/n).exists())
html = html.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
out = pathlib.Path(__file__).parent / 'index.html'
out.write_text(html)
print('built', out, len(html)//1024, 'KB')
