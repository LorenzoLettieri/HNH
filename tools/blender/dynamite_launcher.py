"""
The dynamite launcher ("il lancia-dinamite"): a steampunk drum launcher.
A pistol grip like the revolver's, a brass REVOLVING CAGE holding five red
dynamite sticks (their fuses poke out of the back plate, toward you), a fat
blued barrel with a flared muzzle, a copper tank of compressed air under it
with a pressure gauge on the side: the air is what throws the stick out.
Builds the model, renders preview images and exports
public/models/dynamiteLauncher.glb.

Run it with:  npm run models   (or tools/blender/.venv/bin/python tools/blender/dynamite_launcher.py)
              add --no-render to skip the previews.

Like the shotgun there's NO skeleton: rigid parts, each with its ORIGIN on
its pivot, found by NAME by the game (render/weapons/dynamiteView.ts):

    frame            grip, receiver, barrel, tank, gauge (doesn't move)
    ├── drum         origin ON THE DRUM'S AXIS: rotate it (around its own
    │   │            axis, Blender Y = three.js -Z) to bring the next stick up
    │   ├── stick_0  the five sticks, origin at their BACK end (the fuse side):
    │   ├── ...      slide them back along the axis to pull them out
    │   └── stick_4  (stick_0 is the one in front of the barrel)
    └── muzzle       an empty at the mouth of the barrel: where the flash goes

Coordinates (Blender): X = right, Y = forward (the barrel), Z = up.
The ORIGIN IS THE RIGHT HAND on the grip, and the grip has the same slant and
thickness as the revolver's: the revolver's right arm (Arm_R in arms.glb)
holds this one too, without a new pose.
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
ARMS_GLB = os.path.join(ROOT, 'public', 'models', 'arms.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--no-render' not in sys.argv

# --- Main measures (meters). Change these to reshape the gun ----------------
BARREL_Z = 0.058          # height of the barrel's axis (= the top chamber of the drum)
STICKS = 5                # chambers in the drum
ORBIT = 0.036             # distance of the sticks from the drum's axis
DRUM_Z = BARREL_Z - ORBIT  # the drum's axis: under the barrel, so the TOP stick lines up with it
DRUM_R = 0.056            # radius of the drum's end plates
DRUM_BACK = 0.050         # back plate (toward you)...
DRUM_FRONT = 0.158        # ...and front plate, along Y
PLATE = 0.008             # thickness of the end plates
STICK_R = 0.0135          # a dynamite stick (exaggerated, like every viewmodel)
FUSE_OUT = 0.022          # how far the fuses stick out of the back plate
BARREL_START = DRUM_FRONT + PLATE
BARREL_END = 0.36
BARREL_R = 0.022          # outer radius: fat, a stick goes through it
BORE_R = 0.0165
BELL_R = 0.031            # the flared muzzle
TANK_Z = BARREL_Z - 0.043  # the air tank under the barrel
TANK_R = 0.0145
GRIP_PATH = [(0, -0.040, -0.072), (0, -0.030, -0.045), (0, -0.016, -0.014), (0, -0.002, 0.012), (0, 0.010, 0.030)]
GRIP_SIZE = [(0.0150, 0.024), (0.0145, 0.023), (0.0140, 0.022), (0.0140, 0.022), (0.0135, 0.021)]

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
    # --- Pistol grip: walnut, the revolver's slant ---
    grip = sweep('grip', GRIP_PATH, lambda c, side, across, i: lib.ellipse_ring(
        c, side, across, GRIP_SIZE[i][0], GRIP_SIZE[i][1], n=10))
    parts.append(lib.assign(grip, m['walnut_checkered']))
    butt = lib.loft('butt', [
        lib.ellipse_ring(Vector(GRIP_PATH[0]) + Vector((0, -0.002, -0.004)), (1, 0, 0), (0, 0.9, -0.42), 0.0160, 0.0255, n=10),
        lib.ellipse_ring(Vector(GRIP_PATH[0]) + Vector((0, 0.002, 0.004)), (1, 0, 0), (0, 0.9, -0.42), 0.0160, 0.0255, n=10),
    ], cap_start=True, cap_end=True)
    parts.append(lib.assign(butt, m['brass']))

    # --- Receiver: iron block from the grip to the drum, with a hump on top ---
    receiver = lib.loft('receiver', [
        rounded_rect(-0.022, 0.016, 0.018, 0.050, 0.005),
        rounded_rect(0.000, 0.019, 0.004, 0.058, 0.007),
        rounded_rect(DRUM_BACK - 0.004, 0.022, -0.010, 0.064, 0.008),
    ], v_scale=8, cap_start=True, cap_end=True)
    parts.append(lib.assign(receiver, m['blued']))
    # The hammer-like striker on top, at the back: a brass knob (it lights the fuse).
    striker = lib.box_mesh('striker', (0, -0.006, 0.058), (0.010, 0.020, 0.012), 'x', rotation=(0.35, 0, 0))
    parts.append(lib.assign(striker, m['brass']))

    # --- Trigger guard and trigger, between the grip and the drum ---
    guard_path = [(0, 0.004, 0.006), (0, 0.008, -0.016), (0, 0.026, -0.026), (0, 0.044, -0.020), (0, 0.050, -0.004)]
    guard = sweep('guard', guard_path, lambda c, side, across, i: [
        c + side * sx * 0.0045 + across * sy * 0.0018 for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    parts.append(lib.assign(guard, m['iron']))
    trigger = lib.box_mesh('trigger', (0, 0.026, -0.006), (0.004, 0.004, 0.022), 'x', rotation=(-0.4, 0, 0))
    parts.append(lib.assign(trigger, m['iron']))

    # --- The drum's axle (the frame holds it; the drum turns on it) ---
    axle = tube('axle', 0, DRUM_Z, [(DRUM_BACK - 0.006, 0.008), (DRUM_FRONT + PLATE + 0.006, 0.008)], m['iron'], n=8)
    parts.append(axle)

    # --- Barrel: fat blued tube with a real hole and a flared muzzle (a bell) ---
    barrel = lib.loft('barrel', [
        circle(0, BARREL_START, BARREL_Z, BORE_R, 12),
        circle(0, BARREL_START, BARREL_Z, BARREL_R, 12),
        circle(0, BARREL_END - 0.050, BARREL_Z, BARREL_R, 12),
        circle(0, BARREL_END - 0.018, BARREL_Z, BARREL_R + 0.003, 12),
        circle(0, BARREL_END, BARREL_Z, BELL_R, 12),
        circle(0, BARREL_END, BARREL_Z, BORE_R + 0.006, 12),
    ], v_scale=3, outward_hint=(0, BARREL_START + 0.1, BARREL_Z))
    parts.append(lib.assign(barrel, m['blued']))
    bore = lib.loft('bore', [circle(0, BARREL_END, BARREL_Z, BORE_R + 0.006, 12),
                             circle(0, BARREL_END - 0.03, BARREL_Z, BORE_R, 12),
                             circle(0, BARREL_END - 0.09, BARREL_Z, BORE_R, 12)],
                    cap_end=True, outward_hint=(1, BARREL_END, BARREL_Z))
    parts.append(lib.assign(bore, m['bore']))
    # Brass bands around the barrel, and a front sight on top.
    for y0, y1 in ((BARREL_START + 0.004, BARREL_START + 0.016), (0.255, 0.265)):
        parts.append(tube('band', 0, BARREL_Z, [(y0, BARREL_R + 0.003), (y1, BARREL_R + 0.003)], m['brass'], n=12))
    sight = lib.box_mesh('sight', (0, BARREL_END - 0.03, BARREL_Z + BARREL_R + 0.006), (0.004, 0.012, 0.010), 'x')
    parts.append(lib.assign(sight, m['brass']))

    # --- The air tank under the barrel, its straps and the pipe to the receiver ---
    tank = tube('tank', 0, TANK_Z, [(BARREL_START + 0.012, TANK_R * 0.6), (BARREL_START + 0.020, TANK_R),
                                     (0.300, TANK_R), (0.312, TANK_R * 0.55)], m['copper'], n=10)
    parts.append(tank)
    for y in (0.200, 0.285):  # straps tying the tank to the barrel
        strap = lib.box_mesh('strap', (0, y, (BARREL_Z + TANK_Z) / 2), (0.032, 0.008, BARREL_Z - TANK_Z + 0.03), 'x')
        parts.append(lib.assign(strap, m['brass']))
    pipe = lib.loft('pipe', [circle(0, y, z, 0.0045, 6) for y, z in
                             ((BARREL_START + 0.014, TANK_Z), (0.130, -0.022), (0.060, -0.020), (0.046, -0.006))],
                    cap_start=True, cap_end=True)
    parts.append(lib.assign(pipe, m['copper']))
    # The pressure gauge on the right side of the receiver, facing you a bit.
    gauge_center = Vector((0.026, 0.020, 0.052))
    ring = lib.cylinder_mesh('gauge_ring', gauge_center, 0.016, 0.008, 'x', rotation=(0, math.pi / 2, -0.5), vertices=12)
    parts.append(lib.assign(ring, m['brass']))
    face = lib.cylinder_mesh('gauge_face', gauge_center + Vector((0.0045, -0.0024, 0)), 0.0125, 0.002, 'x',
                             rotation=(0, math.pi / 2, -0.5), vertices=12)
    parts.append(lib.assign(face, m['gauge']))

    frame = join('frame', parts)

    # --- The drum: two engraved brass plates, iron rods between them, the sticks ---
    drum_parts = []
    for y0 in (DRUM_BACK, DRUM_FRONT):
        plate = tube('plate', 0, DRUM_Z, [(y0, DRUM_R * 0.94), (y0 + 0.002, DRUM_R), (y0 + PLATE - 0.002, DRUM_R),
                                           (y0 + PLATE, DRUM_R * 0.94)], m['brass'], n=STICKS * 3, v_scale=12)
        drum_parts.append(plate)
    for k in range(STICKS):  # rods between the chambers: the cage's bars
        a = math.pi / 2 - 2 * math.pi * (k + 0.5) / STICKS
        rod = tube('rod', math.cos(a) * (DRUM_R - 0.006), DRUM_Z + math.sin(a) * (DRUM_R - 0.006),
                   [(DRUM_BACK + PLATE, 0.004), (DRUM_FRONT, 0.004)], m['iron'], n=6)
        drum_parts.append(rod)
    hub = tube('hub', 0, DRUM_Z, [(DRUM_BACK + PLATE, 0.012), (DRUM_FRONT, 0.012)], m['iron'], n=8)
    drum_parts.append(hub)
    drum = join('drum', drum_parts)

    sticks = []
    for k in range(STICKS):
        x, z = chamber(k)
        back = DRUM_BACK - FUSE_OUT * 0.2
        body = tube('stick', x, z, [(back, STICK_R), (DRUM_FRONT + PLATE * 0.6, STICK_R)], m['paper'],
                    n=8, v_scale=1 / ((DRUM_FRONT + PLATE * 0.6) - back))
        # The fuse: out of the back end, bent a little outward (away from the axis), toward you.
        out = Vector((x, 0, z - DRUM_Z)).normalized() * 0.006
        fuse = lib.loft('fuse', [circle(x, back, z, 0.0022, 5),
                                 circle(x + out.x, back - FUSE_OUT, z + out.z, 0.0022, 5)], cap_end=True)
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

# The launcher's rest pose in the game's viewmodel (viewmodelSettings.dynamite*
# in render/weapons/viewmodel.ts), converted to Blender axes: three.js
# (x, y, z) → Blender (x, -z, y); the turns: pitch around X, yaw around
# Blender Z (= three.js Y), roll around Blender -Y (= three.js Z).
# The preview puts the revolver's right arm there too: does the hand fit the grip?
VIEW_POS = (0.17, 0.42, -0.17)
VIEW_ROT = (0.08, -0.10, 0.07)  # (pitch, roll, yaw): turned a little toward the center, the left flank in view


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
        # From the player's eye, held by the revolver's right arm.
        bpy.ops.import_scene.gltf(filepath=ARMS_GLB)
        for name in ('Arm_L', 'Arm_R_Shotgun'):
            bpy.data.objects[name].hide_render = True
        arm = bpy.data.objects['Arm_R']
        frame.location = VIEW_POS
        frame.rotation_euler = VIEW_ROT
        # The arm is in the gun's coordinates (it's a child of the gun in the game): same transform.
        arm.parent = frame
        arm.matrix_parent_inverse.identity()
        lib.render_frame(os.path.join(PREVIEW_DIR, 'dynamite_eye.png'), 0)
        # Beauty shots: side, from behind (the fuses), three quarters.
        frame.location = (0, 0, 0)
        frame.rotation_euler = (0, 0, 0)
        arm.hide_render = True
        for name, loc, target in (
            ('dynamite_side', (0.42, 0.15, 0.03), (0, 0.15, 0.02)),
            ('dynamite_back', (0.16, -0.26, 0.20), (0, 0.12, 0.04)),
            ('dynamite_front', (0.30, 0.55, 0.16), (0, 0.18, 0.03)),
        ):
            cam.location = loc
            cam.rotation_euler = (Vector(target) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
            lib.render_frame(os.path.join(PREVIEW_DIR, name + '.png'), 0)


main()
