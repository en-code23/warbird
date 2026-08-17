"""
Warbird aircraft model builder — headless Blender.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/build_planes.py

Reads tools/planespecs.json (dumped from src/catalog.js, so the shop stats and
the geometry can never disagree) and writes one GLB per aircraft into
assets/models/.

Why Blender rather than more three.js primitives: the shapes that read as
"aircraft" are lofts, not boxes. A wing is an airfoil swept along a span with
taper, dihedral and washout; a fuselage is a run of non-circular stations. You
can approximate neither with BoxGeometry, and LatheGeometry can only make
bodies of revolution — which is why the old fuselage was a tube.

Axis convention, and why it works out:
  built here with  nose +Y, up +Z, span X   (Blender, Z-up)
  glTF export with export_yup maps (x,y,z) -> (x, z, -y)
  arriving in three.js as  nose -Z, up +Y, span X
which is exactly the convention the rest of the codebase already uses.

Output contract — src/planeModel.js depends on these names:
  HULL      fuselage, cowl, belly, headrest     (hidden in cockpit view)
  GLASS     canopy                              (hidden in cockpit view)
  AIRFRAME  wings, tail, nacelles, gear, guns, racks
  PROP_n    one per propeller, spun about its own Y
  EYE       pilot eye point
  MUZZLE_n  gun muzzle
  HARD_L/R  bomb hardpoints
  DISC_n    prop disc centre; scale.x carries the disc radius
  GEARBOTTOM  wheel contact point, for ride height
"""

import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECS = os.path.join(ROOT, "tools", "planespecs.json")
OUTDIR = os.path.join(ROOT, "assets", "models")

TAU = math.pi * 2


# ----------------------------------------------------------------- mesh utils


def mesh_from(name, verts, faces):
    """Build an object from raw vertex/face lists and link it to the scene."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def loft(sections, cap_start=False, cap_end=False, closed_ring=True,
         wrap_sections=False):
    """
    Bridge a list of equal-length point rings into a surface.

    `sections` is a list of rings; every ring must have the same point count.
    A ring is a closed loop unless `closed_ring` is False (open profiles, e.g.
    a windscreen that sits on the fuselage rather than wrapping all the way
    round). Caps close the first/last ring with a fan.

    `wrap_sections` also bridges the last section back to the first, which is
    what a revolve needs — without it a revolved solid is left with a missing
    wedge where the sweep comes back round to its start.
    """
    n = len(sections[0])
    verts = []
    for ring in sections:
        assert len(ring) == n, "loft sections must all have the same length"
        verts.extend(ring)

    faces = []
    span = n if closed_ring else n - 1
    count = len(sections) if wrap_sections else len(sections) - 1
    for s in range(count):
        a = s * n
        b = ((s + 1) % len(sections)) * n
        for i in range(span):
            j = (i + 1) % n
            faces.append([a + i, a + j, b + j, b + i])

    if cap_start:
        faces.append(list(range(n - 1, -1, -1)))
    if cap_end:
        base = (len(sections) - 1) * n
        faces.append([base + i for i in range(n)])

    return verts, faces


def lerp(a, b, t):
    return a + (b - a) * t


def sample_table(table, t):
    """Piecewise-linear lookup over a table of (key, *values) rows."""
    if t <= table[0][0]:
        return table[0][1:]
    if t >= table[-1][0]:
        return table[-1][1:]
    for i in range(len(table) - 1):
        k0, k1 = table[i][0], table[i + 1][0]
        if k0 <= t <= k1:
            f = (t - k0) / (k1 - k0)
            return tuple(lerp(a, b, f) for a, b in zip(table[i][1:], table[i + 1][1:]))
    return table[-1][1:]


def superellipse(hw, hh, cz, n, segments):
    """
    One fuselage station. A superellipse with exponent `n` gives the rounded
    rectangle that real fuselage frames actually are — n=2 is a plain ellipse,
    higher is squarer through the shoulders.
    """
    ring = []
    for i in range(segments):
        a = (i / segments) * TAU
        c, s = math.cos(a), math.sin(a)
        x = hw * math.copysign(abs(c) ** (2.0 / n), c)
        z = hh * math.copysign(abs(s) ** (2.0 / n), s)
        ring.append((x, 0.0, z + cz))
    return ring


def naca4(m, p, t, points=26):
    """
    NACA 4-digit airfoil as a closed loop, TE -> upper -> LE -> lower -> TE.
    Cosine spacing so the leading edge — the part the eye actually reads as an
    aerofoil — gets the resolution.
    """
    xs = [0.5 * (1 - math.cos(math.pi * i / (points - 1))) for i in range(points)]
    upper, lower = [], []
    for x in xs:
        yt = 5 * t * (
            0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
            + 0.2843 * x ** 3 - 0.1015 * x ** 4
        )
        if m > 0 and p > 0:
            if x < p:
                yc = m / (p * p) * (2 * p * x - x * x)
                dy = 2 * m / (p * p) * (p - x)
            else:
                yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x)
                dy = 2 * m / ((1 - p) ** 2) * (p - x)
        else:
            yc, dy = 0.0, 0.0
        th = math.atan(dy)
        upper.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lower.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    # TE round the top to the nose, then back along the bottom; drop the
    # duplicated LE and TE points so the loop closes cleanly.
    return list(reversed(upper)) + lower[1:-1]


# ------------------------------------------------------------- part builders


# fuselage stations: t along the body, half-width, half-height, centre rise
FUSE_TABLE = [
    (0.000, 0.30, 0.30, 0.02),
    (0.050, 0.60, 0.62, 0.01),
    (0.120, 0.85, 0.90, 0.00),
    (0.230, 1.00, 1.00, 0.00),
    (0.350, 0.98, 0.96, 0.02),
    (0.480, 0.87, 0.85, 0.04),
    (0.640, 0.69, 0.69, 0.07),
    (0.800, 0.49, 0.52, 0.10),
    (0.920, 0.32, 0.37, 0.13),
    (1.000, 0.15, 0.24, 0.15),
]

# A long, drawn-out nose for the interceptor: the widest station sits much
# further aft, which is what gives an inline-engined racer its profile.
FUSE_RACER = [
    (0.000, 0.24, 0.24, 0.02),
    (0.090, 0.46, 0.48, 0.01),
    (0.200, 0.68, 0.72, 0.00),
    (0.340, 0.92, 0.96, 0.00),
    (0.430, 1.00, 1.00, 0.02),
    (0.560, 0.90, 0.88, 0.05),
    (0.700, 0.70, 0.70, 0.08),
    (0.840, 0.45, 0.49, 0.12),
    (0.940, 0.28, 0.33, 0.15),
    (1.000, 0.14, 0.22, 0.17),
]

# Barrel-chested and armoured, holding its depth a long way aft.
FUSE_TANK = [
    (0.000, 0.52, 0.50, 0.02),
    (0.070, 0.82, 0.84, 0.01),
    (0.170, 1.00, 1.02, 0.00),
    (0.330, 1.02, 1.00, 0.01),
    (0.480, 0.98, 0.94, 0.03),
    (0.620, 0.86, 0.82, 0.06),
    (0.760, 0.66, 0.65, 0.09),
    (0.880, 0.44, 0.47, 0.12),
    (0.960, 0.30, 0.35, 0.14),
    (1.000, 0.18, 0.26, 0.15),
]

# Long parallel-sided tube with a glazed nose — a bomber, not a fighter.
FUSE_TUBE = [
    (0.000, 0.62, 0.60, 0.02),
    (0.060, 0.86, 0.86, 0.01),
    (0.140, 0.98, 0.98, 0.00),
    (0.300, 1.00, 1.00, 0.00),
    (0.480, 0.99, 0.98, 0.01),
    (0.640, 0.94, 0.92, 0.03),
    (0.780, 0.80, 0.79, 0.06),
    (0.890, 0.58, 0.60, 0.10),
    (0.960, 0.38, 0.43, 0.13),
    (1.000, 0.20, 0.28, 0.15),
]

# Slim, area-ruled and blunt at the intake.
FUSE_JET = [
    (0.000, 0.66, 0.64, 0.02),
    (0.080, 0.80, 0.80, 0.01),
    (0.200, 0.92, 0.94, 0.00),
    (0.360, 1.00, 1.00, 0.00),
    (0.520, 0.96, 0.95, 0.01),
    (0.680, 0.86, 0.86, 0.03),
    (0.820, 0.74, 0.75, 0.05),
    (0.920, 0.62, 0.64, 0.07),
    (0.980, 0.52, 0.55, 0.08),
    (1.000, 0.46, 0.50, 0.09),
]

"""
Per-type shape.

Every aircraft used to come off the same parametric shape with only its size,
colours, tail count and engine count changed, so the fleet read as one aeroplane
at six scales. These are the knobs that actually change the silhouette:

  fuse        fuselage station table — the profile in plan and side view
  wing_z      wing vertical position: high, mid or low on the fuselage
  sweep       leading-edge sweep as a fraction of root chord
  dihedral    degrees
  taper       tip chord as a fraction of root
  canopy      'bubble' | 'razorback' | 'glazed' | 'framed'
  canopy_at   position along the body, 0 = nose
  gear        'taildragger' | 'tricycle'
  nose        'spinner' | 'radial' | 'intake' | 'glazed'
  stab_z      tailplane height, for the T-tail look on the jet
"""
SHAPES = {
    'sparrow': dict(
        fuse=FUSE_TABLE, wing_z=0.34, sweep=0.05, dihedral=6.5, taper=0.68,
        canopy='framed', canopy_at=-0.05, gear='taildragger', nose='spinner',
        stab_z=0.10, chord_scale=1.0,
    ),
    'falcon': dict(
        fuse=FUSE_TABLE, wing_z=-0.22, sweep=0.19, dihedral=5.5, taper=0.52,
        canopy='bubble', canopy_at=-0.08, gear='taildragger', nose='spinner',
        stab_z=0.12, chord_scale=1.0,
    ),
    'comet': dict(
        fuse=FUSE_RACER, wing_z=-0.18, sweep=0.30, dihedral=4.0, taper=0.42,
        canopy='razorback', canopy_at=0.02, gear='taildragger', nose='spinner',
        stab_z=0.14, chord_scale=0.92,
    ),
    'hammer': dict(
        fuse=FUSE_TANK, wing_z=-0.30, sweep=0.10, dihedral=7.5, taper=0.60,
        canopy='framed', canopy_at=0.06, gear='taildragger', nose='radial',
        stab_z=0.16, chord_scale=1.08,
    ),
    'fortress': dict(
        fuse=FUSE_TUBE, wing_z=0.30, sweep=0.14, dihedral=4.5, taper=0.38,
        canopy='glazed', canopy_at=0.20, gear='tricycle', nose='glazed',
        stab_z=0.18, chord_scale=1.0,
    ),
    'vector': dict(
        fuse=FUSE_JET, wing_z=-0.10, sweep=0.62, dihedral=2.0, taper=0.46,
        canopy='bubble', canopy_at=0.10, gear='tricycle', nose='intake',
        stab_z=0.62, chord_scale=0.88,
    ),
}

DEFAULT_SHAPE = SHAPES['falcon']


def build_fuselage(name, length, radius, nose_y, table=None,
                   segments=16, stations=22):
    """Lofted body running from the spinner backplate aft to the tailpost."""
    table = table or FUSE_TABLE
    secs = []
    for i in range(stations):
        t = i / (stations - 1)
        hw, hh, cz = sample_table(table, t)
        ring = superellipse(hw * radius, hh * radius, cz * radius, 2.45, segments)
        y = nose_y - t * length
        secs.append([(x, y, z) for (x, _, z) in ring])
    return mesh_from(name, *loft(secs, cap_start=True, cap_end=True))


def build_surface(
    name, span, root_chord, tip_chord, sweep, dihedral, washout,
    thickness, root_y, root_z, camber=0.02, sections=11, mirror=True,
    profile_points=18,
):
    """
    A lifting surface: airfoil sections lofted from root to tip with taper,
    leading-edge sweep, dihedral and washout, closed off by a rounded tip.

    `mirror` builds both halves as one mesh, which is what wings and tailplanes
    want; a fin passes False and gets rotated into place by the caller.
    """
    verts, faces = [], []

    def half(side):
        secs = []
        for i in range(sections):
            u = i / (sections - 1)
            # squeeze the last stations into a rounded tip instead of a slab
            tipf = 1.0
            if u > 0.86:
                k = (u - 0.86) / 0.14
                tipf = max(0.06, math.sqrt(max(0.0, 1.0 - k * k)))

            # tipf pulls the chord in as well as the thickness, so the planform
            # rounds off. Scaling only the thickness leaves a full-chord
            # knife-edge slab at the tip, which is what a square tip looks like.
            chord = lerp(root_chord, tip_chord, u) * tipf
            thick = thickness * lerp(1.0, 0.72, u)
            prof = naca4(camber, 0.4, thick, profile_points)

            x = side * span * u
            y0 = root_y - sweep * u
            z0 = root_z + math.sin(dihedral) * span * u
            twist = washout * u
            ct, st = math.cos(twist), math.sin(twist)

            ring = []
            for (cx, cy) in prof:
                # chord runs aft (-Y); thickness is +Z
                lc = (cx - 0.25) * chord
                lt = cy * chord
                ring.append((x, y0 - (lc * ct - lt * st),
                             z0 + (lc * st + lt * ct)))
            secs.append(ring)
        return loft(secs, cap_start=True, cap_end=True)

    for side in ([1, -1] if mirror else [1]):
        v, f = half(side)
        off = len(verts)
        verts.extend(v)
        faces.extend([[i + off for i in face] for face in f])

    return mesh_from(name, verts, faces)


CANOPY_TABLE = [
    (0.00, 0.20, 0.02),
    (0.14, 0.52, 0.42),
    (0.30, 0.82, 0.80),
    (0.50, 1.00, 1.00),
    (0.72, 0.94, 0.92),
    (0.88, 0.70, 0.62),
    (1.00, 0.34, 0.20),
]


def build_canopy(name, front_y, back_y, half_width, height, base_z, segments=11):
    """
    Half-dome greenhouse. Only the top half is built — the bottom is inside the
    fuselage, and drawing it would z-fight through the glass from the cockpit.
    """
    secs = []
    stations = 14
    for i in range(stations):
        t = i / (stations - 1)
        w, h = sample_table(CANOPY_TABLE, t)
        y = lerp(front_y, back_y, t)
        ring = []
        for j in range(segments):
            a = math.pi * (j / (segments - 1))  # 0..pi, one side to the other
            ring.append((
                half_width * w * math.cos(a),
                y,
                base_z + height * h * math.sin(a),
            ))
        secs.append(ring)
    return mesh_from(name, *loft(secs, closed_ring=False))


def build_tube(name, stations, segments=12, cap_start=False, cap_end=False):
    """Round lofted tube from (y, radius, centre_z) stations — cowls, pods."""
    secs = []
    for (y, r, cz) in stations:
        ring = []
        for i in range(segments):
            a = (i / segments) * TAU
            ring.append((r * math.cos(a), y, cz + r * math.sin(a)))
        secs.append(ring)
    return mesh_from(name, *loft(secs, cap_start=cap_start, cap_end=cap_end))


def build_blade(name, hub_r, tip_r, root_chord, tip_chord, sections=7):
    """
    Propeller blade: airfoil sections along the radius, twisting from coarse at
    the root to fine at the tip the way a real constant-speed blade does.
    """
    secs = []
    for i in range(sections):
        u = i / (sections - 1)
        r = lerp(hub_r, tip_r, u)
        tipf = 1.0
        if u > 0.85:
            k = (u - 0.85) / 0.15
            tipf = max(0.05, math.sqrt(max(0.0, 1.0 - k * k)))
        chord = lerp(root_chord, tip_chord, u) * tipf
        pitch = lerp(math.radians(42), math.radians(14), u)
        prof = naca4(0.03, 0.4, lerp(0.14, 0.07, u), 11)
        cp, sp = math.cos(pitch), math.sin(pitch)
        ring = []
        for (cx, cy) in prof:
            lc = (cx - 0.3) * chord
            lt = cy * chord
            # chord along X, thickness along Y, twisted about the blade axis Z
            ring.append((lc * cp - lt * sp, lc * sp + lt * cp, r))
        secs.append(ring)
    return mesh_from(name, *loft(secs, cap_start=True, cap_end=True))


def build_wheel(name, radius, width, segments=14):
    """
    Revolved tyre. The cross-section is a closed loop running from the hub bore
    out over the rounded tread and back, so the revolve produces a solid — an
    open band would read as a hollow ring from any angle that catches the edge.
    """
    w = width * 0.5
    hub = radius * 0.34
    prof = [
        (-w, hub),
        (-w, radius * 0.70),
        (-w * 0.82, radius * 0.93),
        (-w * 0.34, radius),
        (w * 0.34, radius),
        (w * 0.82, radius * 0.93),
        (w, radius * 0.70),
        (w, hub),
    ]
    secs = []
    for i in range(segments):
        a = (i / segments) * TAU
        secs.append([(px, pr * math.cos(a), pr * math.sin(a)) for (px, pr) in prof])
    return mesh_from(name, *loft(secs, wrap_sections=True))


def cylinder(name, radius, length, axis="Z", segments=10):
    """Plain capped cylinder — struts, gun barrels, racks."""
    secs = []
    for end in (0.0, length):
        ring = []
        for i in range(segments):
            a = (i / segments) * TAU
            c, s = radius * math.cos(a), radius * math.sin(a)
            if axis == "Z":
                ring.append((c, s, end))
            elif axis == "Y":
                ring.append((c, end, s))
            else:
                ring.append((end, c, s))
        secs.append(ring)
    return mesh_from(name, *loft(secs, cap_start=True, cap_end=True))


def box(name, sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
             [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    return mesh_from(name, verts, faces)


# ------------------------------------------------------------------ material


def make_material(name, hexcolor, roughness=0.62, metallic=0.18, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    r = ((hexcolor >> 16) & 255) / 255.0
    g = ((hexcolor >> 8) & 255) / 255.0
    b = (hexcolor & 255) / 255.0
    # authored colours are sRGB; Blender's inputs are linear
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    bsdf.inputs["Base Color"].default_value = (lin(r), lin(g), lin(b), alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    return m


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


# ------------------------------------------------------------------ assembly


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def join(name, objs):
    """Join a list of objects into one; multi-material stays as glTF primitives."""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def shade(ob, angle=38.0):
    """Smooth shading with an angle threshold, so panel edges stay crisp."""
    if ob is None:
        return
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        # older/newer API shuffles this operator around; smooth-only is fine
        pass


def empty(name, location, scale=1.0):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.2
    e.location = location
    e.scale = (scale, scale, scale)
    bpy.context.collection.objects.link(e)
    return e


def build_plane(spec):
    clear_scene()

    L = spec["length"]
    SPAN = spec["span"]
    CHORD = spec["chord"]
    engines = spec["engines"]
    jet = spec["jet"]
    twin_tail = spec["tail"] == "twin"
    guns = spec["guns"]
    radius = L * 0.093

    shape = SHAPES.get(spec["id"], DEFAULT_SHAPE)
    CHORD = CHORD * shape["chord_scale"]

    nose_y = L * 0.38
    tail_y = -L * 0.62
    wing_y = L * 0.03          # quarter-chord station
    root_z = radius * shape["wing_z"]

    m_body = make_material("body", spec["body"], 0.58, 0.22)
    m_wing = make_material("wing", spec["wing"], 0.60, 0.20)
    m_trim = make_material("trim", spec["trim"], 0.70, 0.10)
    m_spin = make_material("spinner", spec["spinner"], 0.40, 0.45)
    m_dark = make_material("dark", 0x24272B, 0.45, 0.65)
    m_rubber = make_material("rubber", 0x15161A, 0.95, 0.0)
    m_glass = make_material("glass", 0xAEE0F0, 0.08, 0.05, alpha=0.34)

    hull_parts, frame_parts, props, discs, muzzles = [], [], [], [], []

    # ---- fuselage -------------------------------------------------------
    hull_parts.append(assign(
        build_fuselage("fuse", L, radius, nose_y, shape["fuse"]), m_body))

    # Ventral radiator scoop under the wing root. The old full-length keel plank
    # read as a surfboard bolted to the belly; a scoop is what is actually there
    # on a liquid-cooled fighter and it breaks up the underside silhouette.
    # Only the liquid-cooled types need one. A radial is air-cooled, a bomber
    # puts its radiators in the nacelles, and a jet has none at all.
    if shape["nose"] == "spinner" and engines == 1:
        scoop = build_tube("scoop", [
            (wing_y + CHORD * 0.34, radius * 0.30, 0),
            (wing_y + CHORD * 0.05, radius * 0.40, 0),
            (wing_y - CHORD * 0.30, radius * 0.36, 0),
            (wing_y - CHORD * 0.52, radius * 0.22, 0),
        ], cap_start=True, cap_end=True)
        scoop.scale = (1.55, 1.0, 0.66)
        scoop.location = (0, 0, -radius * 0.80)
        hull_parts.append(assign(scoop, m_trim))

    # ---- wings ----------------------------------------------------------
    tip_chord = CHORD * shape["taper"]
    frame_parts.append(assign(build_surface(
        "wing", SPAN, CHORD, tip_chord, CHORD * shape["sweep"],
        math.radians(shape["dihedral"]), math.radians(-2.0), 0.13,
        wing_y, root_z,
    ), m_wing))

    # ---- tail -----------------------------------------------------------
    stab_span = SPAN * 0.36
    frame_parts.append(assign(build_surface(
        "stab", stab_span, CHORD * 0.52, CHORD * 0.32, CHORD * 0.16,
        math.radians(3), math.radians(0), 0.11,
        tail_y + L * 0.11, radius * shape["stab_z"],
        sections=8, profile_points=14,
    ), m_wing))

    fin_h = L * 0.20
    fin_positions = [(stab_span * 0.92, 1), (-stab_span * 0.92, -1)] if twin_tail else [(0, 1)]
    for (fx, _) in fin_positions:
        # Built at the origin and then moved, not built in place and rotated:
        # the rotation is about the object origin, so geometry authored far
        # down the fuselage would swing its offset into the vertical axis.
        fin = build_surface(
            "fin", fin_h, L * 0.20, L * 0.13, L * 0.10,
            math.radians(0), math.radians(0), 0.10, 0.0, 0.0,
            mirror=False, sections=8, profile_points=14,
        )
        # span X -> +Z stands it upright; the chord stays along Y
        fin.rotation_euler = (0, math.radians(-90), 0)
        fin.location = (fx, tail_y + L * 0.15, 0.14)
        frame_parts.append(assign(fin, m_wing))

    # ---- engines --------------------------------------------------------
    def add_prop(px, py, pz, prop_r, index, hub_r):
        # Ogive spinner, tip forward (+Y). Its base radius is handed in so it
        # meets whatever it is bolted to — nose or nacelle — without a step.
        nose_len = hub_r * 2.1
        spinner = build_tube("spin", [
            (-hub_r * 0.5, hub_r, 0),
            (nose_len * 0.28, hub_r * 0.95, 0),
            (nose_len * 0.62, hub_r * 0.72, 0),
            (nose_len * 0.86, hub_r * 0.40, 0),
            (nose_len, hub_r * 0.08, 0),
        ], cap_start=True, cap_end=True)
        assign(spinner, m_spin)

        blades = []
        for i in range(3):
            b = build_blade(f"blade{i}", hub_r * 0.85, prop_r,
                            prop_r * 0.19, prop_r * 0.115)
            b.rotation_euler = (0, math.radians(i * 120), 0)
            blades.append(assign(b, m_dark))

        prop = join(f"PROP_{index}", [spinner] + blades)
        shade(prop, 50)
        prop.location = (px, py, pz)
        props.append(prop)
        discs.append(empty(f"DISC_{index}", (px, py + 0.06, pz), prop_r))

    if engines == 1 and not jet:
        if shape["nose"] == "radial":
            # A radial sits in a fat drum cowl with cooling gills — the reason
            # the ground-attack aircraft reads as blunt-nosed from head on.
            cowl = build_tube("cowl", [
                (nose_y + 0.10, radius * 0.86, 0),
                (nose_y - 0.20, radius * 1.02, 0),
                (nose_y - 0.85, radius * 1.00, 0),
                (nose_y - 1.05, radius * 0.90, 0),
            ], cap_start=False, cap_end=False)
            hull_parts.append(assign(cowl, m_body))
            gills = build_tube("gills", [
                (nose_y - 0.92, radius * 1.03, 0),
                (nose_y - 1.06, radius * 0.94, 0),
            ], cap_start=False, cap_end=False)
            hull_parts.append(assign(gills, m_dark))
        else:
            # Inline engine: the fuselage nose already tapers into the spinner.
            # A drum over it read as a barrel and a ring read as a collar.
            exhaust_z = radius * 0.34
            for side in (1, -1):
                for i in range(3):
                    st = cylinder("stack", radius * 0.075, radius * 0.26, axis="Y")
                    st.location = (side * radius * 0.62,
                                   nose_y - 0.95 - i * radius * 0.32, exhaust_z)
                    st.rotation_euler = (math.radians(8), 0, math.radians(side * -12))
                    hull_parts.append(assign(st, m_dark))

        # 0.32 semi-span keeps the blade tips clear of the ground with the tail
        # down; the old 0.45 put a vertical blade half a metre into the runway.
        hub = radius * (0.42 if shape["nose"] == "radial" else 0.30)
        add_prop(0, nose_y - 0.04, 0, SPAN * 0.32, 0, hub)

    else:
        per_side = max(1, round(engines / 2))
        pod_len = L * (0.34 if jet else 0.30)
        idx = 0
        for side in (-1, 1):
            for i in range(per_side):
                x = side * SPAN * (0.32 + i * 0.30)
                r = radius * 0.52
                front = wing_y + pod_len * 0.55
                pod = build_tube("pod", [
                    (front, r * 0.72, 0),
                    (front - pod_len * 0.16, r, 0),
                    (front - pod_len * 0.72, r * 0.96, 0),
                    (front - pod_len, r * (0.80 if jet else 0.62), 0),
                ], cap_start=not jet, cap_end=not jet)
                pod.location = (x, 0, root_z + 0.05)
                frame_parts.append(assign(pod, m_dark if jet else m_body))

                if not jet:
                    add_prop(x, front - 0.02, root_z + 0.05, SPAN * 0.26, idx,
                             r * 0.68)
                    idx += 1

        if jet:
            intake = build_tube("intake", [
                (nose_y, radius * 0.66, 0),
                (nose_y - 0.55, radius * 0.80, 0),
            ])
            hull_parts.append(assign(intake, m_dark))

    # ---- canopy ---------------------------------------------------------
    # Four glasshouse styles, because the greenhouse is the single most
    # recognisable part of a warbird's profile from the side.
    style = shape["canopy"]
    canopy_y = L * shape["canopy_at"]

    if style == "bubble":
        canopy_len, cw, ch, cz = L * 0.30, 0.80, 0.78, 0.52
    elif style == "razorback":
        canopy_len, cw, ch, cz = L * 0.24, 0.68, 0.60, 0.58
    elif style == "glazed":
        canopy_len, cw, ch, cz = L * 0.20, 0.74, 0.52, 0.60
    else:  # framed — a taller, boxier trainer/attacker hood
        canopy_len, cw, ch, cz = L * 0.26, 0.86, 0.86, 0.48

    canopy = build_canopy(
        "canopy",
        canopy_y + canopy_len * 0.5, canopy_y - canopy_len * 0.5,
        radius * cw, radius * ch, radius * cz,
    )
    glass = assign(canopy, m_glass)

    if style == "razorback":
        # A spine running from the canopy back to the fin, which is what makes
        # a razorback a razorback.
        spine = build_tube("spine", [
            (canopy_y - canopy_len * 0.45, radius * 0.34, 0),
            (tail_y + L * 0.30, radius * 0.24, 0),
            (tail_y + L * 0.17, radius * 0.14, 0),
        ], cap_start=False, cap_end=False)
        spine.location = (0, 0, radius * 0.52)
        spine.scale = (1.0, 1.0, 0.72)
        hull_parts.append(assign(spine, m_body))

    if style == "glazed":
        # Bomb-aimer's nose glazing.
        nose_glass = build_canopy(
            "noseglass",
            nose_y - L * 0.02, nose_y - L * 0.14,
            radius * 0.72, radius * 0.70, -radius * 0.10,
        )
        frame_parts.append(assign(nose_glass, m_glass))

    headrest = box("headrest", radius * 0.52, 0.26, radius * 0.34)
    headrest.location = (0, canopy_y - canopy_len * 0.30, radius * 0.80)
    hull_parts.append(assign(headrest, m_dark))

    # Where the wing actually is at a given spanwise station. Guns and racks
    # were previously placed at fixed offsets from the wing root, which left
    # them hanging in clear air once the wing tapered and swept away from them.
    def wing_station(x_abs):
        u = min(1.0, abs(x_abs) / SPAN)
        chord = lerp(CHORD, tip_chord, u)
        quarter = wing_y - CHORD * shape["sweep"] * u
        rise = math.sin(math.radians(shape["dihedral"])) * SPAN * u
        return quarter + 0.25 * chord, chord, root_z + rise

    # ---- guns -----------------------------------------------------------
    for i in range(guns):
        side = 1 if i % 2 == 0 else -1
        slot = i // 2
        x = side * SPAN * (0.30 + slot * 0.16)
        le, chord, wz = wing_station(x)
        # barrel buried in the leading edge, muzzle just proud of it
        length = 0.55 + chord * 0.12
        y = le - length * 0.74
        barrel = cylinder("barrel", 0.058, length, axis="Y")
        barrel.location = (x, y, wz + 0.02)
        frame_parts.append(assign(barrel, m_dark))
        muzzles.append(empty(f"MUZZLE_{i}", (x, y + length, wz + 0.02)))

    # ---- bomb racks -----------------------------------------------------
    hard = []
    for side in (-1, 1):
        x = side * SPAN * 0.38
        le, chord, wz = wing_station(x)
        rack = box("rack", 0.26, chord * 0.5, 0.18)
        rack.location = (x, le - chord * 0.5, wz - 0.20)
        frame_parts.append(assign(rack, m_dark))
        hard.append(empty("HARD_L" if side < 0 else "HARD_R",
                          (x, le - chord * 0.5, wz - 0.34)))

    # ---- landing gear ---------------------------------------------------
    strut_len = radius * 1.15 + 0.45
    wheel_r = radius * 0.42
    for side in (1, -1):
        x = side * SPAN * 0.24
        le, chord, wz = wing_station(x)
        y = le - chord * 0.30
        leg = cylinder("leg", 0.09, strut_len, axis="Z")
        leg.location = (x, y, wz - strut_len)
        frame_parts.append(assign(leg, m_dark))

        w = build_wheel("wheel", wheel_r, wheel_r * 0.72)
        w.location = (x, y, wz - strut_len)
        frame_parts.append(assign(w, m_rubber))

    # Third leg: a taildragger carries it under the tail, a tricycle under the
    # nose. It changes the whole stance on the ground, so it is worth varying.
    if shape["gear"] == "tricycle":
        nose_r = radius * 0.30
        nose_strut = strut_len - (wheel_r - nose_r)
        nose_at = nose_y - L * 0.14
        nleg = cylinder("nleg", 0.08, nose_strut, axis="Z")
        nleg.location = (0, nose_at, root_z - nose_strut)
        frame_parts.append(assign(nleg, m_dark))
        nw = build_wheel("nwheel", nose_r, nose_r * 0.8)
        nw.location = (0, nose_at, root_z - nose_strut)
        frame_parts.append(assign(nw, m_rubber))
    else:
        tail_wheel_r = radius * 0.20
        tail_strut = strut_len * 0.40
        tleg = cylinder("tleg", 0.07, tail_strut, axis="Z")
        tleg.location = (0, tail_y + L * 0.08, -radius * 0.5 - tail_strut)
        frame_parts.append(assign(tleg, m_dark))
        tw = build_wheel("twheel", tail_wheel_r, tail_wheel_r * 0.8)
        tw.location = (0, tail_y + L * 0.08, -radius * 0.5 - tail_strut)
        frame_parts.append(assign(tw, m_rubber))

    ground_z = root_z - strut_len - wheel_r

    # ---- markers --------------------------------------------------------
    eye = empty("EYE", (0, canopy_y - canopy_len * 0.10, radius * 1.02))
    gearbottom = empty("GEARBOTTOM", (0, 0, ground_z))

    # ---- consolidate ----------------------------------------------------
    hull = join("HULL", hull_parts)
    shade(hull, 62)
    frame = join("AIRFRAME", frame_parts)
    shade(frame, 34)
    glass.name = "GLASS"
    shade(glass, 60)

    return {
        "hull": hull, "frame": frame, "glass": glass,
        "props": props, "discs": discs, "muzzles": muzzles,
        "hard": hard, "eye": eye, "ground": gearbottom,
    }


def export(spec):
    path = os.path.join(OUTDIR, f"{spec['id']}.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=False,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    return path


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    with open(SPECS) as f:
        specs = json.load(f)

    for spec in specs:
        build_plane(spec)
        path = export(spec)
        size = os.path.getsize(path)
        tris = sum(
            len(o.data.loop_triangles)
            for o in bpy.data.objects if o.type == "MESH"
            for _ in [o.data.calc_loop_triangles()]
        )
        print(f"[warbird] {spec['id']:9s} -> {os.path.basename(path):16s} "
              f"{size/1024:7.1f} KB  {tris:6d} tris")

    print("[warbird] done")


if __name__ == "__main__":
    main()
