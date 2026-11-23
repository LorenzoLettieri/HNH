"""
The dynamite launcher ("il lancia-dinamite"): a heavy steampunk drum
launcher, held with TWO hands like a grenade launcher. A walnut stock with
a brass butt plate, a thick wrist that fills the right fist, a massive blued receiver, a brass
REVOLVING CAGE holding five red dynamite sticks (their fuses poke out of
the back plate, toward you), a fat barrel with a flared muzzle, a copper
tank of compressed air under it wrapped in a walnut fore-end for the left
hand, a pressure gauge on the receiver: the air is what throws the stick out.
Builds the model, renders preview images and exports
public/models/dynamiteLauncher.glb.

Run it with:  npm run models   (or tools/blender/.venv/bin/python tools/blender/dynamite_launcher.py)
              add --no-render to skip the previews.

Like the shotgun there's NO skeleton: rigid parts, each with its ORIGIN on
its pivot, found by NAME by the game (render/weapons/dynamiteView.ts):

    frame            stock, receiver, barrel, tank, fore-end, gauge (doesn't move)
    ├── drum         origin ON THE DRUM'S AXIS: rotate it (around its own
    │   │            axis, Blender Y = three.js -Z) to bring the next stick up
    │   ├── stick_0  the five sticks, origin at their BACK end (the fuse side):
    │   ├── ...      slide them back along the axis to pull them out
    │   └── stick_4  (stick_0 is the one in front of the barrel)
    └── muzzle       an empty at the mouth of the barrel: where the flash goes

Coordinates (Blender): X = right, Y = forward (the barrel), Z = up.
THE HANDS ARE THE CARBINE'S (public/models/rifleArms.glb, the same ones the
pump-action borrows): so the gun is built around the two points where those
hands are, in the carbine's coordinates:
  - the ORIGIN is the right hand on the wrist of the stock (as in rifle.py);
  - the left palm is under the fore-end at LEFT_PALM: the fore-end is built
    right above it.
In the game the launcher is held in the carbine's hip pose (the arms are
posed for it), so the shoulders line up off screen.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'dynamiteLauncher.glb')
ARMS_GLB = os.path.join(ROOT, 'public', 'models', 'rifleArms.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--no-render' not in sys.argv

# --- Where the carbine's hands are (see rifle_arms.py, RIGHT and LEFT) ------
LEFT_PALM = Vector((-0.012, 0.29, -0.004))

# --- Main measures (meters). Change these to reshape the gun ----------------
STICKS = 5                # chambers in the drum
DRUM_Z = 0.034            # the drum's axis
ORBIT = 0.047             # distance of the sticks from the drum's axis
BARREL_Z = DRUM_Z + ORBIT  # the barrel lines up with the TOP chamber
DRUM_R = 0.074            # radius of the drum's end plates
DRUM_BACK = 0.105         # back plate (toward you)...
DRUM_FRONT = 0.245        # ...and front plate, along Y
PLATE = 0.010             # thickness of the end plates
STICK_R = 0.0175          # a dynamite stick (exaggerated, like every viewmodel)
FUSE_OUT = 0.026          # how far the fuses stick out of the back plate
BARREL_START = DRUM_FRONT + PLATE
BARREL_END = 0.64
BARREL_R = 0.030          # outer radius: fat, a stick goes through it
BORE_R = 0.022
BELL_R = 0.044            # the flared muzzle
TANK_Z = BARREL_Z - 0.056  # the air tank under the barrel
TANK_R = 0.019
FORE_START, FORE_END = 0.262, 0.44  # the walnut fore-end around the tank (the left hand holds it)
FORE_BOTTOM = LEFT_PALM.z + 0.016   # its belly sits on the left palm
# The stock: rings along the line from the wrist (at the right hand) back to the butt, dropping.
# The WRIST must fill the right fist. The carbine's right hand grips the
# LOWER BAR of the carbine's lever: its fist's hole (measured on the vertices
# of rifleArms.glb, a slice at a time) is about 5 cm wide and 4.5 cm tall,
# centered RIGHT_FIST below the origin. The game lifts the arm by that much
# (render/weapons/dynamiteView.ts, FIST): the hole lands on the origin, where
# this wrist is, as thick as the hole.
RIGHT_FIST = Vector((-0.003, 0.010, -0.072))
STOCK = [  # (y, z of the center, half width, half height)
    (0.040, 0.008, 0.017, 0.030),
    (0.014, 0.001, 0.019, 0.024),
    (-0.030, -0.002, 0.019, 0.023),   # the wrist: the right hand closes around it
    (-0.080, -0.018, 0.019, 0.032),
    (-0.165, -0.048, 0.022, 0.050),
    (-0.260, -0.068, 0.023, 0.060),
]

# Palette (0-255).
BLUED = (58, 64, 84)
BRASS = (186, 142, 64)
COPPER = (170, 92, 52)
WALNUT = (104, 58, 32)
IRON = (78, 78, 88)
RED = (179, 38, 30)       # the same red as the stick in flight (render/dynamite.ts)


# ============================================================================
# Textures (tiny pixel art, like the rest of the viewmodel)
# ============================================================================

def blued_texture():
    """Blued steel: dark, a highlight band along the top (u = 0.25 is up)."""
    p = lib.Pixels(16, 32, BLUED)
    r = lib.rng(20)
    p.noise(r, 0.08)
    for y in range(32):
        for x in (3, 4, 5):
            p.set(x, y, lib.shade(BLUED, 1.35 if x == 4 else 1.18))
        if r.random() < 0.3:
            p.set(r.randrange(16), y, lib.shade(BLUED, 1.25))
    return p.to_image('blued')


def brass_texture():
    """Brass with engraved gears: the drum's end plates, the bands."""
    p = lib.Pixels(32, 32, BRASS)
    r = lib.rng(21)
    p.noise(r, 0.06)
    dark = lib.shade(BRASS, 0.62)
    light = lib.shade(BRASS, 1.25)

    def gear(cx, cy, radius, teeth):
        for k in range(teeth * 8):
            a = 2 * math.pi * k / (teeth * 8)
            rr = radius + (1.6 if (k // 4) % 2 == 0 else 0)
            p.set(round(cx + math.cos(a) * rr), round(cy + math.sin(a) * rr), dark)
        p.set(cx, cy, light)

    gear(10, 11, 5, 8)
    gear(23, 21, 4, 6)
    for x in range(32):
        p.set(x, 0, dark)
        p.set(x, 31, light)
    return p.to_image('brass_engraved')


def copper_texture():
    """The air tank: copper with a few green patches of verdigris and rivet rows."""
    p = lib.Pixels(16, 32, COPPER)
    r = lib.rng(22)
    p.noise(r, 0.07)
    for _ in range(6):
        x, y = r.randrange(16), r.randrange(32)
        p.set(x, y, (78, 140, 110))
        p.set(x + 1, y, (60, 116, 92))
    for y in (2, 29):  # rivet rows near the two ends
        for x in range(0, 16, 3):
            p.set(x, y, lib.shade(COPPER, 1.45))
    for y in range(32):
        p.set(4, y, lib.shade(COPPER, 1.3))  # highlight along the top
    return p.to_image('copper')


def walnut_texture(checkered=False):
    p = lib.Pixels(16, 32, WALNUT)
    r = lib.rng(23 if checkered else 24)
    p.noise(r, 0.07)
    for _ in range(7):
        x = r.randrange(16)
        for y in range(32):
            if r.random() < 0.85:
                p.set(x + round(math.sin(y * 0.35 + x) * 0.8), y, lib.shade(WALNUT, 0.72))
    if checkered:
        for y in range(4, 28):
            for x in range(16):
                if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                    p.set(x, y, lib.shade(WALNUT, 0.6))
    return p.to_image('walnut_checkered' if checkered else 'walnut')


def paper_texture():
    """
    The sticks' red paper: the same look as the stick in flight and the
    pickup (a light column, darker folds at both ends, a pale label).
    u goes around the stick, v along it (from the back end to the front).
    """
    p = lib.Pixels(8, 24, RED)
    for y in range(24):
        p.set(1, y, (224, 72, 58))
        p.set(2, y, (224, 72, 58))
        p.set(6, y, (116, 22, 18))
        p.set(7, y, (116, 22, 18))
        if y < 2 or y >= 22:
            for x in range(8):
                p.set(x, y, (90, 16, 12))
    for y in range(9, 15):
        for x in range(0, 5):
            p.set(x, y, (216, 196, 142))
    for x, y in ((1, 10), (2, 10), (3, 10), (1, 12), (3, 12), (2, 13)):
        p.set(x, y, (42, 26, 16))
    return p.to_image('dynamite_paper')


def gauge_texture():
    """The pressure gauge's face: cream dial, tick marks, a red zone, the needle."""
    n = 16
    p = lib.Pixels(n, n, (226, 214, 180))
    c = (n - 1) / 2
    for k in range(12):
        a = math.pi * (1.25 - 1.5 * k / 11)  # a 270° dial
        x, y = round(c + math.cos(a) * 6), round(c + math.sin(a) * 6)
        p.set(x, y, (40, 30, 24) if k < 9 else (190, 30, 20))
    for t in range(6):  # the needle, pointing into the red: full pressure
        a = math.pi * -0.15
        p.set(round(c + math.cos(a) * t), round(c + math.sin(a) * t), (150, 20, 14))
    p.set(round(c), round(c), (40, 30, 24))
    return p.to_image('gauge_face')


# ============================================================================
# Geometry helpers (the same ones as shotgun.py)
# ============================================================================

def circle(cx, y, cz, radius, n=10):
    """A ring around an axis parallel to Y. Point 0 is on the right, u = 0.25 on top."""
    return [Vector((cx + math.cos(2 * math.pi * k / n) * radius, y, cz + math.sin(2 * math.pi * k / n) * radius))
            for k in range(n)]


def rounded_rect(y, half_w, z_bottom, z_top, bevel):
    b = bevel
    pts = [(half_w, z_top - b), (half_w - b, z_top), (-half_w + b, z_top), (-half_w, z_top - b),
           (-half_w, z_bottom + b), (-half_w + b, z_bottom), (half_w - b, z_bottom), (half_w, z_bottom + b)]
    return [Vector((x, y, z)) for x, z in pts]


def sweep(name, path, make_ring):
    rings = []
    for i, c in enumerate(path):
        c = Vector(c)
        prev = Vector(path[max(0, i - 1)])
        nxt = Vector(path[min(len(path) - 1, i + 1)])
        tangent = (nxt - prev).normalized()
        side = Vector((1, 0, 0))
        across = tangent.cross(side).normalized()
        rings.append(make_ring(c, side, across, i))
    return lib.loft(name, rings, cap_start=True, cap_end=True)


def tube(name, cx, cz, stations, mat, n=10, cap_start=True, cap_end=True, v_scale=4):
    """A round tube along Y: `stations` = [(y, radius), ...]."""
    obj = lib.loft(name, [circle(cx, y, cz, r, n) for y, r in stations],
                   v_scale=v_scale, cap_start=cap_start, cap_end=cap_end)
    return lib.assign(obj, mat)


def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    obj.vertex_groups.clear()
    return obj


def set_origin(obj, point):
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')


def parent(child, par):
    world = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = world

def chamber(k):
    """Where stick `k` sits around the drum's axis: 0 on top (in front of the barrel), then clockwise seen from behind."""
    a = math.pi / 2 - 2 * math.pi * k / STICKS
    return math.cos(a) * ORBIT, DRUM_Z + math.sin(a) * ORBIT


# ============================================================================
# The parts
# ============================================================================

def build(m):
    parts = []
    # --- Stock: walnut, from the wrist (the right hand) back and down to the butt ---
    stock = lib.loft('stock', [lib.ellipse_ring((0, y, z), (1, 0, 0), (0, 0, 1), hw, hh, n=10) for y, z, hw, hh in STOCK],
                     v_scale=4, cap_start=True, cap_end=True)
    parts.append(lib.assign(stock, m['walnut']))
    y, z, hw, hh = STOCK[-1]
    butt = lib.loft('butt', [lib.ellipse_ring((0, y + dy, z), (1, 0, 0), (0, 0, 1), hw + 0.002, hh + 0.002, n=10)
                             for dy in (0.0, -0.012)], cap_start=True, cap_end=True)
    parts.append(lib.assign(butt, m['brass']))
    # A brass strap around the wrist, where the stock meets the receiver.
    parts.append(lib.assign(lib.loft('wristband', [
        lib.ellipse_ring((0, yy, 0.008), (1, 0, 0), (0, 0, 1), 0.0185, 0.032, n=10) for yy in (0.040, 0.052)
    ], cap_start=True, cap_end=True), m['brass']))

    # --- Receiver: a massive blued block from the wrist to the drum, a hump on top ---
    receiver = lib.loft('receiver', [
        rounded_rect(0.034, 0.020, -0.014, 0.046, 0.006),
        rounded_rect(0.050, 0.030, -0.030, 0.070, 0.009),
        rounded_rect(DRUM_BACK - 0.004, 0.032, -0.038, 0.078, 0.010),
    ], v_scale=8, cap_start=True, cap_end=True)
    parts.append(lib.assign(receiver, m['blued']))
    # The striker on top at the back (it lights the fuse), and rivets on the flanks.
    striker = lib.box_mesh('striker', (0, 0.050, 0.078), (0.014, 0.026, 0.016), 'x', rotation=(0.3, 0, 0))
    parts.append(lib.assign(striker, m['brass']))
    for side in (-1, 1):
        for yy, zz in ((0.062, -0.020), (0.062, 0.058), (0.092, -0.026), (0.092, 0.066)):
            rv = lib.cylinder_mesh('rivet', (side * 0.032, yy, zz), 0.0032, 0.004, 'x', rotation=(0, math.pi / 2, 0), vertices=6)
            parts.append(lib.assign(rv, m['brass']))

    # --- Trigger and its guard, in front of the hand (the index finger reaches forward) ---
    guard_path = [(0, 0.052, -0.026), (0, 0.054, -0.044), (0, 0.070, -0.054), (0, 0.090, -0.048), (0, 0.094, -0.034)]
    guard = sweep('guard', guard_path, lambda c, side, across, i: [
        c + side * sx * 0.0055 + across * sy * 0.0025 for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    parts.append(lib.assign(guard, m['iron']))
    trigger = lib.box_mesh('trigger', (0, 0.068, -0.040), (0.005, 0.005, 0.022), 'x', rotation=(-0.35, 0, 0))
    parts.append(lib.assign(trigger, m['iron']))

    # --- The drum's axle (the frame holds it; the drum turns on it) ---
    parts.append(tube('axle', 0, DRUM_Z, [(DRUM_BACK - 0.008, 0.011), (DRUM_FRONT + PLATE + 0.008, 0.011)], m['iron'], n=8))

    # --- Barrel: fat blued tube with a real hole and a flared muzzle (a bell) ---
    barrel = lib.loft('barrel', [
        circle(0, BARREL_START, BARREL_Z, BORE_R, 12),
        circle(0, BARREL_START, BARREL_Z, BARREL_R, 12),
        circle(0, BARREL_END - 0.070, BARREL_Z, BARREL_R, 12),
        circle(0, BARREL_END - 0.025, BARREL_Z, BARREL_R + 0.004, 12),
        circle(0, BARREL_END, BARREL_Z, BELL_R, 12),
        circle(0, BARREL_END, BARREL_Z, BORE_R + 0.008, 12),
    ], v_scale=3, outward_hint=(0, BARREL_START + 0.1, BARREL_Z))
    parts.append(lib.assign(barrel, m['blued']))
    bore = lib.loft('bore', [circle(0, BARREL_END, BARREL_Z, BORE_R + 0.008, 12),
                             circle(0, BARREL_END - 0.04, BARREL_Z, BORE_R, 12),
                             circle(0, BARREL_END - 0.12, BARREL_Z, BORE_R, 12)],
                    cap_end=True, outward_hint=(1, BARREL_END, BARREL_Z))
    parts.append(lib.assign(bore, m['bore']))
    for y0, y1 in ((BARREL_START + 0.004, BARREL_START + 0.020), (FORE_END + 0.02, FORE_END + 0.034), (0.555, 0.567)):
        parts.append(tube('band', 0, BARREL_Z, [(y0, BARREL_R + 0.004), (y1, BARREL_R + 0.004)], m['brass'], n=12))
    sight = lib.box_mesh('sight', (0, BARREL_END - 0.04, BARREL_Z + BARREL_R + 0.008), (0.005, 0.016, 0.014), 'x')
    parts.append(lib.assign(sight, m['brass']))
    # A heat shield on top of the barrel: a perforated iron strip (steampunk, and it reads "big gun").
    shield = lib.box_mesh('shield', (0, (BARREL_START + 0.53) / 2, BARREL_Z + BARREL_R + 0.003), (0.030, 0.53 - BARREL_START, 0.004), 'x')
    parts.append(lib.assign(shield, m['iron']))

    # --- The air tank under the barrel, its straps and the pipe to the receiver ---
    parts.append(tube('tank', 0, TANK_Z, [(BARREL_START + 0.004, TANK_R * 0.6), (BARREL_START + 0.014, TANK_R),
                                          (0.520, TANK_R), (0.536, TANK_R * 0.55)], m['copper'], n=10))
    for yy in (0.475, 0.510):
        strap = lib.box_mesh('strap', (0, yy, (BARREL_Z + TANK_Z) / 2), (0.044, 0.010, BARREL_Z - TANK_Z + 0.04), 'x')
        parts.append(lib.assign(strap, m['brass']))
    pipe = lib.loft('pipe', [circle(0, yy, zz, 0.006, 6) for yy, zz in
                             ((BARREL_START + 0.006, TANK_Z), (0.200, -0.040), (0.120, -0.040), (DRUM_BACK - 0.004, -0.030))],
                    cap_start=True, cap_end=True)
    parts.append(lib.assign(pipe, m['copper']))
    # The walnut fore-end around the tank: the left hand holds it from below.
    fore = lib.loft('foreend', [
        rounded_rect(FORE_START, 0.024, FORE_BOTTOM + 0.006, TANK_Z + 0.022, 0.010),
        rounded_rect(FORE_START + 0.014, 0.028, FORE_BOTTOM, TANK_Z + 0.024, 0.012),
        rounded_rect(FORE_END - 0.014, 0.028, FORE_BOTTOM, TANK_Z + 0.024, 0.012),
        rounded_rect(FORE_END, 0.024, FORE_BOTTOM + 0.006, TANK_Z + 0.022, 0.010),
    ], v_scale=4, cap_start=True, cap_end=True)
    parts.append(lib.assign(fore, m['walnut_checkered']))
    # The pressure gauge on the LEFT flank of the receiver: the side you see.
    gauge_center = Vector((-0.036, 0.075, 0.030))
    ring = lib.cylinder_mesh('gauge_ring', gauge_center, 0.021, 0.010, 'x', rotation=(0, math.pi / 2, 0.35), vertices=12)
    parts.append(lib.assign(ring, m['brass']))
    face = lib.cylinder_mesh('gauge_face', gauge_center + Vector((-0.0055, -0.002, 0)), 0.017, 0.002, 'x',
                             rotation=(0, math.pi / 2, 0.35), vertices=12)
    parts.append(lib.assign(face, m['gauge']))

    frame = join('frame', parts)

    # --- The drum: two engraved brass plates, iron rods between them, the sticks ---
    drum_parts = []
    for y0 in (DRUM_BACK, DRUM_FRONT):
        drum_parts.append(tube('plate', 0, DRUM_Z, [(y0, DRUM_R * 0.94), (y0 + 0.002, DRUM_R), (y0 + PLATE - 0.002, DRUM_R),
                                                     (y0 + PLATE, DRUM_R * 0.94)], m['brass'], n=STICKS * 3, v_scale=12))
    for k in range(STICKS):  # rods between the chambers: the cage's bars
        a = math.pi / 2 - 2 * math.pi * (k + 0.5) / STICKS
        drum_parts.append(tube('rod', math.cos(a) * (DRUM_R - 0.008), DRUM_Z + math.sin(a) * (DRUM_R - 0.008),
                               [(DRUM_BACK + PLATE, 0.005), (DRUM_FRONT, 0.005)], m['iron'], n=6))
    # A brass ring around the middle of the cage, holding the bars.
    drum_parts.append(tube('hoop', 0, DRUM_Z, [((DRUM_BACK + DRUM_FRONT) / 2 - 0.006, DRUM_R - 0.003),
                                               ((DRUM_BACK + DRUM_FRONT) / 2 + 0.006, DRUM_R - 0.003)], m['brass'], n=STICKS * 3))
    drum_parts.append(tube('hub', 0, DRUM_Z, [(DRUM_BACK + PLATE, 0.016), (DRUM_FRONT, 0.016)], m['iron'], n=8))
    drum = join('drum', drum_parts)

    sticks = []
    for k in range(STICKS):
        x, z = chamber(k)
        back = DRUM_BACK - 0.004
        front = DRUM_FRONT + PLATE * 0.6
        body = tube('stick', x, z, [(back, STICK_R), (front, STICK_R)], m['paper'], n=8, v_scale=1 / (front - back))
        # The fuse: out of the back end, bent a little outward (away from the axis), toward you.
        out = Vector((x, 0, z - DRUM_Z)).normalized() * 0.008
        fuse = lib.loft('fuse', [circle(x, back, z, 0.0026, 5),
                                 circle(x + out.x, back - FUSE_OUT, z + out.z, 0.0026, 5)], cap_end=True)
        lib.assign(fuse, m['fuse'])
        s = join(f'stick_{k}', [body, fuse])
        set_origin(s, (x, back, z))
        sticks.append(s)

    muzzle = bpy.data.objects.new('muzzle', None)
    bpy.context.scene.collection.objects.link(muzzle)
    muzzle.location = (0, BARREL_END + 0.01, BARREL_Z)

    # --- Hierarchy (see the top of the file) ---
    set_origin(frame, (0, 0, 0))
    set_origin(drum, (0, DRUM_BACK, DRUM_Z))
    for s in sticks:
        parent(s, drum)
    parent(drum, frame)
    parent(muzzle, frame)
    return frame, drum, sticks, muzzle


# ============================================================================
# Previews and export
# ============================================================================

# The carbine's hip pose in the game's viewmodel (viewmodelSettings.rifle* in
# render/weapons/viewmodel.ts: the arms are posed for it), converted to
# Blender axes: three.js (x, y, z) → Blender (x, -z, y). The preview puts the
# carbine's arms there too: do the hands fit the wrist and the fore-end?
VIEW_POS = (0.15, 0.36, -0.15)
VIEW_ROT = (0.05, -0.05, 0.01)  # (pitch, roll, yaw)


def main():
    lib.reset_scene()
    m = {
        'blued': lib.material('blued', blued_texture(), roughness=0.45),
        'brass': lib.material('brass', brass_texture(), roughness=0.65),
        'copper': lib.material('copper', copper_texture(), roughness=0.6),
        'walnut': lib.material('walnut', walnut_texture(), roughness=0.85),
        'walnut_checkered': lib.material('walnut_checkered', walnut_texture(True), roughness=0.9),
        'iron': lib.material('iron', color=IRON, roughness=0.5),
        'bore': lib.material('bore', color=(14, 12, 12), roughness=1),
        'paper': lib.material('paper', paper_texture(), roughness=0.9),
        'fuse': lib.material('fuse', color=(205, 178, 122), roughness=1),
        'gauge': lib.material('gauge', gauge_texture(), roughness=0.4),
    }
    frame, drum, sticks, muzzle = build(m)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (frame, drum, *sticks, muzzle):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        cam = lib.setup_preview()
        # From the player's eye, held by the carbine's arms (they're in the
        # gun's coordinates: children of the gun, like in the game).
        bpy.ops.import_scene.gltf(filepath=ARMS_GLB)
        arms = [bpy.data.objects[n] for n in ('Arm_R_Rifle', 'Arm_L_Rifle')]
        frame.location = VIEW_POS
        frame.rotation_euler = VIEW_ROT
        for a in arms:
            a.parent = frame
            a.matrix_parent_inverse.identity()
        arms[0].location = -RIGHT_FIST + Vector((0, RIGHT_FIST.y, 0))  # the right fist's hole on the wrist (as in the game)
        lib.render_frame(os.path.join(PREVIEW_DIR, 'dynamite_eye.png'), 0)
        # The hands from the side, close: do they really hold it?
        frame.location = (0, 0, 0)
        frame.rotation_euler = (0, 0, 0)
        cam.location = (-0.75, 0.18, 0.02)
        cam.rotation_euler = (Vector((0, 0.18, 0.0)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        lib.render_frame(os.path.join(PREVIEW_DIR, 'dynamite_hands.png'), 0)
        # Beauty shots without the arms: side, from behind (the fuses), three quarters.
        for a in arms:
            a.hide_render = True
        for name, loc, target in (
            ('dynamite_side', (-0.85, 0.20, 0.06), (0, 0.20, 0.0)),
            ('dynamite_back', (0.22, -0.40, 0.26), (0, 0.15, 0.03)),
            ('dynamite_front', (0.45, 0.95, 0.22), (0, 0.25, 0.02)),
        ):
            cam.location = loc
            cam.rotation_euler = (Vector(target) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
            lib.render_frame(os.path.join(PREVIEW_DIR, name + '.png'), 0)


main()
