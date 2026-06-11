# IN-N-OUT 3D · Nutrition Lab

An interactive **3D In-N-Out nutrition calculator**. Build your order on a
virtual tray — every burger assembles cinematically: the ingredients hover
exploded in mid-air, then fall and stack with impact dust, sizzling steam and
camera shake. Every modification (extra patty, no onion, protein style,
animal style…) re-choreographs the burger in real time while the nutrition
panel keeps score.

![stack](https://img.shields.io/badge/three.js-r160-049EF4) ![models](https://img.shields.io/badge/models-authored_in_Blender-F5792A)

## Features

- 🍔 **Full 3D tray scene** — burgers, fries, drinks, shakes and à-la-carte
  sides all rendered as 3D food on an In-N-Out red tray.
- 🎬 **Cinematic assembly** — ingredients spawn separated, drop one by one,
  squash on impact, kick up dust, steam off the patties and shake the camera.
- 🛠 **Every mod is visual** — extra patty/cheese lift the stack and drop the
  new layer in; removed ingredients eject off the burger; protein style swaps
  the bun for a lettuce wrap; fries cook level tints the fries; shake flavors
  tint the cup band.
- 🔢 **Accurate nutrition** — same component math as the original calculator;
  base items reproduce official In-N-Out totals (±2, console self-test on load).
- 🖱 **Interactive** — orbit/zoom the scene, click any food on the tray to
  select and customize it. Order persists in `localStorage`.

## Run it

No build step. Serve the folder over HTTP and open it:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## How it's made

- **Models** (`assets/models/*.glb`) are authored procedurally with headless
  Blender (`bpy`) by [`tools/build_models.py`](tools/build_models.py):
  real geometry per ingredient — a cloth-simulated melted cheese drape,
  noise-displaced patties, a ruffled lettuce leaf, scattered sesame seeds —
  with PBR textures generated in numpy/Pillow
  ([`tools/textures.py`](tools/textures.py)). Rebuild with:
  ```sh
  pip install bpy pillow numpy
  python3 tools/build_models.py            # all assets + preview render
  python3 tools/build_models.py patty      # just one asset
  ```
- **Renderer**: vanilla [three.js r160](https://threejs.org) (vendored in
  `vendor/`, no bundler), ACES tone mapping, PCF soft shadows, sprite-based
  smoke/steam, spring-damper layer physics in
  [`js/food.js`](js/food.js).
- **Nutrition data** (`data.json`) is unchanged from the original 2D
  calculator: burger components derived by differencing official In-N-Out
  item nutrition so base burgers close exactly to official totals.

## Moving this to its own repo

This was developed on a branch of the original calculator repo. To give it
its own home:

```sh
# on GitHub: create an empty repo, e.g. <you>/innout-3d, then:
git clone -b claude/3d-burger-nutrition-site-rdeq8f https://github.com/alecswang/innout-calculator innout-3d
cd innout-3d
git remote set-url origin https://github.com/<you>/innout-3d.git
git push -u origin HEAD:main
```

---

Nutrition derived from official In-N-Out figures (in-n-out.com).
Fan project — not affiliated with In-N-Out Burgers.
