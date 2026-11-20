"""
The arms holding the lever-action carbine: public/models/rifleArms.glb.

Like the other arms in public/models/arms.glb, they come from "PSX First
Person Arms" (assets-src/psx-arms/, CC0): the rigged model is posed with
its own IK (inverse kinematics: you say where the HAND goes, the solver bends
shoulder and elbow to get it there) and then BAKED, i.e. the deformed
vertices are frozen into a plain mesh. No skeleton reaches the game.

What's new here compared to arms.glb:
  - TWO hands on one gun: Arm_R_Rifle on the wrist of the stock, fingers
    through the lever's loop; Arm_L_Rifle under the fore-end;
  - the right arm is baked TWICE, with the lever shut and with the lever
    open (the hand rides down with it), and the second bake becomes a
    SHAPE KEY of the first ("morph target" in glTF/Three.js): same
    vertices, two positions each. The game slides between the two with a
    single weight (hands.ts, setLever).

Where the gun is matters: an arm posed for a gun held low on the right has
its shoulder in the right place only if the game holds the gun there. So
VIEW below must match viewmodelSettings.rifle* in
src/render/weapons/viewmodel.ts (the hip pose). Change one, change both and
re-run this script.

Everything in the output is in the CARBINE's coordinates (origin = the
right hand on the wrist, like rifle.glb), so the game just puts the arms
inside the gun's group.

Run with: tools/blender/.venv/bin/python tools/blender/rifle_arms.py [--render]
"""
import math
import os
import sys

import bpy  # first: it sets Blender up (bmesh and mathutils come with it)
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
RIG_BLEND = os.path.join(ROOT, 'assets-src', 'psx-arms', 'arms_rig.blend')
ARMS_GLB = os.path.join(ROOT, 'public', 'models', 'arms.glb')  # only for its two materials
RIFLE_GLB = os.path.join(ROOT, 'public', 'models', 'rifle.glb')  # only for the preview
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'rifleArms.glb')
PREVIEW_DIR = os.path.join(os.path.dirname(__file__), 'previews')
RENDER = '--render' in sys.argv

# The gun's hip pose in the game (viewmodelSettings.rifle*): position in
# meters and rotation in radians, in THREE.JS coordinates (x right, y up,
# z toward you), Euler order XYZ.
VIEW = dict(x=0.18, y=-0.12, z=-0.36, pitch=0.05, yaw=0.1, roll=-0.15)

# The lever (from rifle.py): pin position (carbine coordinates, Blender
# axes: x right, y forward, z up) and how far it opens (rifleView.ts).
LEVER_PIN = Vector((0.0, 0.0891, 0.0009))
LEVER_OPEN = 0.85

# Hands are 82% of the original, like in arms.glb.
HAND_SCALE = 0.82

# --- Where the hands go, carbine coordinates (Blender axes) --------------
# Each hand is described by:
#   wrist   where the hand bone starts (the wrist joint);
#   fingers the direction from the wrist to the knuckles;
#   index   the direction from the pinky's knuckle to the index's;
#   elbow   a point the elbow bends toward (the IK "pole");
#   curl    how much each finger bends (radians per joint: 3 joints).
RIGHT = dict(
    # On the right side of the wrist of the stock, the palm against it,
    # the knuckle line along the wrist (index forward, toward the trigger),
    # the fingers wrapping under it through the lever's loop.
    wrist=Vector((0.03, -0.005, 0.03)),
    fingers=Vector((-0.2, 0.2, -1.0)),
    index=Vector((0.0, 1.0, 0.3)),
    elbow=Vector((0.3, -0.25, -0.35)),
    curl=dict(index=0.35, middle=0.9, ring=0.95, pinky=1.0, thumb=0.5),
    shoulder=Vector((0, 0, 0)),
)
LEFT = dict(
    # Under the fore-end, palm up, fingers wrapping around its right side.
    wrist=Vector((-0.045, 0.31, -0.06)),
    fingers=Vector((1.0, 0.3, 0.45)),
    index=Vector((0.0, 1.0, 0.0)),
    elbow=Vector((-0.6, -0.15, -0.3)),
    curl=dict(index=0.8, middle=0.85, ring=0.9, pinky=0.95, thumb=0.3),
    # The fore-end is farther than a real arm reaches from where the gun is
    # held on screen: the shoulder is moved forward (eye space, meters:
    # right, forward, up). It's out of the view anyway: every FPS cheats so.
    shoulder=Vector((0.0, 0.3, -0.12)),
)

# --- The rolled-up shirt sleeves (like arms.glb's) ----------------------------
SLEEVE_SIDES = 8
SLEEVE_RADIUS_UPPER = 0.07  # around the upper arm
SLEEVE_RADIUS_ELBOW = 0.068
SLEEVE_RADIUS_FOREARM = 0.06
SLEEVE_ROLL = 0.42  # where the roll sits, fraction of the forearm from the elbow
SLEEVE_ROLL_WIDTH = 0.035  # meters
SLEEVE_ROLL_EXTRA = 0.011  # how much fatter the roll is
SLEEVE_UV = 7  # plaid repeats around the arm (arms.glb uses ~7)
SLEEVE_V_SCALE = 18  # plaid repeats per meter along the arm


def three_to_blender():
    """Three.js (x, y, z) → Blender (x, -z, y): y-up to z-up, as the glTF exporter does in reverse."""
    return Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def gun_in_rig(eye):
    """
    The carbine's matrix in the rig's space: carbine coordinates → rig coordinates.
    1. the hip pose as Three.js builds it (translate, then rotate X, Y, Z);
    2. converted to Blender axes (C · M · C⁻¹: same transform, other axes);
    3. from the viewmodel camera's space (at the origin, looking +Y) to the
       rig's eye (at `eye`, looking -Y: turned 180° around Z).
    """
    m3 = (Matrix.Translation((VIEW['x'], VIEW['y'], VIEW['z']))
          @ Matrix.Rotation(VIEW['pitch'], 4, 'X')
          @ Matrix.Rotation(VIEW['yaw'], 4, 'Y')
          @ Matrix.Rotation(VIEW['roll'], 4, 'Z'))
    c = three_to_blender()
    return Matrix.Translation(eye) @ Matrix.Rotation(math.pi, 4, 'Z') @ c @ m3 @ c.inverted()


def frame(fingers, index):
    """An orthonormal frame (3×3, columns) from a finger direction and a pinky→index direction."""
    f = fingers.normalized()
    k = (index - f * index.dot(f)).normalized()  # remove the part along f (Gram-Schmidt)
    n = k.cross(f)
    return Matrix((f, k, n)).transposed()


def rest_hand_frame(arm, side):
    """The same frame measured on the rig's REST pose: wrist→middle knuckle, pinky→index knuckle."""
    b = arm.data.bones
    head = b[f'hand.{side}'].head_local
    f = b[f'f_middle.01.{side}'].head_local - head
    k = b[f'f_index.01.{side}'].head_local - b[f'f_pinky.01.{side}'].head_local
    return frame(f, k)


def pose_hand(arm, side, hand, gun, lever_angle=0.0):
    """
    Put the IK target of one hand where `hand` says (carbine coordinates,
    through the gun's matrix), optionally turned with the lever around its pin.
    """
    lever = (Matrix.Translation(LEVER_PIN) @ Matrix.Rotation(lever_angle, 4, 'X')
             @ Matrix.Translation(-LEVER_PIN))
    to_rig = gun @ lever
    rot3 = to_rig.to_3x3().normalized()
    wrist = to_rig @ hand['wrist']
    # The rotation that takes the rest frame onto the wanted one...
    wanted = frame(rot3 @ hand['fingers'], rot3 @ hand['index'])
    turn = wanted @ rest_hand_frame(arm, side).inverted()
    # ...applied to the IK bone's rest orientation.
    ik = arm.pose.bones[f'handIK.{side}']
    rest = ik.bone.matrix_local.to_3x3().normalized()
    ik.matrix = Matrix.LocRotScale(wrist, (turn @ rest).to_quaternion(), Vector((1, 1, 1)))
    # Shoulder shift (eye space → rig: the rig looks along -Y, its right is -X).
    sh = hand['shoulder']
    arm.pose.bones[f'shoulder.{side}'].location = (0, 0, 0)
    bpy.context.view_layer.update()
    sb = arm.pose.bones[f'shoulder.{side}']
    sb.matrix = Matrix.Translation(Vector((-sh.x, -sh.y, sh.z))) @ sb.matrix
    pole = arm.pose.bones[f'elbowIK.{side}']
    pole.matrix = Matrix.Translation(to_rig @ hand['elbow'])
    # Fingers: each first joint bends (the other two copy it, see the rig's constraints).
    for name, angle in hand['curl'].items():
        bone = 'thumb.02' if name == 'thumb' else f'f_{name}.01'
        pb = arm.pose.bones[f'{bone}.{side}']
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (angle, 0, 0)
    arm.pose.bones[f'hand.{side}'].scale = (HAND_SCALE,) * 3
    bpy.context.view_layer.update()
    got = arm.pose.bones[f'hand.{side}'].head
    shoulder = arm.pose.bones[f'upper_arm.{side}'].head
    print(f'{side} lever={lever_angle:.2f} wrist target {tuple(round(x, 3) for x in wrist)} got {tuple(round(x, 3) for x in got)}'
          f' miss {(got - wrist).length:.3f} reach {(wrist - shoulder).length:.3f}')


def bake(mesh_obj, keep):
    """The deformed mesh as it is now, only the vertices for which keep(rest_position) is true."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(mesh_obj.evaluated_get(depsgraph))
    bm = bmesh.new()
    bm.from_mesh(me)
    rest = mesh_obj.data.vertices
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(rest[v.index].co)], context='VERTS')
    bm.to_mesh(me)
    bm.free()
    return me


def sleeve(arm, side):
    """A rolled-up sleeve around the posed upper arm and forearm: a low-poly tube, a fat roll halfway down the forearm."""
    pb = arm.pose.bones
    sh = pb[f'upper_arm.{side}'].head.copy()
    el = pb[f'forearm.{side}'].head.copy()
    wr = pb[f'forearm.{side}'].tail.copy()
    up_dir = (el - sh).normalized()
    fo_dir = (wr - el).normalized()
    # A side vector that doesn't flip between rings: perpendicular to both bones.
    side_v = up_dir.cross(fo_dir)
    if side_v.length < 1e-4:
        side_v = up_dir.orthogonal()
    side_v.normalize()

    def ring(center, axis, radius):
        x = side_v - axis * side_v.dot(axis)
        x.normalize()
        y = axis.cross(x)
        return lib.ellipse_ring(center, x, y, radius, radius, n=SLEEVE_SIDES)

    elbow_axis = (up_dir + fo_dir).normalized()
    roll_at = el + (wr - el) * SLEEVE_ROLL
    w = fo_dir * SLEEVE_ROLL_WIDTH / 2
    rings = [
        ring(sh - up_dir * 0.03, up_dir, SLEEVE_RADIUS_UPPER),
        ring(sh + (el - sh) * 0.5, up_dir, SLEEVE_RADIUS_UPPER * 0.95),
        ring(el, elbow_axis, SLEEVE_RADIUS_ELBOW),
        ring(roll_at - w * 1.6, fo_dir, SLEEVE_RADIUS_FOREARM),
        ring(roll_at - w, fo_dir, SLEEVE_RADIUS_FOREARM + SLEEVE_ROLL_EXTRA),
        ring(roll_at + w, fo_dir, SLEEVE_RADIUS_FOREARM + SLEEVE_ROLL_EXTRA * 0.8),
        ring(roll_at + w * 1.3, fo_dir, SLEEVE_RADIUS_FOREARM - 0.004),
    ]
    obj = lib.loft(f'sleeve_{side}', rings, v_scale=SLEEVE_V_SCALE, outward_hint=sh)
    for loop in obj.data.uv_layers.active.data:
        loop.uv.x *= SLEEVE_UV
    me = obj.data
    bpy.data.objects.remove(obj)
    return me


def joined(meshes, name, mats):
    """One mesh out of several, with material slots in the order of `mats`."""
    bm = bmesh.new()
    for me, mat_index in meshes:
        tmp = bmesh.new()
        tmp.from_mesh(me)
        for f in tmp.faces:
            f.material_index = mat_index
        tmp_me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(tmp_me)
        tmp.free()
        bm.from_mesh(tmp_me)
        bpy.data.meshes.remove(tmp_me)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out)
    bm.free()
    for m in mats:
        out.materials.append(m)
    return out


def main():
    # The materials of arms.glb (skin texture + plaid), so the new arms look the same.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=ARMS_GLB)
    skin = bpy.data.materials['Arms']
    plaid = bpy.data.materials['shirt_plaid']
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)

    # The rig, appended from its .blend file into this scene.
    with bpy.data.libraries.load(RIG_BLEND) as (src, dst):
        dst.objects = [n for n in src.objects if n in ('ArmsRig', 'ArmsMesh')]
    arm, mesh_obj = dst.objects if dst.objects[0].type == 'ARMATURE' else reversed(dst.objects)
    for o in (arm, mesh_obj):
        bpy.context.scene.collection.objects.link(o)
    if arm.animation_data:
        arm.animation_data.action = None  # no animation: our pose only
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)

    eye = arm.data.bones['camera'].head_local.copy()
    gun = gun_in_rig(eye)
    to_gun = gun.inverted()
    is_right = lambda co: co.x < 0  # noqa: E731  (the rig's right arm is on -X)
    is_left = lambda co: co.x > 0  # noqa: E731

    def bake_side(side, lever_angle):
        pose_hand(arm, side, RIGHT if side == 'R' else LEFT, gun, lever_angle)
        me = bake(mesh_obj, is_right if side == 'R' else is_left)
        me.transform(to_gun)  # rig → carbine coordinates
        sl = sleeve(arm, side)
        sl.transform(to_gun)
        return joined([(me, 0), (sl, 1)], f'Arm_{side}_Rifle', [skin, plaid])

    # Right arm: lever shut, then lever open → shape key.
    right = bpy.data.objects.new('Arm_R_Rifle', bake_side('R', 0.0))
    opened = bake_side('R', LEVER_OPEN)
    bpy.context.scene.collection.objects.link(right)
    right.shape_key_add(name='Basis')
    key = right.shape_key_add(name='lever_open')
    for i, v in enumerate(opened.vertices):
        key.data[i].co = v.co
    left = bpy.data.objects.new('Arm_L_Rifle', bake_side('L', 0.0))
    bpy.context.scene.collection.objects.link(left)
    for o in (right, left):
        for p in o.data.polygons:
            p.use_smooth = False  # flat shading, like the rest

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    right.select_set(True)
    left.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False, export_morph=True)
    print('exported', OUT_GLB)

    if RENDER:
        preview(arm, mesh_obj, right, left, gun, eye)


def preview(arm, mesh_obj, right, left, gun, eye):
    """Render from the player's eye, the carbine in its hip pose, lever shut and open."""
    for o in (arm, mesh_obj):
        o.hide_render = True
    bpy.ops.import_scene.gltf(filepath=RIFLE_GLB)
    rifle = bpy.data.objects['frame']
    for o in bpy.data.objects:
        o.rotation_mode = 'XYZ'
    holder = bpy.data.objects.new('holder', None)
    bpy.context.scene.collection.objects.link(holder)
    holder.matrix_world = gun
    for o in (rifle, right, left):
        o.parent = holder
    lib.setup_preview()
    cam = bpy.context.scene.camera
    cam.location = eye
    cam.rotation_euler = (math.radians(90), 0, math.pi)
    if '--big' in sys.argv:
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 960, 540
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    lib.render_frame(os.path.join(PREVIEW_DIR, 'rifle_arms.png'), 0)
    bpy.data.objects['lever'].rotation_euler.x = LEVER_OPEN
    right.data.shape_keys.key_blocks['lever_open'].value = 1
    lib.render_frame(os.path.join(PREVIEW_DIR, 'rifle_arms_open.png'), 0)
    if '--closeup' in sys.argv:
        # Close-ups of the grip, from the gun's left and right side and from below.
        bpy.data.objects['lever'].rotation_euler.x = 0
        right.data.shape_keys.key_blocks['lever_open'].value = 0
        cam.data.angle = math.radians(40)
        views = [(f'{n}{k}', Vector(pos) + Vector((0, y, 0)), Vector((0, y, 0)))
                 for k, y in (('', 0.03), ('_fore', 0.31))
                 for n, pos in (('left', (-0.4, 0, 0)), ('right', (0.4, 0, 0)), ('below', (0, 0, -0.4)))]
        for name, pos, aim in views:
            p = gun @ pos
            target = gun @ aim
            cam.location = p
            cam.rotation_euler = (target - p).to_track_quat('-Z', 'Y').to_euler()
            lib.render_frame(os.path.join(PREVIEW_DIR, f'rifle_arms_{name}.png'), 0)
    if '--side' in sys.argv:
        # From the left and above, farther away: where the shoulders and elbows are.
        cam.location = eye + Vector((1.4, -0.6, 0.9))
        cam.rotation_euler = (Vector((-1.4, 0.6, -1.1))).to_track_quat('-Z', 'Z').to_euler()
        cam.data.angle = math.radians(35)
        for o in (arm, mesh_obj):
            o.hide_render = False
        lib.render_frame(os.path.join(PREVIEW_DIR, 'rifle_arms_side.png'), 0)


if __name__ == '__main__':
    main()
