"""
The shovel ("il badile"): takes "Shovel" by Quaternius (assets-src/shovel/,
never edited) and turns it into public/models/shovel.glb, ready for the
viewmodel. Much simpler than the carbine: one piece, nothing moves, so the
whole job is the FIT (turn, scale, move the origin), baked into the vertices.

In the original (after import) the shovel stands upright: length along +Z
(blade at the bottom, -Z; the red D-grip at the top), width along X, the
blade's flat face looking along Y. It's 3.9 m tall (an FBX in centimeters
exported at the wrong scale: the import puts a 199× scale on the object).

Our conventions for a held thing (the same as the guns): "forward" = Blender
+Y (= -Z in Three.js), up = +Z, meters, origin = where the hand holds it.
For the shovel:
    origin  the middle of the D-grip, where the hand is
    +Y      along the shaft, toward the blade
    X       across the blade (its width)
    Z       out of the blade's flat face

Run with: tools/blender/.venv/bin/python tools/blender/shovel.py [--render]
"""
import math
import os
import sys

import bpy  # first: it sets Blender up (mathutils comes with it)
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC_GLB = os.path.join(ROOT, 'assets-src', 'shovel', 'shovel_quaternius.glb')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'shovel.glb')
PREVIEW_DIR = os.path.join(os.path.dirname(__file__), 'previews')
RENDER = '--render' in sys.argv

# The original is 3.87 m from the blade's tip to the top of the grip; a
# short trench spade is about 1 m. Scaled to 25%: 0.97 m, blade 20 cm wide.
SCALE = 0.25
# Where the hand holds it, in the ORIGINAL's coordinates (after the import's
# scale): the middle of the red D-grip (it goes from z 1.06 to 1.79).
GRIP = Vector((0.0, 0.0, 1.5))


def main():
    lib.reset_scene()
    bpy.ops.import_scene.gltf(filepath=SRC_GLB)
    shovel = next(o for o in bpy.data.objects if o.type == 'MESH')
    # The import puts the 199× scale (and the axis conversion) on the object:
    # into the vertices first, so "the original's coordinates" are meters.
    bpy.ops.object.select_all(action='DESELECT')
    shovel.select_set(True)
    bpy.context.view_layer.objects.active = shovel
    shovel.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.data.objects):
        if o is not shovel:
            bpy.data.objects.remove(o)
    shovel.name = shovel.data.name = 'shovel'

    # The fit as ONE matrix, read right to left (like function composition):
    # move the grip to the origin, then lay it down (+90° around X: up +Z
    # becomes back -Y, so the blade, at the bottom, points forward +Y), then
    # scale. Matrices compose transforms: that's why 3D code uses them.
    fit = Matrix.Scale(SCALE, 4) @ Matrix.Rotation(math.radians(90), 4, 'X') @ Matrix.Translation(-GRIP)
    shovel.data.transform(fit)

    vs = [v.co for v in shovel.data.vertices]
    lo = [round(min(v[k] for v in vs), 3) for k in range(3)]
    hi = [round(max(v[k] for v in vs), 3) for k in range(3)]
    print('shovel bounds', lo, hi)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    shovel.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        lib.setup_preview()
        # Roughly where the game shows it mid-swing: grip down-left, blade up-right.
        shovel.location = (-0.25, 0.25, -0.3)
        shovel.rotation_euler = (math.radians(45), math.radians(-20), math.radians(-40))
        lib.render_frame(os.path.join(PREVIEW_DIR, 'shovel_eye.png'), 0)


if __name__ == '__main__':
    main()
