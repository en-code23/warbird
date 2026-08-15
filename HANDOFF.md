# Warbird — project handoff

> For whoever picks this up next. Written for an agent that **has Blender MCP**,
> which the session that built this did not.
>
> Read [`README.md`](README.md) first for what the game is and how to run it.
> This document is only about **state of the work**: what is done, what is not,
> and where the seams are.

- **Repo**: https://github.com/en-code23/warbird
- **Live site**: https://en-code23.github.io/warbird/ (GitHub Pages, `main`, root)
- **Local**: `python3 -m http.server 8123`, plus `npm run server` for multiplayer

---

## Status against the original brief

| # | Asked for | Status |
|---|---|---|
| 1 | Public repo | **Done** |
| 2 | GitHub Pages site | **Done** — `en-code23.github.io/warbird` |
| 3 | Rename root folder | **Done** — `test` → `warbird` |
| 4 | Control remap (`Q`↔`A`, `E`↔`D`) | **Done** — Q/E roll, A/D rudder |
| 5 | Shooting on left click | **Done** — hitscan guns, tracers, per-gun ballistics |
| 6 | Scope on right click | **Done** — toggles, narrows FOV to 22°, swaps reticle for a gunsight |
| 7 | Ram other players | **Done** — proximity check in `updateFlight` |
| 8 | Creative mode, infinite chunked world | **Done** — `src/chunks.js` |
| 9 | Singleplayer timed destruction | **Done** — Strike mode, 2/5/10 min |
| 10 | Multiplayer with lobbies | **Done, needs a host** — see *Multiplayer* below |
| 11 | Private lobbies with passwords | **Done** — server-side check |
| 12 | Points for kills and destruction | **Done** — per-mode scoring table in `src/modes.js` |
| 13 | Coins + shop | **Done** — `src/economy.js`, shop UI in `src/ui.js` |
| 14 | Multiple planes / guns / bombs | **Done** — 6 / 5 / 5 in `src/catalog.js` |
| 15 | Good stat descriptions | **Done** — prose + comparable stat bars on every shop card |
| 16 | More maps | **Done** — 6 total (was 4) |
| 17 | Bigger cities | **Done** — grids up ~2×, e.g. Midtown 84 → 225 buildings |
| 18 | People walking | **Done** — `src/pedestrians.js`, 260 instanced, shootable, they flee blasts |
| 19 | More realistic destruction | **Partial** — see below |
| 20 | Better cockpit | **Partial** — see below |
| 21 | Commented code | **Done** — every module has a header explaining *why*, not just *what* |
| 22 | Good README | **Done** |
| 23 | "Make everything realistic", use Blender | **NOT DONE — this is the main outstanding item** |

---

## 1. Blender models — the big one

**No Blender MCP server was connected to the session that built this**, so every
model in the repo is procedural three.js geometry. You have Blender MCP. This is
the highest-value thing to pick up.

### The swap point

All aircraft are built by one factory: `createPlane(spec, opts)` in
`src/plane.js`. Nothing else in the codebase knows how an aircraft is
constructed. Replace the body with a `GLTFLoader` call and return the same shape:

```js
{
  group,          // THREE.Object3D — nose along -Z, wings along X
  propellers,     // Object3D[] that spin about their local Z
  propDiscs,      // Mesh[] whose material.opacity tracks RPM
  hideInCockpit,  // Mesh[] enclosing the pilot; hidden in cockpit view
  hardpoints,     // local-space Vector3[] bombs drop from
  muzzles,        // local-space Vector3[] tracers spawn from
  eye,            // local-space cockpit camera position
  dimensions,     // {length, span, radius}
  gearHeight,     // wheels-to-origin distance; drives ground contact
  hull            // local-space Vector3[] sampled for collision
}
```

**Conventions that must hold**: `-Z` is forward, `+Y` is up, `+X` is starboard.
If an export uses a different axis convention, bake the correction into the
geometry — do not change the flight code, which assumes this throughout.

`gearHeight` and `hull` are load-bearing: ground contact and building collision
both come from them. Get them wrong and the aircraft either floats or clips.

### Priority order

1. **The six aircraft** — one per entry in `PLANES` (`src/catalog.js`). Each has
   a `model` block (length, span, chord, tail type, engine count, colours) that
   the procedural factory consumes; a real mesh can ignore it, but keep
   `dimensions` roughly consistent or the camera and gear heights need retuning.
2. **A cockpit interior** — `src/cockpit.js` builds one procedurally and it is
   the weakest part of the project (see below). A real modelled cockpit per
   aircraft would be a large visible win.
3. **Pedestrians** — currently capsule-and-sphere figures in an InstancedMesh.
   They need to stay instanced; export a single low-poly figure and keep the
   two-mesh (body/head) split or collapse it to one.
4. **Buildings** — currently textured boxes. A handful of modular facade pieces
   would carry the "bigger, more realistic cities" goal further than anything
   else. Note that `world.js` relies on axis-aligned boxes for collision, so keep
   footprints rectangular or update `buildingAt`.

**Budget**: keep exports to a few thousand triangles. Cities render hundreds of
objects and the sim targets 60fps on integrated graphics.

---

## 2. Cockpit view — partial

`src/cockpit.js` now draws a real instrument panel (airspeed, altitude, RPM, fuel
dials with live needles on a canvas texture, plus airframe and throttle bars), a
reflector gunsight, canopy frame and a control stick that moves with your input.
Verified working on screen.

Two known issues left:

- **The wings read as flat black slabs** either side of the view, because they
  are lit only from above and you are seeing their underside. Needs either a real
  cockpit sill occluding them, or a modelled wing root.
- **The interior is one generic cockpit** scaled by fuselage radius, used for
  every aircraft. A bomber and a jet should not have the same office.

Two bugs were found and fixed during development, worth knowing about if you
rework it: the eye point used to sit *inside* the lathe fuselage (fixed by
tagging enclosing meshes `hideInCockpit`), and a shroud box behind the panel
punched through the instrument face and hid every dial (fixed by deleting the
shroud). If you re-add geometry near the panel, check it from inside.

---

## 3. Destruction — partial

What works now:

- Buildings have hit points scaled by footprint and height. Gunfire chips them
  down and scorches the facade as it goes; bombs destroy outright inside the
  blast radius.
- Collapse animates: the building sinks, leans on two axes, throws debris and
  dust, then smokes for ~26 seconds.
- Cluster munitions split into twelve bomblets at 70 m.
- Incendiaries spread to neighbouring buildings over six waves.
- Pedestrians are killed by blasts and gunfire, and the survivors run.

What is still missing for "realistic":

- **No structural fragments.** Buildings scale down rather than breaking into
  pieces. Real progress here means pre-fractured meshes (Blender's Cell Fracture
  can bake these) swapped in on destruction, which is exactly the kind of job
  Blender MCP makes tractable.
- **No debris that persists.** Rubble is a flattened box, not a pile.
- **No fire propagation along streets**, only radial spread from the impact.
- **Collapsed buildings stop being collidable**; the ground check covers them.

---

## 4. Multiplayer — done, but needs a host

The client (`src/net.js`) and server (`server/index.js`) are complete: lobby
browser, create/join, private lobbies with passwords, host-launched matches,
~15 Hz state sync, interpolated remote aircraft, kill feed, standings, match
timer.

**It cannot work from GitHub Pages alone** — Pages is static hosting and cannot
run a WebSocket server. To finish this feature for the public site:

1. Deploy `server/` to Render / Fly.io / Railway (start command
   `node server/index.js`, it reads `$PORT`).
2. Put the `wss://` URL in the Multiplayer screen, or link people to
   `https://en-code23.github.io/warbird/?server=wss://your-host`.
3. Optionally hard-code that default in `src/ui.js` (`wireLobby`, the
   `serverInput.value` fallback).

**It has not been tested with two live clients.** Single-client paths (connect,
lobby list, create, join) are exercised by the code but a real two-player match
has never been run. That is the first thing to verify.

**The trust model is weak by design**: damage and deaths are client-reported.
Making it authoritative means moving flight integration server-side — a large job
and deliberately out of scope.

---

## 5. Smaller things not done

- **No AI opponents.** Singleplayer is you against a city; nothing shoots back.
  There is no anti-aircraft fire on any map.
- **Vehicles.** There are pedestrians but no cars or trains.
- **Sound is entirely synthesised** (WebAudio). It is serviceable, not good.
  Real samples would help more than almost any visual change.
- **No mobile/touch controls.** Keyboard and mouse only.
- **Free Flight has no landing challenge** — one home strip at the origin with no
  PAPI, since `runway.papi` is an empty array for chunk worlds.
- **The economy is unbalanced.** Prices and payouts were set by feel, never
  tuned. A Strike run scores a few hundred; the jet costs 12,000.

---

## Testing approach that worked

Drive the page with Playwright, step frames explicitly, freeze, then screenshot:

```js
const frame = () => new Promise(r => requestAnimationFrame(r));
document.querySelectorAll('.mode-card')[0].click();
await frame();
document.querySelectorAll('.map-card')[0].click();
for (let i = 0; i < 30; i++) await frame();
window.sim.setRunning(false);   // freeze so the last frame stays on screen
```

WebGL canvases screenshot correctly through the compositor even though
`preserveDrawingBuffer` is off — **provided the loop is frozen**.

This caught several real bugs that reading the code did not: an aliased shared
temporary vector in the particle system, a butte generated on the approach
centreline, landings that graded far too leniently against the fpm shown on the
HUD, and both cockpit faults above.

### Things verified working

Takeoff and climb; bombing and building destruction; gun damage (600 hp tower →
132 hp under 1.5s of 30mm); pedestrian ray hits and blast kills; landing grading
across the whole band from greaser to crash; hazard collisions; map switching
without leaking objects; Free Flight chunk streaming (49 chunks held constant,
buildings varying 299–731 with terrain) and unlimited ammo; the cockpit panel.

### Never tested

Two-client multiplayer. Any of the six aircraft other than the starter Sparrow in
actual flight — the physics is shared and parameterised, so they should be fine,
but the fast ones (Comet, Vector) have high stall speeds and may make the shorter
runways unusable. Worth a pass.
