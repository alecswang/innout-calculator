"""Author all 3D assets for the In-N-Out 3D nutrition site with headless Blender (bpy).

Builds every burger ingredient / tray item as real geometry — including a
cloth-simulated melted cheese drape — assigns PBR materials with procedurally
generated textures (tools/textures.py), and exports one GLB per asset into
assets/models/.

Run:  python3 tools/build_models.py [asset ...] [--preview]
"""

import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "models")
TEXDIR = "/tmp/innout_tex"

sys.path.insert(0, HERE)
import textures  # noqa: E402

random.seed(8)

# ---------------------------------------------------------------- scene utils


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.engine = "CYCLES"


def clear_objects():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials):
        for d in list(block):
            if d.users == 0:
                block.remove(d)


def active():
    return bpy.context.active_object


def smooth(obj, on=True):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth() if on else bpy.ops.object.shade_flat()


def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def join(objs, name):
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = active()
    obj.name = name
    return obj


def displace(obj, strength=0.02, scale=0.35, seed=0):
    tex = bpy.data.textures.new(f"clouds{seed}", "CLOUDS")
    tex.noise_scale = scale
    m = obj.modifiers.new("disp", "DISPLACE")
    m.texture = tex
    m.strength = strength
    m.texture_coords = "OBJECT"


def bevel(obj, width=0.03, segments=3):
    m = obj.modifiers.new("bev", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(40)


def subsurf(obj, levels=1):
    m = obj.modifiers.new("sub", "SUBSURF")
    m.levels = m.render_levels = levels


def solidify(obj, t=0.02):
    m = obj.modifiers.new("sol", "SOLIDIFY")
    m.thickness = t
    m.offset = -1


# -------------------------------------------------------------------- UV/mats


def radial_uv(obj, diameter=None, center=(0, 0)):
    """uv = vertex XY mapped so the object's XY extent fills the image."""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    if diameter is None:
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        diameter = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv[loop.index].uv = (
            (co.x - center[0]) / diameter + 0.5,
            (co.y - center[1]) / diameter + 0.5,
        )


def smart_uv(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")


_mat_cache = {}


def material(name, color=(1, 1, 1, 1), tex=None, rough=0.5, metal=0.0,
             alpha=1.0, double=False):
    key = name
    if key in _mat_cache:
        return _mat_cache[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex:
        img = bpy.data.images.load(os.path.join(TEXDIR, tex + ".png"))
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = color
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    m.use_backface_culling = not double
    _mat_cache[key] = m
    return m


def set_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def assign_by_normal(obj, mat, nz_test):
    """Append `mat` as slot 1 and assign it to faces whose normal passes test."""
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        if nz_test(poly.normal.z):
            poly.material_index = len(obj.data.materials) - 1


# ------------------------------------------------------------------- exports


def export(obj_or_objs, name):
    objs = obj_or_objs if isinstance(obj_or_objs, list) else [obj_or_objs]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_image_format="AUTO",
    )
    size = os.path.getsize(path) // 1024
    zs = []
    for o in objs:
        for corner in o.bound_box:
            zs.append((o.matrix_world @ Vector(corner)).z)
    print(f"  exported {name}.glb  ({size} KB, z {min(zs):.3f}..{max(zs):.3f})")


# ============================================================= asset builders

BUILDERS = {}


def builder(fn):
    BUILDERS[fn.__name__] = fn
    return fn


def perturb_verts(obj, fn):
    me = obj.data
    for v in me.vertices:
        v.co = fn(v.co)


@builder
def bun_top():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1)
    dome = active()
    dome.scale = (0.52, 0.52, 0.34)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=(0, 0, 0.0), plane_no=(0, 0, 1),
                        clear_inner=True, use_fill=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    displace(dome, 0.006, 0.5, seed=1)
    smooth(dome)
    radial_uv(dome, 1.04)
    set_mat(dome, material("bun_crust", tex="bun_crust", rough=0.42))
    assign_by_normal(dome, material("bun_crumb", tex="bun_crumb", rough=0.8),
                     lambda nz: nz < -0.85)

    # sesame seeds scattered over the dome
    seeds = []
    rnd = random.Random(4)
    for _ in range(60):
        ang = rnd.uniform(0, 2 * math.pi)
        rad = 0.52 * math.sqrt(rnd.uniform(0.02, 0.92))
        nx, ny = math.cos(ang) * rad, math.sin(ang) * rad
        t = (rad / 0.52)
        nz = 0.34 * math.sqrt(max(1 - t * t, 0.0))
        if nz < 0.05:
            continue
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
        s = active()
        s.scale = (0.016, 0.011, 0.007)
        normal = Vector((nx / 0.52 ** 2, ny / 0.52 ** 2, nz / 0.34 ** 2)).normalized()
        s.rotation_mode = "QUATERNION"
        q = normal.to_track_quat("Z", "Y")
        s.rotation_quaternion = q @ Vector((0, 0, 1)).rotation_difference(Vector((0, 0, 1)))
        s.rotation_quaternion = q
        s.location = (nx, ny, nz - 0.002)
        smooth(s)
        set_mat(s, material("sesame", (0.93, 0.86, 0.68, 1), rough=0.5))
        seeds.append(s)
    obj = join([dome] + seeds, "bun_top")
    export(obj, "bun_top")


@builder
def bun_heel():
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.5, depth=0.14,
                                        location=(0, 0, 0.07))
    obj = active()
    bevel(obj, 0.045, 4)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, 1.0)
    set_mat(obj, material("bun_crust", tex="bun_crust", rough=0.42))
    assign_by_normal(obj, material("bun_crumb", tex="bun_crumb", rough=0.8),
                     lambda nz: nz > 0.85)
    obj.name = "bun_heel"
    export(obj, "bun_heel")


@builder
def patty():
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.53, depth=0.15,
                                        location=(0, 0, 0.075))
    obj = active()
    bevel(obj, 0.05, 3)
    subsurf(obj, 1)
    displace(obj, 0.022, 0.18, seed=3)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, 1.06)
    set_mat(obj, material("patty", tex="patty", rough=0.55))
    obj.name = "patty"
    export(obj, "patty")


@builder
def cheese():
    """Cloth-simulated slice draped over a patty-shaped collider."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.51, depth=0.16,
                                        location=(0, 0, -0.08))
    col = active()
    col.modifiers.new("col", "COLLISION")

    bpy.ops.mesh.primitive_plane_add(size=0.96, location=(0, 0, 0.06))
    sheet = active()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=30)
    bpy.ops.object.mode_set(mode="OBJECT")
    cloth = sheet.modifiers.new("cloth", "CLOTH")
    cloth.settings.quality = 8
    cloth.settings.mass = 0.2
    cloth.settings.bending_stiffness = 8.0
    cloth.collision_settings.distance_min = 0.004
    cloth.collision_settings.collision_quality = 4
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, 32
    for f in range(1, 33):
        scene.frame_set(f)
    bpy.context.view_layer.objects.active = sheet
    bpy.ops.object.modifier_apply(modifier="cloth")
    solidify(sheet, 0.022)
    subsurf(sheet, 1)
    apply_mods(sheet)
    smooth(sheet)
    # drop the collider, keep the drape; rebase so the flat top sits at z=0
    bpy.data.objects.remove(col)
    zmax = max(v.co.z for v in sheet.data.vertices)
    for v in sheet.data.vertices:
        v.co.z -= zmax - 0.012
    radial_uv(sheet, 1.0)
    set_mat(sheet, material("cheese", (0.95, 0.62, 0.10, 1), rough=0.34, double=True))
    sheet.name = "cheese"
    export(sheet, "cheese")


@builder
def lettuce():
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=0.56,
                                      fill_type="TRIFAN")
    obj = active()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=5)
    bpy.ops.object.mode_set(mode="OBJECT")

    def ruffle(co):
        r = math.hypot(co.x, co.y)
        a = math.atan2(co.y, co.x)
        amp = 0.012 + (r / 0.56) ** 2.2 * 0.075
        z = amp * math.sin(a * 7 + r * 6)
        z += 0.5 * amp * math.sin(a * 13 + 2.0)
        z += noise.noise(Vector((co.x * 3, co.y * 3, 0))) * 0.02
        return Vector((co.x, co.y, co.z + z + 0.03))

    perturb_verts(obj, ruffle)
    solidify(obj, 0.015)
    subsurf(obj, 1)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, 1.12)
    set_mat(obj, material("lettuce", tex="lettuce", rough=0.5, double=True))
    obj.name = "lettuce"
    export(obj, "lettuce")


@builder
def wrap():
    """Protein-style lettuce cup."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1)
    obj = active()
    obj.scale = (0.60, 0.60, 0.42)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=(0, 0, 0.16), plane_no=(0, 0, 1),
                        clear_outer=True, use_fill=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    def shape(co):
        z = max(co.z, -0.30)  # flatten base
        r = math.hypot(co.x, co.y)
        a = math.atan2(co.y, co.x)
        lip = 0.05 * math.sin(a * 6 + 1) + 0.03 * math.sin(a * 11)
        k = max((z + 0.05) / 0.25, 0)  # only the rim ruffles
        return Vector((co.x * (1 + lip * k * 0.4),
                       co.y * (1 + lip * k * 0.4),
                       z + lip * k + 0.30))

    perturb_verts(obj, shape)
    solidify(obj, 0.02)
    subsurf(obj, 1)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, 1.3)
    set_mat(obj, material("lettuce", tex="lettuce", rough=0.5, double=True))
    obj.name = "wrap"
    export(obj, "wrap")


@builder
def tomato():
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.47, depth=0.07,
                                        location=(0, 0, 0.035))
    obj = active()
    bevel(obj, 0.012, 2)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, 0.94)
    set_mat(obj, material("tomato", tex="tomato", rough=0.35))
    obj.name = "tomato"
    export(obj, "tomato")


@builder
def onion():
    rings = []
    for i, r in enumerate((0.40, 0.28, 0.165)):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.024,
                                         major_segments=48, minor_segments=12)
        t = active()
        t.scale = (1, 1, 0.75)
        bpy.ops.object.transform_apply(scale=True)
        t.location = (0, 0, 0.02)
        smooth(t)
        rings.append(t)
    obj = join(rings, "onion")
    bpy.ops.object.transform_apply(location=True)
    radial_uv(obj, 0.86)
    set_mat(obj, material("onion", tex="onion", rough=0.3, alpha=0.92))
    export(obj, "onion")


@builder
def grilled_onion():
    rnd = random.Random(12)
    bits = []
    for _ in range(16):
        bpy.ops.mesh.primitive_cube_add(size=1)
        b = active()
        b.scale = (rnd.uniform(0.07, 0.11), rnd.uniform(0.02, 0.03), 0.011)
        ang = rnd.uniform(0, 2 * math.pi)
        rad = 0.40 * math.sqrt(rnd.random())
        b.location = (math.cos(ang) * rad, math.sin(ang) * rad,
                      0.012 + rnd.uniform(0, 0.012))
        b.rotation_euler = (rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25),
                            rnd.uniform(0, math.pi))
        bevel(b, 0.006, 2)
        apply_mods(b)
        smooth(b)
        bits.append(b)
    obj = join(bits, "grilled_onion")
    radial_uv(obj, 0.9)
    set_mat(obj, material("grilled_onion", tex="grilled_onion", rough=0.38))
    export(obj, "grilled_onion")


@builder
def pickle():
    chips = []
    rnd = random.Random(5)
    for i in range(3):
        ang = i * 2 * math.pi / 3 + 0.5
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.17,
                                            depth=0.055, location=(0, 0, 0.028))
        c = active()
        bevel(c, 0.012, 2)
        displace(c, 0.006, 0.1, seed=20 + i)
        apply_mods(c)
        smooth(c)
        radial_uv(c, 0.34)
        c.location = (math.cos(ang) * 0.27, math.sin(ang) * 0.27, 0)
        c.rotation_euler = (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1),
                            rnd.uniform(0, 3))
        chips.append(c)
    obj = join(chips, "pickle")
    set_mat(obj, material("pickle", tex="pickle", rough=0.3))
    export(obj, "pickle")


def _sauce_disc(name, radius, depth, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth,
                                        location=(0, 0, depth / 2))
    obj = active()

    def wavy(co):
        r = math.hypot(co.x, co.y)
        if r > radius * 0.8:
            a = math.atan2(co.y, co.x)
            k = 1 + 0.06 * math.sin(a * 5 + 1.2) + 0.04 * math.sin(a * 9)
            return Vector((co.x * k, co.y * k, co.z))
        return co

    perturb_verts(obj, wavy)
    subsurf(obj, 1)
    displace(obj, 0.008, 0.2, seed=31)
    apply_mods(obj)
    smooth(obj)
    radial_uv(obj, radius * 2.2)
    set_mat(obj, mat)
    obj.name = name
    export(obj, name)


@builder
def spread():
    _sauce_disc("spread", 0.50, 0.05,
                material("spread", tex="spread", rough=0.28))


@builder
def ketchup():
    _sauce_disc("ketchup", 0.42, 0.032,
                material("ketchup", (0.55, 0.04, 0.05, 1), rough=0.12))


@builder
def mustard():
    _sauce_disc("mustard", 0.40, 0.026,
                material("mustard", (0.78, 0.55, 0.07, 1), rough=0.3))


@builder
def chiles():
    rnd = random.Random(9)
    bits = []
    for _ in range(9):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.045, minor_radius=0.017,
                                         major_segments=24, minor_segments=10)
        b = active()
        b.scale = (1, 1, 0.8)
        ang = rnd.uniform(0, 2 * math.pi)
        rad = 0.33 * math.sqrt(rnd.random())
        b.location = (math.cos(ang) * rad, math.sin(ang) * rad, 0.018)
        b.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4),
                            rnd.uniform(0, 3))
        smooth(b)
        bits.append(b)
    obj = join(bits, "chiles")
    bpy.ops.object.transform_apply(scale=True)
    radial_uv(obj, 0.75)
    set_mat(obj, material("chiles", (0.62, 0.62, 0.20, 1), rough=0.22))
    export(obj, "chiles")


def _paper_boat(name, sx, sy, sz):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
    obj = active()
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True, location=False)
    # taper the bottom, delete the top face
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(obj.data)
    for f in list(bm.faces):
        if f.normal.z > 0.9:
            bm.faces.remove(f)
    for v in bm.verts:
        if v.co.z < sz * 0.2:
            v.co.x *= 0.68
            v.co.y *= 0.72
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    solidify(obj, 0.012)
    bevel(obj, 0.01, 2)
    apply_mods(obj)
    smart_uv(obj)
    set_mat(obj, material("paper", tex="paper", rough=0.65, double=True))
    obj.name = name
    return obj


@builder
def fries():
    boat = _paper_boat("boat", 1.16, 0.78, 0.30)
    rnd = random.Random(2)
    sticks = []
    for _ in range(42):
        bpy.ops.mesh.primitive_cube_add(size=1)
        f = active()
        ln = rnd.uniform(0.42, 0.72)
        f.scale = (0.068, 0.068, ln)
        f.location = (rnd.uniform(-0.42, 0.42), rnd.uniform(-0.24, 0.24),
                      0.16 + ln * 0.45)
        f.rotation_euler = (rnd.uniform(-0.45, 0.45), rnd.uniform(-0.45, 0.45),
                            rnd.uniform(0, math.pi))
        bevel(f, 0.014, 2)
        apply_mods(f)
        sticks.append(f)
    pile = join(sticks, "fries_pile")
    smart_uv(pile)
    set_mat(pile, material("fry", tex="fry", rough=0.45))
    obj = join([boat, pile], "fries")
    export(obj, "fries")


@builder
def side_boat():
    obj = _paper_boat("side_boat", 0.62, 0.46, 0.17)
    export(obj, "side_boat")


def _cup(name, r1, r2, h, band_z, band_name="band",
         lid="dome", straw_h=0.5):
    parts = []
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=r1, radius2=r2,
                                    depth=h, location=(0, 0, h / 2))
    cup = active()
    smooth(cup)
    set_mat(cup, material("cup_white", (0.96, 0.96, 0.95, 1), rough=0.32))
    parts.append(cup)

    for bz, br in band_z:
        bpy.ops.mesh.primitive_torus_add(major_radius=br, minor_radius=0.02,
                                         major_segments=48, minor_segments=8,
                                         location=(0, 0, bz))
        b = active()
        b.scale = (1, 1, 2.2)
        bpy.ops.object.transform_apply(scale=True)
        smooth(b)
        b.name = band_name
        set_mat(b, material("inout_red", (0.62, 0.02, 0.07, 1), rough=0.4))
        parts.append(b)

    if lid == "dome":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r2 * 1.06)
        d = active()
        d.scale = (1, 1, 0.42)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.bisect(plane_co=(0, 0, 0), plane_no=(0, 0, 1),
                            clear_inner=True, use_fill=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        d.location = (0, 0, h)
        smooth(d)
        set_mat(d, material("lid_clear", (0.85, 0.88, 0.9, 1), rough=0.1, alpha=0.45))
        parts.append(d)
        top = h + r2 * 0.42
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r2 * 1.05,
                                            depth=0.035, location=(0, 0, h + 0.0175))
        d = active()
        bevel(d, 0.01, 2)
        apply_mods(d)
        smooth(d)
        set_mat(d, material("cup_white", (0.96, 0.96, 0.95, 1), rough=0.32))
        parts.append(d)
        top = h + 0.035

    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.021,
                                        depth=straw_h,
                                        location=(0.07, 0, top + straw_h / 2 - 0.1))
    s = active()
    s.rotation_euler = (0.12, 0.1, 0)
    smooth(s)
    set_mat(s, material("inout_red", (0.62, 0.02, 0.07, 1), rough=0.4))
    parts.append(s)

    obj = join(parts, name)
    export(obj, name)


@builder
def drink():
    _cup("drink", 0.25, 0.335, 0.82,
         band_z=[(0.70, 0.328), (0.10, 0.262)], lid="dome", straw_h=0.5)


@builder
def shake():
    _cup("shake", 0.24, 0.315, 0.58,
         band_z=[(0.46, 0.310)], band_name="flavor", lid="flat", straw_h=0.42)


@builder
def tray():
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.09))
    outer = active()
    outer.scale = (3.5, 2.5, 0.18)
    bpy.ops.object.transform_apply(scale=True, location=False)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.16))
    inner = active()
    inner.scale = (3.3, 2.3, 0.22)
    bpy.ops.object.transform_apply(scale=True, location=False)
    boolm = outer.modifiers.new("cut", "BOOLEAN")
    boolm.operation = "DIFFERENCE"
    boolm.object = inner
    bpy.context.view_layer.objects.active = outer
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(inner)
    bevel(outer, 0.03, 3)
    apply_mods(outer)
    smooth(outer)
    set_mat(outer, material("tray_red", (0.42, 0.012, 0.05, 1), rough=0.3))

    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0.075))
    liner = active()
    liner.scale = (1.55, 1.05, 1)
    bpy.ops.object.transform_apply(scale=True, location=False)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=14)
    bpy.ops.object.mode_set(mode="OBJECT")

    def wave(co):
        z = 0.004 * math.sin(co.x * 7) * math.cos(co.y * 9)
        return Vector((co.x, co.y, co.z + z))

    perturb_verts(liner, wave)
    smooth(liner)
    smart_uv(liner)
    set_mat(liner, material("paper", tex="paper", rough=0.65, double=True))
    obj = join([outer, liner], "tray")
    export(obj, "tray")


# ------------------------------------------------------------------- preview


def render_preview(path="/tmp/innout_preview.png"):
    """Import the exported GLBs, assemble a Double-Double scene, render."""
    reset_scene()
    clear_objects()

    def load(name, loc=(0, 0, 0), rot_z=0.0):
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, name + ".glb"))
        objs = [o for o in bpy.context.selected_objects if o.type == "MESH"]
        for o in objs:
            o.location = Vector(o.location) + Vector(loc)
            o.rotation_euler.z += rot_z
        return objs

    load("tray")
    z = 0.07
    stack = [("bun_heel", 0.135), ("spread", 0.025), ("lettuce", 0.06),
             ("tomato", 0.07), ("patty", 0.13), ("cheese", 0.03),
             ("onion", 0.04), ("patty", 0.13), ("cheese", 0.03),
             ("bun_top", 0.0)]
    for name, adv in stack:
        load(name, (-0.85, 0.1, z), rot_z=random.uniform(0, 6))
        z += adv
    load("fries", (0.75, -0.45, 0.07))
    load("drink", (1.05, 0.55, 0.07))
    load("shake", (0.2, 0.75, 0.07))

    # studio
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -0.01))
    floor = active()
    set_mat(floor, material("floor", (0.93, 0.91, 0.88, 1), rough=0.8))

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(140))
    bpy.context.collection.objects.link(sun)
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy = 320
    key.data.size = 3
    key.location = (2.5, -2.5, 3.2)
    key.rotation_euler = (math.radians(40), 0, math.radians(45))
    bpy.context.collection.objects.link(key)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.78, 0.82, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    bpy.context.scene.world = world

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.location = (2.6, -3.4, 2.0)
    cam.rotation_euler = (math.radians(64), 0, math.radians(36))
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        sc.view_settings.view_transform = "Khronos PBR Neutral"
    except TypeError:
        pass
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("preview ->", path)


# ---------------------------------------------------------------------- main

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_preview = "--preview" in sys.argv or not args
    names = args or list(BUILDERS)

    textures.write_all(TEXDIR)
    reset_scene()
    for name in names:
        if name not in BUILDERS:
            print("unknown asset:", name)
            continue
        clear_objects()
        _mat_cache.clear()
        print("building", name)
        BUILDERS[name]()
    if do_preview:
        render_preview()


if __name__ == "__main__":
    main()
