"""Extract reusable preview sprites without modifying the original collages."""

from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
SHEETS = {
    "comic": ROOT / "Комикс-граффити мудборд «Настольный теннис WTF».png",
    "concept": ROOT / "Концепт-арт игры «Настольный теннис WTF».png",
    "extreme": ROOT / "Экстремальный теннис_ концепт-арт игры.png",
}
SPRITES = [
    ("ball-panic", "comic", (27, 842, 150, 963), "ball"),
    ("ball-wobble", "comic", (160, 847, 280, 963), "ball"),
    ("ball-scream", "extreme", (15, 927, 171, 1076), "ball"),
    ("ball-shock", "extreme", (765, 1054, 832, 1178), "cutout"),
    ("paddle-red", "extreme", (180, 918, 291, 1069), "cutout"),
    ("paddle-comic", "comic", (904, 527, 1010, 640), "cutout"),
    ("impact", "extreme", (298, 927, 446, 1068), "cutout"),
    ("crown", "extreme", (17, 1119, 122, 1210), "cutout"),
    ("streak", "extreme", (133, 1115, 283, 1214), "cutout"),
    ("speed", "extreme", (296, 1111, 456, 1197), "cutout"),
    ("cry-aaa", "extreme", (496, 926, 589, 1018), "cutout"),
    ("cry-ahh", "extreme", (687, 924, 765, 1018), "cutout"),
    ("logo-brush", "comic", (286, 57, 491, 254), "cutout"),
    ("logo-stamp", "concept", (1006, 31, 1253, 401), "cutout"),
    ("net", "comic", (1115, 718, 1230, 761), "cutout"),
    ("court", "concept", (780, 1047, 1080, 1220), "opaque"),
]


def remove_background(image):
    """Flood the dark exterior, retaining black ink enclosed by the artwork."""
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    outside = Image.new("L", image.size)
    visited = outside.load()
    pending = deque()

    def push(x, y):
        if visited[x, y]:
            return
        r, g, b, a = pixels[x, y]
        if a < 24 or max(r, g, b) < 58:
            visited[x, y] = 255
            pending.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)
    while pending:
        x, y = pending.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                push(nx, ny)

    alpha = outside.point(lambda value: 255 - value)
    # A one-pixel ink outline is part of the comic silhouette, not a halo.
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.3))
    source_alpha = image.getchannel("A")
    if source_alpha.getextrema()[0] < 255:
        from PIL import ImageChops

        alpha = ImageChops.multiply(alpha, source_alpha)
    image.putalpha(alpha)
    return image


def main():
    output = ROOT / "assets"
    output.mkdir(exist_ok=True)
    sheets = {key: Image.open(path) for key, path in SHEETS.items()}
    previews = []
    for name, sheet, box, mode in SPRITES:
        image = sheets[sheet].crop(box).convert("RGBA")
        if mode == "ball":
            # Preserve the black pupils/mouth; global chroma-key would erase them.
            alpha = Image.new("L", image.size)
            ImageDraw.Draw(alpha).ellipse((2, 2, image.width - 3, image.height - 3), fill=255)
            image.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.45)))
        elif mode == "cutout":
            image = remove_background(image)
            bbox = image.getbbox()
            if bbox:
                image = image.crop(bbox)
        else:
            image.putalpha(255)
        image.save(output / (name + ".png"), optimize=True)
        previews.append((name, image.copy()))
        print(name, image.size)

    # Local contact sheet is only a verification artifact, not a runtime asset.
    preview = Image.new("RGB", (800, 800), "#252525")
    draw = ImageDraw.Draw(preview)
    for index, (name, image) in enumerate(previews):
        x, y = index % 4 * 200, index // 4 * 200
        for yy in range(y, y + 170, 12):
            for xx in range(x, x + 190, 12):
                if ((xx - x) // 12 + (yy - y) // 12) % 2:
                    draw.rectangle((xx, yy, xx + 11, yy + 11), fill="#333333")
        image.thumbnail((166, 150), Image.Resampling.LANCZOS)
        preview.paste(image, (x + (190 - image.width) // 2, y + (170 - image.height) // 2), image)
        draw.text((x + 12, y + 177), name, fill="#ffff33")
    preview.save(ROOT.parent / "temp" / "preloader-assets.png")


if __name__ == "__main__":
    main()
