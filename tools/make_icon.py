from __future__ import annotations

"""Generate the fxxk_file application icon (green rounded square + 译).

Run once with Pillow installed:
    python tools/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "app.ico"

GREEN_TOP = (33, 122, 87)
GREEN_BOTTOM = (13, 80, 56)
WHITE = (255, 255, 255, 255)

SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = max(2, int(size * 0.22))

    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(gradient)
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(GREEN_TOP[0] + (GREEN_BOTTOM[0] - GREEN_TOP[0]) * t)
        g = int(GREEN_TOP[1] + (GREEN_BOTTOM[1] - GREEN_TOP[1]) * t)
        b = int(GREEN_TOP[2] + (GREEN_BOTTOM[2] - GREEN_TOP[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    img.paste(gradient, (0, 0), mask)

    char = "译"
    font = load_font(max(8, int(size * 0.60)))
    text_draw = ImageDraw.Draw(img)
    bbox = text_draw.textbbox((0, 0), char, font=font)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    x = (size - width) / 2 - bbox[0]
    y = (size - height) / 2 - bbox[1]
    text_draw.text((x, y), char, font=font, fill=WHITE)
    return img


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = [draw_icon(s) for s in SIZES]
    frames[-1].save(OUT, format="ICO", append_images=frames[:-1])
    print(f"Wrote {OUT} with {len(frames)} sizes")


if __name__ == "__main__":
    main()
