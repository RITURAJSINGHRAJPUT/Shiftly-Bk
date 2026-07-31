#!/usr/bin/env python3
"""
Derive every brand asset the client ships from the single source wordmark.

Source of truth is `assets/shiftly.png` — a 1024x1024 transparent PNG of the
cutlery-built SHIFTLY wordmark. At ~1.5 MB it is far too heavy to serve, and it
carries a lot of empty margin, so nothing references it directly. This script
trims it, resizes it and writes the results into `client/public/brand/`.

Outputs are committed, so running the app needs nothing from here. Re-run it
only when `assets/shiftly.png` itself changes:

    python3 scripts/build-brand-assets.py

Requires Pillow (`pip install Pillow`) — a dev-only dependency.

Two properties of the artwork drive most of what follows:

1. The letterforms are near-black navy (#001830) with cream highlights. That
   reads beautifully on white and all but disappears on the navy sidebar
   (#1e1b4b) and dark-mode cards (#16172c). The `-light` variants fix it by
   inverting HSL lightness, which — unlike a flat cream tint — preserves the
   fork-tine and spoon detail that makes the mark recognisable.

2. The leading fork-S glyph, used alone as an icon, stops being legible below
   about 48px; the tines thin out into a squiggle. Every raster icon therefore
   sits on a solid rounded plate, which holds up down to 16px.
"""

import colorsys
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'assets', 'newshiftly.png')
OUT_DIR = os.path.join(ROOT, 'client', 'public', 'brand')

# BrandLogo.jsx puts these on the <img> as width/height so the box is reserved
# before the bitmap decodes. Emitted rather than hand-copied: the wordmark's
# aspect ratio changes whenever the artwork is redrawn (2.35:1 -> 3.26:1 on the
# last swap), and a stale constant there means a visible reflow on every load.
METRICS = os.path.join(ROOT, 'client', 'src', 'components', 'brand-metrics.json')

# Alpha below this is the artwork's outer glow rather than the artwork. Trimming
# on the raw bbox keeps a frame of mostly-invisible haze; trimming here gives the
# true wordmark.
ALPHA_FLOOR = 40

# A column carrying less than this share of the densest column counts as the gap
# between two letters.
GAP_RATIO = 0.02

PLATE_BG = (30, 27, 75)      # --sidebar-bg #1e1b4b, so the icon matches the app
PLATE_RADIUS = 0.22          # of the plate's side
PLATE_INSET = 0.14           # margin around the glyph
MASKABLE_INSET = 0.28        # Android crops to a circle; keep clear of the edge

# Thin tines alias badly when resized straight to 16-48px. Draw large, then
# downsample once at the end.
SUPERSAMPLE = 4


def trimmed(img):
    """Crop to the artwork, ignoring the outer glow."""
    mask = img.getchannel('A').point(lambda v: 255 if v > ALPHA_FLOOR else 0)
    return img.crop(mask.getbbox())


def leading_glyph_width(img):
    """Where the wordmark's first letter ends.

    Measured rather than hardcoded: the S is cropped out to serve as the app's
    square mark, and letter positions move whenever the artwork is redrawn. The
    previous source put the gap at x=168 and the current one at x=188, which a
    constant would have silently mis-cropped.
    """
    alpha = img.getchannel('A')
    w, h = img.size
    columns = [sum(alpha.crop((x, 0, x + 1, h)).getdata()) for x in range(w)]
    floor = max(columns) * GAP_RATIO
    for x in range(1, w):
        if columns[x] < floor <= columns[x - 1]:
            return x
    raise SystemExit('could not find a letter boundary — check ALPHA_FLOOR/GAP_RATIO')


def lightened(img):
    """Invert HSL lightness, preserving hue and saturation.

    Near-black navy becomes pale cream and the cream highlights become dark, so
    the letterform structure survives instead of flattening into a silhouette.
    """
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hue, lit, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            r2, g2, b2 = colorsys.hls_to_rgb(hue, 1.0 - lit, sat)
            px[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return out


def fit(img, width=None, height=None):
    """Resize preserving aspect ratio, given one dimension."""
    w, h = img.size
    if width is None:
        width = max(1, round(w * height / h))
    else:
        height = max(1, round(h * width / w))
    return img.resize((width, height), Image.LANCZOS)


def square(img, side):
    """Centre the glyph on a transparent square canvas."""
    scaled = fit(img, height=side)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(scaled, ((side - scaled.size[0]) // 2, 0), scaled)
    return canvas


def plated(glyph, side, inset=PLATE_INSET):
    """Draw the glyph on a rounded plate, supersampled then downsampled once."""
    big = side * SUPERSAMPLE
    canvas = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        [0, 0, big - 1, big - 1],
        radius=int(big * PLATE_RADIUS),
        fill=PLATE_BG + (255,),
    )
    inner = fit(glyph, height=int(big * (1 - 2 * inset)))
    canvas.paste(inner, ((big - inner.size[0]) // 2, (big - inner.size[1]) // 2), inner)
    return canvas.resize((side, side), Image.LANCZOS)


def save(img, name, quantize=True):
    """Write a PNG, palettised unless the image is too small to benefit.

    The artwork is soft-edged and full of gradients, so 32-bit PNG is expensive:
    the wordmark costs 175 KB flat and 35 KB palettised, with no difference
    visible at the sizes it actually renders. FASTOCTREE keeps the alpha channel,
    which matters — the marks are transparent and sit on coloured chips.
    """
    path = os.path.join(OUT_DIR, name)
    out = img
    if quantize and img.size[0] * img.size[1] > 64 * 64:
        out = img.quantize(colors=256, method=Image.FASTOCTREE)
    out.save(path, optimize=True)
    kb = os.path.getsize(path) / 1024
    print(f'  {name:<26} {img.size[0]:>4}x{img.size[1]:<4} {kb:6.1f} KB')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    source = Image.open(SOURCE).convert('RGBA')
    wordmark = trimmed(source)
    print(f'source {source.size[0]}x{source.size[1]} -> trimmed '
          f'{wordmark.size[0]}x{wordmark.size[1]}\n')

    wordmark_light = lightened(wordmark)
    glyph_width = leading_glyph_width(wordmark)
    print(f'leading S glyph ends at x={glyph_width}\n')
    glyph = wordmark.crop((0, 0, glyph_width, wordmark.size[1]))
    glyph_light = lightened(glyph)

    # 640px covers the widest on-screen use (~200px on the login card) at 3x.
    print('wordmarks')
    sized_wordmark = fit(wordmark, width=640)
    save(sized_wordmark, 'wordmark.png')
    save(fit(wordmark_light, width=640), 'wordmark-light.png')

    # Transparent, no plate: these sit inside the app's own indigo chip, and a
    # navy plate would vanish against the navy sidebar.
    print('\nin-app marks')
    save(square(glyph, 192), 'mark.png')
    save(square(glyph_light, 192), 'mark-light.png')

    # Plated, because these land on browser and OS chrome we do not control.
    print('\nicons')
    for size in (16, 32, 48):
        save(plated(glyph_light, size), f'favicon-{size}.png')
    save(plated(glyph_light, 180), 'apple-touch-icon.png')
    save(plated(glyph_light, 192), 'icon-192.png')
    save(plated(glyph_light, 512), 'icon-512.png')
    save(plated(glyph_light, 512, inset=MASKABLE_INSET), 'icon-maskable-512.png')

    metrics = {
        '_comment': 'Generated by scripts/build-brand-assets.py — do not edit.',
        'wordmark': {'width': sized_wordmark.size[0], 'height': sized_wordmark.size[1]},
        'mark': {'width': 192, 'height': 192},
    }
    with open(METRICS, 'w') as fh:
        json.dump(metrics, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'\nwrote {os.path.relpath(METRICS, ROOT)} '
          f'(wordmark {sized_wordmark.size[0]}x{sized_wordmark.size[1]})')

    total = sum(
        os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR)
    )
    print(f'\ntotal {total / 1024:.1f} KB in client/public/brand/')


if __name__ == '__main__':
    main()
