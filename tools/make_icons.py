"""Generates the app icons (SVG + PNG) — two white footprints on the Team 8 gradient.
Run: python tools/make_icons.py
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')
STOPS = [(0.0, (15, 47, 134)), (0.36, (22, 80, 208)), (0.70, (10, 159, 224)), (1.0, (18, 201, 144))]

# One foot in local coordinates (pointing up, big toe on the left = right foot):
# a peanut-shaped sole (forefoot + heel ellipses) and five toes hugging the forefoot edge.
SOLES = [(4, -8, 44, 46), (-2, 42, 35, 44)]  # (cx, cy, rx, ry)


def _toes():
    cx, cy, rx, ry = SOLES[0]
    out = []
    for deg, r in [(106, 16), (82, 12), (62, 10.5), (44, 9), (27, 8)]:
        a = math.radians(deg)
        px, py = cx + rx * math.cos(a), cy - ry * math.sin(a)
        nx, ny = math.cos(a) / rx, -math.sin(a) / ry          # ellipse normal
        n = math.hypot(nx, ny)
        out.append((round(px + nx / n * (r + 3.5), 1), round(py + ny / n * (r + 3.5), 1), r))
    return out


TOES = _toes()
FEET = [  # (cx, cy, angle°, mirror)
    (184, 318, -12, True),   # left foot
    (328, 200, 12, False),   # right foot
]


def gradient(size):
    yy, xx = np.mgrid[0:size, 0:size]
    t = (xx + yy) / (2 * (size - 1))
    rgb = np.zeros((size, size, 3))
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        m = (t >= t0) & (t <= t1)
        k = ((t - t0) / (t1 - t0))[m][:, None]
        rgb[m] = np.array(c0) * (1 - k) + np.array(c1) * k
    return Image.fromarray(rgb.astype('uint8'), 'RGB').convert('RGBA')


def feet_layer(size, scale):
    s = size / 512
    layer = Image.new('L', (size, size), 0)
    for cx, cy, ang, mirror in FEET:
        foot = Image.new('L', (size, size), 0)
        d = ImageDraw.Draw(foot)
        fx = lambda x: (256 + (cx - 256) * scale + (-x if mirror else x) * scale) * s
        fy = lambda y: (256 + (cy - 256) * scale + y * scale) * s
        for scx, scy, rx, ry in SOLES:
            d.ellipse([fx(scx) - rx * scale * s, fy(scy) - ry * scale * s, fx(scx) + rx * scale * s, fy(scy) + ry * scale * s], fill=255)
        for tx, ty, r in TOES:
            d.ellipse([fx(tx) - r * scale * s, fy(ty) - r * scale * s, fx(tx) + r * scale * s, fy(ty) + r * scale * s], fill=255)
        center = ((256 + (cx - 256) * scale) * s, (256 + (cy - 256) * scale) * s)
        foot = foot.rotate(-ang, resample=Image.BICUBIC, center=center)
        layer = Image.fromarray(np.maximum(np.array(layer), np.array(foot)))
    return layer


def render(size, *, rounded=True, scale=1.0):
    big = size * 4
    img = gradient(big)
    white = Image.new('RGBA', (big, big), (255, 255, 255, 255))
    img = Image.composite(white, img, feet_layer(big, scale))
    if rounded:
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 116 / 512), fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    parts = []
    for cx, cy, ang, mirror in FEET:
        m = -1 if mirror else 1
        shapes = [f'<ellipse cx="{cx + m * scx}" cy="{cy + scy}" rx="{rx}" ry="{ry}"/>' for scx, scy, rx, ry in SOLES]
        shapes += [f'<circle cx="{cx + m * tx}" cy="{cy + ty}" r="{r}"/>' for tx, ty, r in TOES]
        parts.append(f'<g transform="rotate({ang} {cx} {cy})">{"".join(shapes)}</g>')
    stops = ''.join(f'<stop offset="{t}" stop-color="#{c[0]:02x}{c[1]:02x}{c[2]:02x}"/>' for t, c in STOPS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">{stops}</linearGradient></defs>'
            f'<rect width="512" height="512" rx="116" fill="url(#g)"/><g fill="#fff">{"".join(parts)}</g></svg>\n')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    render(192).save(os.path.join(OUT, 'icon-192.png'))
    render(512).save(os.path.join(OUT, 'icon-512.png'))
    render(512, rounded=False, scale=0.8).save(os.path.join(OUT, 'maskable-512.png'))
    render(180, rounded=False, scale=0.92).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
    with open(os.path.join(OUT, 'icon.svg'), 'w', encoding='utf-8') as f:
        f.write(svg())
    print('Icons written to', OUT)
