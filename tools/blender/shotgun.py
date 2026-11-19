"""
The double-barrel shotgun ("la doppietta"): a sawed-off side-by-side with
exposed hammers, a walnut pistol grip and an engraved brass receiver (the
steampunk touch). Builds the model, renders preview images and exports
public/models/shotgun.glb.

Run it with:  npm run models   (or tools/blender/.venv/bin/python tools/blender/shotgun.py)

Unlike the leg there's NO skeleton: a gun is made of rigid parts that turn
around a pin (barrels around the hinge, hammers around their screw). So the
model is a small HIERARCHY of objects, each with its ORIGIN on its pivot:

    stock            receiver + grip + trigger guard (doesn't move)
    ├── barrels      origin on the hinge pin: rotate it to break the gun open
    │   ├── shell_L  the two cartridges, origin at their base: slide them
    │   └── shell_R  back to eject them
    ├── hammer_L     origin on the hammer screw: rotate to cock / drop
    └── hammer_R

The game finds the parts by NAME and animates them in code (rotation of a
node), because the timing depends on tuning values (reload time, fire rate)
that can change from the debug panel. A baked animation clip couldn't follow.

Coordinates (Blender): X = right, Y = forward (the barrels), Z = up.
The ORIGIN IS THE RIGHT HAND, on the grip: like the revolver, the viewmodel
places that point and everything else follows.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'shotgun.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--no-render' not in sys.argv

# --- Main measures (meters). Change these to reshape the gun ----------------
BARREL_START = 0.115   # breech face (where the barrels meet the receiver)
BARREL_END = 0.43      # muzzle: a SAWED-OFF, ~31 cm of barrel
BARREL_R = 0.0155      # outer radius at the breech (a real 12 gauge is ~0.0125: a viewmodel exaggerates)
MUZZLE_R = 0.0148      # slightly thinner at the muzzle
BORE_R = 0.0115        # the hole
BARREL_X = 0.0155      # the two barrels touch: centers at ± one radius
BARREL_Z = 0.056        # height of the barrels' axis
HINGE = Vector((0, 0.112, 0.018))  # the pin the barrels turn around when you break the gun
HAMMER_PIVOT_Y, HAMMER_PIVOT_Z = 0.052, 0.066
HAMMER_X = 0.0145

# Palette (0-255).
BLUED = (58, 64, 84)       # blued steel: dark, a bit blue
BRASS = (186, 142, 64)
WALNUT = (104, 58, 32)
IRON = (78, 78, 88)


# ============================================================================
# Textures (tiny pixel art, like the rest of the viewmodel)
# ============================================================================

def blued_texture():
    """Blued barrels: dark steel, a highlight band along the top (u = 0.25 is up)."""
    p = lib.Pixels(16, 32, BLUED)
    r = lib.rng(10)
    p.noise(r, 0.08)
    for y in range(32):
        for x in (3, 4, 5):  # highlight: the light reflected along the top of the tube
            p.set(x, y, lib.shade(BLUED, 1.35 if x == 4 else 1.18))
        if r.random() < 0.3:  # a few worn, lighter scratches
            p.set(r.randrange(16), y, lib.shade(BLUED, 1.25))
    return p.to_image('blued')


def brass_texture():
    """Engraved brass: gear wheels and scrolls, the steampunk signature."""
    p = lib.Pixels(32, 32, BRASS)
    r = lib.rng(11)
    p.noise(r, 0.06)
    dark = lib.shade(BRASS, 0.62)
    light = lib.shade(BRASS, 1.25)

    def gear(cx, cy, radius, teeth):
        for k in range(teeth * 8):
            a = 2 * math.pi * k / (teeth * 8)
            tooth = (k // 4) % 2 == 0
            rr = radius + (1.6 if tooth else 0)
            p.set(round(cx + math.cos(a) * rr), round(cy + math.sin(a) * rr), dark)
        for k in range(16):  # hub
            a = 2 * math.pi * k / 16
            p.set(round(cx + math.cos(a) * 1.5), round(cy + math.sin(a) * 1.5), dark)
        p.set(cx, cy, light)

    gear(9, 10, 5, 8)
    gear(22, 20, 4, 6)
    gear(23, 6, 2.5, 5)
    for x in range(32):  # a border line top and bottom, like an engraved frame
        p.set(x, 0, dark)
        p.set(x, 31, light)
    for k in range(10):  # a scroll joining the gears
        p.set(4 + k, 22 + round(math.sin(k * 0.9) * 2), dark)
    return p.to_image('brass_engraved')


def walnut_texture(checkered=False):
    """Walnut with darker grain lines along the wood; the grip gets checkering."""
    p = lib.Pixels(16, 32, WALNUT)
    r = lib.rng(12 if checkered else 13)
    p.noise(r, 0.07)
    for _ in range(7):  # grain: long wavy darker lines along v
        x = r.randrange(16)
        for y in range(32):
            if r.random() < 0.85:
                p.set(x + round(math.sin(y * 0.35 + x) * 0.8), y, lib.shade(WALNUT, 0.72))
    if checkered:
        # Diamond checkering (the cross-hatched grip of fine guns), with a plain border.
        for y in range(4, 28):
            for x in range(16):
                if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                    p.set(x, y, lib.shade(WALNUT, 0.6))
    for y in range(32):
        p.set(0, y, lib.shade(WALNUT, 1.2))  # a lighter edge where the wood is worn
    return p.to_image('walnut_checkered' if checkered else 'walnut')


def shell_texture():
    """Red paper hull with ribs; the bottom rows are the brass head."""
    p = lib.Pixels(8, 16, (150, 34, 28))
    for y in range(16):
        for x in range(0, 8, 2):
            p.set(x, y, (120, 26, 22))  # ribs of the paper hull
    return p.to_image('shell_hull')


# ============================================================================
# Geometry helpers
# ============================================================================

def rounded_rect(y, half_w, z_bottom, z_top, bevel, axis='y'):
    """A box section with chamfered corners (8 points), in the XZ plane at `y`."""
    b = bevel
    pts2 = [
        (half_w, z_top - b), (half_w - b, z_top), (-half_w + b, z_top), (-half_w, z_top - b),
        (-half_w, z_bottom + b), (-half_w + b, z_bottom), (half_w - b, z_bottom), (half_w, z_bottom + b),
    ]
    return [Vector((x, y, z)) for x, z in pts2]


def circle(cx, y, cz, radius, n=10):
    """A ring around an axis parallel to Y. Point 0 is on the right, u = 0.25 on top."""
    return [Vector((cx + math.cos(2 * math.pi * k / n) * radius, y, cz + math.sin(2 * math.pi * k / n) * radius))
            for k in range(n)]


def stadium(y, half_len, radius, cz, n_half=6):
    """The outline around BOTH barrels (two half circles joined): for the brass bands."""
    pts = []
    for k in range(n_half + 1):  # right half circle, bottom to top
        a = -math.pi / 2 + math.pi * k / n_half
        pts.append(Vector((half_len + math.cos(a) * radius, y, cz + math.sin(a) * radius)))
    for k in range(n_half + 1):  # left half circle, top to bottom
        a = math.pi / 2 + math.pi * k / n_half
        pts.append(Vector((-half_len + math.cos(a) * radius, y, cz + math.sin(a) * radius)))
    return pts


def sweep(name, path, make_ring):
    """
    Rings placed along a 3D path (a polyline in the YZ plane), each one
    perpendicular to the path: for the grip and the trigger guard.
    make_ring(center, side, across, i) returns the ring's points.
    """
    rings = []
    for i, c in enumerate(path):
        c = Vector(c)
        prev = Vector(path[max(0, i - 1)])
        nxt = Vector(path[min(len(path) - 1, i + 1)])
        tangent = (nxt - prev).normalized()
        side = Vector((1, 0, 0))
        across = tangent.cross(side).normalized()  # in the YZ plane, perpendicular to the path
        rings.append(make_ring(c, side, across, i))
    return lib.loft(name, rings, cap_start=True, cap_end=True)


def join(name, objects):
    """Merge several meshes into one object (each keeps its material)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    obj.vertex_groups.clear()  # no skeleton here: the helpers' bone groups are useless
    return obj


def set_origin(obj, point):
    """Move the object's origin (its pivot) to `point` without moving the mesh."""
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')


def parent(child, par):
    """Parent without moving: the child's position becomes relative to the parent's origin."""
    world = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = world


# ============================================================================
# The parts
# ============================================================================

def build(mats):
    # --- Receiver: engraved brass block between the grip and the barrels ---
    receiver = lib.loft('receiver', [
        rounded_rect(0.012, 0.012, 0.030, 0.058, 0.004),   # the tang, narrowing into the grip
        rounded_rect(0.034, 0.025, 0.008, 0.071, 0.007),
        rounded_rect(0.100, 0.027, 0.006, 0.075, 0.007),
        rounded_rect(BARREL_START, 0.027, 0.010, 0.075, 0.007),  # the breech face
    ], v_scale=8, cap_start=True, cap_end=True)
    lib.assign(receiver, mats['brass'])
    # Round "shoulders" where the receiver meets the barrels (the fences).
    fences = []
    for side in (-1, 1):
        f = lib.loft('fence', [circle(side * BARREL_X, y, BARREL_Z, rad, 8)
                               for y, rad in ((0.096, 0.007), (0.103, 0.0148), (BARREL_START, 0.0160))],
                     v_scale=8, cap_start=True)
        lib.assign(f, mats['brass'])
        fences.append(f)
    # Hinge pin (sticks out a little on both sides) and the top lever that opens the gun.
    pin = lib.cylinder_mesh('pin', HINGE, 0.0060, 0.058, 'x', rotation=(0, math.pi / 2, 0), vertices=8)
    lib.assign(pin, mats['iron'])
    lever = lib.box_mesh('lever', (0.005, 0.030, 0.074), (0.009, 0.034, 0.005), 'x', rotation=(0, 0, -0.35))
    lib.assign(lever, mats['iron'])
    # Rivets on the side plates: four little studs each side.
    rivets = []
    for side in (-1, 1):
        for y, z in ((0.045, 0.018), (0.045, 0.062), (0.092, 0.018), (0.092, 0.062)):
            rv = lib.cylinder_mesh('rivet', (side * 0.027, y, z), 0.0022, 0.003, 'x',
                                   rotation=(0, math.pi / 2, 0), vertices=6)
            lib.assign(rv, mats['iron'])
            rivets.append(rv)

    # --- Pistol grip: walnut, swept along a curve going down and back ---
    grip_path = [(0, -0.045, -0.072), (0, -0.032, -0.045), (0, -0.014, -0.012),
                 (0, 0.004, 0.016), (0, 0.022, 0.036)]
    grip_size = [(0.0175, 0.025), (0.0165, 0.023), (0.0158, 0.022), (0.0155, 0.022), (0.0145, 0.021)]
    grip = sweep('grip', grip_path, lambda c, side, across, i: lib.ellipse_ring(
        c, side, across, grip_size[i][0], grip_size[i][1], n=10))
    lib.assign(grip, mats['walnut_checkered'])
    # Butt cap: a brass plate closing the bottom of the grip.
    cap = lib.loft('buttcap', [
        lib.ellipse_ring(Vector(grip_path[0]) + Vector((0, -0.003, -0.004)), (1, 0, 0), (0, 0.84, -0.54), 0.0183, 0.0262, n=10),
        lib.ellipse_ring(Vector(grip_path[0]) + Vector((0, 0.003, 0.004)), (1, 0, 0), (0, 0.84, -0.54), 0.0183, 0.0262, n=10),
    ], cap_start=True, cap_end=True)
    lib.assign(cap, mats['brass'])

    # --- Trigger guard (a flat iron loop) and two triggers (one per barrel) ---
    guard_path = [(0, 0.030, 0.010), (0, 0.036, -0.012), (0, 0.055, -0.020), (0, 0.082, -0.016),
                  (0, 0.096, 0.000), (0, 0.098, 0.012)]
    guard = sweep('guard', guard_path, lambda c, side, across, i: [
        c + side * sx * 0.0045 + across * sy * 0.0018 for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    lib.assign(guard, mats['iron'])
    triggers = []
    for i, y in enumerate((0.058, 0.074)):
        t = lib.box_mesh('trigger', (0, y, 0.0), (0.004, 0.004, 0.022), 'x', rotation=(-0.35 - i * 0.1, 0, 0))
        lib.assign(t, mats['iron'])
        triggers.append(t)

    stock = join('stock', [receiver, *fences, pin, lever, *rivets, grip, cap, guard, *triggers])

    # --- Barrels: two tubes with a real hole, ribs, brass bands, fore-end ---
    parts = []
    for side in (-1, 1):
        cx = side * BARREL_X
        # One loft that goes: breech face (annulus) → outside of the tube → muzzle face (annulus).
        tube = lib.loft('barrel', [
            circle(cx, BARREL_START, BARREL_Z, BORE_R),
            circle(cx, BARREL_START, BARREL_Z, BARREL_R),
            circle(cx, 0.30, BARREL_Z, (BARREL_R + MUZZLE_R) / 2),
            circle(cx, BARREL_END, BARREL_Z, MUZZLE_R),
            circle(cx, BARREL_END, BARREL_Z, BORE_R),
        ], v_scale=3, outward_hint=(cx, BARREL_START + 0.1, BARREL_Z))
        lib.assign(tube, mats['blued'])
        # The bore: a black tube inside, closed deep in (you look into darkness).
        bore = lib.loft('bore', [
            circle(cx, BARREL_END, BARREL_Z, BORE_R),
            circle(cx, BARREL_END - 0.06, BARREL_Z, BORE_R),
        ], cap_end=True, outward_hint=(cx + 1, BARREL_END, BARREL_Z))
        lib.assign(bore, mats['bore'])
        parts += [tube, bore]
    # Top rib (the flat strip you aim along) and bottom rib, filling the valleys.
    top_rib = lib.box_mesh('rib', (0, (BARREL_START + BARREL_END) / 2 + 0.002, BARREL_Z + 0.0105),
                           (0.010, BARREL_END - BARREL_START - 0.004, 0.008), 'x')
    bottom_rib = lib.box_mesh('rib2', (0, (BARREL_START + BARREL_END) / 2, BARREL_Z - 0.011),
                              (0.010, BARREL_END - BARREL_START - 0.004, 0.009), 'x')
    lug = lib.box_mesh('lug', (0, 0.128, 0.027), (0.018, 0.03, 0.024), 'x')  # hooks onto the hinge pin
    for o in (top_rib, bottom_rib, lug):
        lib.assign(o, mats['iron'])
    # Brass bands around both barrels: one at the muzzle, one at the end of the fore-end.
    bands = []
    for y0, y1 in ((BARREL_END - 0.016, BARREL_END - 0.004), (0.296, 0.306)):
        ry = MUZZLE_R + 0.0016
        band = lib.loft('band', [stadium(y, BARREL_X, ry, BARREL_Z) for y in (y0, y1)],
                        v_scale=20, cap_start=True, cap_end=True)
        lib.assign(band, mats['brass'])
        bands.append(band)
    bead = lib.cylinder_mesh('bead', (0, BARREL_END - 0.01, BARREL_Z + 0.017), 0.0026, 0.003, 'x', vertices=6)
    lib.assign(bead, mats['brass'])
    # Fore-end: walnut wrapped under the barrels, rounded at the front.
    fore = lib.loft('foreend', [
        rounded_rect(0.136, 0.025, 0.012, 0.052, 0.009),
        rounded_rect(0.150, 0.029, 0.008, 0.053, 0.011),
        rounded_rect(0.270, 0.028, 0.012, 0.053, 0.011),
        rounded_rect(0.290, 0.022, 0.022, 0.050, 0.008),
    ], v_scale=3, cap_start=True, cap_end=True)
    lib.assign(fore, mats['walnut'])
    barrels = join('barrels', [*parts, top_rib, bottom_rib, lug, *bands, bead, fore])

    # --- Shells: brass head + red paper hull, sitting in the chambers ---
    shells = []
    for name, side in (('shell_R', 1), ('shell_L', -1)):
        cx = side * BARREL_X
        rim = lib.loft('rim', [circle(cx, BARREL_START - 0.0015, BARREL_Z, BORE_R + 0.0012, 10),
                               circle(cx, BARREL_START + 0.012, BARREL_Z, BORE_R + 0.0012, 10)],
                       cap_start=True, cap_end=True)
        lib.assign(rim, mats['brass'])
        hull = lib.loft('hull', [circle(cx, BARREL_START + 0.012, BARREL_Z, BORE_R - 0.0004, 10),
                                 circle(cx, BARREL_START + 0.065, BARREL_Z, BORE_R - 0.0004, 10)],
                        v_scale=20, cap_end=True)
        lib.assign(hull, mats['shell'])
        s = join(name, [rim, hull])
        set_origin(s, (cx, BARREL_START - 0.0015, BARREL_Z))
        shells.append(s)

    # --- Hammers: modeled DOWN (resting on the firing pins, as after a shot) ---
    hammers = []
    for name, side in (('hammer_R', 1), ('hammer_L', -1)):
        x = side * HAMMER_X
        # The body leans forward from the screw to the nose; the spur sticks out the back.
        body = lib.box_mesh('hbody', (x, HAMMER_PIVOT_Y + 0.010, HAMMER_PIVOT_Z + 0.012),
                            (0.0075, 0.011, 0.030), 'x', rotation=(-0.55, 0, 0))
        nose = lib.box_mesh('hnose', (x, HAMMER_PIVOT_Y + 0.024, HAMMER_PIVOT_Z + 0.020),
                            (0.0065, 0.013, 0.008), 'x')
        spur = lib.box_mesh('hspur', (x + side * 0.001, HAMMER_PIVOT_Y + 0.004, HAMMER_PIVOT_Z + 0.027),
                            (0.0095, 0.018, 0.006), 'x', rotation=(0.35, 0, 0))
        screw = lib.cylinder_mesh('hscrew', (x + side * 0.004, HAMMER_PIVOT_Y, HAMMER_PIVOT_Z), 0.0035, 0.002, 'x',
                                  rotation=(0, math.pi / 2, 0), vertices=6)
        for o in (body, nose, spur):
            lib.assign(o, mats['iron'])
        lib.assign(screw, mats['brass'])
        h = join(name, [body, nose, spur, screw])
        set_origin(h, (x, HAMMER_PIVOT_Y, HAMMER_PIVOT_Z))
        hammers.append(h)

    # --- Hierarchy (see the top of the file) ---
    set_origin(stock, (0, 0, 0))
    set_origin(barrels, HINGE)
    for s in shells:
        parent(s, barrels)
    parent(barrels, stock)
    for h in hammers:
        parent(h, stock)
    return stock, barrels, shells, hammers


# ============================================================================
# Previews and export
# ============================================================================

# Rest pose in the game's viewmodel (render/weapons/shotgunView.ts), converted
# to Blender axes: three.js (x, y, z) → Blender (x, -z, y).
VIEW_POS = (0.115, 0.27, -0.125)
VIEW_YAW = 0.05


def main():
    lib.reset_scene()
    mats = {
        'blued': lib.material('blued', blued_texture(), roughness=0.45),
        'brass': lib.material('brass', brass_texture(), roughness=0.65),
        'walnut': lib.material('walnut', walnut_texture(), roughness=0.85),
        'walnut_checkered': lib.material('walnut_checkered', walnut_texture(True), roughness=0.9),
        'iron': lib.material('iron', color=IRON, roughness=0.5),
        'bore': lib.material('bore', color=(14, 12, 12), roughness=1),
        'shell': lib.material('shell', shell_texture(), roughness=0.8),
    }
    stock, barrels, shells, hammers = build(mats)
    # The hammers are COCKED when the gun is ready: the game uses this as the rest
    # pose and drops them forward when a barrel fires.
    for h in hammers:
        h.rotation_euler.x = 0.0

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (stock, barrels, *shells, *hammers):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        cam = lib.setup_preview()
        # From the player's eye, in the in-game rest pose.
        stock.location = VIEW_POS
        stock.rotation_euler = (0, 0, VIEW_YAW)
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shotgun_eye.png'), 0)
        # Broken open (reload pose): barrels down, hammers back.
        barrels.rotation_euler.x = -0.75
        for s in shells:
            s.location.y -= 0.03
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shotgun_eye_open.png'), 0)
        # Beauty shots from the side and from above-front.
        stock.location = (0, 0, 0)
        stock.rotation_euler = (0, 0, 0)
        barrels.rotation_euler.x = 0
        for s in shells:
            s.location.y += 0.03
        cam.location = (0.36, 0.17, 0.03)
        cam.rotation_euler = (Vector((0, 0.17, 0.0)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shotgun_side.png'), 0)
        cam.location = (0.3, -0.28, 0.25)
        cam.rotation_euler = (Vector((0, 0.15, 0.02)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shotgun_back.png'), 0)
        barrels.rotation_euler.x = -0.75
        cam.location = (0.45, 0.05, 0.22)
        cam.rotation_euler = (Vector((0, 0.13, 0.0)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shotgun_open.png'), 0)


main()
