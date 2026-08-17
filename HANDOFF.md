# Warbird — project handoff

> For whoever picks this up next.
>
> **Blender no longer needs an MCP.** The third session drove Blender 5.2
> headlessly from a Python script (`tools/build_planes.py`), which is better than
> an MCP would have been: the models are reproducible from the catalogue data
> rather than hand-modelled once and frozen. The aircraft are done. Buildings,
> terrain and the cockpit are not — see §2.
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
| 23 | "Make everything realistic", use Blender | **Aircraft done** — buildings/terrain/cockpit still procedural, §2 |

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

### Third round

| Asked for | Status |
|---|---|
| Affinity for better UI | **Not possible — Affinity has no scripting interface.** Affinity 3.2.3 is installed but ships no CLI, no AppleScript dictionary and no plugin API, so nothing can drive it programmatically. The UI work was done directly in CSS: a shot-down card, a settings strip, and a HUD collision fix. See §8 |
| Blender for better models | **Done** — all six airframes, `tools/build_planes.py`, §2 |
| SuperCollider for music | **Done** — 16-bar menu theme rendered NRT, `tools/build_music.scd` |
| Engine sound less annoying | **Done and measured** — dissonance −47% to −69%, §9 |
| Mobile respawning | **Done** — it was genuinely unreachable before, §8 |
| Fullscreen for phone | **Done** — explicit toggle plus auto-entry on launch, §8 |

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

## 2. Blender models — aircraft done, scenery not

**The aircraft are Blender-built.** `tools/build_planes.py` drives Blender 5.2
headlessly and exports one GLB per airframe; `src/planeModel.js` loads them.
No MCP is involved and none is needed — see the README for the commands.

Do it the same way for anything else you model. Driving Blender from a script
that reads the game's own data beats hand-modelling because the geometry cannot
drift away from the stats, and anyone can regenerate the whole fleet from a
clean checkout.

**Still procedural**, in rough value order:

1. **The cockpit interior** — `src/cockpit.js`, still the weakest part of the
   project. Highest value remaining.
2. **Flak batteries** — `src/flak.js` builds them from a cylinder and a cone.
   They must stay in two `InstancedMesh`es (bases and barrels) because the
   barrel instance matrix is what tracks the target.
3. **Pedestrians and vehicles** — both instanced; keep them that way.
4. **Buildings** — see the warning below. Hardest, because of the shader hook.

### The swap point (already taken, for reference)

Aircraft come from `buildPlane(spec, opts)` in `src/planeModel.js`, which falls
back to `createPlane(spec.model, opts)` in `src/plane.js` when a GLB is missing
or fails to load. Both return the same shape:

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

### Two things that will bite you

**Axis conversion is free if you build for it.** Model with nose `+Y`, up `+Z`,
span `X` in Blender, then export with `export_yup=True`. The exporter maps
`(x,y,z) → (x, z, −y)`, which lands exactly on the game's `−Z` forward, `+Y` up.
Do not rotate objects to fix it afterwards — rotation happens about the object
origin, so geometry authored far down the fuselage swings its offset into the
wrong axis. That bug put a tail fin six units under the aircraft.

**Clones share buffers, so disposal is a hazard.** `planeModel.js` clones one
cached template per aircraft type, so a lobby of eight Falcons uploads one set of
buffers. Every shared geometry and material is flagged `userData.shared`, and
`disposePlane()` is the only thing that may free one. Calling
`geometry.dispose()` in a traverse — which is what the code used to do — would
free the template out from under every other aircraft in the match.

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
- **iPhone Safari still gets no fullscreen** — it exposes no Fullscreen API, so
  the FULL switch and the menu toggle are both hidden there rather than offered
  and silently doing nothing. The landscape nag covers orientation. Adding to the
  home screen is the only way to lose the address bar on iPhone.
- **Untested on real hardware.** Everything here was verified in a 844×390
  viewport with synthetic pointer events, which exercises the logic but tells you
  nothing about real thermals or touch latency. **Get it on an actual phone.**

---

## 8. UI work in the third round

**Affinity cannot be scripted.** Affinity 3.2.3 is installed on the build
machine, but it ships no CLI, no AppleScript dictionary (`osascript` reaches only
the standard application suite) and no plugin API. Nothing can drive it
programmatically, and a design tool would not have produced shippable CSS anyway.
The UI work was done in `src/style.css` directly. If you want Affinity in the
loop, the realistic use is exporting an SVG by hand and inlining it.

Three changes:

**The shot-down card** (`#down`). Being shot down previously printed
`DOWN — press R to respawn` as a HUD banner. On a phone that is a dead end you
cannot fly out of: there is no R key, and no other control respawns. It is now a
card with a 56 px-tall button, which is the fix for "make mobile respawning
work". The keyboard hint is hidden in touch mode, and the button is auto-focused
only on non-touch so no stray focus ring appears on a phone.

Worth keeping if you rework it: the test that mattered was
`document.elementFromPoint()` at the button's centre returning `down-respawn`.
A card that renders correctly but sits under the touch layer would look perfect
in a screenshot and be untappable.

**The settings strip** on the main menu — music, sound, fullscreen. Each is a
lamp driven by real state, not remembered intent, so a browser-initiated
fullscreen exit turns the light off. Fullscreen is hidden where unsupported.

**A HUD collision fix**: `body.touch-mode .bl` sat at 84 px, and the four-gauge
stack above it ends at 95 px, so the airframe-integrity bar printed through the
heading readout on a short landscape phone. Now 104 px.

---

## 9. Audio

`src/audio.js`. Routing is master → { music, sfx } so the two can be balanced
and muted independently.

**The engine was rebuilt against measurements**, not opinion.
`tools/engine-measure.js` renders the old and new models through an
`OfflineAudioContext` and scores both; the README has the table. Level-matched,
sensory dissonance is down 47–69% and sub-40 Hz energy at idle went from 47.9%
to 0.2%.

Two things worth knowing if you tune it further:

- **Measure tonal dissonance, not modulation-band energy.** The first metric
  tried was envelope energy in the 20–150 Hz band, which reported the new engine
  as *worse* — because a broadband prop-wash layer had deliberately been added,
  and noise has a random envelope with energy everywhere. The Plomp–Levelt
  pairwise-partial measure ignores broadband noise and tracks what "harsh"
  actually is.
- **Do not clamp the weight oscillator to a fixed floor.** Clamping it to 46 Hz
  killed the wasted sub-bass but parked it ~15 Hz from the fundamental, inside a
  critical band, and dissonance went *up*. Unison with the fundamental fixes both
  at once and cannot beat.

**The menu theme** is the only audio file: 16 bars at 72 BPM in D minor, rendered
non-real-time by `tools/build_music.scd`. It plays on the menus and fades out on
launch — in flight it would only fight the engine. See the README for the
render, the two-pass loop trick, and why loop points come from the musical length
rather than the decoded duration.

Not done:

- **No positional audio.** Other aircraft, flak and explosions are all centred
  regardless of where they are. `PannerNode` per event would be a real upgrade.
- **No in-game music bed.** Deliberate, but a very sparse one during Free Flight
  might work.
- **The engine has never been heard on a phone speaker.** The sub-40 Hz work was
  aimed squarely at small drivers and is unverified on one.

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
- **All six Blender airframes load and assemble**: correct propeller count per
  type (4 for the Fortress, 0 for the jet), correct muzzle count per catalogue
  entry (1 / 4 / 6), plausible per-type ride heights
- **The shot-down card and its respawn button**, including a hit test proving
  nothing overlays the button, and the plane genuinely returning to the runway
  rearmed and repaired
- **Fullscreen** enters, and the lamps resync from the real `fullscreenchange`
  event rather than from what we asked for
- **The theme decodes to exactly 53.33333 s** — zero drift against the musical
  length, so the loop points are sample-accurate
- **Engine A/B**, level-matched, through an `OfflineAudioContext`

### Never tested

- **Any of this on real mobile hardware.** The whole point of that round was
  thermals, and thermals cannot be measured in a desktop browser at a phone-sized
  viewport. This is still the first thing to verify.
- **The music loop by ear.** The seam was verified numerically (0.9994
  correlation between passes, zero decode drift) but nobody has listened to it
  wrap. Listen to it once.
- **The engine on a phone speaker** — see §9.
- More than two multiplayer clients at once.
- iPhone Safari specifically (no Fullscreen API; MP3 decode padding may differ,
  which is why `leadingSilence()` measures it at runtime instead of assuming).
