"""Generate the extension icons (public/icon/{16,32,48,128}.png).

Run with: python3 scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 512
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icon"


def draw_master() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    # Vertical pine-green gradient inside a rounded square.
    gradient = Image.new("RGBA", (SIZE, SIZE))
    top, bottom = (46, 139, 110), (24, 92, 74)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
        ImageDraw.Draw(gradient).line([(0, y), (SIZE, y)], fill=color)
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([16, 16, SIZE - 16, SIZE - 16], radius=112, fill=255)
    img.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    # Mouse cursor arrow.
    cursor = [(150, 120), (150, 390), (215, 330), (262, 430), (305, 410), (258, 312), (345, 312)]
    draw.polygon(cursor, fill=(255, 255, 255, 255))
    # Four-point sparkle, top right.
    cx, cy, r, w = 370, 160, 70, 18
    sparkle = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
               (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    draw.polygon(sparkle, fill=(255, 255, 255, 235))
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_master()
    for size in (16, 32, 48, 128):
        master.resize((size, size), Image.LANCZOS).save(OUT_DIR / f"{size}.png")


if __name__ == "__main__":
    main()
