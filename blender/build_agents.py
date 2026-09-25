"""Builds the four society agents and exports them to society/assets/agents.glb.

Run headless (does not touch whatever is open in your Blender):
  blender --background --factory-startup --python society/blender/build_agents.py -- --preview

Conventions (Blender space, Z up, every character faces -Y and sits on z=0):
  * Empty <Name> is the character root; its parts live in its local frame.
  * <Name>_Body and anything with "Fuzz" in its name gets fur shells in Three.js.
  * Eye beads have their origin at their centre (blink = scale Z), pupils at the
    eyeball centre (look = rotate), shades at the bridge (slide down to peek).
  * Nothing on the face may sit closer than FUR to the body or the fur swallows it.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))
OUT = os.path.join(ASSETS, "agents.glb")
PREVIEW = "--preview" in sys.argv
MB_THRESH = 0.6
FUR = 0.05             # fur length used in Three.js - keep in sync with FUR.len in index.html
DETAIL = 0.6           # decimate ratio for the fuzzy bodies (higher = smoother silhouettes, heavier fur)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = scene.collection


# ------------------------------------------------------------------ helpers
def linear(hexstr):
    c = Vector(bytes.fromhex(hexstr.lstrip("#"))) / 255.0
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]


def material(name, color, rough=0.5, metal=0.0, sheen=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    lin = linear(color)
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for key, val in (("Sheen Weight", sheen), ("Coat Weight", coat)):
        if b.inputs.get(key) is not None:
            b.inputs[key].default_value = val
    m.diffuse_color = (*lin, 1.0)
    return m


def link(obj):
    coll.objects.link(obj)
    return obj


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)


def metaball_mesh(name, elements, resolution=0.01):
    """elements: list of dicts(co, r, [size], [type], [s]). r is the *surface* radius of a lone ball;
    higher stiffness `s` keeps neighbouring balls as distinct bumps instead of melting together."""
    mb = bpy.data.metaballs.new("MB" + name)
    mb.resolution = mb.render_resolution = resolution
    mb.threshold = MB_THRESH
    tmp = link(bpy.data.objects.new("MB" + name, mb))
    for el in elements:
        e = mb.elements.new()
        e.type = el.get("type", "BALL")
        e.co = el["co"]
        s = el.get("s", 2.0)
        # field = s * (1 - d^2/R^2)^3, so a lone ball's surface sits at this fraction of R
        e.radius = el["r"] / math.sqrt(1 - (MB_THRESH / s) ** (1 / 3))
        e.stiffness = s
        if "size" in el:
            e.size_x, e.size_y, e.size_z = el["size"]
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    me.name = name
    bpy.data.objects.remove(tmp)
    bpy.data.metaballs.remove(mb)
    return link(bpy.data.objects.new(name, me))


def mesh_from_rings(name, rings):
    """rings: list of vertex-coordinate lists; a ring of length 1 is a pole."""
    bm = bmesh.new()
    vr = [[bm.verts.new(co) for co in ring] for ring in rings]
    for lo, hi in zip(vr, vr[1:]):
        n = max(len(lo), len(hi))
        for i in range(n):
            j = (i + 1) % n
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[j], hi[i]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[j], hi[0]))
            else:
                bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def sit(obj, sink=0.03, scale=(1, 1, 1)):
    """Scale the mesh, then drop it so it rests on z=0 with a flat, slightly squashed sole."""
    obj.data.transform(Matrix.Diagonal((*scale, 1)))
    zmin = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.z = max(v.co.z - zmin - sink, 0.0)


def finish(obj, mat, ratio=None, smooth_iters=0):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for _ in range(smooth_iters):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v.co.z > 0.001], factor=0.5,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data)
    bm.free()
    if ratio:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        apply_modifiers(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def bake(obj):
    """Bake the object's transform into its mesh."""
    if obj.modifiers:
        apply_modifiers(obj)
    obj.data.transform(obj.matrix_basis)
    obj.matrix_basis = Matrix.Identity(4)
    return obj


def set_origin(obj, point):
    """Move the origin to `point` without moving the geometry (and without rotation/scale)."""
    bake(obj)
    p = Vector(point)
    obj.data.transform(Matrix.Translation(-p))
    obj.location = p
    return obj


def prim(kind, name, mat, loc=(0, 0, 0), **kw):
    fn = {
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "cyl": bpy.ops.mesh.primitive_cylinder_add,
        "torus": bpy.ops.mesh.primitive_torus_add,
    }[kind]
    if kind == "sphere":
        kw.setdefault("segments", 40)
        kw.setdefault("ring_count", 22)
    if kind == "cyl":
        kw.setdefault("vertices", 48)
    if kind == "torus":
        kw.setdefault("major_segments", 64)
        kw.setdefault("minor_segments", 14)
    fn(location=loc, **kw)
    o = bpy.context.active_object
    o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(mat)
    return o


def tube(name, pts, radius, mat, closed=False):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1.0)
    sp.use_cyclic_u = closed
    tmp = link(bpy.data.objects.new(name + "_crv", cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    obj = link(bpy.data.objects.new(name, me))
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat)
    return obj


def join(name, objs):
    for o in objs:
        bake(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    return o


def catmull(pts, per=6):
    out = []
    P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = (Vector(P[j]) for j in (i - 1, i, i + 1, i + 2))
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(Vector(pts[-1]))
    return out


# ------------------------------------------------------------------ surface probes
def hit(body, origin, direction):
    ok, loc, nor, _ = body.ray_cast(Vector(origin), Vector(direction).normalized())
    assert ok, f"ray missed {body.name} from {tuple(origin)}"
    return loc, nor.normalized()


def front(body, x, z, off=0.0):
    """Point on the front of the body at (x, z), pushed `off` out along the normal."""
    loc, nor = hit(body, (x, -3, z), (0, 1, 0))
    return loc + nor * off, nor


def around(body, angle, z, off=0.0):
    """Point on the body at horizontal angle (0 = front/-Y, +pi/2 = +X) and height z."""
    d = Vector((math.sin(angle), -math.cos(angle), 0))
    loc, nor = hit(body, Vector((0, 0, z)) + d * 3, -d)
    return loc + nor * off, nor


def toward(body, center, direction, off=0.0):
    """Point where a ray coming in along -direction towards `center` meets the body."""
    d = Vector(direction).normalized()
    loc, nor = hit(body, Vector(center) + d * 3, -d)
    return loc + nor * off, nor


def bead(name, mat, center, nor, size):
    """A squashed sphere (w, depth, h) whose flat face follows the surface normal. Origin = centre."""
    o = prim("sphere", name, mat, loc=center, radius=1, segments=32, ring_count=16)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = nor.to_track_quat("-Y", "Z")
    o.scale = size
    return set_origin(o, center)


def spectacles(prefix, body, eye_x, eye_z, rim_r, mat_frame, mat_lens=None, lift=0.02, rim_w=0.008):
    """Round glasses sitting on the fur in front of the eyes. Returns (parts, bridge centre)."""
    c0, n0 = front(body, 0, eye_z)
    up = Vector((0, 0, 1))
    side = up.cross(n0).normalized()          # points to the character's left (+X)
    up = n0.cross(side).normalized()
    rot = Matrix((side, up, n0)).transposed().to_4x4()  # local X=side, Y=up, Z=normal
    parts = []
    centres = {}
    for s in (1, -1):
        q, _ = front(body, s * eye_x, eye_z)
        c = q + n0 * (FUR + lift)
        centres[s] = c
        rim = prim("torus", f"{prefix}rim", mat_frame, loc=c, major_radius=rim_r, minor_radius=rim_w)
        rim.matrix_basis = Matrix.Translation(c) @ rot
        parts.append(rim)
        if mat_lens:
            lens = prim("cyl", f"{prefix}lens", mat_lens, loc=c, radius=rim_r * 0.97, depth=0.01)
            lens.matrix_basis = Matrix.Translation(c + n0 * 0.002) @ rot @ Matrix.Diagonal((1, 1, 0.6, 1))
            parts.append(lens)
        # temple arm: a short stub from the outer edge of the rim back into the fur
        start = c + side * s * rim_r
        end = start + side * s * 0.03 - n0 * 0.11
        parts.append(tube(f"{prefix}temple", [tuple(start), tuple(start.lerp(end, 0.5)), tuple(end)], rim_w * 0.8, mat_frame))
    bc = (centres[1] + centres[-1]) / 2
    inner = rim_r * 0.96
    bridge = [tuple(bc + side * s * inner * t + up * (0.012 + 0.012 * (1 - t * t))) for s, t in
              ((-1, 1.0), (-1, 0.5), (1, 0.0), (1, 0.5), (1, 1.0))]
    parts.append(tube(f"{prefix}bridge", bridge, rim_w * 0.9, mat_frame))
    return parts, bc


def root(name, parts, x):
    r = link(bpy.data.objects.new(name, None))
    r.empty_display_type = "PLAIN_AXES"
    r.empty_display_size = 0.2
    for p in parts:
        p.parent = r
    r.location = (x, 0, 0)
    return r


# ------------------------------------------------------------------ materials
M = {
    "eye": material("EyeBead", "#0b0b0f", 0.12, coat=1.0),
    "white": material("EyeWhite", "#fbfaf3", 0.22, coat=0.5),
    "frame": material("Frame", "#141418", 0.28, coat=0.6),
    "lens": material("ShadeLens", "#08080b", 0.04, coat=1.0),
}
FURS = {"Nimbus": "#2f7bff", "Moss": "#9be23a", "Sol": "#ffc62e", "Rosie": "#ff4fb4", "Beret": "#1b1b21"}
FM = {k: material(f"Fur_{k}", v, 0.95, sheen=0.25 if k == "Beret" else 1.0) for k, v in FURS.items()}
dims = {}


# ------------------------------------------------------------------ 1. Nimbus - a cloud in a beret
def build_nimbus():
    S = 5.0  # stiff balls -> distinct, round cloud puffs with soft creases between them
    body = metaball_mesh("Nimbus_Body", [
        {"co": (-0.31, 0, 0.18), "r": 0.18, "s": S},
        {"co": (-0.02, 0, 0.19), "r": 0.21, "s": S},
        {"co": (0.29, 0, 0.18), "r": 0.19, "s": S},
        {"co": (-0.23, 0.01, 0.35), "r": 0.17, "s": S},
        {"co": (0.04, 0, 0.43), "r": 0.23, "s": S},
        {"co": (0.3, 0.01, 0.35), "r": 0.16, "s": S},
    ])
    sit(body, 0.05, scale=(1, 1.3, 1))
    finish(body, FM["Nimbus"], ratio=DETAIL, smooth_iters=2)
    parts = [body]
    for side, s in (("L", 1), ("R", -1)):
        p, n = front(body, s * 0.115, 0.28, FUR * 0.6)
        parts.append(bead(f"Nimbus_Eye_{side}", M["eye"], p, n, (0.031, 0.02, 0.048)))
    top, _ = hit(body, (0.03, 0, 3), (0, 0, -1))
    beret = metaball_mesh("Nimbus_Beret_Fuzz", [
        {"co": (0, 0, 0.0), "r": 0.23, "type": "ELLIPSOID", "size": (1.4, 1.3, 0.36), "s": 3.0},
        {"co": (0.0, 0, 0.075), "r": 0.036, "s": 3.0},
    ], resolution=0.006)
    finish(beret, FM["Beret"], ratio=DETAIL, smooth_iters=1)
    for v in beret.data.vertices:  # soft felt: the brim settles over the round head
        v.co.z -= 0.7 * (v.co.x ** 2 + v.co.y ** 2)
    beret.data.transform(Matrix.Translation((0.0, 0, 0.03)))
    beret.data.transform(Euler((0.08, -0.2, 0)).to_matrix().to_4x4())
    beret.location = top - Vector((0, 0, 0.05))  # worn snug, sunk into the top puff
    parts.append(beret)
    return parts


# ------------------------------------------------------------------ 2. Moss - a frog-ish mound with googly eyes
def build_moss():
    body = metaball_mesh("Moss_Body", [
        {"co": (0, 0, 0.22), "r": 0.25, "type": "ELLIPSOID", "size": (1.3, 1.05, 1.0)},
        {"co": (0.15, -0.03, 0.42), "r": 0.12},
        {"co": (-0.15, -0.03, 0.42), "r": 0.12},
    ])
    sit(body, 0.04)
    finish(body, FM["Moss"], ratio=DETAIL, smooth_iters=2)
    parts = [body]
    R = 0.085
    for side, s in (("L", 1), ("R", -1)):
        bump = Vector((s * 0.15, -0.03, 0.42))
        p, n = toward(body, bump, (s * 0.3, -1, 0.45))
        ec = p + n * (FUR * 0.55 - R * 0.3)
        parts.append(prim("sphere", f"Moss_EyeWhite_{side}", M["white"], loc=ec, radius=R))
        look = Vector((-s * 0.12, -1, 0.05)).normalized()  # a touch cross-eyed
        pupil = bead(f"Moss_Pupil_{side}", M["eye"], ec + look * (R * 0.82), look, (0.047, 0.02, 0.05))
        parts.append(set_origin(pupil, ec))
    return parts


# ------------------------------------------------------------------ 3. Sol - a gumdrop triangle in round glasses
SOL_PROFILE = [(0.0, 0.0), (0.24, 0.004), (0.35, 0.024), (0.405, 0.07), (0.412, 0.125), (0.385, 0.2),
               (0.29, 0.37), (0.195, 0.52), (0.125, 0.61), (0.068, 0.665), (0.0, 0.688)]


def build_sol():
    rings = []
    segs = 72
    for pr in catmull(SOL_PROFILE):
        r, z = max(pr.x, 0.0), pr.y
        if r < 1e-4:
            rings.append([(0, 0, z)])
        else:
            rings.append([(r * math.sin(a), -r * 0.75 * math.cos(a), z)
                          for a in (2 * math.pi * i / segs for i in range(segs))])
    body = mesh_from_rings("Sol_Body", rings)
    finish(body, FM["Sol"], smooth_iters=1)
    parts = [body]
    EX, EZ = 0.112, 0.25
    for side, s in (("L", 1), ("R", -1)):
        pts = []
        for i in range(13):  # closed, contented eyes:  ◡ ◡
            a = math.radians(-72 + 144 * i / 12)
            q, _ = front(body, s * EX + math.sin(a) * 0.034, EZ + 0.012 - math.cos(a) * 0.022, FUR * 0.62)
            pts.append(tuple(q))
        parts.append(tube(f"Sol_EyeClosed_{side}", pts, 0.0078, M["eye"]))
        p, n = front(body, s * EX, EZ, FUR * 0.55)
        parts.append(bead(f"Sol_EyeOpen_{side}", M["eye"], p, n, (0.026, 0.018, 0.034)))
    glasses, _ = spectacles("sol_", body, EX, EZ + 0.004, 0.084, M["frame"], lift=0.008, rim_w=0.0072)
    parts.append(join("Sol_Glasses", glasses))
    return parts


# ------------------------------------------------------------------ 4. Rosie - a plush heart in sunglasses
def heart_radius(cz, n_theta, width, squash):
    """Distance from (0, cz) to a softened heart outline, sampled at n_theta angles."""
    raw = []
    for i in range(1440):
        t = 2 * math.pi * i / 1440
        raw.append((16 * math.sin(t) ** 3, 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)))
    xs = [p[0] for p in raw]
    zs = [p[1] for p in raw]
    k = width / (max(xs) - min(xs))
    poly = [((x) * k, (z - min(zs)) * k * squash) for x, z in raw]

    def cast(theta):
        dx, dz = math.cos(theta), math.sin(theta)
        best = 0.0
        for (x1, z1), (x2, z2) in zip(poly, poly[1:] + poly[:1]):
            ex, ez = x2 - x1, z2 - z1
            den = dx * ez - dz * ex
            if abs(den) < 1e-12:
                continue
            ax, az = x1, z1 - cz
            tr = (ax * ez - az * ex) / den
            u = (ax * dz - az * dx) / den
            if tr > 0 and 0 <= u <= 1:
                best = max(best, tr)
        return best

    R = [cast(2 * math.pi * i / n_theta) for i in range(n_theta)]
    sig = n_theta * 7 / 360  # soften the tip and the notch like stuffed fabric would
    w = [math.exp(-0.5 * (j / sig) ** 2) for j in range(-int(3 * sig), int(3 * sig) + 1)]
    h = len(w) // 2
    return [sum(R[(i + j - h) % n_theta] * w[j] for j in range(len(w))) / sum(w) for i in range(n_theta)]


def build_rosie():
    W, SQ, CZ, D, P = 0.84, 0.86, 0.3, 0.25, 2.5
    NT, NP = 144, 36
    R = heart_radius(CZ, NT, W, SQ)
    rings = [[(0, D, CZ)]]
    for j in range(1, NP):
        phi = -math.pi / 2 + math.pi * j / NP     # back pole -> front pole
        c, s = math.cos(phi), math.sin(phi)
        cr = math.copysign(abs(c) ** (2 / P), c)  # superellipse cross-section: puffy, pillow-like
        sr = math.copysign(abs(s) ** (2 / P), s)
        rings.append([(R[i] * cr * math.cos(2 * math.pi * i / NT), -D * sr, CZ + R[i] * cr * math.sin(2 * math.pi * i / NT))
                      for i in range(NT)])
    rings.append([(0, -D, CZ)])
    body = mesh_from_rings("Rosie_Body", rings)
    sit(body, 0.035)
    finish(body, FM["Rosie"], smooth_iters=2)
    parts = [body]
    EX, EZ = 0.125, 0.4
    for side, s in (("L", 1), ("R", -1)):
        p, n = front(body, s * EX, EZ, FUR * 0.55)
        parts.append(bead(f"Rosie_Eye_{side}", M["eye"], p, n, (0.024, 0.018, 0.034)))
    shades, bc = spectacles("ros_", body, EX, EZ + 0.004, 0.086, M["frame"], M["lens"], lift=0.02, rim_w=0.009)
    parts.append(set_origin(join("Rosie_Shades", shades), bc))
    return parts


LINEUP = [("Nimbus", build_nimbus, -1.42), ("Moss", build_moss, -0.52), ("Sol", build_sol, 0.34), ("Rosie", build_rosie, 1.24)]
for name, fn, x in LINEUP:
    parts = fn()
    b = parts[0]
    dims[name] = tuple(round(d, 3) for d in b.dimensions)
    root(name, parts, x)

# ------------------------------------------------------------------ export
os.makedirs(ASSETS, exist_ok=True)
# Draco compression keeps the download small (the public site's bandwidth). 14-bit positions are
# ~0.05 mm apart on these ~0.7 m characters, far below a pixel; normals keep 12 bits for smooth shading.
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14, export_draco_normal_quantization=12, export_draco_texcoord_quantization=12,
)
print("EXPORTED", OUT)
print("NAMES", sorted(o.name for o in scene.objects))
for k, v in dims.items():
    print("DIMS", k, v, "verts", len(bpy.data.objects[k + "_Body"].data.vertices))

# ------------------------------------------------------------------ preview render
if PREVIEW:
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam")))
    cam.location = (0, -7.2, 1.25)
    cam.rotation_euler = (math.radians(82.5), 0, 0)
    cam.data.lens = 58
    scene.camera = cam
    for loc, en, size, col in (((-3, -4, 4), 700, 3, (1, 0.96, 0.9)), ((4, -3, 2), 250, 4, (0.8, 0.88, 1)),
                                ((0, 4, 3), 500, 3, (1, 1, 1))):
        l = link(bpy.data.objects.new("light", bpy.data.lights.new("light", "AREA")))
        l.location = loc
        l.data.energy = en
        l.data.size = size
        l.data.color = col
        l.rotation_euler = (Vector((0, 0, 0.4)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.data.materials.append(material("Floor", "#26262c", 0.35))
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (*linear("#6f7280"), 1)
    bg.inputs[1].default_value = 0.5
    scene.world = world
    scene.render.resolution_x, scene.render.resolution_y = 1600, 640
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            pass
    scene.render.filepath = os.path.join(ASSETS, "preview.png")
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", scene.render.filepath)
