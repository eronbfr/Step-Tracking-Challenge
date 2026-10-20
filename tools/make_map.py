"""Builds the world-map assets of the Team page (assets/map/) from public-domain sources.

    python tools/make_map.py <download-cache-dir>

Downloads (once, into the cache dir) and converts:
  • NASA Blue Marble Next Generation, Dec 2004, topography + bathymetry (day side)
      https://visibleearth.nasa.gov/images/73909
  • NASA Black Marble 2016, 3 km (city lights, night side)
      https://visibleearth.nasa.gov/images/144898
  • Natural Earth 1:10m / 1:50m countries, land borders and states (vector overlay)
      https://www.naturalearthdata.com

Output (all in plate carrée, i.e. x = longitude, y = latitude, so the app places anything with simple maths):
  world-day.webp / world-night.webp   2048×1024, whole world
  latam-day.webp  / latam-night.webp  2048² / 1024², the Americas window in INSET (sharp at team zoom)
  geo.json                            borders, team countries, states and home-city areas (quantised lon/lat)
"""
import json
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'map')

NASA = 'https://eoimages.gsfc.nasa.gov/images/imagerecords'
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'
SOURCES = {
    'bm21600.jpg': f'{NASA}/73000/73909/world.topo.bathy.200412.3x21600x10800.jpg',
    'bm5400.jpg': f'{NASA}/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg',
    'night3km.jpg': f'{NASA}/144000/144898/BlackMarble_2016_3km.jpg',
    'ne10m_admin0.geojson': f'{NE}/ne_10m_admin_0_countries.geojson',
    'ne50m_admin0.geojson': f'{NE}/ne_50m_admin_0_countries.geojson',
    'ne50m_borders.geojson': f'{NE}/ne_50m_admin_0_boundary_lines_land.geojson',
    'ne10m_admin1.geojson': f'{NE}/ne_10m_admin_1_states_provinces.geojson',
    'ne10m_admin1_lines.geojson': f'{NE}/ne_10m_admin_1_states_provinces_lines.geojson',
}

# Sharp window over the team's part of the world: [west, east, north, south] in degrees. Keep in sync with js/worldmap.js.
INSET = (-125, -25, 38, -58)
TEAM = {'BR': 'BRA', 'MX': 'MEX', 'CO': 'COL', 'UY': 'URY'}
# Home-city areas highlighted under the pins (ids match metrics.js CITY / config.js ROSTER.city).
PLACES = {
    'sp': lambda p: p['iso_3166_2'] == 'BR-SP',
    'rio': lambda p: p['iso_3166_2'] == 'BR-RJ',
    'cdmx': lambda p: p['iso_3166_2'] in ('MX-DIF', 'MX-CMX'),
    'bog': lambda p: p['adm0_a3'] == 'COL' and p['name'] in ('Bogota', 'Bogotá', 'Bogotá D.C.'),
    'mvd': lambda p: p['iso_3166_2'] == 'UY-MO',
}


def fetch(cache, name):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        print('downloading', SOURCES[name])
        urllib.request.urlretrieve(SOURCES[name], path)
    return path


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ───────────── Imagery ─────────────
def save_webp(img, name, quality):
    path = os.path.join(OUT, name)
    img.save(path, 'WEBP', quality=quality, method=6)
    print(f'{name}: {img.size[0]}×{img.size[1]}, {os.path.getsize(path) // 1024} KB')


def crop_box(img):
    """Pixel box of INSET in an equirectangular image."""
    w, h = img.size
    west, east, north, south = INSET
    return (round((west + 180) / 360 * w), round((90 - north) / 180 * h), round((east + 180) / 360 * w), round((90 - south) / 180 * h))


def imagery(cache):
    Image.MAX_IMAGE_PIXELS = None  # the 21600×10800 source is a known, trusted size
    day = Image.open(fetch(cache, 'bm5400.jpg')).convert('RGB')
    save_webp(day.resize((2048, 1024), Image.LANCZOS), 'world-day.webp', 82)

    big = Image.open(fetch(cache, 'bm21600.jpg'))
    big.draft('RGB', (big.size[0] // 2, big.size[1] // 2))  # decode at half size (30 px/°) — still 3× the output
    big = big.convert('RGB')
    save_webp(big.crop(crop_box(big)).resize((2048, 2048), Image.LANCZOS), 'latam-day.webp', 80)
    del big

    night = Image.open(fetch(cache, 'night3km.jpg')).convert('RGB')
    save_webp(night.resize((2048, 1024), Image.LANCZOS), 'world-night.webp', 80)
    save_webp(night.crop(crop_box(night)).resize((1024, 1024), Image.LANCZOS), 'latam-night.webp', 80)


# ───────────── Vectors ─────────────
def simplify(pts, tol):
    """Douglas–Peucker (iterative) on [(lon, lat)…]."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    t2 = tol * tol
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        d2 = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if d2 == 0:
                dist = (px - x1) ** 2 + (py - y1) ** 2
            else:
                u = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / d2))
                dist = (px - x1 - u * dx) ** 2 + (py - y1 - u * dy) ** 2
            if dist > best:
                best, idx = dist, i
        if best > t2:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def lines_of(geom):
    """Every ring / line string of a GeoJSON geometry as a list of (lon, lat)."""
    t, c = geom['type'], geom['coordinates']
    if t == 'Polygon':
        return c
    if t == 'MultiPolygon':
        return [ring for poly in c for ring in poly]
    if t == 'LineString':
        return [c]
    if t == 'MultiLineString':
        return c
    return []


def encode(lines, tol, q, min_size=0.0, closed=False):
    """Simplify, quantise (q steps per degree) and delta-encode: [[x0, y0, dx1, dy1, …], …]."""
    out = []
    for line in lines:
        pts = [(float(x), float(y)) for x, y, *_ in line]
        if min_size:
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            if max(xs) - min(xs) < min_size and max(ys) - min(ys) < min_size:
                continue
        pts = simplify(pts, tol)
        qp = []
        for x, y in pts:
            p = (round(x * q), round(y * q))
            if not qp or p != qp[-1]:
                qp.append(p)
        if len(qp) < (4 if closed else 2):
            continue
        flat = [qp[0][0], qp[0][1]]
        for (x0, y0), (x1, y1) in zip(qp, qp[1:]):
            flat += [x1 - x0, y1 - y0]
        out.append(flat)
    return out


def vectors(cache):
    a0_10 = load_json(fetch(cache, 'ne10m_admin0.geojson'))
    a0_50 = load_json(fetch(cache, 'ne50m_admin0.geojson'))
    borders = load_json(fetch(cache, 'ne50m_borders.geojson'))
    a1 = load_json(fetch(cache, 'ne10m_admin1.geojson'))
    a1_lines = load_json(fetch(cache, 'ne10m_admin1_lines.geojson'))

    geo = {'q': 100, 'inset': list(INSET)}
    # Land borders of the whole world (no coastlines: the imagery already shows them).
    geo['borders'] = encode([l for f in borders['features'] for l in lines_of(f['geometry'])], 0.06, 100)

    countries, labels = {}, {}
    for f in a0_10['features']:
        p = f['properties']
        cc = next((k for k, v in TEAM.items() if p['ADM0_A3'] == v), None)
        if cc:
            countries[cc] = encode(lines_of(f['geometry']), 0.025, 100, min_size=0.12, closed=True)
    for f in a0_50['features']:
        p = f['properties']
        cc = next((k for k, v in TEAM.items() if p['ADM0_A3'] == v), None)
        if cc:
            labels[cc] = [round(p['LABEL_X'], 2), round(p['LABEL_Y'], 2)]
    geo['countries'], geo['labels'] = countries, labels

    states = {}
    for f in a1_lines['features']:
        p = f['properties']
        cc = next((k for k, v in TEAM.items() if p.get('ADM0_A3') == v), None)
        if cc:
            states.setdefault(cc, []).extend(encode(lines_of(f['geometry']), 0.025, 100))
    geo['states'] = states

    places = {}
    for f in a1['features']:
        p = f['properties']
        for pid, match in PLACES.items():
            if match(p):
                places[pid] = encode(lines_of(f['geometry']), 0.008, 100, min_size=0.02, closed=True)
    missing = set(PLACES) - set(places)
    if missing:
        raise SystemExit(f'home areas not found in Natural Earth: {sorted(missing)}')
    geo['places'] = places

    path = os.path.join(OUT, 'geo.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(geo, f, separators=(',', ':'))
    print(f'geo.json: {os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    cache = os.path.abspath(sys.argv[1])
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    vectors(cache)
    imagery(cache)
