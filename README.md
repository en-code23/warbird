# Bomber Run

A small 3D flight simulator in [three.js](https://threejs.org/): pick a city,
take off, flatten it, and get back on the deck in one piece.

No build step, no dependencies to install — three.js is pulled from a CDN via an
import map.

## Running it

ES modules can't be loaded over `file://`, so it needs a local server:

```bash
python3 -m http.server 8123
# then open http://localhost:8123/
```

Any static server works (`npx serve`, `php -S localhost:8123`, …).

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Rudder left / right |
| `↑` / `↓` | Throttle |
| `B` | Wheel brakes |
| `Space` | Release a bomb |
| `C` | Toggle chase / cockpit view |
| `M` | Change map (`M` or `Esc` again to resume) |
| `R` | Respawn on the runway |

Roll the aircraft and the nose swings round with it — banked turns are how you
steer, the rudder is only for trimming. Below about 50kt the wing stops flying
and you sink; the `STALL` light warns you first.

The green ring on the ground is the bomb sight: it marks where a bomb released
right now would land, so fly until the ring sits on the target.

## Maps

Four fields, picked from the title screen or with `M`. Damage and score reset
when you switch.

| Map | Difficulty | What makes it interesting |
| --- | --- | --- |
| **Midtown** | Easy | Dense grid on open farmland, long runway, clear approach. |
| **Bayside** | Moderate | Harbour city with piers and shipping. The field is a raised causeway out in the bay and runs crosswise to the town, so the circuit is awkward and an overrun puts you in the water. |
| **Dust Basin** | Hard | Low adobe town on a desert floor, ringed by buttes. The rock is indestructible — bombing it does nothing and flying into it ends the sortie. |
| **Kranzberg** | Hard | Valley town at dusk under snow-capped peaks. Short strip and high ground either side. |

Terrain hazards are always kept clear of the runway, its approach corridor and
the climb-out, so every field stays usable however the scenery rolls.

## Landing

Landing is scored, not just survived.

Fly the approach on the **PAPI** — four lights beside the touchdown zone, set to
a 4° glideslope. Two white and two red means you're on it; all white means high,
all red means low. The `APPROACH` panel on the left shows range to the aim point,
your actual glideslope angle, and a deviation marker.

Touch down under the structural limits — 14 units/sec of sink, wings within 20°
of level, nose neither dug in nor pitched way up — or you write the aircraft off.
Get down inside them and the arrival is graded on sink rate:

| Grade | Sink | Bonus |
| --- | --- | --- |
| `GREASED` | under ~240 fpm | +5 |
| `GOOD` | under ~550 fpm | +3 |
| `FIRM` | under ~1080 fpm | +2 |
| `HARD` | anything still survivable | +1 |
| `OFF HEADING` | on the strip but crooked | +1 |
| `OFF FIELD` | survivable, but not on the runway | +0 |

The landing only counts once you **brake to a stop** — that's when the bonus is
paid and the bomb bay is rearmed, so you can fly another sortie without
respawning. Ditching in the water is never survivable.

## What's in it

- **Flight model** — arcade, not a study sim. Thrust vs. quadratic drag,
  speed bled by climb angle, control authority that falls away with airspeed,
  lift that drops off as you bank, and coordinated turns driven by bank angle.
- **Towns** — a road grid of blocks with taller towers toward the centre, parks,
  rooftop masts, an airfield with hangars, and scattered vegetation. Facades use
  a generated texture per architectural style (office glass, adobe, alpine
  chalet) with per-face UV scaling, so windows stay a constant size instead of
  stretching with the building.
- **Bombing** — ballistic bombs that weathervane into the airflow, with a
  predicted-impact sight. A hit brings down everything inside the blast radius;
  buildings collapse, throw debris and dust, then smoke for a while. Damage is
  persistent across respawns.
- **Crashing** — hitting the ground too hard, too banked or nose-down writes the
  aircraft off, as does clipping a building or terrain with any part of the
  airframe (nose, tail and both wingtips are all tested). Sitting in your own
  bomb blast counts too. The camera pulls back and orbits the burning wreck.
- **Audio** — engine drone, wind, and explosions are synthesised with WebAudio;
  there are no sound files.

## Layout

```
index.html         markup, HUD and import map
src/main.js        flight model, bombs, collisions, landing, camera, game loop
src/maps.js        map definitions (pure data) + picker thumbnails
src/world.js       builds and tears down a world from a map definition
src/mapselect.js   the map picker overlay
src/plane.js       the aircraft model
src/effects.js     pooled fireballs, debris, smoke
src/audio.js       synthesised engine and explosions
src/hud.js         HUD updates
```

Adding a map means adding one entry to `MAPS` in `src/maps.js`; `world.js` reads
it and the picker thumbnail draws itself from the same config, so a preview can't
drift from the real layout. Runways are always axis-aligned (along X or Z), which
is what keeps every collision box axis-aligned.

## About the aircraft model

The plane is built procedurally in `src/plane.js` — a lathed tapered fuselage,
extruded trapezoidal wings and tail surfaces with dihedral, a three-blade
propeller with an RPM-faded blur disc, canopy, cowl, roundels, bomb racks and
landing gear.

**This was originally meant to be modelled in Blender via the Blender MCP
server, but no such server was connected to the session**, so it is code-built
instead. Everything is behind one factory function, so swapping in a Blender
export is a contained change — replace the body of `createPlane()` with a
`GLTFLoader` call and return the same object:

```js
{
  group,        // THREE.Object3D, nose along -Z, wings along X, ~9 units long
  propeller,    // child that spins about its local Z
  propDisc,     // translucent disc whose opacity tracks RPM
  hardpoints,   // local-space Vector3s that bombs are released from
  eye           // local-space cockpit camera position
}
```

Nothing else in the sim reaches into the model. If the export uses a different
axis convention, bake the correction into the geometry (or into `group`'s
rotation) rather than changing the flight code, which assumes -Z is forward.

## Tuning

The flight model constants are at the top of `src/main.js` — `MAX_SPEED`,
`STALL_SPEED`, `THRUST`, `DRAG`, `GRAVITY`, the three control rates, `CEILING`,
`BOMB_LOAD`, `BLAST_RADIUS`, and the touchdown limits `MAX_SINK`, `MAX_BANK`
and `GLIDESLOPE`.

`window.sim` is exposed in the browser console for tuning — flight state, the
aircraft, the current world and runway, `loadMap()`, and `setRunning(false)` to
freeze the loop.

## Known limits

- Trees, cacti and pines are instanced decoration and have no collision.
- Collapsed buildings flatten into rubble slabs; they stop being collidable
  once down, since the ground check covers them.
- Bomb-vs-building tests use axis-aligned boxes, which is exact here because
  every building is axis-aligned. Terrain hazards use cylinder and cone tests
  instead.
- Water is a flat plane — there are no waves, and the sea is only distinguished
  from land by being fatal to touch.
