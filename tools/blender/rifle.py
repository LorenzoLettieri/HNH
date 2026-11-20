"""
The lever-action carbine ("la carabina a leva"): takes "Rifle" by
CreativeTrio (assets-src/rifle/, never edited) and turns it into
public/models/rifle.glb, ready for the viewmodel.

The downloaded model is ONE mesh, and a "triangle soup" at that: every
triangle has its own three vertices, nothing is shared. So we:
  1. merge the vertices that sit on top of each other (remove doubles):
     the pieces become connected surfaces again;
  2. split it into LOOSE PARTS (each connected surface = one object): the
     modeler built the lever, the hammer etc. as separate pieces, so they
     come apart by themselves;
  3. recognize each part by WHERE it is (its bounding box), name it and
     join the ones that never move;
  4. turn, scale and move everything into the viewmodel's conventions
     (barrel along Blender +Y = -Z in Three.js, up +Z, meters, origin = the
     right hand on the grip), baked into the vertices;
  5. put each moving part's ORIGIN on its pivot (the lever on its pin, the
     hammer on its screw), so the game rotates it with a single number;
  6. add what the model doesn't have: a spent case (thrown out by the
     lever), a live round (pushed in through the loading gate during the
     reload) and a rear sight (for aiming down the sights).

The result:
    frame          receiver, stock, barrel, magazine tube, fore-end, rear sight
    ├── lever      origin on its pin: rotation.x opens it (the loop swings down)
    ├── hammer     origin on its screw: rotation.x cocks it back
    ├── trigger    origin at its top
    ├── bolt       the end of the bolt sticking out of the receiver: slides back
    ├── case       spent brass, in the chamber: the lever throws it out
    └── round      a live cartridge at the loading gate (reload)

Run with: tools/blender/.venv/bin/python tools/blender/rifle.py
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
SRC_GLB = os.path.join(ROOT, 'assets-src', 'rifle', 'rifle_creativetrio.glb')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'rifle.glb')
PREVIEW_DIR = os.path.join(os.path.dirname(__file__), 'previews')
RENDER = '--render' in sys.argv

# --- The fit: from the original's coordinates to ours ----------------------
# In the original (after import), the rifle lies on its side: length along
# +Y (muzzle at +Y), "up" is -X, the side is Z; and it's 2.2 m long. A
# Winchester carbine is about 1 m: we scale it to 45%.
SCALE = 0.45
# Where the right hand holds the wrist of the stock, in the ORIGINAL's
# coordinates: it becomes the origin.
GRIP = Vector((0.12, -0.45, 0.0))
# Pivots, original coordinates.
LEVER_PIN = Vector((0.118, -0.252, 0.0))
HAMMER_SCREW = Vector((0.045, -0.385, 0.0))
TRIGGER_TOP = Vector((0.12, -0.33, 0.0))


def fit(p):
    """A point of the original → our coordinates (x right, y forward = muzzle, z up)."""
    d = Vector(p) - GRIP
    # Turn: original Z → our X, Y stays, original -X → our Z (90° around Y).
    return Vector((d.z, d.y, -d.x)) * SCALE


# In our coordinates (meters, origin = grip).
CHAMBER_Y = fit((0, -0.17, 0)).y  # the spent case sits here, just in front of the bolt
RECEIVER_TOP = fit((-0.013, 0, 0)).z
CASE_LENGTH = 0.033  # .44-40, more or less
CASE_RADIUS = 0.0058
ROUND_LENGTH = 0.041  # case + lead bullet
GATE = Vector((0.013, fit((0, -0.09, 0)).y, fit((0.075, 0, 0)).z))  # loading gate, right side of the receiver

BRASS = (196, 150, 70)
LEAD = (120, 116, 112)
SIGHT = (30, 28, 28)


def import_parts():
    """Import, merge doubles, split into loose parts. Returns them sorted from the butt to the muzzle."""
    bpy.ops.import_scene.gltf(filepath=SRC_GLB)
    obj = next(o for o in bpy.data.objects if o.type == 'MESH')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # The import puts the 100× scale and the axis conversion on the object: into the vertices.
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-6)  # the triangle soup becomes surfaces again
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    return [o for o in bpy.data.objects if o.type == 'MESH']


def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return (Vector([min(v[k] for v in vs) for k in range(3)]), Vector([max(v[k] for v in vs) for k in range(3)]))


def identify(parts):
    """
    Name the parts by where they are (original coordinates: -X up, +Y muzzle).
    7 pieces: stock+receiver, lever, hammer, trigger, the bolt's end, barrel,
    magazine tube + fore-end.
    """
    named = {}
    for o in parts:
        lo, hi = bounds(o)
        n = len(o.data.vertices)
        if hi.y > 1.0 and lo.x < -0.03:
            named['barrel'] = o
        elif hi.y > 1.0:
            named['tube'] = o
        elif lo.y < -1.0:
            named['stock'] = o
        elif lo.x > 0.1 and hi.y - lo.y > 0.2:
            named['lever'] = o
        elif lo.x > 0.1:
            named['trigger'] = o
        elif lo.x < -0.03:
            named['hammer'] = o
        elif n < 30 and hi.y - lo.y < 0.03:
            named['bolt'] = o
    missing = {'barrel', 'tube', 'stock', 'lever', 'trigger', 'hammer', 'bolt'} - named.keys()
    assert not missing, f'parts not found: {missing}'
    return named


def bake_fit(o):
    """Our coordinates baked into the vertices (the object stays at the origin, unrotated)."""
    for v in o.data.vertices:
        v.co = fit(o.matrix_world @ v.co)
    o.matrix_world = Matrix.Identity(4)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def set_origin(obj, point):
    """Move the object's origin (its pivot) to `point` without moving the mesh."""
    bpy.context.scene.cursor.location = point
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')


def parent(child, par):
    world = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = world


def cylinder_y(name, y0, length, radius, mat, verts=8, center=(0, 0)):
    """A cylinder along +Y from y0, flat-shaded, low-poly like the rest."""
    bm = bmesh.new()
    rings = []
    for y in (y0, y0 + length):
        rings.append([bm.verts.new((center[0] + math.cos(2 * math.pi * k / verts) * radius, y,
                                    center[1] + math.sin(2 * math.pi * k / verts) * radius)) for k in range(verts)])
    for k in range(verts):
        k2 = (k + 1) % verts
        bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    lib.assign(obj, mat)
    return obj


def box(name, lo, hi, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector([lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k]) for k in range(3)])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    lib.assign(obj, mat)
    return obj


def build():
    p = identify(import_parts())
    for o in p.values():
        bake_fit(o)

    # Rear sight: a little buckhorn plate on the barrel just ahead of the
    # receiver, with a notch the front sight sits in when you aim. Its top is
    # at the height of the front sight's tip.
    barrel_lo, barrel_hi = bounds(p['barrel'])
    sight_mat = lib.material('rear_sight', color=SIGHT, roughness=0.6)
    y = fit((0, 0.12, 0)).y
    top = barrel_hi.z  # the front sight's tip is the barrel's highest point
    base = fit((-0.025, 0, 0)).z  # the barrel's top surface
    rear = [
        box('rs_l', (-0.009, y, base), (-0.0022, y + 0.004, top + 0.002), sight_mat),
        box('rs_r', (0.0022, y, base), (0.009, y + 0.004, top + 0.002), sight_mat),
        box('rs_b', (-0.0022, y, base), (0.0022, y + 0.004, top - 0.0035), sight_mat),
    ]

    frame = join([p['stock'], p['barrel'], p['tube'], *rear], 'frame')
    lever, hammer, trigger, bolt = p['lever'], p['hammer'], p['trigger'], p['bolt']
    for name, o in (('lever', lever), ('hammer', hammer), ('trigger', trigger), ('bolt', bolt)):
        o.name = o.data.name = name

    # Cartridges: flat-colored like the shotgun's shells.
    brass = lib.material('case_brass', color=BRASS, roughness=0.5)
    lead = lib.material('bullet_lead', color=LEAD, roughness=0.7)
    case = cylinder_y('case', -CASE_LENGTH / 2, CASE_LENGTH, CASE_RADIUS, brass)
    round_case = cylinder_y('round', -ROUND_LENGTH / 2, CASE_LENGTH, CASE_RADIUS, brass)
    bullet = cylinder_y('round_tip', -ROUND_LENGTH / 2 + CASE_LENGTH, ROUND_LENGTH - CASE_LENGTH, CASE_RADIUS * 0.85, lead)
    rnd = join([round_case, bullet], 'round')
    case.location = (0, CHAMBER_Y, RECEIVER_TOP - CASE_RADIUS * 1.5)
    rnd.location = GATE

    set_origin(frame, (0, 0, 0))
    set_origin(lever, fit(LEVER_PIN))
    set_origin(hammer, fit(HAMMER_SCREW))
    set_origin(trigger, fit(TRIGGER_TOP))
    lo, hi = bounds(bolt)
    set_origin(bolt, (lo + hi) / 2)
    for o in (lever, hammer, trigger, bolt, case, rnd):
        parent(o, frame)
    return frame, lever, hammer, trigger, bolt, case, rnd


def main():
    lib.reset_scene()
    frame, lever, hammer, trigger, bolt, case, rnd = build()
    lo, hi = bounds(frame)
    print('frame bounds', tuple(round(x, 4) for x in lo), tuple(round(x, 4) for x in hi))
    for o in (lever, hammer, trigger, bolt, case, rnd):
        print(o.name, 'origin', tuple(round(x, 4) for x in o.matrix_world.translation))

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (frame, lever, hammer, trigger, bolt, case, rnd):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        lib.setup_preview()
        frame.location = (0.13, 0.25, -0.16)
        frame.rotation_euler = (0, 0, 0.12)
        lib.render_frame(os.path.join(PREVIEW_DIR, 'rifle_eye.png'), 0)
        lever.rotation_euler.x = 0.9
        hammer.rotation_euler.x = -0.5
        bolt.location.y -= 0.03
        lib.render_frame(os.path.join(PREVIEW_DIR, 'rifle_open.png'), 0)


if __name__ == '__main__':
    main()
