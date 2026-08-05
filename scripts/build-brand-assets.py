#!/usr/bin/env python3
"""
Derive every brand asset the client ships from the single source mark.

Source of truth is `assets/image.png` — a 1254x1254 opaque PNG: a solid blue
field carrying the white Bookends Shiftly mark. At ~1.1 MB it is far too heavy to
serve, so nothing references it directly. This script resizes it into
`client/public/brand/`.

Outputs are committed, so running the app needs nothing from here. Re-run it only
when `assets/image.png` itself changes:

    python3 scripts/build-brand-assets.py

Requires Pillow (`pip install Pillow`) — a dev-only dependency.

This replaced a much larger script written for the previous artwork, and the
deletions are the interesting part. That source was a *transparent* PNG of dark
navy lettering laid out horizontally, so the old script had to:

  * trim the transparent margin — there is no alpha channel now;
  * derive a lightness-inverted copy for dark surfaces — the tile carries its own
    background, so one asset reads correctly on the navy sidebar and on a white
    card alike;
  * measure and crop the leading glyph to make an icon — the new source *is* the
    icon, with no wordmark to crop it out of;
  * draw a rounded plate behind that glyph so it survived 16px — the tile is a
    plate already.

The wordmark is now live text in BrandLogo.jsx rather than a bitmap, which is
what lets it read "Bookends Shiftly" when the artwork itself says neither word.
"""

import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'assets', 'image.png')
OUT_DIR = os.path.join(ROOT, 'client', 'public', 'brand')

# BrandLogo.jsx puts these on the <img> as width/height so the box is reserved
# before the bitmap decodes. Emitted rather than hand-copied: a stale constant
# there means a visible reflow on every page load, which nothing would catch.
METRICS = os.path.join(ROOT, 'client', 'src', 'components', 'brand-metrics.json')

# In-app display size. 192 rather than the source's 1254: the mark is never shown
# larger than the sidebar rail, and 1254 is 1.1 MB of nothing.
MARK_SIDE = 192

# Android crops a maskable icon to a circle, so the mark has to sit well inside
# the square or its corners are cut. The padding is the same blue as the field,
# so it is invisible — it just moves the mark inward.
MASKABLE_SCALE = 0.62

RASTER = {
    'favicon-16.png': 16,
    'favicon-32.png': 32,
    'favicon-48.png': 48,
    'icon-192.png': 192,
    'icon-512.png': 512,
    'apple-touch-icon.png': 180,
    'mark.png': MARK_SIDE,
}


def field_colour(img):
    """
    The tile's background, read from a corner rather than hardcoded.

    Sampling means a re-coloured source needs no edit here — and the maskable
    padding has to match it exactly or a seam shows at the crop boundary.
    """
    return img.convert('RGB').getpixel((2, 2))


def resized(img, side):
    """LANCZOS: the mark has hard edges, and a cheaper filter visibly stairsteps
    them at favicon sizes."""
    return img.resize((side, side), Image.LANCZOS)


def maskable(img, side):
    """The mark shrunk inside a full-bleed field, so a circular crop misses it."""
    canvas = Image.new('RGB', (side, side), field_colour(img))
    inner = int(side * MASKABLE_SCALE)
    offset = (side - inner) // 2
    canvas.paste(resized(img, inner), (offset, offset))
    return canvas


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    # No alpha to preserve, so RGB keeps the files small.
    img.convert('RGB').save(path, 'PNG', optimize=True)
    return os.path.getsize(path)


def main():
    if not os.path.exists(SOURCE):
        raise SystemExit(f'Source artwork not found: {SOURCE}')

    os.makedirs(OUT_DIR, exist_ok=True)
    source = Image.open(SOURCE).convert('RGB')

    if source.width != source.height:
        raise SystemExit(
            f'Expected a square source; got {source.width}x{source.height}. '
            'Every output is a square icon, so a non-square source would be '
            'silently distorted.'
        )

    print(f'source  {os.path.relpath(SOURCE, ROOT)}  '
          f'{source.width}x{source.height}  field rgb{field_colour(source)}\n')

    for name, side in sorted(RASTER.items(), key=lambda kv: kv[1]):
        size = save(resized(source, side), name)
        print(f'  {name:24} {side:>4}px  {size / 1024:6.1f} KB')

    size = save(maskable(source, 512), 'icon-maskable-512.png')
    print(f'  {"icon-maskable-512.png":24} {512:>4}px  {size / 1024:6.1f} KB  '
          f'(mark at {int(MASKABLE_SCALE * 100)}% for the circular crop)')

    # Anything left from the previous artwork would still be served and would
    # quietly contradict the new brand.
    for stale in ('wordmark.png', 'wordmark-light.png', 'mark-light.png'):
        path = os.path.join(OUT_DIR, stale)
        if os.path.exists(path):
            os.remove(path)
            print(f'  removed {stale} (from the previous artwork)')

    with open(METRICS, 'w') as fh:
        json.dump({
            '_comment': 'Generated by scripts/build-brand-assets.py — do not edit.',
            'mark': {'width': MARK_SIDE, 'height': MARK_SIDE},
        }, fh, indent=2)
        fh.write('\n')
    print(f'\nwrote {os.path.relpath(METRICS, ROOT)}')


if __name__ == '__main__':
    main()
