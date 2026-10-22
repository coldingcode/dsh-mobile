"""Regenerate the dsh-mobile brand icon, PWA icons and iOS app icon set.

Requires Pillow and numpy:
    python -m pip install pillow numpy
    python scripts/generate-icons.py
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 1024


def gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = (x * 0.55 + y * 0.65) / (size * 1.2)
    t = np.clip(t, 0, 1)[..., None]
    a = np.array(start, dtype=np.float32)
    b = np.array(end, dtype=np.float32)
    return Image.fromarray((a * (1 - t) + b * t).astype(np.uint8), "RGB")


def build_core() -> Image.Image:
    base = gradient(SIZE, (144, 160, 255), (16, 20, 48)).convert("RGBA")

    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    for r in range(580, 0, -8):
        alpha = int(82 * (1 - r / 580) ** 1.7)
        draw.ellipse(
            [SIZE * 0.62 - r, SIZE * 0.7 - r, SIZE * 0.62 + r, SIZE * 0.7 + r],
            fill=(40, 205, 255, alpha),
        )
    base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(70)))

    spec = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(spec).ellipse([-280, -400, 720, 430], fill=(255, 255, 255, 88))
    base = Image.alpha_composite(base, spec.filter(ImageFilter.GaussianBlur(88)))

    font = None
    for path in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\seguisb.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ):
        if os.path.exists(path):
            font = ImageFont.truetype(path, 540)
            break
    if font is None:
        font = ImageFont.load_default()

    text_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    measure = ImageDraw.Draw(text_layer)
    bbox = measure.textbbox((0, 0), "d", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) / 2 - bbox[0]
    y = (SIZE - th) / 2 - bbox[1] + 4

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + 16), "d", font=font, fill=(0, 0, 0, 100))
    base = Image.alpha_composite(base, shadow.filter(ImageFilter.GaussianBlur(17)))
    ImageDraw.Draw(base).text((x, y), "d", font=font, fill=(255, 255, 255, 250))

    def sparkle(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, color: tuple[int, int, int, int]) -> None:
        points = [
            (cx, cy - r),
            (cx + r * 0.22, cy - r * 0.22),
            (cx + r, cy),
            (cx + r * 0.22, cy + r * 0.22),
            (cx, cy + r),
            (cx - r * 0.22, cy + r * 0.22),
            (cx - r, cy),
            (cx - r * 0.22, cy - r * 0.22),
        ]
        draw.polygon(points, fill=color)

    stars = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    stars_draw = ImageDraw.Draw(stars)
    sparkle(stars_draw, 744, 294, 52, (190, 244, 255, 238))
    sparkle(stars_draw, 808, 386, 22, (255, 255, 255, 185))
    base = Image.alpha_composite(base, stars.filter(ImageFilter.GaussianBlur(0.6)))
    return base


def main() -> None:
    core = build_core()

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=228, fill=255)
    rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rounded.paste(core, (0, 0), mask)
    border = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        [3, 3, SIZE - 4, SIZE - 4], radius=225, outline=(255, 255, 255, 72), width=4
    )
    rounded = Image.alpha_composite(rounded, border)

    assets = os.path.join(ROOT, "assets")
    web_public = os.path.join(ROOT, "src", "web", "public")
    ios_icons = os.path.join(
        ROOT, "ios", "dsh-mobile", "Resources", "Assets.xcassets", "AppIcon.appiconset"
    )
    os.makedirs(assets, exist_ok=True)
    os.makedirs(web_public, exist_ok=True)
    os.makedirs(ios_icons, exist_ok=True)

    rounded.save(os.path.join(assets, "icon.png"))
    rounded.save(os.path.join(web_public, "icon.png"))
    rounded.resize((180, 180), Image.LANCZOS).save(os.path.join(web_public, "icon-180.png"))
    core.convert("RGB").save(os.path.join(assets, "icon-maskable.png"))
    core.convert("RGB").save(os.path.join(web_public, "icon-maskable.png"))

    ios_sizes = {
        "icon-20@2x.png": 40,
        "icon-20@3x.png": 60,
        "icon-29@2x.png": 58,
        "icon-29@3x.png": 87,
        "icon-40@2x.png": 80,
        "icon-40@3x.png": 120,
        "icon-60@2x.png": 120,
        "icon-60@3x.png": 180,
        "icon-1024.png": 1024,
    }
    full = core.convert("RGB")
    for name, size in ios_sizes.items():
        full.resize((size, size), Image.LANCZOS).save(os.path.join(ios_icons, name), optimize=True)

    print("icons written")


if __name__ == "__main__":
    main()
