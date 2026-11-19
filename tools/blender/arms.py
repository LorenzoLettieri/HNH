"""
The gunslinger's arms: leather gloves with gauntlet cuffs, the sleeves of a
duster coat. Right hand wrapped around the revolver's grip, left hand open
(it fans the hammer). Exports public/models/arms.glb.

Run with:  npm run models

Coordinates (Blender): X = right, Y = forward, Z = up. The origin is the
viewmodel "holder" (the gun's rest position, see viewmodel.ts): the revolver's
barrel points along +Y and its grip is around (0, -0.03, -0.028). The glTF
exporter turns this into the Three.js holder space (Y up, barrel along -Z).

How it's made:
1. Each arm is modeled once in a CANONICAL pose (arm straight back along -Y,
   wrist at the origin, open hand pointing +Y, palm down) with a skeleton:
   shoulder → upper arm → forearm → hand → 3 bones per finger and thumb.
2. It's POSED like a puppet: IK places the wrist (the elbow follows), and
   each finger joint is rotated to wrap around the grip.
3. The pose is "applied as rest pose": the mesh is frozen in that shape and
   the skeleton's rest pose becomes the posed one. The arms are static for
   now (the left one is moved as a whole by the fanning code), but the
   skeleton is exported, ready for real animations later (reload...).
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'arms.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--no-render' not in sys.argv

# --- Hand proportions (canonical: wrist at origin, fingers +Y, palm -Z) -------
# A bit smaller than a real hand: the viewmodel is a caricature, and a real
# size hand would hide half of the revolver.
PALM_LENGTH = 0.052
PALM_WIDTH = 0.046
FOREARM = 0.25
UPPER_ARM = 0.27
# Fingers: (name, x across the palm for a RIGHT hand, base y, segment lengths, radius)
FINGERS = [
    ('index', -0.016, 0.050, (0.020, 0.014, 0.012), 0.0060),
    ('middle', -0.0055, 0.052, (0.022, 0.015, 0.012), 0.0062),
    ('ring', 0.0055, 0.050, (0.020, 0.014, 0.011), 0.0058),
    ('pinky', 0.0160, 0.046, (0.016, 0.011, 0.010), 0.0050),
]
THUMB = ((0.020, 0.015, 0.012), 0.0068)

# --- The revolver's grip (from revolverModel.ts, converted to Blender axes) ---
GRIP_CENTER = Vector((0.0, -0.03, -0.028))
GRIP_TILT = 0.35  # the grip leans back by this angle (radians)
GRIP_HALF_WIDTH = 0.012


# ============================================================================
# Textures
# ============================================================================

def glove_texture():
    p = lib.Pixels(16, 16, (150, 100, 58))  # light tan: it must stand out against the dark revolver
    r = lib.rng(11)
    for _ in range(18):
        p.set(r.randrange(16), r.randrange(16), (130, 86, 50))  # worn spots
    for y in range(0, 16, 2):
        p.set(4, y, (196, 150, 96))  # a stitched seam on the back of the hand / fingers
    return p.to_image('glove')


def gauntlet_texture():
    """The flared cuff of a cowboy glove: darker leather, stitched border."""
    p = lib.Pixels(16, 16, (112, 72, 42))
    r = lib.rng(12)
    for _ in range(14):
        p.set(r.randrange(16), r.randrange(16), (96, 62, 36))
    for x in range(0, 16, 2):
        p.set(x, 13, (160, 116, 70))  # stitches along the edge
    for x in range(16):
        p.set(x, 15, (60, 36, 20))
    return p.to_image('gauntlet')


def sleeve_texture():
    """Dusty duster-coat canvas, with a darker cuff band at v ≈ 0."""
    p = lib.Pixels(16, 32, (104, 94, 80))
    r = lib.rng(13)
    for _ in range(40):
        p.set(r.randrange(16), r.randrange(32), (90, 80, 68))
    for y in range(4, 32, 6):  # folds
        for x in range(16):
            if r.random() < 0.5:
                p.set(x, y, (82, 74, 62))
    for y in range(0, 3):
        for x in range(16):
            p.set(x, y, (70, 60, 50))  # cuff band
    return p.to_image('sleeve')


# ============================================================================
# One arm, in the canonical pose
# ============================================================================

def finger_tube(name, base, direction, lengths, radius, bone_names, mats, side):
    """A finger: 3 tapered tubes along `direction`, each rigidly on its own bone."""
    objs = []
    d = Vector(direction).normalized()
    # Two axes perpendicular to the finger, for the ring planes.
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    ax = d.cross(up).normalized()
    ay = ax.cross(d).normalized()
    p = Vector(base)
    r = radius
    for i, (length, bone) in enumerate(zip(lengths, bone_names)):
        # Each segment slightly overlaps the previous one: no gaps when bent.
        start = p - d * (r * 0.6 if i else 0.004)
        end = p + d * length
        r2 = r * 0.9
        rings = [lib.ellipse_ring(start, ax, ay, r, r * 0.85, n=6),
                 lib.ellipse_ring(end, ax, ay, r2, r2 * 0.85, n=6)]
        objs.append(lib.assign(lib.loft(f'{name}{i}', rings, [{bone: 1.0}] * 2, v_scale=20,
                                        cap_start=True, cap_end=True), mats))
        p = end
        r = r2
    return objs, p


def build_arm(side):
    """
    side = +1 for the right arm, -1 for the left (mirrored across X).
    Returns (armature object, mesh object), canonical pose, armature at the origin.
    """
    sfx = '_R' if side > 0 else '_L'
    m_glove = lib.material('glove', glove_texture(), roughness=0.75)
    m_gaunt = lib.material('gauntlet', gauntlet_texture(), roughness=0.8)
    m_sleeve = lib.material('sleeve', sleeve_texture(), roughness=1.0)

    # --- Skeleton ---
    data = bpy.data.armatures.new('Arm' + sfx)
    rig = bpy.data.objects.new('Arm' + sfx, data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = data.edit_bones

    def bone(name, head, tail, parent=None, connect=False, deform=True):
        b = eb.new(name + sfx)
        b.head, b.tail = Vector(head), Vector(tail)
        b.parent = eb[parent + sfx] if parent else None
        b.use_connect = connect
        b.use_deform = deform
        b.roll = 0
        return b

    shoulder = Vector((0, -FOREARM - UPPER_ARM, 0))
    # The elbow is bent a tiny bit in the rest pose: with a perfectly straight
    # arm, "which way does the elbow point" is undefined and the IK + pole
    # gets stuck (the leg works because its knee is bent by 1 cm too).
    elbow = Vector((0, -FOREARM, -0.012))
    bone('shoulder', shoulder + Vector((0, 0, 0.05)), shoulder)
    bone('upper', shoulder, elbow, 'shoulder')
    bone('forearm', elbow, (0, 0, 0), 'upper', connect=True)
    bone('hand', (0, 0, 0), (0, PALM_LENGTH, 0), 'forearm', connect=True)
    finger_bones = {}
    for name, x, by, lengths, _ in FINGERS:
        x *= side
        names, p, parent = [], Vector((x, by, 0)), 'hand'
        for i, length in enumerate(lengths):
            n = f'{name}{i}'
            bone(n, p, p + Vector((0, length, 0)), parent, connect=i > 0)
            names.append(n + sfx)
            p = p + Vector((0, length, 0))
            parent = n
        finger_bones[name] = names
    # Thumb: from the side of the palm, pointing forward and outward.
    tdir = Vector((-0.6 * side, 0.8, -0.15)).normalized()
    tbase = Vector((-0.019 * side, 0.012, -0.004))
    names, p, parent = [], tbase, 'hand'
    for i, length in enumerate(THUMB[0]):
        n = f'thumb{i}'
        b = bone(n, p, p + tdir * length, parent, connect=i > 0)
        names.append(n + sfx)
        p = p + tdir * length
        parent = n
    finger_bones['thumb'] = names
    # Controls (not exported): where the wrist goes, and where the elbow points.
    bone('hand_ik', (0, 0, 0), (0, PALM_LENGTH, 0), deform=False)
    bone('elbow_pole', (0.3 * side, -FOREARM, -0.2), (0.3 * side, -FOREARM, -0.15), deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # --- Mesh ---
    parts = []
    # Palm: a flattened tube from the wrist to the knuckles.
    palm_rings = [lib.ellipse_ring((0, y, 0), (1, 0, 0), (0, 0, 1), rx, rz, n=8)
                  for y, rx, rz in ((-0.004, 0.019, 0.012), (0.026, PALM_WIDTH / 2, 0.012), (PALM_LENGTH, PALM_WIDTH / 2 - 0.001, 0.010))]
    parts.append(lib.assign(lib.loft('palm', palm_rings, [{'hand' + sfx: 1.0}] * 3, v_scale=20, cap_start=True, cap_end=True), m_glove))
    for name, x, by, lengths, radius in FINGERS:
        objs, _ = finger_tube(name, (x * side, by, 0), (0, 1, 0), lengths, radius, finger_bones[name], m_glove, side)
        parts += objs
    objs, _ = finger_tube('thumb', tbase, tdir, THUMB[0], THUMB[1], finger_bones['thumb'], m_glove, side)
    parts += objs

    # Gauntlet cuff: flares out from the wrist toward the elbow (open at the back).
    g = [(0.006, 0.02, 0.013), (-0.015, 0.022, 0.017), (-0.035, 0.027, 0.022), (-0.055, 0.031, 0.026)]
    g_rings = [lib.ellipse_ring((0, y, 0), (1, 0, 0), (0, 0, 1), rx, rz, n=8) for y, rx, rz in g]
    y, rx, rz = g[-1]
    g_rings.append(lib.ellipse_ring((0, y + 0.002, 0), (1, 0, 0), (0, 0, 1), rx * 0.85, rz * 0.85, n=8))  # lip
    g_w = [{'hand' + sfx: 1.0}] + [{'forearm' + sfx: 1.0}] * 4
    parts.append(lib.assign(lib.loft('gauntlet', g_rings, g_w, v_scale=1 / 0.07), m_gaunt))

    # Duster sleeve: forearm and upper arm, wider toward the shoulder, a cuff band.
    s = [(-0.04, 0.022, 0.02), (-0.12, 0.024, 0.022), (-FOREARM + 0.02, 0.026, 0.024), (-FOREARM, 0.027, 0.025),
         (-FOREARM - 0.02, 0.028, 0.026), (-FOREARM - UPPER_ARM, 0.032, 0.03)]
    # The sleeve follows the slightly bent arm (rings centered on the bones).
    def on_arm(y):
        if y >= -FOREARM:
            return Vector((0, y, elbow.z * (y / -FOREARM)))
        k = (y + FOREARM) / -UPPER_ARM
        return Vector((0, y, elbow.z * (1 - k)))
    s_rings = [lib.ellipse_ring(on_arm(y), (1, 0, 0), (0, 0, 1), rx, rz, n=8) for y, rx, rz in s]
    s_w = []
    for y, _, _ in s:
        if y > -FOREARM + 0.01:
            s_w.append({'forearm' + sfx: 1.0})
        elif y < -FOREARM - 0.01:
            s_w.append({'upper' + sfx: 1.0})
        else:
            s_w.append({'forearm' + sfx: 0.5, 'upper' + sfx: 0.5})
    parts.append(lib.assign(lib.loft('sleeve', s_rings, s_w, v_scale=1 / 0.3, cap_start=True, cap_end=True), m_sleeve))

    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.active_object
    mesh.name = 'ArmMesh' + sfx
    bpy.ops.object.shade_flat()
    mesh.parent = rig
    mod = mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig

    # IK: the wrist follows hand_ik (and copies its rotation), the elbow points at the pole.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    ik = rig.pose.bones['forearm' + sfx].constraints.new('IK')
    ik.target, ik.subtarget = rig, 'hand_ik' + sfx
    ik.pole_target, ik.pole_subtarget = rig, 'elbow_pole' + sfx
    ik.chain_count = 2
    rot = rig.pose.bones['hand' + sfx].constraints.new('COPY_ROTATION')
    rot.target, rot.subtarget = rig, 'hand_ik' + sfx
    best = None
    for deg in (0, 90, -90, 180):
        ik.pole_angle = math.radians(deg)
        bpy.context.view_layer.update()
        err = (rig.pose.bones['forearm' + sfx].head - elbow).length
        if best is None or err < best[0]:
            best = (err, deg)
    ik.pole_angle = math.radians(best[1])
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig, mesh, finger_bones


# ============================================================================
# Posing
# ============================================================================

def place(rig, name, head, rot3=None):
    """Moves pose bone `name` so its head is at `head` (armature space), rotated by rot3 from rest."""
    pb = rig.pose.bones[name]
    rest = rig.data.bones[name].matrix_local
    r = (rot3 if rot3 is not None else Matrix.Identity(3)) @ rest.to_3x3()
    pb.matrix = Matrix.Translation(Vector(head)) @ r.to_4x4()
    bpy.context.view_layer.update()


def curl(rig, names, angles_deg, axis='X'):
    """Bends a chain of finger bones (local rotations, degrees)."""
    for n, a in zip(names, angles_deg):
        pb = rig.pose.bones[n]
        pb.rotation_mode = 'XYZ'
        e = [0.0, 0.0, 0.0]
        e['XYZ'.index(axis)] = math.radians(a)
        pb.rotation_euler = e
    bpy.context.view_layer.update()


def freeze_pose(rig, mesh):
    """Applies the current pose as the new rest pose (mesh and skeleton), drops the controls."""
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.modifier_apply(modifier='Armature')
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)  # also removes the constraints' effect from now on
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    bpy.ops.object.mode_set(mode='EDIT')
    for n in [b.name for b in rig.data.edit_bones if b.name.startswith(('hand_ik', 'elbow_pole'))]:
        rig.data.edit_bones.remove(rig.data.edit_bones[n])
    bpy.ops.object.mode_set(mode='OBJECT')
    mod = mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig


def pose_right(rig, finger_bones):
    """Right hand wrapped around the grip, index finger on the trigger."""
    s, c = math.sin(GRIP_TILT), math.cos(GRIP_TILT)
    up = Vector((0, -s, c))       # along the grip, toward the frame
    fwd = Vector((0, c, s))       # toward the muzzle side of the grip
    # Hand orientation: canonical X (index → pinky) goes DOWN the grip, Y
    # (fingers) forward, Z (back of the hand) out to the right.
    m = Matrix((-up, fwd, Vector((1, 0, 0)))).transposed()
    palm_center = GRIP_CENTER + Vector((GRIP_HALF_WIDTH + 0.011, 0, 0)) + up * 0.006
    wrist = palm_center - fwd * (PALM_LENGTH * 0.55)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    # Shoulder: behind, below and to the right, off screen.
    place(rig, 'shoulder_R', Vector((0.2, -0.48, -0.25)) + Vector((0, 0, 0.05)))
    place(rig, 'elbow_pole_R', (0.4, -0.25, -0.6))
    place(rig, 'hand_ik_R', wrist, m)
    # Fingers wrap around the front of the grip (toward the palm = negative X rotation).
    curl(rig, finger_bones['middle'], (-95, -80, -50))
    curl(rig, finger_bones['ring'], (-95, -85, -55))
    curl(rig, finger_bones['pinky'], (-90, -85, -55))
    curl(rig, finger_bones['index'], (-55, -60, -35))  # on the trigger, less closed
    curl(rig, finger_bones['thumb'], (-35, -25, -15), axis='Z')


def pose_left(rig, finger_bones):
    """
    Left hand open, palm down: the fanning code moves it as a whole, with its
    PALM CENTER at the armature's origin (that's the point the keyframes in
    hands.ts describe). The forearm goes back-left, out of the screen.
    """
    # Wrist slightly bent: the hand turns a bit inward (toward the gun).
    m = Euler((0, 0, math.radians(-25))).to_matrix()
    # The wrist sits half a palm behind the palm center, along the (turned) hand.
    wrist = -(m @ Vector((0, PALM_LENGTH * 0.5, 0)))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    place(rig, 'shoulder_L', Vector((-0.42, -0.32, -0.36)) + Vector((0, 0, 0.05)))
    place(rig, 'elbow_pole_L', (-0.5, -0.1, -0.6))
    place(rig, 'hand_ik_L', wrist, m)
    for name in ('index', 'middle', 'ring', 'pinky'):
        curl(rig, finger_bones[name], (-12, -10, -6))  # relaxed, slightly curved
    curl(rig, finger_bones['thumb'], (-10, -5, 0), axis='Z')


# ============================================================================
# Previews and export
# ============================================================================

def revolver_proxy():
    """A rough copy of revolverModel.ts, ONLY for the previews (not exported)."""
    objs = []
    def blk(c, size, rot=(0, 0, 0), col=(70, 70, 80)):
        o = lib.box_mesh('gun', c, size, 'none', rotation=rot)
        lib.assign(o, lib.material('gunmat', color=col, roughness=0.5))
        objs.append(o)
    blk((0, 0.135, 0.034), (0.02, 0.17, 0.02))                      # barrel
    blk((0, 0.02, 0.024), (0.026, 0.075, 0.045))                    # frame
    blk((0, 0.028, 0.026), (0.04, 0.046, 0.04))                     # cylinder
    blk((0, -0.03, -0.028), (0.024, 0.034, 0.08), (GRIP_TILT, 0, 0), (150, 90, 50))  # grip
    blk((0, 0.014, 0.002), (0.004, 0.004, 0.016))                   # trigger
    return objs


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x, scene.render.resolution_y = 480, 270
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.09, 0.03, 1)
    scene.world = world
    sun = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = Vector((-1, -1.5, 2)).normalized().to_track_quat('Z', 'Y').to_euler()
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('eye', bpy.data.cameras.new('eye'))
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(55)
    cam.data.clip_start = 0.01
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim(cam, pos, target):
    cam.location = pos
    cam.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()


def main():
    lib.reset_scene(60)
    rig_r, mesh_r, fingers_r = build_arm(+1)
    pose_right(rig_r, fingers_r)
    freeze_pose(rig_r, mesh_r)
    rig_l, mesh_l, fingers_l = build_arm(-1)
    pose_left(rig_l, fingers_l)
    freeze_pose(rig_l, mesh_l)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (rig_r, mesh_r, rig_l, mesh_l):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_def_bones=True, export_skins=True)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        revolver_proxy()
        # In the game the left hand rests below the screen; for the preview,
        # put it where it is at the moment it slaps the hammer.
        rig_l.location = (-0.006, 0.025, 0.084)
        cam = setup_render()
        # The game's viewmodel camera, seen from the holder: the holder sits at
        # (0.11, -0.115, -0.36) in camera space (Three.js) → the eye is at
        # (-0.11, -0.36, 0.115) in Blender holder space, looking forward.
        cam.location = (-0.11, -0.36, 0.115)
        cam.rotation_euler = (math.radians(90), 0, 0)
        bpy.context.scene.render.filepath = os.path.join(PREVIEW_DIR, 'arms_eye.png')
        bpy.ops.render.render(write_still=True)
        aim(cam, (0.35, 0.05, 0.05), (0.02, -0.03, -0.02))
        bpy.context.scene.render.filepath = os.path.join(PREVIEW_DIR, 'arms_right_side.png')
        bpy.ops.render.render(write_still=True)
        aim(cam, (-0.3, 0.1, 0.05), (0.0, -0.03, -0.02))
        bpy.context.scene.render.filepath = os.path.join(PREVIEW_DIR, 'arms_left_side.png')
        bpy.ops.render.render(write_still=True)


main()
