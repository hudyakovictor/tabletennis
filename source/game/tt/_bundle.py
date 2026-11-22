"""Internal canvas-frame bundler. The only application build is source/build.py."""
import base64
import datetime
import hashlib
import json
import math
import os
import pathlib
import re
import struct

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


def build_rackets():
    """Pack the supplied GLBs for the existing renderer, without runtime fetches."""
    assets = REPO / 'source' / 'assets'
    models = {
        'r-standard': (assets / 'rackets/models/standard.glb', .05335, (.88, .88, .011 / .013), 0),
        'r-pan': (assets / 'pan/models/pan.glb', .115, (-.68, .68, -.020 / .0565), .010 - .012 * .020 / .0565),
    }
    packed = {}
    for key, (path, center_y, scale, offset_z) in models.items():
        raw = path.read_bytes()
        if struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw)):
            raise ValueError(f'Invalid GLB header: {path}')
        chunks, offset = {}, 12
        while offset < len(raw):
            length, kind = struct.unpack_from('<II', raw, offset)
            chunks[kind] = raw[offset + 8:offset + 8 + length]
            offset += 8 + length
        doc = json.loads(chunks[0x4E4F534A])
        binary = chunks[0x004E4942]
        if any(any(field in node for field in ('matrix', 'translation', 'rotation', 'scale')) for node in doc['nodes']):
            raise ValueError(f'Bake node transforms before importing {path}')

        def accessor(index, shape):
            a = doc['accessors'][index]
            if a['type'] != shape or 'sparse' in a:
                raise ValueError(f'Unsupported accessor in {path}')
            fmt = {5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
            count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[shape]
            view = doc['bufferViews'][a['bufferView']]
            if view.get('buffer', 0) != 0:
                raise ValueError(f'External geometry buffer in {path}')
            size = struct.calcsize('<' + fmt * count)
            stride = view.get('byteStride', size)
            start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
            end = start + (a['count'] - 1) * stride + size
            if end > view.get('byteOffset', 0) + view['byteLength'] or end > len(binary):
                raise ValueError(f'Truncated accessor in {path}')
            return [struct.unpack_from('<' + fmt * count, binary, start + i * stride) for i in range(a['count'])]

        textures, texture_ids, parts = [], {}, []
        for mesh in doc['meshes']:
            for primitive in mesh['primitives']:
                if primitive.get('mode', 4) != 4:
                    raise ValueError(f'Only triangle meshes are supported: {path}')
                attrs = primitive['attributes']
                positions = accessor(attrs['POSITION'], 'VEC3')
                normals = accessor(attrs['NORMAL'], 'VEC3')
                uvs = accessor(attrs['TEXCOORD_0'], 'VEC2')
                indices = [row[0] for row in accessor(primitive['indices'], 'SCALAR')]
                nv, ni = len(positions), len(indices)
                if len(normals) != nv or len(uvs) != nv or ni % 3 or max(indices) >= nv:
                    raise ValueError(f'Invalid primitive in {path}')
                # Fit the existing paddle envelope; the pan's flat -Z bottom becomes +Z.
                pos = [(x * scale[0], (y - center_y) * scale[1], z * scale[2] + offset_z) for x, y, z in positions]
                nrm = []
                for row in normals:
                    n = [row[i] / scale[i] for i in range(3)]
                    length = math.hypot(*n)
                    nrm.append([value / length for value in n])
                floats = [value for rows in (pos, nrm, uvs) for row in rows for value in row]
                wide = max(indices) > 65535
                data = struct.pack('<' + 'f' * len(floats), *floats) + struct.pack('<' + ('I' if wide else 'H') * ni, *indices)
                material = doc['materials'][primitive['material']]
                pbr = material.get('pbrMetallicRoughness', {})
                mat = {'color': pbr.get('baseColorFactor', [1, 1, 1, 1])[:3],
                       'rough': pbr.get('roughnessFactor', 1), 'metal': pbr.get('metallicFactor', 1),
                       'doubleSided': material.get('doubleSided', False)}
                if key == 'r-pan':
                    # The base-color-only renderer omits the tiled ObsidianCast_ORM map.
                    # Preserve its mean linear G/B factors, not a fabricated dielectric coating.
                    mat['rough'] *= 0.47728640986423865
                    mat['metal'] *= 0.9007337869382372
                if 'baseColorTexture' in pbr:
                    image_id = doc['textures'][pbr['baseColorTexture']['index']]['source']
                    if image_id not in texture_ids:
                        if key == 'r-standard':
                            # The user-supplied atlas differs from the stale image embedded in this GLB.
                            image = (assets / 'rackets/textures/standard_atlas.png').read_bytes()
                            mime = 'image/png'
                        else:
                            source = doc['images'][image_id]
                            view = doc['bufferViews'][source['bufferView']]
                            start = view.get('byteOffset', 0)
                            image = binary[start:start + view['byteLength']]
                            mime = source['mimeType']
                        texture_ids[image_id] = len(textures)
                        textures.append('data:' + mime + ';base64,' + base64.b64encode(image).decode('ascii'))
                    mat['texture'] = texture_ids[image_id]
                parts.append({'nv': nv, 'ni': ni, 'wide': wide, 'data': base64.b64encode(data).decode('ascii'), 'material': mat})
        packed[key] = {'parts': parts, 'textures': textures, 'singleFace': key == 'r-pan',
                       'faceOffset': .010 if key == 'r-pan' else .0051 * scale[2]}
    return packed


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
        path = SRC.parent / 'assets' / 'night-hall.webp'
        if path.exists():
            arena['panorama'] = 'data:image/webp;base64,' + base64.b64encode(path.read_bytes()).decode('ascii')
    audio = {}
    for key, filename in {'swing': 'missing the ball.mp3', 'ball1': '43d6230aeba4b8c.mp3',
                          'ball2': '8eba8ea8ef04f24.mp3', 'ball3': 'c3c37baf3cd71bd.mp3'}.items():
        audio[key] = base64.b64encode((SHARED / 'sounds' / filename).read_bytes()).decode('ascii')
    js = 'window.__TT_ARENA = ' + json.dumps(arena) + ';\nconst TT_RACKETS = ' + json.dumps(build_rackets()) + ';\nconst TT_AUDIO_SAMPLES = ' + json.dumps(audio) + ';\n' + '\n\n'.join(parts)
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
