"""Internal canvas-frame bundler. The only application build is source/build.py."""
import base64
import datetime
import hashlib
import json
import os
import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parent / 'src'
REPO = SRC.parents[3]
SHARED = REPO / 'source' / 'src'

JS_ORDER = ['05_stroke_config.js', '06_calibration.js', '03_i18n.js', '10_math.js', '12_match_rules.js',
            '13_stamina.js', '20_gl.js', '25_career.js', '27_network.js', '30_physics.js',
            '37_stroke_motion_data.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js',
            '43_input_telemetry.js', '44_diagnostics.js', '44_miss_shots.js', '45_perf.js',
            '46_physics_watchdog.js', '50_audio.js', '55_ai.js', '56_rig.js', '57_camera.js',
            '58_coach.js', '59_replay.js', '60_scene.js', '61_particles.js', '62_arena.js',
            '64_training_data.js', '65_train.js', '66_training_preview.js', '75_feedback.js',
            '75_music.js', '76_emotion.js', '84_racket.js', '86_meta.js',
            '70_game.js', '80_ui.js', '90_boot.js', '92_embed.js']
CSS_ORDER = ['05_style.css', '07_preview.css']


def build_frame():
    """Return the embedded game scene; never write or launch a second game page."""
    for suffix, order in [('.js', JS_ORDER), ('.css', CSS_ORDER)]:
        present = {file.name for file in SRC.glob('*' + suffix)}
        missing, extra = sorted(present - set(order)), sorted(set(order) - present)
        if missing or extra:
            raise ValueError(f'Engine bundle manifest out of sync: missing {missing}, unknown {extra}')

    css = '\n'.join((SRC / name).read_text(encoding='utf-8') for name in CSS_ORDER)
    for family, weight, filename in [('Unb', 900, 'unb900.woff2'), ('Unb', 600, 'unb600.woff2'),
                                     ('Man', 600, 'man600.woff2'), ('Man', 800, 'man800.woff2')]:
        data = base64.b64encode((SHARED / filename).read_bytes()).decode('ascii')
        css += f'\n@font-face{{font-family:"{family}";font-weight:{weight};font-display:block;src:url(data:font/woff2;base64,{data}) format("woff2")}}'
    body = (SRC / '02_body.html').read_text(encoding='utf-8')

    parts = []
    for name in JS_ORDER:
        text = (SRC / name).read_text(encoding='utf-8')
        text = re.sub(r"^'use strict';\s*$", '', text, count=1, flags=re.M)
        parts.append('/* ====== ' + name + ' ====== */\n' + text)

    arena = {}
    if not os.environ.get('TT_NO_ARENA'):
        for key, filename in {'panorama': 'street-court.jpg', 'asphalt': 'asphalt-tile.jpg', 'stands': 'stands.jpg'}.items():
            path = SRC.parent / 'assets' / filename
            if path.exists():
                arena[key] = 'data:image/jpeg;base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
    audio = {}
    for key, filename in {'swing': 'missing the ball.mp3', 'ball1': '43d6230aeba4b8c.mp3',
                          'ball2': '8eba8ea8ef04f24.mp3', 'ball3': 'c3c37baf3cd71bd.mp3'}.items():
        audio[key] = base64.b64encode((SHARED / 'sounds' / filename).read_bytes()).decode('ascii')
    js = 'window.__TT_ARENA = ' + json.dumps(arena) + ';\nconst TT_AUDIO_SAMPLES = ' + json.dumps(audio) + ';\n' + '\n\n'.join(parts)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
    fingerprint = hashlib.sha256((css + '\n' + body + '\n' + js).encode('utf-8')).hexdigest()[:12]
    return f'''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Игровая сцена</title>
<style>{css}</style>
</head>
<body>{body}
<script>
const BUILD_VERSION = 'embedded scene {stamp} · {fingerprint}';
{js}
</script>
</body>
</html>'''


if __name__ == '__main__':
    raise SystemExit('No standalone engine build. Build the application with: python3 source/build.py')
