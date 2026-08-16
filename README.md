# Warbird

A browser flight simulator built on [three.js](https://threejs.org/). Fly a
piston fighter — or a four-engine bomber, or a jet — over destructible cities.
Bomb them, strafe them, dodge the flak, land back on the strip, spend the coins
on better aircraft, and shoot other people down.

Plays on a phone: landscape, with a throttle quadrant under your left thumb and
the stick under your right.

**Play it: <https://en-code23.github.io/warbird/>**

No build step and no install. `index.html` pulls three.js from a CDN via an
import map; everything under `src/` is a plain ES module.

---

## Running locally

ES modules can't load over `file://`, so it needs a static server:

```bash
git clone https://github.com/en-code23/warbird.git
cd warbird
python3 -m http.server 8123
# open http://localhost:8123/
```

For multiplayer you also need the lobby server:

```bash
npm install
npm run server       # ws://localhost:8080
```

---

## Controls

### Touch

| Input | Action |
| --- | --- |
| **Right side of the screen** | The stick. Touch anywhere and drag — that point becomes centre |
| **Left lever** | Throttle. Slide it up for power; it stays where you leave it |
| **GUNS** | Hold to fire |
| **BOMB** | Release one bomb |
| **&#9664; &#9654;** | Rudder |
| **SCOPE / VIEW / BRAKE / MENU** | Panel switches, top right |

The stick has no fixed base on purpose: a virtual joystick pinned to one corner
makes you look at your thumb to find it, and the thing you need to be looking at
is the horizon. Deflection is squared, so small movements near centre are gentle
— which is what makes a landing flyable with a thumb at all.

### Keyboard

| Input | Action |
| --- | --- |
| `W` / `S` | Pitch down / up |
| `Q` / `E` | Roll left / right |
| `A` / `D` | Rudder left / right |
| `↑` / `↓` | Throttle |
| `B` | Wheel brakes |
| **Left click** | Fire guns |
| **Right click** | Toggle gunsight scope |
| `Space` | Release a bomb |
| `C` | Chase / cockpit view |
| `M` or `Esc` | Menu (press again to resume) |
| `R` | Respawn |

**Bank to turn.** The nose follows the roll — the rudder is only for trimming and
for steering on the ground. Below your aircraft's stall speed the wing stops
supporting you and you sink, whatever the nose is doing.

---

## Game modes

### Strike — singleplayer

A timed sortie against one **defended** city: 2, 5 or 10 minutes. Destroy as much
as you can before the clock stops.

| Target | Points |
| --- | --- |
| Building | 10 |
| Flak battery | 60 |
| Vehicle | 6 |
| Casualty | 2 |
| Completed landing | 25 |

The flak is the point. Batteries track you, lead the shot and burst shells around
you, and they are the only thing on the map that can kill you — so the sortie is
a real decision rather than target practice. They cannot depress below the
rooftops, so you can fly under them; they lead badly against a fast target, so
you can outrun them; or you can suppress them first, which pays six buildings a
gun. 60% of the score is paid out as coins, plus 120 for bringing the aircraft
home.

### Free Flight — creative

An endless procedurally generated world with no timer, no boundary and unlimited
ordnance. Terrain streams in around you as you fly: space is divided into
420-unit chunks and the 49 nearest are kept built, while the rest are torn down.
Every chunk's contents come from a hash of its coordinates, so the same patch of
world is identical every time you fly back over it — nothing is stored, and there
is no edge to reach.

### Dogfight — multiplayer

Public and private lobbies over a WebSocket server. Shoot other pilots down or
ram them, and bomb the city for points on the side. Kills are worth 100.

---

## Landing

Landing is scored, not merely survived.

Fly the approach on the **PAPI** — four lights beside the touchdown zone, set to
a 4° glideslope. Two white and two red means you're on it; all white is high, all
red is low. The `APPROACH` panel shows range to the aim point, your actual
glideslope angle and a deviation marker.

Touch down inside the structural limits — under 14 units/sec of sink, wings
within 20° of level, nose neither dug in nor pitched up — or you write the
aircraft off. Inside them, the arrival is graded on sink rate:

| Grade | Sink | Bonus |
| --- | --- | --- |
| `GREASED` | under ~240 fpm | +5 |
| `GOOD` | under ~550 fpm | +3 |
| `FIRM` | under ~1080 fpm | +2 |
| `HARD` | anything still survivable | +1 |
| `OFF HEADING` | on the strip but crooked | +1 |
| `OFF FIELD` | survivable, but off the runway | +0 |

The landing only counts once you **brake to a stop** — that's when the bonus
pays, the bomb bay is rearmed and the airframe is patched up, so you can fly
repeat sorties without respawning. Ditching in water is never survivable.

---

## Aircraft

Six airframes, all flown by the same physics with different numbers. Full stats
are on the shop cards; the short version:

| Aircraft | Role | Top speed | Stall | Armour | Bombs | Guns | Price |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Sparrow T.1** | Trainer | 152 kt | 39 kt | 55 | 8 | 1 | free |
| **Falcon Mk.V** | Fighter | 193 kt | 48 kt | 100 | 24 | 4 | 1,200 |
| **Comet R.2** | Interceptor | 246 kt | 64 kt | 78 | 12 | 4 | 2,600 |
| **Hammer A.3** | Ground attack | 175 kt | 53 kt | 210 | 40 | 6 | 3,400 |
| **Fortress B.9** | Heavy bomber | 168 kt | 60 kt | 320 | 80 | 4 | 6,000 |
| **Vector J.1** | Jet | 308 kt | 78 kt | 130 | 20 | 4 | 12,000 |

Speed and stall are the figures the HUD shows. Faster airframes stall higher and
land harder; the bomber turns like a container ship but absorbs punishment that
folds a fighter.

## Guns

| Gun | Damage | Rate | Ammo/mount | Price |
| --- | --- | --- | --- | --- |
| **7.9mm MG** | 4 | 1,150 rpm | 900 | free |
| **12.7mm HMG** | 9 | 780 rpm | 600 | 700 |
| **20mm Cannon** | 22 | 600 rpm | 280 | 1,800 |
| **30mm Cannon** | 52 | 380 rpm | 140 | 3,800 |
| **Rotary Gatling** | 11 | 3,600 rpm | 1,800 | 6,500 |

Total output scales with the airframe's gun mounts, so the same gun behaves very
differently on a one-mount trainer and a six-mount attacker. Buildings have hit
points based on their size — rifle calibre barely scratches a tower, while the
30mm opens one up in a couple of seconds.

## Bombs

| Bomb | Blast | Damage | Carried | Price |
| --- | --- | --- | --- | --- |
| **50kg Light** | 20 m | 40 | ×1.6 | free |
| **250kg GP** | 30 m | 70 | ×1.0 | 500 |
| **500kg Heavy** | 48 m | 130 | ×0.55 | 1,600 |
| **Cluster** | 18 m ×12 | 35 | ×0.7 | 2,900 |
| **Incendiary** | 26 m | 55 | ×0.9 | 4,200 |

Cluster munitions open at 70 m and scatter twelve bomblets. Incendiaries keep
spreading to neighbouring buildings for six waves after the hit, so one
well-placed stick can take a whole block over the following minute. Heavy bombs
dropped below about 60 m will catch your own aircraft in the blast.

---

## Coins and the shop

Coins come from sorties — half the score, plus landing bonuses. Everything in the
Hangar is bought once and kept forever, and the equipped loadout is used on every
sortie. Progress saves to `localStorage`; unknown ids are dropped on load, so
adding or renaming catalogue entries can never brick an existing save.

---

## Multiplayer

**GitHub Pages is static hosting and cannot run a WebSocket server**, so the
public site has nothing to talk to out of the box. The lobby server in `server/`
is a plain Node app:

```bash
npm install && npm run server
```

Then open the Multiplayer screen, put `ws://localhost:8080` in the **Server**
field and connect. You can preselect a server with `?server=wss://your-host`. To
make it work from the public site, deploy `server/` to any free Node host
(Render, Fly.io, Railway) and use the resulting `wss://` URL.

Lobbies are public or private; private ones require a password, and the host
launches the match. See [`server/README.md`](server/README.md) for the wire
protocol.

**Trust model:** the server is a relay. It owns lobby membership and match
lifecycle but does not simulate flight, and damage is reported by the shooting
client. Fine among people who know each other; wide open to a modified client
otherwise.

A full two-client match has now been run end to end: connect, list, create a
private lobby, reject a wrong password, join with the right one, host launch,
live state sync, and a kill reaching both clients' scoreboards.

---

## Maps

| Map | Difficulty | What makes it interesting |
| --- | --- | --- |
| **Midtown** | Easy | Dense grid on farmland, long runway, clear approach. |
| **Bayside** | Moderate | Harbour city; the field is a raised causeway out in the bay, running crosswise. An overrun puts you in the water. |
| **Dust Basin** | Hard | Adobe town ringed by buttes. Rock is indestructible — bombing it does nothing, and flying into it ends the sortie. |
| **Kranzberg** | Hard | Valley town at dusk under snow-capped peaks. Short strip, high ground either side. |
| **Steelworks** | Moderate | Sprawling industrial city under overcast, almost no landmarks. |
| **Nightfall** | Hard | A city at two in the morning. Every window is lit and nothing else is. |

Terrain hazards are always kept clear of the runway, its approach corridor and
the climb-out, so every field stays usable however the scenery rolls.

---

## Performance, and why there is no Rust in here

Mobile was the goal, so the sim was profiled before anything was rewritten. The
result decided the whole approach:

| | Before | After |
| --- | --- | --- |
| Draw calls / frame | **669** | **148** |
| JS simulation / frame | 0.05 ms | 0.05 ms |

The entire simulation — collision, the crowd, every ray test — costs **0.05 ms of
a 16.7 ms frame**. It was never the bottleneck. The cost was 669 draw calls of
driver overhead and fragment work at `devicePixelRatio` 2, and **neither of those
is reachable from Rust or WebAssembly**: draw-call submission belongs to the
browser and the GPU driver, and fill rate belongs to the GPU. A WASM rewrite
could have won back a fraction of a millisecond and would have cost the
zero-build-step deploy. So the fixes are where the time actually goes:

- **Buildings are instanced.** Every building used to be a mesh plus a roof mesh;
  a city was ~500 draw calls, doubled by the shadow pass. They now share two
  `InstancedMesh`es, so a city is 2 draw calls at any size — see
  [`src/buildings.js`](src/buildings.js). The per-face UV tiling that made this
  awkward moved into the vertex shader and reads a per-instance size attribute.
- **Resolution is the first thing given up.** Fragment cost is quadratic in pixel
  ratio, so a phone at DPR 1 instead of 2 does a quarter of the shading work.
- **The frame rate is capped at 60.** A 120 Hz phone will happily render 120 fps
  and cook itself doing it, for no visible gain.
- **Shadows are off on the low tier**, because they mean drawing the whole city a
  second time into a depth map.
- Chunk teardown in Free Flight was `indexOf` + `splice` per building — O(n²) and
  a visible hitch every time a chunk dropped. It is a single mark-and-sweep now.

### Quality tiers

Set under **Controls**. `Auto` is the default and the honest recommendation: a
governor watches real frame time and walks the render scale down before it drops
a tier, because that is the cheapest thing to lose and the least noticeable in
motion. It only ever steps down, with hysteresis so it settles instead of
oscillating.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Max pixel ratio | 1.0 | 1.35 | 2.0 |
| Shadows | off | 1024 | 2048 soft |
| Antialiasing | off | off | on |
| Pedestrians | 70 | 150 | 260 |
| Vehicles | 26 | 60 | 110 |
| Free Flight chunks | 25 | 25 | 49 |

Phones start on Low. There is no user-agent sniffing — the check is
`(pointer: coarse)` and `(hover: none)`, which is what actually matters and stays
true for devices that do not exist yet.

---

## How it is put together

```
index.html          markup, HUD, import map
src/
  main.js           flight model, combat, scoring, camera, game loop
  catalog.js        data: aircraft, guns, bombs — stats, prices, descriptions
  economy.js        coins, ownership, loadout, localStorage save
  modes.js          game mode rules
  maps.js           map definitions (pure data) + picker thumbnails
  world.js          builds and tears down a world from a map definition
  chunks.js         endless streamed world for Free Flight
  buildings.js      instanced building batch — a whole city in 2 draw calls
  flak.js           anti-aircraft batteries: tracking, lead, bursts
  vehicles.js       instanced street traffic
  quality.js        quality tiers and the adaptive frame-time governor
  touch.js          touch controls: throttle quadrant, stick, triggers
  plane.js          aircraft model factory, parameterised per airframe
  cockpit.js        cockpit interior with live canvas instruments
  weapons.js        guns, tracers, bomb ballistics, cluster and incendiary logic
  pedestrians.js    instanced street crowd
  effects.js        pooled fireballs, debris, smoke
  audio.js          synthesised engine, guns, explosions — no audio files
  hud.js            HUD updates
  ui.js             menu, map picker, shop, lobby, results screens
  net.js            multiplayer client
server/
  index.js          Node WebSocket lobby + relay server
```

Design rules worth keeping if you extend it:

- **Data over code.** Aircraft, guns, bombs and maps are plain objects. Adding
  content means adding a table entry, never touching the flight model.
- **Pool everything.** Particles, tracers and bombs are allocated up front;
  nothing enters or leaves the scene graph mid-flight, so a heavy bombing run
  never triggers a shader recompile or a GC spike.
- **Axis-aligned collision.** Runways always run along X or Z, which keeps every
  building box axis-aligned. Terrain hazards use cylinder and cone tests.
- **Diff before touching the DOM.** The HUD writes a value only when it changes.

### Debugging

`window.sim` is exposed in the browser console:

```js
sim.state                 // live flight state
sim.world                 // current world: buildings, hazards, runway
sim.session               // mode, score, clock
sim.setRunning(false)     // freeze the loop
sim.economy.addCoins(9999)
```

---

## Known limits

- Vegetation, pedestrians and traffic have no collision with the aircraft.
- Collapsed buildings stop being collidable; the ground check covers them.
- Water is a flat plane, fatal to touch, with no waves.
- Flak is the only thing that shoots back — there are still no AI aircraft.
- The flight model is arcade, not a study sim. Shared constants are at the top of
  `src/main.js`; per-aircraft ones are in `src/catalog.js`.
- **Every model is procedural three.js geometry.** See [`HANDOFF.md`](HANDOFF.md)
  — the aircraft were meant to be modelled in Blender, and the swap point is a
  single function.

## Licence

MIT.
