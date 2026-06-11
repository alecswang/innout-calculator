"""Procedural PBR texture generation (Pillow + numpy) for the In-N-Out 3D models.

All textures are drawn in "radial UV" space: the mesh helper maps every vertex
to uv = (x/d + .5, y/d + .5), so image center == object center and the image
edge circle == the object rim.
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512


def _grid(size=SIZE):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2
    dx, dy = (x - cx) / cx, (y - cy) / cy
    r = np.sqrt(dx * dx + dy * dy)          # 0 center -> 1 at inscribed rim
    a = np.arctan2(dy, dx)
    return dx, dy, r, a


def fbm(size=SIZE, octaves=5, seed=0, base=4):
    """Multi-octave value noise in [0,1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = base * (2 ** o)
        if n >= size:
            break
        layer = rng.random((n, n)).astype(np.float32)
        img = Image.fromarray((layer * 255).astype(np.uint8)).resize(
            (size, size), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 255.0)
        total += amp
        amp *= 0.55
    return out / max(total, 1e-6)


def _to_img(rgb):
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def _mix(c1, c2, t):
    t = t[..., None]
    return np.asarray(c1, np.float32) * (1 - t) + np.asarray(c2, np.float32) * t


def bun_crust(seed=1):
    """Golden-brown baked crust, darker at the crown center, floury rim."""
    _, _, r, a = _grid()
    n = fbm(seed=seed, octaves=6)
    gold = np.array([208, 134, 58], np.float32)
    deep = np.array([166, 96, 38], np.float32)
    pale = np.array([238, 192, 130], np.float32)
    t = np.clip(1.25 - r * 1.05 + (n - 0.5) * 0.5, 0, 1)   # browner center
    rgb = _mix(pale, gold, t)
    rgb = _mix(rgb, deep, np.clip((n - 0.55) * 3.0, 0, 1) * 0.7)
    # subtle toasted speckle
    spk = fbm(seed=seed + 9, octaves=7, base=16)
    rgb = _mix(rgb, deep * 0.9, np.clip((spk - 0.7) * 4, 0, 1) * 0.5)
    return _to_img(rgb)


def bun_cumb():
    """Pale interior crumb."""
    n = fbm(seed=7, octaves=7, base=12)
    base = np.array([243, 226, 196], np.float32)
    dark = np.array([222, 198, 160], np.float32)
    return _to_img(_mix(base, dark, np.clip((n - 0.45) * 2.2, 0, 1)))


def patty_tex(seed=3):
    """Seared beef: dark crust, charred blotches, juicy highlights."""
    _, _, r, a = _grid()
    n = fbm(seed=seed, octaves=7, base=6)
    n2 = fbm(seed=seed + 4, octaves=7, base=24)
    brown = np.array([128, 78, 46], np.float32)
    dark = np.array([84, 50, 30], np.float32)
    char = np.array([52, 32, 20], np.float32)
    juicy = np.array([172, 104, 58], np.float32)
    rgb = _mix(brown, dark, n)
    rgb = _mix(rgb, char, np.clip((n2 - 0.6) * 3.2, 0, 1) * 0.85)
    rgb = _mix(rgb, juicy, np.clip((n - 0.68) * 4.0, 0, 1) * 0.5)
    # grill sear arcs
    sear = (np.sin(a * 2 + n * 6 + r * 9) > 0.86) & (r < 0.95)
    rgb = _mix(rgb, char, sear.astype(np.float32) * 0.45)
    return _to_img(rgb)


def tomato_slice():
    """Cross-section: red skin rim, paler pericarp, seed wedges."""
    size = SIZE
    dx, dy, r, a = _grid()
    n = fbm(seed=11, octaves=5)
    skin = np.array([188, 32, 24], np.float32)
    flesh = np.array([228, 78, 56], np.float32)
    inner = np.array([244, 120, 92], np.float32)
    gel = np.array([236, 150, 110], np.float32)
    core = np.array([248, 196, 150], np.float32)

    rgb = _mix(flesh, inner, np.clip(1.2 - r * 1.3, 0, 1))
    # 6 seed-cavity wedges
    wedge = 0.5 + 0.5 * np.cos(a * 6 + 0.7)
    cav = np.clip((wedge - 0.45) * 2.2, 0, 1) * np.clip(1 - np.abs(r - 0.55) * 3.2, 0, 1)
    rgb = _mix(rgb, gel, cav)
    # seeds: bright flecks inside cavities
    seeds = (fbm(seed=23, octaves=7, base=32) > 0.74) & (cav > 0.4)
    rgb = _mix(rgb, core + 10, seeds.astype(np.float32) * 0.9)
    # central pith
    rgb = _mix(rgb, core, np.clip(1 - r * 6.0, 0, 1))
    rgb = _mix(rgb, core * 0.97, np.clip(1 - np.abs(r - 0.18) * 9, 0, 1) * 0.5)
    # skin rim (outer 6%)
    rgb = _mix(rgb, skin, np.clip((r - 0.93) * 18, 0, 1))
    rgb += (n[..., None] - 0.5) * 14
    return _to_img(rgb)


def pickle_slice():
    """Dill chip: dark skin rim, pale-green interior, radial seed pattern."""
    _, _, r, a = _grid()
    n = fbm(seed=31, octaves=6)
    skin = np.array([62, 92, 38], np.float32)
    flesh = np.array([168, 188, 110], np.float32)
    inner = np.array([196, 208, 132], np.float32)
    rgb = _mix(flesh, inner, np.clip(1 - r * 1.1, 0, 1))
    spokes = 0.5 + 0.5 * np.cos(a * 9 + n * 3)
    rgb = _mix(rgb, flesh * 0.82, np.clip((spokes - 0.55) * 2, 0, 1) *
               np.clip(1 - np.abs(r - 0.45) * 2.4, 0, 1) * 0.7)
    seeds = (fbm(seed=37, octaves=7, base=24) > 0.78) & (r < 0.5)
    rgb = _mix(rgb, np.array([214, 220, 160], np.float32), seeds.astype(np.float32))
    rgb = _mix(rgb, skin, np.clip((r - 0.88) * 12, 0, 1))
    rgb += (n[..., None] - 0.5) * 12
    return _to_img(rgb)


def lettuce_tex():
    """Crisp iceberg: pale ribbed center -> green ruffled edge."""
    _, _, r, a = _grid()
    n = fbm(seed=41, octaves=6)
    pale = np.array([214, 232, 168], np.float32)
    green = np.array([124, 178, 70], np.float32)
    deep = np.array([86, 142, 52], np.float32)
    rgb = _mix(pale, green, np.clip(r * 1.25 - 0.1 + (n - 0.5) * 0.4, 0, 1))
    veins = 0.5 + 0.5 * np.cos(a * 14 + n * 8 + r * 4)
    rgb = _mix(rgb, deep, np.clip((veins - 0.72) * 3, 0, 1) * 0.35 * np.clip(r, 0, 1))
    rgb = _mix(rgb, pale, np.clip(1 - r * 3.2, 0, 1) * 0.7)
    return _to_img(rgb)


def onion_slice():
    """Raw onion rings: translucent white with faint ring banding."""
    _, _, r, a = _grid()
    n = fbm(seed=51, octaves=5)
    white = np.array([246, 242, 232], np.float32)
    band = np.array([222, 214, 196], np.float32)
    rings = 0.5 + 0.5 * np.cos(r * 40 + n * 2)
    rgb = _mix(white, band, np.clip((rings - 0.4) * 1.4, 0, 1) * 0.8)
    return _to_img(rgb)


def fry_tex():
    n = fbm(seed=61, octaves=6, base=8)
    gold = np.array([232, 178, 92], np.float32)
    toast = np.array([198, 134, 56], np.float32)
    rgb = _mix(gold, toast, np.clip((n - 0.4) * 2.0, 0, 1))
    return _to_img(rgb)


def paper_boat():
    """White food-service paper with the faintest warm fiber noise."""
    n = fbm(seed=71, octaves=6, base=10)
    white = np.array([250, 248, 242], np.float32)
    warm = np.array([238, 232, 220], np.float32)
    return _to_img(_mix(white, warm, np.clip((n - 0.4) * 1.6, 0, 1)))


def spread_tex():
    """Thousand-island spread: pink-orange with relish flecks."""
    n = fbm(seed=81, octaves=6, base=10)
    base = np.array([238, 168, 120], np.float32)
    deep = np.array([224, 142, 96], np.float32)
    rgb = _mix(base, deep, n)
    flecks = fbm(seed=83, octaves=7, base=40)
    rgb = _mix(rgb, np.array([150, 110, 60], np.float32),
               (flecks > 0.78).astype(np.float32) * 0.8)
    rgb = _mix(rgb, np.array([120, 150, 70], np.float32),
               (flecks < 0.2).astype(np.float32) * 0.5)
    return _to_img(rgb)


def grilled_onion_tex():
    n = fbm(seed=91, octaves=6, base=8)
    car = np.array([196, 134, 64], np.float32)
    deep = np.array([142, 84, 36], np.float32)
    return _to_img(_mix(car, deep, np.clip((n - 0.35) * 1.8, 0, 1)))


def write_all(out_dir):
    import os
    os.makedirs(out_dir, exist_ok=True)
    jobs = {
        "bun_crust.png": bun_crust,
        "bun_crumb.png": bun_cumb,
        "patty.png": patty_tex,
        "tomato.png": tomato_slice,
        "pickle.png": pickle_slice,
        "lettuce.png": lettuce_tex,
        "onion.png": onion_slice,
        "fry.png": fry_tex,
        "paper.png": paper_boat,
        "spread.png": spread_tex,
        "grilled_onion.png": grilled_onion_tex,
    }
    paths = {}
    for name, fn in jobs.items():
        p = os.path.join(out_dir, name)
        fn().save(p)
        paths[name.split(".")[0]] = p
    return paths


if __name__ == "__main__":
    write_all("/tmp/innout_tex")
    print("textures written to /tmp/innout_tex")
