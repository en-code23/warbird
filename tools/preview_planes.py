"""
Render a contact sheet of the exported aircraft.

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        --factory-startup --python tools/preview_planes.py -- out.png [angle]

Imports the GLBs rather than rebuilding from the source script, so this checks
the exported file — materials, axis conversion and all — and not just the
in-memory scene that produced it.
"""

import bpy
import json
import math
import os
import sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "assets", "models")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/planes.png"
ANGLE = argv[1] if len(argv) > 1 else "three-quarter"
ONLY = argv[2] if len(argv) > 2 else None


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def main():
    clear()
    with open(os.path.join(ROOT, "tools", "planespecs.json")) as f:
        specs = json.load(f)
    if ONLY:
        specs = [s for s in specs if s["id"] == ONLY]

    if len(specs) == 1:
        bpy.ops.import_scene.gltf(
            filepath=os.path.join(OUTDIR, f"{specs[0]['id']}.glb"))
        reach = None  # measured from the real bounds below
    else:
        # lay them out in a 3x2 grid, biggest span decides the spacing
        step = 16.0
        cols = 3
        for i, spec in enumerate(specs):
            path = os.path.join(OUTDIR, f"{spec['id']}.glb")
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=path)
            new = [o for o in bpy.data.objects if o not in before]

            cx = (i % cols - 1) * step
            cy = -(i // cols) * step * 0.75
            for o in new:
                if o.parent is None:
                    o.location.x += cx
                    o.location.y += cy
        reach = 34.0

    # camera framed on the bounding reach so any airframe fills the frame.
    # Aiming is done with a track-to constraint rather than hand-written euler
    # angles — those are easy to get subtly wrong and render an empty frame.
    # measure what is actually in the scene rather than trusting the spec
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for k in range(3):
                lo[k] = min(lo[k], w[k])
                hi[k] = max(hi[k], w[k])
    centre = [(lo[k] + hi[k]) / 2 for k in range(3)]
    measured = max(hi[k] - lo[k] for k in range(3)) * 0.62
    if reach is None:
        reach = measured
    print(f"[warbird] bounds x{lo[0]:.2f}..{hi[0]:.2f} "
          f"y{lo[1]:.2f}..{hi[1]:.2f} z{lo[2]:.2f}..{hi[2]:.2f}")

    target = bpy.data.objects.new("target", None)
    target.location = centre
    bpy.context.collection.objects.link(target)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 42
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    d = reach * 2.9
    positions = {
        "side": (d, 0, reach * 0.08),
        "top": (0, 0, d),
        "front": (0, d, reach * 0.14),
        "nose": (d * 0.5, d * 0.66, reach * 0.34),
        "three-quarter": (-d * 0.58, -d * 0.66, d * 0.34),
        "rear": (0, -d, reach * 0.18),
    }
    off = positions.get(ANGLE, positions["three-quarter"])
    cam.location = (centre[0] + off[0], centre[1] + off[1], centre[2] + off[2])
    con = cam.constraints.new(type="TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    bpy.context.scene.camera = cam

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = 6.0
    sun_data.angle = math.radians(6)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(52), math.radians(12), math.radians(-40))
    bpy.context.collection.objects.link(sun)

    fill_data = bpy.data.lights.new("fill", type="SUN")
    fill_data.energy = 1.2
    fill = bpy.data.objects.new("fill", fill_data)
    fill.rotation_euler = (math.radians(-40), 0, math.radians(120))
    bpy.context.collection.objects.link(fill)

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.21, 1)
    bpy.context.scene.world = world

    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 900
    scene.render.filepath = OUT
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"[warbird] wrote {OUT} using {scene.render.engine}")


main()
