# Warbird — project handoff

> For whoever picks this up next. Still written for an agent that **has Blender
> MCP**, which neither session that built this had.
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
| 2 | GitHub Pages site | **Done** |
| 3 | Rename root folder | **Done** — `test` → `warbird` |
| 4 | Control remap (`Q`↔`A`, `E`↔`D`) | **Done** — Q/E roll, A/D rudder |
| 5 | Shooting on left click | **Done** |
| 6 | Scope on right click | **Done** |
| 7 | Ram other players | **Done** |
| 8 | Creative mode, infinite chunked world | **Done** |
| 9 | Singleplayer timed destruction | **Done** — Strike, and it fights back now |
| 10 | Multiplayer with lobbies | **Done, needs a host** — now tested with two clients |
| 11 | Private lobbies with passwords | **Done** — tested both accept and reject |
| 12 | Points for kills and destruction | **Done** |
| 13 | Coins + shop | **Done** — prices retuned, see below |
| 14 | Multiple planes / guns / bombs | **Done** — 6 / 5 / 5 |
| 15 | Good stat descriptions | **Done** |
| 16 | More maps | **Done** — 6 |
| 17 | Bigger cities | **Done** |
| 18 | People walking | **Done** — plus traffic now |
| 19 | More realistic destruction | **Partial** — see §4 |
| 20 | Better cockpit | **Partial** — see §3 |
| 21 | Commented code | **Done** |
| 22 | Good README | **Done** |
| 23 | "Make everything realistic", use Blender | **NOT DONE — still the main outstanding item** |

### Second round

| Asked for | Status |
|---|---|
| Mobile version | **Done** — touch layer, responsive menus, landscape lock |
| Runs smoothly, no overheating | **Done** — 669 → 148 draw calls, tiers, frame cap, governor |
| "Maybe with Rust" | **Deliberately not** — see §1, the profile says it cannot help |
| AI opponents / anti-aircraft | **Half done** — flak batteries exist, AI aircraft do not |
| Vehicles | **Done** — `src/vehicles.js` |
| Free Flight landing challenge | **Done** — the home strip has a PAPI now |
| Economy balance | **Done** — retuned, see §6 |
| Persistent rubble | **Done** — collapsed buildings leave a heap |
| Two-client multiplayer test | **Done** — and it found a real bug, see §5 |

---

## 1. Why there is no Rust, and where the time actually went

The brief asked for Rust "or whatever fits best". The sim was profiled first, and
the numbers ruled it out:

| | Before | After |
|---|---|---|
| Draw calls / frame | 669 | **148** |
| Triangles / frame | 115k | 135k |
| JS simulation / frame | **0.05 ms** | 0.05 ms |

Measured per call: `buildingAt` 0.0011 ms (5×/frame), `pedestrians.update`
0.018 ms, `pedestrians.rayHit` 0.0018 ms (≤14×/frame). The whole simulation is
0.3% of a frame. **Rust/WASM cannot touch what was actually slow** — draw-call
submission is browser + driver, fill rate is the GPU. It would also have cost the
zero-build-step deploy, which is what makes this repo a static site.

If you are tempted to revisit this: measure first. The hook is
`window.sim.renderer.info`, and the draw-call counter used here is a monkey-patch
over the WebGL context's `drawElements` / `drawArrays` / `drawElementsInstanced`.

---

## 2. Blender models — still the big one

**No Blender MCP server has been connected to either session that built this**,
so every model in the repo is procedural three.js geometry. You have Blender MCP.
This is still the highest-value thing to pick up.

### The swap point

All aircraft are built by one factory: `createPlane(spec, opts)` in
`src/plane.js`. Nothing else knows how an aircraft is constructed. Replace the
body with a `GLTFLoader` call and return the same shape:

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
Bake any axis correction into the geometry — do not change the flight code.

`gearHeight` and `hull` are load-bearing: ground contact and building collision
both come from them.

### Priority order

1. **The six aircraft** — one per entry in `PLANES` (`src/catalog.js`).
2. **A cockpit interior** — `src/cockpit.js` is the weakest part of the project.
3. **Flak batteries** — `src/flak.js` builds them from a cylinder and a cone.
   They must stay in two `InstancedMesh`es (bases and barrels) because the barrel
   instance matrix is what tracks the target.
4. **Pedestrians and vehicles** — both instanced; keep them that way.
5. **Buildings** — see the warning below.

### ⚠️ Buildings are instanced now — read this before touching them

Buildings no longer have individual meshes. They live in a shared
`BuildingBatch` (`src/buildings.js`): two `InstancedMesh`es for facades and
roofs, one instance per building. This is what took a city from ~500 draw calls
to 2, and it constrains what a modelled building can be:

- All instances share **one geometry**. Per-building variety comes from the
  instance matrix (position/scale/lean), per-instance colour, and the `iSize`
  attribute that drives facade tiling in the vertex shader.
- Per-face UV tiling is done in `onBeforeCompile`, not baked into UVs. If you
  swap the geometry for a modelled shell, the shader hook has to follow — and
  `customProgramCacheKey` must stay, or three hands back a program compiled for
  a material that never had the hook.
- Collapse is a per-instance matrix rewrite (`b.setCollapse(k)`), scorching is a
  per-instance colour write (`b.setTint(c)`). Only buildings that are actually
  changing get rewritten.
- `world.js` still relies on **axis-aligned boxes** for collision. Keep footprints
  rectangular or update `buildingAt`.

A handful of modular facade pieces would work well here as long as they stay one
shared geometry. Several different building *shapes* would mean one batch per
shape — still cheap, but it is a real design change.

**Budget**: a few thousand triangles per export.

---

## 3. Cockpit view — partial

`src/cockpit.js` draws a real instrument panel (airspeed, altitude, RPM, fuel
dials with live needles on a canvas texture, plus airframe and throttle bars), a
reflector gunsight, canopy frame and a control stick that moves with your input.

Two known issues left:

- **The wings read as flat black slabs** either side of the view, because they
  are lit only from above and you are seeing their underside.
- **The interior is one generic cockpit** scaled by fuselage radius, used for
  every aircraft. A bomber and a jet should not have the same office.

Two bugs were found and fixed here, worth knowing if you rework it: the eye point
used to sit *inside* the lathe fuselage, and a shroud box behind the panel
punched through the instrument face and hid every dial. If you re-add geometry
near the panel, check it from inside.

---

## 4. Destruction — still partial

What works:

- Hit points scaled by footprint and height; gunfire chips and scorches.
- Collapse animates: sinks, leans on two axes, throws debris and dust, smokes.
- **Persistent rubble**: a finished collapse drops static instanced debris blocks
  that stay for the rest of the sortie (`effects.dropRubble`, one draw call for
  the whole city's ruins, capped at 420 blocks).
- Cluster munitions split into twelve bomblets; incendiaries spread over six
  waves; pedestrians and vehicles die to blasts and gunfire.

Still missing for "realistic":

- **No structural fragments.** Buildings scale down rather than breaking apart.
  Pre-fractured meshes (Blender's Cell Fracture) swapped in on destruction is the
  real fix, and is exactly the kind of job Blender MCP makes tractable. Note the
  instancing constraint in §2 — fragments would need their own batch.
- **No fire propagation along streets**, only radial spread from the impact.
- **Collapsed buildings stop being collidable**; the ground check covers them.

---

## 5. Multiplayer — tested, and it had a real bug

The client (`src/net.js`) and server (`server/index.js`) are complete: lobby
browser, create/join, private lobbies with passwords, host-launched matches,
~15 Hz state sync, interpolated remote aircraft, kill feed, standings, timer.

**A full two-client match has now been run** — connect, list, create private,
reject wrong password, join with the right one, launch, live position sync, and a
kill landing on both scoreboards.

That test immediately found a bug that would have broken every real session:
`client.lastSeen` was only refreshed by an application message, and a client
sitting in a lobby **sends nothing at all**. Anyone waiting more than 30 seconds
for a friend was silently terminated by the reaper. Fixed with protocol-level
`ws.ping()` / `pong`, which the browser answers in the network layer and which
therefore survives a backgrounded tab whose JS timers are throttled.

**It still cannot work from GitHub Pages alone** — Pages is static hosting. To
finish this for the public site:

1. Deploy `server/` to Render / Fly.io / Railway (`node server/index.js`, reads
   `$PORT`).
2. Link people to `https://en-code23.github.io/warbird/?server=wss://your-host`,
   or hard-code the default in `src/ui.js` (`wireLobby`).

**The trust model is weak by design**: damage and deaths are client-reported.
Making it authoritative means moving flight integration server-side — a large job
and deliberately out of scope.

---

## 6. Balance notes

The economy was previously untuned: a good five-minute Strike run paid ~300 coins
against a 12,000 jet, i.e. ~40 sorties for the last aircraft.

- Payout is now 60% of score plus a flat 120 for bringing the aircraft home.
- Flak (60) and vehicles (6) add to the board.
- Prices cut across the range; the jet is 9,800.
- Roughly: first upgrade ~1 run, mid tier ~4 runs, the jet ~9 runs.

Flak difficulty per map is in `maps.js` under `defences` — `count`, `range`,
`minHeight`, `accuracy`, `damage`. Measured: a straight pass over Midtown at
300 m cost 72 HP before the easy map was softened, which killed the 55-armour
trainer on the first sortie of the game. The easy maps were toned down; Dust
Basin, Kranzberg and Nightfall keep their teeth. **This is the number most likely
to need another pass once real people play it.**

---

## 7. Mobile

`src/touch.js` and the `#touch` block in `index.html`. Three deliberate choices,
each documented in the module header:

- The throttle is a **slide lever in a slotted gate**, not a +/- pair.
- The stick has **no fixed base** — touch anywhere on the right side and that
  point becomes centre.
- Deflection is **squared**, so small movements near centre are gentle.

Keyboard and touch feed the same axes; the keyboard wins when a key is held, so a
tablet with a keyboard works.

Not done:

- **No haptics.** `navigator.vibrate` on gun fire and touchdown would help.
- **No control customisation** — sizes and positions are fixed.
- **iOS Safari gets neither fullscreen nor an orientation lock** (it supports
  neither API); the landscape nag covers it, but the address bar still eats
  screen space.
- **Untested on real hardware.** Everything here was verified in a 844×390
  viewport with synthetic pointer events, which exercises the logic but tells you
  nothing about real thermals or touch latency. **Get it on an actual phone.**

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

⚠️ **Chrome caches ES modules per origin aggressively**, and `Cache-Control:
no-store` does not clear the in-memory module map. A hard reload is not enough.
Serve from a **different port** to force a fresh module graph, or you will spend
twenty minutes debugging code the browser is not running.

Touch controls can be driven with synthetic `PointerEvent`s, but note
`setPointerCapture` throws for a pointer id that was never real — which is also a
genuine Safari failure mode, so it is wrapped in `capture()` in `touch.js`.

### Things verified working

- Takeoff and climb for all six aircraft
- Bombing, gun damage, building destruction, pedestrian hits, blast kills
- Landing grading across the whole band, greaser through to crash
- Terrain hazard collisions with the right message per map
- **No leak over 10 rebuilds of the same map**: geometry drift −2, textures 0,
  programs constant
- **Free Flight over 14 legs of streaming**: chunk count constant, and
  `slots in use === live buildings` held every single time — the batch free list
  never leaks a slot
- **Touch**: throttle drag drives the flight model and paints the lever, the
  stick actually banks the aircraft, guns fire and cease, bomb releases, rudder
  centres on release, scope toggles both ways, throttle and stick work
  simultaneously under two fingers
- **Flak**: fires, tracks, leads, holds fire below its minimum height,
  destructible by both bombs and guns
- **Two-client multiplayer**, end to end
- The live GitHub Pages build, not just localhost

### Never tested

- **Any of this on real mobile hardware.** The whole point of the round was
  thermals, and thermals cannot be measured in a desktop browser at a phone-sized
  viewport. This is the first thing to verify.
- More than two multiplayer clients at once.
- iOS Safari specifically (no fullscreen or orientation-lock API).
