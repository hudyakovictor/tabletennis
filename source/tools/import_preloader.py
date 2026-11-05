#!/usr/bin/env python3
"""Import only the production sprites from the supplied motion reference."""
import argparse
import base64
import json
import pathlib
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("reference", type=pathlib.Path)
args = parser.parse_args()
text = args.reference.read_text(encoding="utf-8")
start = text.index("const ASSETS = ") + len("const ASSETS = ")
assets, _ = json.JSONDecoder().raw_decode(text[start:])
for key, value in re.findall(r'ASSETS\.(\w+)\s*=\s*("[^"\n]+")\s*;', text):
    assets[key] = json.loads(value)

destination = pathlib.Path(__file__).resolve().parents[1] / "src" / "ill"
sprites = {
    "ball_sprite_intro": "preloader-ball-intro",
    "ball_scream_spin": "preloader-ball-spin",
    "paddle": "preloader-paddle",
    "impact_burst": "preloader-burst",
}
for key, name in sprites.items():
    prefix, payload = assets[key].split(",", 1)
    if prefix != "data:image/webp;base64":
        raise ValueError(f"Unexpected sprite format: {key}")
    data = base64.b64decode(payload, validate=True)
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"Invalid WebP sprite: {key}")
    output = destination / f"{name}.webp"
    output.write_bytes(data)
    print(f"imported {output.name}: {len(data)} bytes")
