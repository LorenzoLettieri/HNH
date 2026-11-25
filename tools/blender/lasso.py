"""
The lasso ("il lazo"): a cowboy's rawhide rope, built from scratch.
Builds the model and exports public/models/lasso.glb (with --render it also
renders preview images into tools/blender/previews/).

Run with: tools/blender/.venv/bin/python tools/blender/lasso.py [--render]

A rope is the simplest thing to model and the hardest to animate: a TUBE
along a curve. Here we build the two pieces that keep their shape; every
stretch of rope that moves (the spoke from the hand to the loop, the rope
flying 9 m out, the taut grappling line) is a tube rebuilt by the game every
frame along a curve it computes (src/render/weapons/ropeMesh.ts): same idea,
in TypeScript.

Two separate objects (no skeleton), found by NAME by the game
(src/render/weapons/lassoView.ts):

    coil    the coiled rope in the LEFT hand: five loops of different sizes
            bundled together, tied at the top with a rawhide strip, and a
            short tail hanging out. Origin = where the hand grips it (the
            top of the coil, the tie).
    noose   the LOOP you spin and throw: a slightly wobbly ring of rope
            lying flat (normal = Blender Z), with the HONDA (the small eye
            of rope the noose runs through) at +X. Origin = the ring's
            center: the game spins it around its normal, and scales it up
            when it opens to catch something.

Coordinates (Blender): X = right, Y = forward, Z = up; meters. Exported with
+Y up (three.js: Y up, -Z forward).

THE TUBE (rope_tube): for every point of the curve a ring of RADIAL points
around it, then lib.loft joins the rings. The ring needs two axes
perpendicular to the curve; picking them fresh at every point would make
them flip and twist the tube where the curve turns. PARALLEL TRANSPORT
instead: carry the previous ring's axis along, each time removing the part
that now points along the curve (a projection) and renormalizing. The axis
turns only as much as the curve does: no twist. (The same trick keeps a
camera on a roller coaster from spinning.)
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'lasso.glb')
PREVIEW_DIR = os.path.join(ROOT, 'tools', 'blender', 'previews')
RENDER = '--render' in sys.argv

# --- Measures (meters) -------------------------------------------------------
ROPE_R = 0.009          # rope radius: ~2 cm thick, fatter than real so it reads at low resolution
SIDES = 6               # sides of the tube: low-poly, flat-shaded
NOOSE_R = 0.24          # the loop's radius in your hand (the game scales it when it opens)
NOOSE_WOBBLE = 0.012    # how far the ring bends up and down: a real loop is never a perfect circle
HONDA_LEN = 0.05        # the honda's eye, along the ring
COIL_LOOPS = [          # (radius, x offset, y offset (depth), tilt around Y, radians)
    (0.105, 0.000, 0.000, 0.00),
    (0.098, 0.006, 0.012, 0.10),
    (0.110, -0.006, -0.012, -0.08),
    (0.092, 0.004, 0.022, 0.16),
    (0.102, -0.004, -0.022, -0.14),
]
TIE_R = 0.03            # the rawhide strip around the top of the coil
TAIL = [(0.0, 0.0, -0.01), (0.03, 0.01, -0.06), (0.045, 0.0, -0.13), (0.035, -0.01, -0.19)]  # the end hanging out

# --- Palette -------------------------------------------------------------------
HEMP = (196, 158, 98)
HEMP_DARK = (138, 102, 58)
HEMP_DEEP = (92, 64, 36)
RAWHIDE = (120, 72, 40)


def rope_texture():
    """
    8 × 8, around × along the rope: three strands twisted, so DIAGONAL stripes
    (the color depends on u + v: the stripe moves round as you go along).
    One stripe light, one mid, a dark line in the groove between strands.
    """
    p = lib.Pixels(8, 8, HEMP)
    for y in range(8):
        for x in range(8):
            band = (x + y) % 8
            p.set(x, y, HEMP if band < 3 else HEMP_DARK if band < 6 else HEMP_DEEP)
    p.noise(lib.rng(3), 0.08)
    return p.to_image('rope')


def rawhide_texture():
    p = lib.Pixels(8, 4, RAWHIDE)
    for x in range(0, 8, 3):
        for y in range(4):
            p.set(x, y, lib.shade(RAWHIDE, 0.7))  # the edges of the wrapped strip
    p.noise(lib.rng(5), 0.1)
    return p.to_image('rawhide')


def rope_tube(name, points, radius=ROPE_R, closed=False):
    """A tube of `radius` along `points` (a list of Vectors). See PARALLEL TRANSPORT at the top."""
    pts = [Vector(q) for q in points]
    if closed:
        pts = pts + [pts[0]]
    n = len(pts)
    tangents = []
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        if closed and (i == 0 or i == n - 1):
            a, b = pts[-2], pts[1]
        tangents.append((b - a).normalized())
    # A first axis perpendicular to the first tangent...
    t0 = tangents[0]
    side = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    axis = (side - t0 * side.dot(t0)).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        # ...carried along: remove the part along the new tangent, renormalize.
        axis = (axis - t * axis.dot(t)).normalized()
        other = t.cross(axis)
        rings.append(lib.ellipse_ring(pts[i], axis, other, radius, radius, n=SIDES))
    return lib.loft(name, rings, v_scale=8.0)


def noose_points():
    """The ring, with a bit of wobble (two waves around), and a narrower stretch where the honda pinches it."""
    pts = []
    steps = 28
    for k in range(steps):
        a = 2 * math.pi * k / steps
        r = NOOSE_R * (1 - 0.04 * math.cos(a))  # pinched toward the honda (+X)
        z = NOOSE_WOBBLE * math.sin(2 * a + 0.6)
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    return pts


def honda():
    """
    The honda: the small eye at +X the rope runs through. A short fat loop
    standing up across the ring (a torus-like tube), plus a knot lump.
    """
    x0 = NOOSE_R * 0.96
    eye = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        eye.append(Vector((x0 + math.cos(a) * 0.022, math.sin(a) * HONDA_LEN * 0.5, 0.012 + math.sin(a) * 0.004 + math.cos(a) * 0.01)))
    parts = [rope_tube('honda_eye', eye, ROPE_R * 0.8, closed=True)]
    knot = []
    for k in range(9):
        a = 2 * math.pi * k / 9
        knot.append(Vector((x0 + 0.025 + math.cos(a) * 0.012, -HONDA_LEN * 0.5 + math.sin(a) * 0.012, math.sin(2 * a) * 0.006)))
    parts.append(rope_tube('honda_knot', knot, ROPE_R * 0.9, closed=True))
    return parts


def coil(rope, rawhide):
    """The coil: loops hanging from the hand (origin at the top), tied, with a tail."""
    parts = []
    for i, (r, dx, dy, tilt) in enumerate(COIL_LOOPS):
        pts = []
        steps = 22
        for k in range(steps):
            a = 2 * math.pi * k / steps
            # Circle in the XZ plane, its top at the origin (that's where the hand holds the bundle).
            x = math.sin(a) * r
            z = (math.cos(a) - 1) * r
            # A little sag and twist so the loops don't look stamped.
            y = dy + 0.006 * math.sin(3 * a + i)
            c, s = math.cos(tilt), math.sin(tilt)
            pts.append(Vector((dx + x * c + z * s, y, -x * s + z * c)))
        parts.append(rope_tube(f'coil_{i}', pts, closed=True))
    # The tie: a short flattened cylinder of rawhide around the top of the bundle.
    tie = []
    for k in range(4):
        y = -0.03 + 0.02 * k
        tie.append(lib.ellipse_ring(Vector((0, y, -0.012)), Vector((1, 0, 0)), Vector((0, 0, 1)), TIE_R * 0.9, TIE_R * 0.55, n=8))
    t = lib.loft('coil_tie', tie, v_scale=8.0, cap_start=True, cap_end=True)
    lib.assign(t, rawhide)
    for q in parts:
        lib.assign(q, rope)
    tail = rope_tube('coil_tail', [Vector(q) for q in TAIL])
    lib.assign(tail, rope)
    parts += [t, tail]
    return join('coil', parts)


def join(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for q in parts:
        q.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = obj.data.name = name
    bpy.ops.object.shade_flat()
    return obj


def main():
    lib.reset_scene()
    rope = lib.material('rope', rope_texture(), roughness=0.95)
    rawhide = lib.material('rawhide', rawhide_texture(), roughness=0.9)
    ring = rope_tube('noose_ring', noose_points(), closed=True)
    parts = [ring, *honda()]
    for q in parts:
        lib.assign(q, rope)
    noose = join('noose', parts)
    held = coil(rope, rawhide)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    noose.select_set(True)
    held.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print('exported', OUT_GLB)

    if RENDER:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        lib.setup_preview()
        # As in the game, more or less: the coil low on the left, the noose spinning on the right.
        held.location = (-0.2, 0.4, -0.2)
        noose.location = (0.22, 0.6, 0.0)
        noose.rotation_euler = (math.radians(70), math.radians(-25), 0)
        lib.render_frame(os.path.join(PREVIEW_DIR, 'lasso_eye.png'), 1)
        print('previews in', PREVIEW_DIR)


main()
