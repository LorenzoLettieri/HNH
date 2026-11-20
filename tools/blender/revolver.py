"""
The revolver: "Revolver" by Quaternius (CC0, tools/blender/sources/
revolver_quaternius.glb), modified for the game and exported as
public/models/revolver.glb.

Run it with:  npm run models   (or tools/blender/.venv/bin/python tools/blender/revolver.py)

The downloaded file is ONE mesh with four materials. This script:

1. Turns the grip brown: in the original only the two thin side panels are
   wood, the block between them is grey, and from the player's eye you see
   mostly that block (the back strap). We give it the wood material.
2. Splits off the MOVING PARTS into separate objects, each with its ORIGIN on
   its pivot (like tools/blender/shotgun.py):

       frame        everything that doesn't move (barrel, frame, grip...)
       ├── cylinder origin on its axis: the game turns it 60° per shot
       └── hammer   origin on its screw; modeled COCKED: the game drops it
                    forward when it fires and brings it back

3. Bakes the "fit" into the vertices: barrel forward, meters, origin = the
   right hand on the grip. So the game loads it as is, no correction.

How do we find the parts in a mesh where every face is separate (no shared
vertices: that's how flat-shaded models are exported)? By MATERIAL and
POSITION of each face: the cylinder and the hammer are the only "LightMetal"
faces, the hammer is the part behind the cylinder. The grip block is the
"Grey" face group behind the trigger. Coordinates below are the ones of the
imported file (X = toward the muzzle, Z = up, ~2 units long).
"""
import math
import os
import sys

import bpy
import bmesh  # noqa: E402 (bmesh only exists once bpy is loaded)
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

HERE = os.path.dirname(__file__)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SOURCE = os.path.join(HERE, 'sources', 'revolver_quaternius.glb')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'revolver.glb')

# --- Where the parts are, in the source file's coordinates ---
# Faces behind this X belong to the hammer (LightMetal) or the grip (Grey);
# in front of it, to the cylinder or the trigger.
SPLIT_X = 0.33
# The hammer's screw: near the bottom of the hammer, at the back of the frame.
HAMMER_PIVOT = Vector((0.23, 0.0, 0.375))

# --- The fit: source → game (Blender axes: X = right, Y = forward, Z = up) ---
# Turn +X (the muzzle) to +Y: 90° around the vertical axis.
FIT_ROTATION = math.pi / 2
# ~2 units → ~30 cm.
FIT_SCALE = 0.151
# Then slide it so the middle of the grip lands on the origin (the right hand).
FIT_OFFSET = Vector((0.0, -0.026, -0.02))

# Colors (linear RGB, like the file's). The wood is the file's "DarkWood",
# a bit lighter: in the viewmodel it read almost black.
WOOD = (0.16, 0.085, 0.05, 1.0)


def fit_matrix():
    return (Matrix.Translation(FIT_OFFSET)
            @ Matrix.Rotation(FIT_ROTATION, 4, 'Z')
            @ Matrix.Scale(FIT_SCALE, 4))


def separate(obj, name, pick):
    """Move the faces for which pick(face_center, material_name) is true into a new object."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.select = pick(f.calc_center_median(), me.materials[f.material_index].name)
    bm.to_mesh(me)
    bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    part = next(o for o in bpy.context.selected_objects if o is not obj)
    part.name = name
    part.data.name = name
    return part


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


def main():
    lib.reset_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    frame = next(o for o in bpy.data.objects if o.type == 'MESH')
    # Bake the file's own scale (17.8) into the vertices and drop its empty parent.
    world = frame.matrix_world.copy()
    frame.parent = None
    frame.matrix_world = world
    for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)
    frame.data.transform(frame.matrix_world)
    frame.matrix_world = Matrix.Identity(4)
    frame.name = frame.data.name = 'frame'

    # 1. The grip: the grey block behind the trigger becomes wood.
    mats = frame.data.materials
    wood_index = mats.find('DarkWood')
    mats[wood_index].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = WOOD
    bm = bmesh.new()
    bm.from_mesh(frame.data)
    for f in bm.faces:
        if mats[f.material_index].name == 'Grey' and f.calc_center_median().x < SPLIT_X:
            f.material_index = wood_index
    bm.to_mesh(frame.data)
    bm.free()

    # 2. The moving parts.
    hammer = separate(frame, 'hammer', lambda c, m: m == 'LightMetal' and c.x < SPLIT_X)
    cylinder = separate(frame, 'cylinder', lambda c, m: m == 'LightMetal')
    # The cylinder's axis: the middle of its bounding box (it's round around it).
    vs = [v.co for v in cylinder.data.vertices]
    axis = Vector(((min(v.x for v in vs) + max(v.x for v in vs)) / 2, (min(v.y for v in vs) + max(v.y for v in vs)) / 2, (min(v.z for v in vs) + max(v.z for v in vs)) / 2))

    # 3. The fit, baked into every part's vertices; pivots go through it too.
    m = fit_matrix()
    for o in (frame, hammer, cylinder):
        o.data.transform(m)
    set_origin(cylinder, m @ axis)
    set_origin(hammer, m @ HAMMER_PIVOT)
    set_origin(frame, (0, 0, 0))
    parent(cylinder, frame)
    parent(hammer, frame)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (frame, cylinder, hammer):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)


main()
