"""Renders the YTD Studio logo as PNGs: the iOS app icon and the desktop (macOS / Windows) icon.

The artwork matches android/app/src/main/res/drawable/ic_launcher_foreground.xml (108 x 108 units):
a violet-to-pink circle with a white arrow dropping into a tray.

    python3 scripts/icons/render.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SS = 4  # supersampling for smooth edges
BG = (0x12, 0x10, 0x2A, 255)
VIOLET = (0x7B, 0x5C, 0xFF)
PINK = (0xFF, 0x54, 0x70)
WHITE = (255, 255, 255, 255)


def gradient(size):
    """Diagonal violet (top left) to pink (bottom right)."""
    grad = Image.new('RGBA', (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(VIOLET[i] + (PINK[i] - VIOLET[i]) * t) for i in range(3)) + (255,)
    return grad


def art(img, ox, oy, scale):
    """Draws the 108-unit artwork with its origin at (ox, oy)."""
    def p(x, y):
        return (ox + x * scale, oy + y * scale)

    # Gradient disc: centre (54, 54), radius 28.
    left, top = p(26, 26)
    size = round(56 * scale)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    small = gradient(64).resize((size, size), Image.BILINEAR)
    img.paste(small, (round(left), round(top)), mask)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle([p(50, 36), p(58, 55)], radius=2 * scale, fill=WHITE)   # arrow shaft
    d.polygon([p(42, 51), p(66, 51), p(54, 63)], fill=WHITE)                   # arrow head
    d.rounded_rectangle([p(41, 67), p(67, 72)], radius=2.5 * scale, fill=WHITE)  # tray


def ios_icon(path):
    n = 1024 * SS
    img = Image.new('RGBA', (n, n), BG)
    scale = n / 80.0  # 80-unit window (14..94) around the 108-unit canvas: the disc fills 70%
    art(img, -14 * scale, -14 * scale, scale)
    img.resize((1024, 1024), Image.LANCZOS).convert('RGB').save(path)


def desktop_icon(path):
    n = 1024 * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    inset, size = 100 * SS, 824 * SS  # macOS icon grid: rounded square with a margin
    ImageDraw.Draw(img).rounded_rectangle([inset, inset, inset + size, inset + size], radius=185 * SS, fill=BG)
    scale = size / 80.0
    art(img, inset - 14 * scale, inset - 14 * scale, scale)
    img.resize((1024, 1024), Image.LANCZOS).save(path)


if __name__ == '__main__':
    ios_icon(ROOT / 'ios/YTDStudio/Assets.xcassets/AppIcon.appiconset/AppIcon.png')
    desktop_icon(ROOT / 'build/icon.png')
