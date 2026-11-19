"""
Small modeling toolkit on top of Blender's Python API (bpy), shared by the
model scripts in this folder. Everything is built from code: run a script,
get a .glb in public/models/. No hand-made files to keep in sync.

The core idea is LOFTING: a shape is described by a list of cross-sections
("rings": a leg is a series of ellipses along the bone, a boot's foot a
series of D shapes from heel to toe) and we connect each ring to the next
one with quads. It's how a lot of low-poly modeling is done by hand too
(extrude a ring, scale it, move it, repeat), just written down as numbers.

Coordinates are Blender's: X = right, Y = forward, Z = up. The glTF exporter
converts them to the Y-up convention of Three.js (Blender +Y becomes -Z,
the direction a camera looks at).
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def reset_scene(fps=60):
    """Empty scene (no default cube, camera or light)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    return scene


# --------------------------------------------------------------------------
# Rings and lofts
# --------------------------------------------------------------------------

def ellipse_ring(center, x_axis, y_axis, rx, ry, n=10, flat_bottom=None, z_wobble=None):
    """
    `n` points on an ellipse around `center`, in the plane of x_axis/y_axis.
    - flat_bottom: clamp the points so none goes lower (along y_axis) than
      this offset from the center: an ellipse with a flat base (a shoe).
    - z_wobble: function angle -> offset along the ring's normal direction
      (used for the V-shaped dip at the top of a cowboy boot).
    """
    center = Vector(center)
    x_axis = Vector(x_axis).normalized()
    y_axis = Vector(y_axis).normalized()
    normal = x_axis.cross(y_axis)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        px = math.cos(a) * rx
        py = math.sin(a) * ry
        if flat_bottom is not None:
            py = max(py, flat_bottom)
        p = center + x_axis * px + y_axis * py
        if z_wobble:
            p += normal * z_wobble(a)
        pts.append(p)
    return pts


def loft(name, rings, weights=None, v_scale=1.0, cap_start=False, cap_end=False, outward_hint=None):
    """
    Connects `rings` (lists with the same number of points) into a tube.
    - weights: one dict per ring {bone_name: weight}, for skinning.
    - UVs: u goes around the ring (0..1), v along the tube (meters × v_scale).
    - caps close the ends with one polygon.
    - outward_hint: a point INSIDE the tube near its start, to orient the
      normals outward (default: the center of the first ring).
    All faces are wound the same way, so if the tube folds back on itself
    (e.g. the lip of a boot going down inside), the inner side correctly
    faces inward. We only check ONE face and flip everything if needed.
    """
    n = len(rings[0])
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    bm.verts.index_update()
    ring_indices = [[v.index for v in ring] for ring in verts]  # kept: the BMesh is freed below

    centers = [sum(r, Vector()) / n for r in rings]
    vs = [0.0]
    for i in range(1, len(rings)):
        vs.append(vs[-1] + (centers[i] - centers[i - 1]).length * v_scale)

    faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            j2 = (j + 1) % n
            f = bm.faces.new((verts[i][j], verts[i][j2], verts[i + 1][j2], verts[i + 1][j]))
            for loop, (uu, vv) in zip(f.loops, ((j / n, vs[i]), ((j + 1) / n, vs[i]), ((j + 1) / n, vs[i + 1]), (j / n, vs[i + 1]))):
                loop[uv].uv = (uu, vv)
            faces.append(f)

    def cap(ring_verts, center):
        f = bm.faces.new(ring_verts)
        for loop in f.loops:
            d = loop.vert.co - center
            loop[uv].uv = (0.5 + d.x * 2, 0.5 + d.y * 2)
        return f

    # (cap face, its ring's center, the neighbouring ring's center)
    caps = []
    if cap_start:
        caps.append((cap(list(reversed(verts[0])), centers[0]), centers[0], centers[1]))
    if cap_end:
        caps.append((cap(verts[-1], centers[-1]), centers[-1], centers[-2]))

    # Orientation check on the first face: its normal must point away from the inside.
    bm.normal_update()
    inside = Vector(outward_hint) if outward_hint is not None else centers[0]
    f0 = faces[0]
    if f0.normal.dot(f0.calc_center_median() - inside) < 0:
        for f in faces:
            f.normal_flip()
    # Each cap must face away from the tube: same direction as (its ring − the next ring).
    for f, c, neighbour in caps:
        if f.normal.dot(c - neighbour) < 0:
            f.normal_flip()

    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    if weights:
        for i, w in enumerate(weights):
            for bone, value in w.items():
                group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                group.add(ring_indices[i], value, 'REPLACE')
    return obj


def box_mesh(name, center, size, bone, rotation=(0, 0, 0)):
    """A simple box (all its vertices on one bone)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    g = obj.vertex_groups.new(name=bone)
    g.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    return obj


def cylinder_mesh(name, center, radius, depth, bone, rotation=(0, 0, 0), vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    g = obj.vertex_groups.new(name=bone)
    g.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    return obj


def star_mesh(name, center, points, r_out, r_in, thickness, bone, rotation=(0, 0, 0)):
    """A flat star (the spur's rowel), lying in the XZ plane before `rotation`."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    outline = []
    for k in range(points * 2):
        a = math.pi * k / points
        r = r_out if k % 2 == 0 else r_in
        outline.append((math.cos(a) * r, math.sin(a) * r))
    front = [bm.verts.new((x, -thickness / 2, y)) for x, y in outline]
    back = [bm.verts.new((x, thickness / 2, y)) for x, y in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    m = len(outline)
    for k in range(m):
        k2 = (k + 1) % m
        bm.faces.new((front[k2], front[k], back[k], back[k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_euler = rotation
    obj.location = center
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    g = obj.vertex_groups.new(name=bone)
    g.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    return obj


# --------------------------------------------------------------------------
# Pixel-art textures
# --------------------------------------------------------------------------

class Pixels:
    """A tiny RGB canvas (0-255 colors, (0,0) = bottom-left like Blender's UVs)."""

    def __init__(self, w, h, color):
        self.w, self.h = w, h
        self.data = [[color for _ in range(w)] for _ in range(h)]

    def set(self, x, y, color):
        self.data[y % self.h][x % self.w] = color

    def get(self, x, y):
        return self.data[y % self.h][x % self.w]

    def noise(self, rng, amount):
        """Random darker/lighter pixels: the "grain" of leather, cloth, iron."""
        for y in range(self.h):
            for x in range(self.w):
                k = 1 + (rng.random() * 2 - 1) * amount
                self.set(x, y, tuple(max(0, min(255, int(c * k))) for c in self.get(x, y)))

    def to_image(self, name):
        img = bpy.data.images.new(name, self.w, self.h, alpha=False)
        flat = []
        for row in self.data:
            for r, g, b in row:
                flat += [r / 255, g / 255, b / 255, 1.0]
        img.pixels = flat
        img.pack()
        return img


def shade(color, k):
    return tuple(max(0, min(255, int(c * k))) for c in color)


def material(name, image=None, color=(1, 1, 1), roughness=0.8, metallic=0.0):
    """Principled material; textures use 'Closest' (= NearestFilter in Three.js: crisp pixels)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if image is not None:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Closest'
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*[(c / 255) ** 2.2 for c in color], 1)
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def rng(seed):
    return random.Random(seed)


# --------------------------------------------------------------------------
# Preview renders
# --------------------------------------------------------------------------

def setup_preview():
    """Cycles at the game's pixel resolution, a reddish sky, the viewmodel's key light and camera (at the eye, 55° FOV)."""
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


def render_frame(path, frame):
    scene = bpy.context.scene
    scene.frame_set(frame)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
