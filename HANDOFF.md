# Warbird — project handoff

> Working document for whoever picks this up next (Codex, with Blender MCP available).
> Status below is updated as work lands. Anything marked **TODO** is not started;
> **PARTIAL** means the scaffolding is in but the feature is not finished.

## What this is

A browser flight simulator in three.js. No build step: `index.html` uses an
import map pointing at the three.js CDN, and every module under `src/` is a
plain ES module. Open a static server on the repo root and it runs.

- **Repo**: https://github.com/en-code23/warbird
- **Live site**: https://en-code23.github.io/warbird/
- **Local**: `python3 -m http.server 8123` then open http://localhost:8123/

## The original brief

The user asked for, in one go:

1. Public repo + GitHub Pages site + rename root folder — **DONE**
2. Multiplayer: lobbies, private lobbies with passwords — see *Multiplayer* below
3. Shooting: left click fires, right click toggles scope/zoom; players can also ram each other
4. Game modes: **Creative** (infinite chunk-loaded world), **Singleplayer** (destroy as much as possible in a chosen time), **Multiplayer** (lobbies)
5. More maps
6. Points for kills and for destruction, in both SP and MP
7. Control remap: `Q`→`A` and `E`→`D`, and vice versa — **DONE**
8. Better cockpit view (the old one was bad)
9. "Make everything realistic", using Blender if needed
10. Good README + commented code
11. Different plane types, gun types, bomb types
12. Coins + a shop to buy planes/guns/bombs
13. Good descriptions with real stats (max speed etc.) for every item
14. More realistic destruction
15. Bigger cities
16. Pedestrians walking around

## Status

| # | Feature | Status |
|---|---------|--------|
| 1 | Repo, Pages, folder rename | DONE |
| 7 | Control remap (A/D rudder, Q/E roll) | DONE |
| 11 | Plane / gun / bomb catalogue with real stats | see table below |
| 12 | Coins + shop | see below |
| 3 | Guns, tracers, scope toggle | see below |
| 4 | Game modes | see below |
| 6 | Scoring | see below |
| 15 | Bigger cities | see below |
| 16 | Pedestrians | see below |
| 14 | Realistic destruction | see below |
| 8 | Cockpit view | see below |
| 5 | More maps | see below |
| 2 | Multiplayer | see below |
| 9 | Blender models | **TODO — needs Blender MCP, which this session did not have** |

## Blender work (the main thing this session could not do)

**No Blender MCP server was connected to this session**, so every model in the
repo is procedural three.js geometry. This is the single highest-value thing for
the next agent to pick up, since it has Blender MCP.

All aircraft are built behind one factory in `src/plane.js`. Swapping in a
Blender export is contained — `createPlane(spec)` must return:

```js
{
  group,      // THREE.Object3D — nose along -Z, wings along X, ~9 units long
  propeller,  // child that spins about its local Z
  propDisc,   // translucent disc whose opacity tracks RPM
  hardpoints, // local-space Vector3[] that bombs drop from
  muzzles,    // local-space Vector3[] that gun tracers spawn from
  eye         // local-space cockpit camera position
}
```

Nothing else in the sim reaches into the model. If an export uses a different
axis convention, bake the correction into the geometry rather than changing the
flight code, which assumes **-Z is forward**.

Priority order for Blender:
1. The aircraft (one mesh per entry in `PLANES`, see `src/catalog.js`)
2. A cockpit interior (instrument panel, gunsight, canopy frame) — the current
   cockpit view is a camera position with a procedural panel, not a real interior
3. Pedestrians (currently low-poly capsule figures)
4. Buildings (currently textured boxes; a few modular facade pieces would carry
   the "bigger, more realistic cities" goal a long way)

Keep every export under a few thousand triangles — cities render hundreds of
objects and the sim targets 60fps on integrated graphics.

## Architecture

```
index.html          markup, HUD, import map
src/
  main.js           entry: scene, loop, mode routing, camera
  catalog.js        data: planes, guns, bombs — stats and shop prices
  economy.js        coins, ownership, localStorage persistence
  maps.js           map definitions (pure data) + picker thumbnails
  world.js          builds/tears down a world from a map definition
  chunks.js         infinite procedural world for Creative mode
  plane.js          aircraft model factory
  weapons.js        guns, tracers, bombs, ballistics
  pedestrians.js    crowd simulation
  effects.js        pooled fireballs, debris, smoke
  audio.js          synthesised engine, guns, explosions
  hud.js            HUD updates
  mapselect.js      map picker
  shop.js           shop UI
  net/client.js     multiplayer client
server/
  index.js          Node WebSocket lobby + relay server
```

Design rules worth keeping:
- **Data over code.** Planes, guns, bombs and maps are plain objects. Adding
  content should never mean touching the flight model.
- **Pool everything.** `effects.js` allocates all particles up front; nothing
  enters or leaves the scene graph mid-flight. Tracers and bombs are pooled too.
- **Axis-aligned collision.** Runways are always along X or Z so every building
  AABB stays axis-aligned. Terrain hazards use cylinder/cone tests instead.

## Multiplayer

**GitHub Pages is static hosting and cannot run a WebSocket server.** The lobby
server in `server/` is a plain Node app; the client takes its URL from a
`?server=` query parameter or the in-game field, defaulting to
`ws://localhost:8080`.

To make multiplayer work from the public site, deploy `server/` to any free Node
host (Render, Fly.io, Railway) and point the client at the `wss://` URL. Until
then multiplayer works locally with `npm run server`.

Protocol is documented in `server/README.md`.

## Debugging

`window.sim` is exposed in the browser console:

```js
sim.state              // live flight state
sim.world              // current world (buildings, hazards, runway)
sim.setRunning(false)  // freeze the loop — useful before screenshotting
sim.loadMap(map)       // swap maps
sim.economy.addCoins(9999)
```

Automated checking pattern used throughout this project: drive the page with
Playwright, run N frames via `requestAnimationFrame`, freeze with
`sim.setRunning(false)`, then screenshot. WebGL canvases screenshot correctly
through the compositor even though `preserveDrawingBuffer` is off, **provided
the loop is frozen** so the last rendered frame is still on screen.

## Known limits / gotchas

- Vegetation and pedestrians are decoration and have no collision with the aircraft.
- Collapsed buildings stop being collidable; the ground check covers them.
- Water is a flat plane, fatal to touch, no waves.
- The flight model is arcade, not a study sim. Constants are at the top of
  `src/main.js`.
- `1 world unit ≈ 1 metre` is assumed by the HUD conversions (ft, fpm, kt).
