"""
The kicking leg: the left leg of the gunslinger, jeans tucked into a cowboy
boot with a spur. Builds the model, its skeleton and the "kick" animation,
renders preview images and exports public/models/leg.glb.

Run it with:  npm run models   (or tools/blender/.venv/bin/python tools/blender/leg.py)

Coordinates (Blender): X = right, Y = forward, Z = up. The ORIGIN IS YOUR
EYE: the leg is a viewmodel, it's modeled and animated in camera space, the
same way the revolver lives in the viewmodel scene. The hip is cheated a
bit higher and closer than a real hip: like every FPS, what matters is what
reads well on screen, not anatomy.

How the animation is made (the same way an animator would do it by hand):
1. A SKELETON (armature): hip → thigh → shin → foot. The mesh is "skinned":
   each vertex follows one or two bones with a weight (vertex groups).
2. IK (inverse kinematics): instead of rotating thigh and shin one by one,
   we move a TARGET where the ankle should be, and Blender computes the hip
   and knee angles to reach it (a "pole" decides which way the knee points).
   Like placing a foot where you want it and letting the leg follow.
3. Keyframes on the target (where the ankle is, how the foot is turned) at
   a few frames; Blender interpolates between them with Bézier curves.
4. BAKE: the IK result is converted into plain bone rotations, one key per
   frame. glTF (and Three.js) know nothing about IK: they just play rotations.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'leg.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--no-render' not in sys.argv

FPS = 60

# --- Proportions: the two knobs to play with ---------------------------------
LEG_STRETCH = 1.2  # leg length ×: a longer leg makes the kick land further from you
BOOT_SCALE = 0.8   # boot size ×

# --- Skeleton in "design space": the shapes below are drawn around these -----
# (rest pose: standing, leg straight down). The proportions are applied AFTER
# building, as two scale transforms (see BOOT_MATRIX / LEG_MATRIX): all the
# numbers in the shape tables can stay as they are.
HIP = Vector((-0.25, 0.0, -0.75))
KNEE_D = Vector((-0.25, 0.012, -1.2))
ANKLE_D = Vector((-0.25, 0.0, -1.63))
TOE_D = Vector((-0.25, 0.24, -1.73))
GROUND = -1.76


def scale_about(center, sx, sy, sz):
    """Scale matrix around a point: move the point to the origin, scale, move back."""
    c = Vector(center)
    return Matrix.Translation(c) @ Matrix.Diagonal((sx, sy, sz, 1.0)) @ Matrix.Translation(-c)


# 1. The boot shrinks around the ankle. Its height is divided by LEG_STRETCH
#    because step 2 will stretch it back: the net effect is a uniform BOOT_SCALE.
BOOT_MATRIX = scale_about(ANKLE_D, BOOT_SCALE, BOOT_SCALE, BOOT_SCALE / LEG_STRETCH)
# 2. The whole leg stretches downward from the hip (the leg is vertical in the
#    rest pose, so scaling Z = making it longer, not thicker).
LEG_MATRIX = scale_about(HIP, 1, 1, LEG_STRETCH)

# The real skeleton, after the two transforms.
KNEE = LEG_MATRIX @ KNEE_D
ANKLE = LEG_MATRIX @ ANKLE_D
TOE = LEG_MATRIX @ BOOT_MATRIX @ TOE_D

# --- Kick timing (frames at 60 fps) ------------------------------------------
# IMPACT_FRAME / 60 must match tuning.kickWindup (0.08 s ≈ frame 5): the game
# scales the clip so this frame lands exactly when the simulation deals damage.
CHAMBER_FRAME = 3   # knee up, foot pulled in
IMPACT_FRAME = 5    # leg extended: the boot hits
HOLD_FRAME = 10     # still out, pushing a little more
RECHAMBER_FRAME = 17
END_FRAME = 27      # back to standing (out of view)


# ============================================================================
# Textures (pixel art, generated)
# ============================================================================

TAN = (150, 94, 52)
CREAM = (232, 198, 140)


# Low-res and few colors, like the hands and the revolver (8-32 px): at the
# game's 270-pixel vertical resolution, more detail would just turn to mush.
# Rule of thumb: about as many texels per meter as the other viewmodel parts.

def jeans_texture():
    p = lib.Pixels(16, 32, (70, 82, 108))
    r = lib.rng(1)
    for y in range(32):
        for x in range(16):
            if (x + y) % 4 == 0:  # the diagonal "twill" weave of denim
                p.set(x, y, (82, 96, 124))
    for y in range(32):  # outer side seam (u = 0.5) with the orange stitching of real jeans
        p.set(8, y, (50, 58, 80))
        if y % 2 == 0:
            p.set(9, y, (205, 135, 60))
    for _ in range(6):  # creases: short darker dashes
        x, y = r.randrange(16), r.randrange(32)
        for k in range(r.randrange(2, 5)):
            p.set(x + k, y, (52, 60, 82))
    return p.to_image('jeans')


def shaft_texture():
    """Boot shaft: tan leather with the classic stitched arches front and back."""
    p = lib.Pixels(32, 32, TAN)
    r = lib.rng(2)
    for _ in range(40):  # a few darker scuffs, not a noisy grain
        p.set(r.randrange(32), r.randrange(32), lib.shade(TAN, 0.85))
    for cx in (8, 24):  # u = 0.25 (front) and 0.75 (back)
        for w, top in ((5, 26), (3, 23)):  # two nested "gothic arches"
            for y in range(4, top - w):
                if y % 2 == 0:
                    p.set(cx - w, y, CREAM)
                    p.set(cx + w, y, CREAM)
            for s in range(0, 12):
                a = math.pi * s / 11
                if s % 2 == 0:
                    p.set(cx + round(math.cos(a) * w), top - w + round(math.sin(a) * w), CREAM)
    for y in range(29, 32):  # dark band at the top of the shaft
        for x in range(32):
            p.set(x, y, (92, 54, 30))
    return p.to_image('boot_shaft')


def vamp_texture():
    """The foot of the boot: darker leather, a stitched toe cap."""
    p = lib.Pixels(32, 16, (122, 72, 40))
    for y in range(11, 16):  # toe cap (v > 0.7), a bit darker
        for x in range(32):
            p.set(x, y, (100, 58, 32))
    for x in range(0, 32, 2):  # stitching across the toe cap
        p.set(x, 10, CREAM)
    for y in range(0, 10, 2):  # a stitched line down the middle of the instep (u = 0.25 = top)
        p.set(8, y, CREAM)
    return p.to_image('boot_vamp')


def sole_texture():
    p = lib.Pixels(8, 8, (46, 32, 24))
    for x in range(8):
        p.set(x, 7, (70, 50, 36))  # a lighter edge
    return p.to_image('boot_sole')


# ============================================================================
# Geometry
# ============================================================================

def lerp_table(table, t):
    """Linear interpolation in a [(t, value), ...] table (sorted by t)."""
    if t <= table[0][0]:
        return table[0][1]
    for (t0, v0), (t1, v1) in zip(table, table[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0)
            if isinstance(v0, tuple):
                return tuple(a + (b - a) * k for a, b in zip(v0, v1))
            return v0 + (v1 - v0) * k
    return table[-1][1]


# Foot of the boot, from heel to toe: y -> (half width, height above the sole).
FOOT = [
    (-0.078, (0.030, 0.075)),
    (-0.050, (0.044, 0.112)),
    (0.000, (0.046, 0.125)),
    (0.080, (0.050, 0.088)),
    (0.170, (0.049, 0.056)),
    (0.240, (0.032, 0.038)),
    (0.290, (0.006, 0.020)),
]
# Top of the sole along the foot: the heel lifts the back of the foot, the
# toe curls up a little ("toe spring"). This slope IS the cowboy-boot look.
SOLE_TOP = [(-0.08, GROUND + 0.052), (0.03, GROUND + 0.050), (0.13, GROUND + 0.016), (0.29, GROUND + 0.026)]


def foot_ring(y, scale=1.0, n=8):
    hw, h = lerp_table([(t, v) for t, v in FOOT], y)
    zb = lerp_table(SOLE_TOP, y)
    center = (HIP.x, y, zb + h * 0.45)
    return lib.ellipse_ring(center, (1, 0, 0), (0, 0, 1), hw * scale, h * 0.55 * scale, n=n, flat_bottom=-h * 0.45 * scale)


def build_meshes():
    m_jeans = lib.material('jeans', jeans_texture(), roughness=1.0)
    m_shaft = lib.material('boot_shaft', shaft_texture(), roughness=0.6)
    m_vamp = lib.material('boot_vamp', vamp_texture(), roughness=0.55)
    m_sole = lib.material('boot_sole', sole_texture(), roughness=0.9)
    m_dark = lib.material('dark_leather', color=(70, 40, 22), roughness=0.7)
    m_brass = lib.material('brass', color=(210, 160, 70), roughness=0.4, metallic=0.3)
    m_steel = lib.material('steel', color=(170, 170, 180), roughness=0.4, metallic=0.3)
    parts = []

    # --- Jeans: rings down the leg, more of them around the knee so it bends cleanly ---
    jeans_rings, jeans_w = [], []
    for z, rx, ry in [(-0.6, 0.09, 0.092), (-0.75, 0.088, 0.09), (-0.9, 0.08, 0.082), (-1.03, 0.072, 0.074),
                      (-1.12, 0.066, 0.068), (-1.17, 0.064, 0.066), (-1.2, 0.063, 0.066), (-1.23, 0.064, 0.067),
                      (-1.28, 0.062, 0.064), (-1.34, 0.058, 0.06), (-1.40, 0.048, 0.05), (-1.46, 0.045, 0.047),
                      (-1.52, 0.042, 0.044)]:  # the last ones go down inside the (smaller) boot
        # The knee sticks out a little forward.
        y = 0.012 * max(0.0, 1 - abs(z - KNEE_D.z) / 0.08)
        jeans_rings.append(lib.ellipse_ring((HIP.x, y, z), (1, 0, 0), (0, 1, 0), rx, ry, n=6))
        # Skin weights: thigh above the knee, shin below, a blend around it.
        k = min(1.0, max(0.0, (KNEE_D.z + 0.06 - z) / 0.12))  # 0 above, 1 below
        jeans_w.append({'thigh': 1 - k, 'shin': k} if 0 < k < 1 else ({'thigh': 1.0} if k == 0 else {'shin': 1.0}))
    parts.append(lib.assign(lib.loft('jeans', jeans_rings, jeans_w, v_scale=2.0, cap_start=True), m_jeans))

    # --- Boot shaft: rings up the shin, flaring at the top, with the V dips ---
    def dip(a):
        return -0.032 * abs(math.sin(a))  # front and back lower than the sides

    shaft_rings, shaft_w = [], []
    shaft = [(-1.70, 0.047, 0.054), (-1.62, 0.049, 0.056), (-1.52, 0.054, 0.059), (-1.42, 0.06, 0.064),
             (-1.33, 0.068, 0.071), (-1.29, 0.073, 0.076)]
    for i, (z, rx, ry) in enumerate(shaft):
        top = i == len(shaft) - 1
        shaft_rings.append(lib.ellipse_ring((HIP.x, 0.004, z), (1, 0, 0), (0, 1, 0), rx, ry, n=8, z_wobble=dip if top else None))
        shaft_w.append({'shin': 0.5, 'foot': 0.5} if z < -1.6 else {'shin': 1.0})
    # The lip: fold over the top edge and go down inside (it shows the boot is hollow).
    z, rx, ry = shaft[-1]
    shaft_rings.append(lib.ellipse_ring((HIP.x, 0.004, z), (1, 0, 0), (0, 1, 0), rx * 0.88, ry * 0.88, n=8, z_wobble=dip))
    shaft_rings.append(lib.ellipse_ring((HIP.x, 0.004, z - 0.06), (1, 0, 0), (0, 1, 0), rx * 0.84, ry * 0.84, n=8, z_wobble=dip))
    shaft_w += [{'shin': 1.0}, {'shin': 1.0}]
    parts.append(lib.assign(lib.loft('shaft', shaft_rings, shaft_w, v_scale=1 / 0.42), m_shaft))

    # Pull straps on the sides (where the shaft is highest).
    for side in (-1, 1):
        parts.append(lib.assign(lib.box_mesh('strap', (HIP.x + side * 0.072, 0.004, -1.255), (0.006, 0.02, 0.05), 'shin'), m_dark))

    # --- Foot (the "vamp"): D-shaped rings from heel to the pointed toe ---
    ys = [y for y, _ in FOOT]
    parts.append(lib.assign(lib.loft('vamp', [foot_ring(y) for y in ys], [{'foot': 1.0}] * len(ys),
                                     v_scale=1 / 0.37, cap_start=True, cap_end=True), m_vamp))

    # --- Sole: a thin slab under the foot outline ---
    sole_rings = []
    for y in ys:
        hw, _ = lerp_table(FOOT, y)
        z = lerp_table(SOLE_TOP, y)
        sole_rings.append(lib.ellipse_ring((HIP.x, y, z - 0.008), (1, 0, 0), (0, 0, 1), hw + 0.006, 0.009, n=6))
    parts.append(lib.assign(lib.loft('sole', sole_rings, [{'foot': 1.0}] * len(ys), v_scale=3, cap_start=True, cap_end=True), m_sole))

    # --- Heel block: wider on top, slanted front face (the "cuban" cowboy heel) ---
    top_z = lerp_table(SOLE_TOP, -0.02) - 0.016
    heel = [
        [Vector((HIP.x + x, y, top_z)) for x, y in ((-0.036, -0.074), (0.036, -0.074), (0.038, 0.028), (-0.038, 0.028))],
        [Vector((HIP.x + x, y, GROUND)) for x, y in ((-0.03, -0.066), (0.03, -0.066), (0.03, 0.0), (-0.03, 0.0))],
    ]
    parts.append(lib.assign(lib.loft('heel', heel, [{'foot': 1.0}] * 2, v_scale=4, cap_start=True, cap_end=True,
                                     outward_hint=(HIP.x, -0.02, top_z - 0.02)), m_sole))

    # --- Spur: a band around the heel, a shank sticking back, a star-shaped rowel ---
    band_z = GROUND + 0.075
    band, cy = [], -0.022
    for s in range(5):
        t = math.pi * s / 4
        c = Vector((HIP.x + math.cos(t) * 0.05, cy - math.sin(t) * 0.062, band_z))
        radial = Vector((math.cos(t), -math.sin(t), 0))
        band.append(lib.ellipse_ring(c, radial, (0, 0, 1), 0.004, 0.007, n=4))
    parts.append(lib.assign(lib.loft('spur_band', band, [{'foot': 1.0}] * len(band), cap_start=True, cap_end=True,
                                     outward_hint=(HIP.x, cy, band_z)), m_steel))
    parts.append(lib.assign(lib.box_mesh('spur_shank', (HIP.x, cy - 0.062 - 0.02, band_z - 0.006), (0.008, 0.04, 0.008), 'foot',
                                         rotation=(math.radians(-15), 0, 0)), m_steel))
    parts.append(lib.assign(lib.star_mesh('rowel', (HIP.x, cy - 0.062 - 0.045, band_z - 0.012), 5, 0.026, 0.009, 0.005, 'foot',
                                          rotation=(0, 0, math.radians(90))), m_steel))

    # --- Spur strap over the instep, with a brass concho on the outer (left) side ---
    strap = [foot_ring(0.03, 1.07), foot_ring(0.055, 1.07)]
    parts.append(lib.assign(lib.loft('spur_strap', strap, [{'foot': 1.0}] * 2, outward_hint=(HIP.x, 0.04, GROUND + 0.09)), m_dark))
    hw, h = lerp_table(FOOT, 0.042)
    concho_z = lerp_table(SOLE_TOP, 0.042) + h * 0.45
    parts.append(lib.assign(lib.cylinder_mesh('concho', (HIP.x - hw * 1.07 - 0.003, 0.042, concho_z), 0.015, 0.006, 'foot',
                                              rotation=(0, math.radians(90), 0), vertices=6), m_brass))

    # Proportions: everything but the jeans (parts[0]) is the boot.
    for o in parts[1:]:
        o.data.transform(BOOT_MATRIX)

    # One object: fewer things to manage in the game (the materials stay separate).
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    leg = bpy.context.active_object
    leg.name = 'Leg'
    leg.data.transform(LEG_MATRIX)
    # FLAT shading: every face has its own normal, so the facets show. That's
    # the retro low-poly look (smooth shading would make it look like clay).
    bpy.ops.object.shade_flat()
    return leg


# ============================================================================
# Skeleton and animation
# ============================================================================

def build_rig():
    data = bpy.data.armatures.new('LegRig')
    rig = bpy.data.objects.new('LegRig', data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False, deform=True):
        b = eb.new(name)
        b.head, b.tail = head, tail
        b.parent = eb[parent] if parent else None
        b.use_connect = connect
        b.use_deform = deform
        return b

    bone('hip', HIP + Vector((0, 0, 0.1)), HIP)
    bone('thigh', HIP, KNEE, 'hip')
    bone('shin', KNEE, ANKLE, 'thigh', connect=True)
    bone('foot', ANKLE, TOE, 'shin', connect=True)
    # Animation controls (not part of the exported skeleton).
    bone('foot_ik', ANKLE, TOE, deform=False)
    bone('knee_pole', Vector((-0.4, 0.6, -0.3)), Vector((-0.4, 0.6, -0.25)), deform=False)
    bpy.ops.object.mode_set(mode='POSE')

    ik = rig.pose.bones['shin'].constraints.new('IK')
    ik.target, ik.subtarget = rig, 'foot_ik'
    ik.pole_target, ik.pole_subtarget = rig, 'knee_pole'
    ik.chain_count = 2
    rot = rig.pose.bones['foot'].constraints.new('COPY_ROTATION')
    rot.target, rot.subtarget = rig, 'foot_ik'

    # The pole angle depends on how the bones are oriented: try the usual
    # candidates and keep the one that leaves the rest pose untouched.
    best = None
    for deg in (0, 90, -90, 180):
        ik.pole_angle = math.radians(deg)
        bpy.context.view_layer.update()
        err = (rig.pose.bones['shin'].head - KNEE).length
        if best is None or err < best[0]:
            best = (err, deg)
    ik.pole_angle = math.radians(best[1])
    bpy.context.view_layer.update()
    return rig


def key_foot(rig, frame, ankle, foot_rot):
    """Puts the IK target at `ankle`, with the foot rotated by `foot_rot` (Euler, degrees), and keys it."""
    pb = rig.pose.bones['foot_ik']
    rest = rig.data.bones['foot_ik'].matrix_local
    r = Euler([math.radians(a) for a in foot_rot], 'XYZ').to_matrix().to_4x4()
    pb.rotation_mode = 'QUATERNION'
    pb.matrix = Matrix.Translation(Vector(ankle)) @ r @ rest.to_3x3().to_4x4()
    bpy.context.view_layer.update()
    pb.keyframe_insert('location', frame=frame)
    pb.keyframe_insert('rotation_quaternion', frame=frame)


def key_hip(rig, frame, pos):
    """Moves the whole leg: the hip is the root of the skeleton. (Viewmodel cheat, see KICK_HIP.)"""
    pb = rig.pose.bones['hip']
    rest = rig.data.bones['hip'].matrix_local
    # A bone's matrix is placed by its HEAD; the hip bone's head sits 10 cm
    # above the hip joint (its tail), so offset by the same amount.
    head = Vector(pos) + (rest.translation - HIP)
    pb.matrix = Matrix.Translation(head) @ rest.to_3x3().to_4x4()
    bpy.context.view_layer.update()
    pb.keyframe_insert('location', frame=frame)


# During the kick the hip slides down-left and a bit BEHIND the eye: the leg
# comes out of the bottom-left corner and goes straight AWAY from you (a
# front kick), and the boot ends up near the center, close and big: toe up,
# sole toward the enemy. Not too far left, or the leg crosses the screen
# sideways and it stops looking like a front kick. Anatomically absurd, but the camera can't
# see your hip, only the boot: every FPS viewmodel cheats like this.
KICK_HIP = (-0.36, -0.05, -0.72)


def animate(rig):
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, END_FRAME
    # (frame, ankle position, foot rotation in degrees: X tips the toe up, Z turns it inward)
    half = tuple((a + b) / 2 for a, b in zip(HIP, KICK_HIP))
    for frame, hip in ((0, HIP), (CHAMBER_FRAME, half), (IMPACT_FRAME, KICK_HIP), (HOLD_FRAME, KICK_HIP),
                       (RECHAMBER_FRAME, half), (END_FRAME, HIP)):
        key_hip(rig, frame, hip)
    key_foot(rig, 0, ANKLE, (0, 0, 0))                                 # standing (below the screen)
    # A RISING kick: at the chamber the foot is already forward but LOW (still
    # below the screen), then it snaps UP and forward into view, and keeps
    # rising a little during the hold (follow-through). Left → center as before.
    key_foot(rig, CHAMBER_FRAME, (-0.24, 0.45, -0.88), (40, 0, -10))   # foot low and forward, out of view
    key_foot(rig, IMPACT_FRAME, (-0.06, 0.75, -0.22), (68, 0, -15))   # BOOM: up into view, toe up, sole forward
    key_foot(rig, HOLD_FRAME, (-0.05, 0.78, -0.16), (72, 0, -15))     # still rising a little
    key_foot(rig, RECHAMBER_FRAME, (-0.22, 0.48, -0.86), (40, 0, -10)) # drops back down
    key_foot(rig, END_FRAME, ANKLE, (0, 0, 0))                         # foot back down

    # Bake: turn IK + constraints into plain per-frame rotations of the real bones.
    bpy.ops.pose.select_all(action='DESELECT')
    for name in ('hip', 'thigh', 'shin', 'foot'):
        rig.pose.bones[name].select = True
    bpy.ops.nla.bake(frame_start=0, frame_end=END_FRAME, only_selected=True, visual_keying=True,
                     clear_constraints=True, use_current_action=True, bake_types={'POSE'})
    rig.animation_data.action.name = 'kick'
    bpy.ops.object.mode_set(mode='OBJECT')


def skin(leg, rig):
    leg.parent = rig
    mod = leg.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


# ============================================================================
# Previews and export
# ============================================================================

def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = 480, 270  # the game's pixel resolution
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.09, 0.03, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    # Key light like the game's viewmodel: from above-left, slightly behind you.
    sun = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = Vector((-1, -1.5, 2)).normalized().to_track_quat('Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    # The same camera as the game's viewmodel: at the eye, looking forward, 55° vertical FOV.
    cam = bpy.data.objects.new('eye', bpy.data.cameras.new('eye'))
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(55)
    cam.data.clip_start = 0.01
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def render(path, frame):
    scene = bpy.context.scene
    scene.frame_set(frame)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    lib.reset_scene(FPS)
    rig = build_rig()
    bpy.ops.object.mode_set(mode='OBJECT')
    leg = build_meshes()
    skin(leg, rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    animate(rig)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    leg.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=True, export_force_sampling=True, export_def_bones=True,
                              export_skins=True)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        cam = setup_render()
        for f in (CHAMBER_FRAME, IMPACT_FRAME, HOLD_FRAME, 13, RECHAMBER_FRAME):
            render(os.path.join(PREVIEW_DIR, f'leg_eye_{f:02d}.png'), f)
        # A "beauty shot" from the side: is it a nice boot?
        cam.location = (0.55, 0.45, -0.2)
        cam.rotation_euler = (Vector((-0.1, 0.5, -0.3)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        render(os.path.join(PREVIEW_DIR, 'leg_side.png'), IMPACT_FRAME)
        cam.location = (-0.25, -0.6, -1.45)
        cam.rotation_euler = (Vector((-0.25, 0.08, -1.66)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        render(os.path.join(PREVIEW_DIR, 'leg_rest_back.png'), 0)
        cam.location = (-2.2, 0.05, -1.25)  # far to the side: the whole leg, to judge the proportions
        cam.rotation_euler = (Vector((-0.25, 0.05, -1.3)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
        render(os.path.join(PREVIEW_DIR, 'leg_rest_side.png'), 0)


main()
