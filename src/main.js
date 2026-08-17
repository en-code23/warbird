import * as THREE from 'three';
import { buildPlane, preloadPlane, disposePlane } from './planeModel.js';
import { createWorld, disposeWorld } from './world.js';
import { ChunkWorld, FREEFLIGHT_ENV } from './chunks.js';
import { Pedestrians } from './pedestrians.js';
import { Cockpit } from './cockpit.js';
import { Weapons } from './weapons.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { UI } from './ui.js';
import { Net } from './net.js';
import { Economy } from './economy.js';
import { formatClock } from './modes.js';
import { planeById } from './catalog.js';
import { TIERS, Governor, detectTier, guessTier, storeTier, isTouchDevice } from './quality.js';
import {
  TouchControls, setupOrientation, goFullscreen,
  toggleFullscreen, fullscreenSupported, isFullscreen, onFullscreenChange
} from './touch.js';

/* ==========================================================================
   Constants
   ==========================================================================
   Per-aircraft figures (speed, thrust, control rates, armour) come from the
   catalogue. These are the ones that apply to every airframe equally.
*/

const GRAVITY = 32;
const BOMB_GRAVITY = 30;
const ARENA = 3200;

/** Touchdown limits. Outside these the aircraft is written off. */
const MAX_SINK = 14;
const MAX_BANK = 0.35;
const GLIDESLOPE = 4.0;

const SCOPE_FOV = 22;
const BASE_FOV = 62;

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = 180 / Math.PI;

/* ==========================================================================
   Renderer / scene
   ========================================================================== */

/* ---------- quality ---------- */

const touchDevice = isTouchDevice();

/** `auto` means "let the governor decide"; anything else is the player's call. */
let tierPref = detectTier();
let tierName = tierPref === 'auto' ? guessTier() : tierPref;
let quality = { ...TIERS[tierName] };

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: quality.antialias,
  powerPreference: 'high-performance',
  // The default depth+stencil buffer costs bandwidth on tiled mobile GPUs and
  // nothing here uses the stencil.
  stencil: false,
  // Never allocate a preserved buffer: it forces the driver to keep a full
  // extra copy of every frame.
  preserveDrawingBuffer: false
});

/**
 * Render scale is the governor's main lever. It multiplies the tier's pixel
 * ratio cap, so a phone can drop to 0.6x resolution before anything visible
 * gets turned off — resolution is the cheapest thing to give up in motion and
 * the most expensive thing to keep, because fragment cost is quadratic in it.
 */
let renderScale = 1;

function applyResolution() {
  const ratio = Math.min(devicePixelRatio, quality.maxPixelRatio) * renderScale;
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbcd4e2, 0.00052);
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.4, 9000);

/* ---------- sky ---------- */

const skyUniforms = {
  top: { value: new THREE.Color(0x2f6fb0) },
  horizon: { value: new THREE.Color(0xbcd4e2) },
  sun: { value: new THREE.Vector3(0.42, 0.62, -0.66).normalize() }
};

const SKY_RADIUS = 4500;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(SKY_RADIUS, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.15 + 0.06, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.72));
        float d = max(dot(normalize(vDir), sun), 0.0);
        col += vec3(1.0, 0.86, 0.62) * pow(d, 26.0) * 0.9;
        col += vec3(1.0, 0.88, 0.72) * pow(d, 3.5) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
sky.frustumCulled = false;
scene.add(sky);

/* ---------- lights ---------- */

const SUN_DIR = new THREE.Vector3(0.42, 0.62, -0.66).normalize();
const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 1000;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xbdd7ef, 0x4a5a3a, 1.15);
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(hemi, ambient);

/**
 * Pushes the current tier into the renderer, lights and camera.
 *
 * Shadows are the expensive one: with them on, every building is drawn a second
 * time into the depth map. Turning them off roughly halves the draw calls,
 * which is why the low tier does exactly that rather than just shrinking the
 * map. Called on boot, on a tier change, and after each world build.
 */
function applyQuality() {
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = quality.shadowMapSize >= 2048
    ? THREE.PCFSoftShadowMap
    : THREE.PCFShadowMap;
  renderer.toneMapping = quality.toneMapping
    ? THREE.ACESFilmicToneMapping
    : THREE.NoToneMapping;

  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const d = quality.shadowDistance;
    const c = sun.shadow.camera;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d;
    c.updateProjectionMatrix();
    // a resized map has to be thrown away or three keeps rendering the old one
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }

  camera.far = quality.drawDistance;
  camera.updateProjectionMatrix();

  // The sky is real geometry, so a shortened far plane clips straight through
  // it and leaves a black void across most of the view. Keep the dome just
  // inside the far plane whatever the draw distance is.
  sky.scale.setScalar((quality.drawDistance * 0.86) / SKY_RADIUS);
  effects?.setBudget(quality.particleScale);
  applyResolution();
}

/* ==========================================================================
   Services
   ========================================================================== */

const effects = new Effects(scene);
const audio = new Audio();

// Browsers refuse to start an AudioContext outside a user gesture, so the menu
// theme waits for the first click or key anywhere on the page. Once is enough.
addEventListener('pointerdown', firstGesture, { once: true });
addEventListener('keydown', firstGesture, { once: true });

function firstGesture() {
  audio.start();
  audio.resume();
  if (!session.running) audio.playMusic();
}
const hud = new Hud();
const economy = new Economy();
const net = new Net();
const weapons = new Weapons(scene, effects, audio);

/* ---------- bomb sight ---------- */

const sight = new THREE.Mesh(
  new THREE.RingGeometry(4.2, 5.4, 32),
  new THREE.MeshBasicMaterial({
    color: 0xcde06a, transparent: true, opacity: 0.8,
    depthWrite: false, depthTest: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  })
);
sight.rotation.x = -Math.PI / 2;
sight.renderOrder = 5;
scene.add(sight);

/* ==========================================================================
   Session + flight state
   ========================================================================== */

const state = {
  speed: 0,
  throttle: 0.7,
  velocity: new THREE.Vector3(),
  hp: 100,
  maxHp: 100,
  alive: true,
  grounded: true,
  cockpit: false,
  scoped: false,
  braking: false,
  shake: 0,
  wreck: null,
  outOfArea: 0,
  touchdown: null,
  lastHitBy: null,
  pitchIn: 0,
  rollIn: 0
};

const session = {
  mode: null,
  map: null,
  room: null,
  duration: 0,
  timeLeft: 0,
  score: 0,
  buildings: 0,
  peds: 0,
  kills: 0,
  deaths: 0,
  landings: 0,
  flak: 0,
  flakWarned: false,
  running: false
};

let world = null;
let runway = null;
let pedestrians = null;
let plane = null;
let cockpit = null;
let planeSpec = planeById(economy.data.loadout.plane);

// Start fetching the equipped airframe while the player is still in the menu,
// so the first launch is as quick as every one after it.
preloadPlane(planeSpec.id);

/* ==========================================================================
   Aircraft construction
   ========================================================================== */

/** Rebuilds the player's aircraft from the equipped loadout. */
function buildAircraft() {
  if (plane) {
    cockpit?.dispose();
    disposePlane(plane);
  }

  planeSpec = economy.loadout.plane;
  plane = buildPlane(planeSpec, { guns: planeSpec.guns });
  scene.add(plane.group);
  cockpit = new Cockpit(plane.group, plane.dimensions, plane.eye);
  cockpit.visible = state.cockpit;

  state.maxHp = planeSpec.armour;
  state.hp = planeSpec.armour;

  weapons.setLoadout(economy.loadout);
}

/* ==========================================================================
   Environment
   ========================================================================== */

function applyEnv(env) {
  skyUniforms.top.value.setHex(env.skyTop);
  skyUniforms.horizon.value.setHex(env.skyHorizon);
  SUN_DIR.fromArray(env.sunDir).normalize();
  skyUniforms.sun.value.copy(SUN_DIR);

  scene.fog.color.setHex(env.skyHorizon);
  // Thicker fog on low tiers hides the shortened draw distance instead of
  // popping geometry in at the far plane.
  scene.fog.density = env.fogDensity * quality.fogScale;

  sun.color.setHex(env.sunColor);
  sun.intensity = env.sunIntensity;
  hemi.color.setHex(env.hemiSky);
  hemi.groundColor.setHex(env.hemiGround);
  hemi.intensity = env.hemiIntensity;
  ambient.intensity = env.ambient;
  renderer.toneMappingExposure = env.exposure;
}

function teardownWorld() {
  pedestrians?.dispose();
  pedestrians = null;
  if (world?.dispose) world.dispose();
  else if (world) disposeWorld(world);
  world = null;
  burning.length = 0;
  fires.length = 0;
  collapsing.length = 0;
  rubble.length = 0;
  weapons.reset();
  effects.reset();
  clearRemotes();
}

/* ==========================================================================
   Launching a sortie
   ========================================================================== */

async function launch({ mode, map, duration, room }) {
  // Wait for the airframe before building the world. It is a ~140 KB fetch that
  // is already cached after the first sortie, and taking it here means you
  // never launch into the fallback model just because the menu was quick.
  await preloadPlane(economy.loadout.plane.id);

  teardownWorld();
  buildAircraft();

  session.mode = mode;
  session.map = map;
  session.duration = duration ?? 0;
  session.timeLeft = duration ?? 0;
  session.score = 0;
  session.buildings = 0;
  session.peds = 0;
  session.kills = 0;
  session.deaths = 0;
  session.landings = 0;
  session.flak = 0;
  session.flakWarned = false;
  session.running = true;
  session.room = room ?? null;

  // The world builders read every population figure off the tier, so a phone
  // gets a genuinely lighter city rather than the same city rendered worse.
  const build = { ...quality, effects };

  if (mode.infinite) {
    world = new ChunkWorld(scene, build);
    world.update(new THREE.Vector3());
    applyEnv(FREEFLIGHT_ENV);
  } else {
    world = createWorld(map, build);
    scene.add(world.group);
    applyEnv(map.env);
  }
  runway = world.runway;

  // crowds only exist where there are streets to walk
  if (world.streets) {
    pedestrians = new Pedestrians(scene, {
      count: mode.infinite ? Math.round(quality.pedestrians * 0.5) : quality.pedestrians,
      grid: world.streets.grid,
      cell: world.streets.cell,
      half: world.streets.half,
      road: world.streets.road,
      shadows: quality.shadows,
      effects
    });
  }

  governor.reset();
  governor.setTier(tierName);

  resetPlane();
  hud.show();
  hud.setMode(mode);
  running = true;
  last = performance.now();
  nextFrameDue = 0;
  audio.start();
  audio.resume();
  audio.stopMusic(1.2);
  // Launching is a user gesture, which is the only moment the browser will
  // grant fullscreen and an orientation lock.
  goFullscreen();

  hud.banner(
    `${(map?.name ?? 'Free Flight').toUpperCase()}<small>${planeSpec.name} · ${economy.loadout.gun.name} · ${economy.loadout.bomb.name}</small>`,
    'good',
    3
  );
}

function resetPlane() {
  const g = plane.group;
  g.position.copy(runway.start);
  g.position.y = runway.deck + plane.gearHeight;
  g.quaternion.setFromAxisAngle(UP, Math.atan2(-runway.forward.x, -runway.forward.z));
  g.visible = true;

  state.speed = 0;
  state.throttle = 0.7;
  touch.setThrottle(0.7);
  state.velocity.set(0, 0, 0);
  state.hp = state.maxHp;
  state.alive = true;
  state.grounded = true;
  state.shake = 0;
  state.wreck = null;
  state.outOfArea = 0;
  state.touchdown = null;
  state.lastHitBy = null;

  weapons.rearm();
  weapons.reset();
  hud.clearBanner();
  hideDownCard();
}

/* ==========================================================================
   Input
   ========================================================================== */

const keys = Object.create(null);
const HELD = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyB',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
]);

addEventListener('keydown', (e) => {
  if (HELD.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;

  if (ui.visible) {
    if ((e.code === 'KeyM' || e.code === 'Escape') && world) resumeFromMenu();
    return;
  }
  if (e.code === 'KeyC') setCockpit(!state.cockpit);
  if (e.code === 'KeyR') respawn();
  if (e.code === 'Space') dropBomb();
  if (e.code === 'KeyM' || e.code === 'Escape') openMenu();
});

addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  weapons.trigger = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (ui.visible) return;
  if (e.button === 0) weapons.trigger = true;
  if (e.button === 2) setScoped(!state.scoped);
});

addEventListener('mouseup', (e) => {
  if (e.button === 0) weapons.trigger = false;
});

const axis = (neg, pos) => (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0);

/* ---------- touch ---------- */

/**
 * Touch and keyboard feed the same axes. The keyboard wins when a key is
 * actually down, so plugging a keyboard into a tablet still works; otherwise
 * the analogue touch value passes through untouched, which is what makes a
 * landing flyable with a thumb.
 */
const touch = new TouchControls({
  onFire: (on) => { weapons.trigger = on; },
  onBomb: () => dropBomb(),
  onView: () => setCockpit(!state.cockpit),
  onScope: (on) => setScoped(on),
  onMenu: () => openMenu(),
  onFullscreen: () => toggleFullscreen()
});

setupOrientation();

/* ---------- settings strip ---------- */

/**
 * Menu toggles. Each one is a lamp that reflects real state rather than a
 * remembered intent, so a fullscreen exit the browser performed on its own
 * still turns the light off.
 */
const optMusic = document.getElementById('opt-music');
const optSound = document.getElementById('opt-sound');
const optFull = document.getElementById('opt-full');

function setLamp(el, on) {
  if (!el) return;
  el.classList.toggle('is-on', on);
  el.setAttribute('aria-pressed', String(on));
}

optMusic?.addEventListener('click', () => {
  const on = !optMusic.classList.contains('is-on');
  setLamp(optMusic, on);
  audio.start();
  audio.setMusicEnabled(on);
});

optSound?.addEventListener('click', () => {
  const on = !optSound.classList.contains('is-on');
  setLamp(optSound, on);
  audio.start();
  audio.setMuted(!on);
});

if (optFull && fullscreenSupported()) {
  optFull.hidden = false;
  optFull.addEventListener('click', () => toggleFullscreen());
}

// The browser can drop out of fullscreen on its own (swipe down, Escape), so
// the lamps follow the real state rather than what we last asked for.
onFullscreenChange((on) => {
  touch.setFullscreen(on);
  setLamp(optFull, on);
});
setLamp(optFull, isFullscreen());

/** Keyboard axis, falling back to the touch axis when no key is held. */
function mix(neg, pos, touchValue) {
  const k = axis(neg, pos);
  return k !== 0 ? k : touchValue;
}

function setScoped(on) {
  state.scoped = on;
  hud.setScoped(on);
  touch.setScoped(on);
}

function setCockpit(on) {
  state.cockpit = on;
  if (cockpit) cockpit.visible = on;
  // From inside, the solid propeller blades sweep across the whole view as
  // black bars. Real cockpit views see a translucent disc, so show only that.
  for (const prop of plane.propellers) prop.visible = !on;
  for (const mesh of plane.hideInCockpit) mesh.visible = !on;
}

/* ==========================================================================
   Scoring
   ========================================================================== */

function award(kind, n = 1) {
  const points = (session.mode.scoring[kind] ?? 0) * n;
  if (points) {
    session.score += points;
    hud.coinPop(`+${points}`);
    if (session.room) net.send({ t: 'score', n: points });
  }
  if (kind === 'building') session.buildings += n;
  if (kind === 'pedestrian') session.peds += n;
  if (kind === 'kill') session.kills += n;
  if (kind === 'flak') session.flak += n;
}

/* ==========================================================================
   Ordnance
   ========================================================================== */

const burning = [];
const fires = [];
/** Buildings currently mid-collapse, so the frame loop never sweeps the city. */
const collapsing = [];
const rubble = [];
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hull = new THREE.Vector3();
const _euler = new THREE.Euler();
const _c = new THREE.Color();

function dropBomb() {
  if (!state.alive) return;
  weapons.dropBomb({
    matrix: plane.group.matrixWorld,
    hardpoints: plane.hardpoints,
    velocity: state.velocity
  });
}

/** A bomb has reached the ground or a structure. */
function detonate(pos, spec) {
  effects.explode(pos, {
    radius: spec.blast * 0.45,
    debris: 20 + Math.round(spec.blast * 0.6),
    smoke: 12 + Math.round(spec.blast * 0.35)
  });
  audio.boom(0.5 + spec.blast / 60);

  const d = plane.group.position.distanceTo(pos);
  state.shake = Math.max(state.shake, clamp(120 / (d + 14), 0, 1.2));

  for (const b of world.buildings) {
    if (!b.alive) continue;
    const dx = Math.max(b.min.x - pos.x, 0, pos.x - b.max.x);
    const dz = Math.max(b.min.z - pos.z, 0, pos.z - b.max.z);
    if (dx * dx + dz * dz > spec.blast * spec.blast) continue;
    if (pos.y > b.max.y + spec.blast * 0.7) continue;
    demolish(b);
  }

  if (pedestrians) {
    const killed = pedestrians.blast(pos, spec.blast * 1.15);
    if (killed) award('pedestrian', killed);
  }

  if (world.vehicles) {
    const wrecked = world.vehicles.blast(pos, spec.blast * 1.1);
    if (wrecked) award('vehicle', wrecked);
  }

  // Flak sites are tougher than a car but softer than a tower: anything inside
  // the blast goes, which makes a heavy bomb a legitimate way to open a
  // corridor through the defences.
  if (world.flak) {
    const silenced = world.flak.blast(pos, spec.blast * 0.9);
    if (silenced) award('flak', silenced);
  }

  // incendiaries keep taking neighbours for a while after the hit
  if (spec.incendiary) {
    fires.push({ pos: pos.clone(), spec, wave: 0, t: 0, radius: spec.blast });
  }

  if (state.alive && d < spec.blast * 0.75) {
    damage(spec.damage * (1 - d / (spec.blast * 0.75)), null, 'CAUGHT IN YOUR OWN BLAST');
  }
}

function updateFires(dt) {
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];
    f.t += dt;
    if (f.t < f.spec.incendiary.interval) continue;
    f.t = 0;
    if (++f.wave > f.spec.incendiary.waves) {
      fires.splice(i, 1);
      continue;
    }
    f.radius += f.spec.incendiary.spread / f.spec.incendiary.waves;

    for (const b of world.buildings) {
      if (!b.alive) continue;
      const dx = b.center.x - f.pos.x;
      const dz = b.center.z - f.pos.z;
      if (dx * dx + dz * dz > f.radius * f.radius) continue;
      if (Math.random() < 0.45) demolish(b);
    }
  }
}

function demolish(b) {
  if (!b.alive) return;
  b.alive = false;
  b.collapse = 0.0001;
  collapsing.push(b);
  award('building');

  const p = b.center;
  effects.explode(_n.set(p.x, b.min.y + Math.min(b.height * 0.6, 30), p.z), {
    radius: 9 + Math.min(b.height, 40) * 0.26,
    debris: 14,
    smoke: 9
  });
  pedestrians?.scare(p, 90);
  if (burning.length < 18) burning.push({ bld: b, t: 0 });
}

/**
 * This used to sweep every building in the world each frame to find the handful
 * that were mid-collapse — 700 iterations to animate two. Buildings now join an
 * active list when they are knocked down and leave it when they settle.
 */
function updateCollapses(dt) {
  for (let i = collapsing.length - 1; i >= 0; i--) {
    const b = collapsing[i];
    b.collapse = Math.min(1, b.collapse + dt * 0.85);
    const k = b.collapse;
    const s = b.setCollapse(k);
    const base = b.min.y;

    if (b.extras) for (const e of b.extras) e.position.y = base + b.height * s + 6;

    if (Math.random() < 14 * dt * effects.budget) {
      effects.puff(
        _v.set(
          b.center.x + (Math.random() - 0.5) * b.size.x * 1.3,
          base + Math.random() * b.height * s,
          b.center.z + (Math.random() - 0.5) * b.size.z * 1.3
        ),
        { r0: 3, r1: 18, life: 2.6, opacity: 0.42 }
      );
    }

    if (k >= 1) {
      _c.copy(b.baseColor).multiplyScalar(0.45);
      b.setTint(_c);
      b.hideRoof();
      if (b.extras) for (const e of b.extras) e.visible = false;
      // leave a heap behind rather than a stain
      effects.dropRubble(b.center, b.size);
      collapsing.splice(i, 1);
    }
  }

  for (let i = burning.length - 1; i >= 0; i--) {
    const f = burning[i];
    f.t += dt;
    if (f.t > 26) {
      burning.splice(i, 1);
      continue;
    }
    effects.burn(
      _v.set(
        f.bld.center.x + (Math.random() - 0.5) * f.bld.size.x * 0.6,
        (f.bld.min?.y ?? 0) + 2 + Math.random() * 4,
        f.bld.center.z + (Math.random() - 0.5) * f.bld.size.z * 0.6
      ),
      dt * 6 * (1 - f.t / 26)
    );
  }
}

/* ==========================================================================
   Damage, crashing, landing
   ========================================================================== */

function damage(amount, fromId, reason) {
  if (!state.alive) return;
  state.hp -= amount;
  if (fromId) state.lastHitBy = fromId;
  state.shake = Math.max(state.shake, Math.min(0.7, amount / 60));
  hud.flashDamage();
  if (state.hp <= 0) crash(reason ?? 'SHOT DOWN');
}

function crash(reason) {
  if (!state.alive) return;
  state.alive = false;
  state.grounded = false;
  state.touchdown = null;
  session.deaths++;

  const p = plane.group.position.clone();
  p.y = Math.max(p.y, 1);
  effects.explode(p, { radius: 15, debris: 48, smoke: 22 });
  audio.boom(1.4);
  state.shake = 1.4;
  state.wreck = p;
  burning.push({
    bld: { center: p, size: new THREE.Vector3(6, 0, 6), height: 4, min: { y: 0 } },
    t: 0
  });

  plane.group.visible = false;
  if (cockpit) cockpit.visible = false;
  weapons.trigger = false;
  touch.release();
  if (session.room) net.reportDeath(state.lastHitBy);

  lastDownReason = reason ?? 'Shot down';
  showDownCard(lastDownReason);
}

/* ---------- shot-down card ---------- */

const downEl = document.getElementById('down');
const downReason = document.getElementById('down-reason');
let lastDownReason = 'Shot down';

function showDownCard(reason) {
  if (!downEl) return;
  if (downReason) downReason.textContent = reason;
  downEl.hidden = false;
  // Focus the action so a keyboard or switch-control user lands on it and can
  // press Enter. Skipped on touch, where there is nothing to focus with and the
  // ring would just be decoration on a button you are about to tap anyway.
  if (!touchDevice) {
    requestAnimationFrame(() => document.getElementById('down-respawn')?.focus());
  }
}

function hideDownCard() {
  if (downEl) downEl.hidden = true;
}

document.getElementById('down-respawn')?.addEventListener('click', () => respawn());

function respawn() {
  // Still allowed while alive — R has always doubled as "put me back on the
  // runway", and the HUD legend promises that.
  if (!world) return;
  hideDownCard();
  resetPlane();
  setCockpit(state.cockpit);
  hud.banner('CLEARED FOR TAKEOFF', 'good', 1.6);
}

function gradeTouchdown(sinkRate, alignment, onStrip) {
  if (!onStrip) return { grade: 'OFF FIELD', bonus: 0, note: 'you are not on the strip' };
  if (alignment < 0.9) return { grade: 'OFF HEADING', bonus: 1, note: 'line up with the runway' };
  // thresholds chosen so the fpm the HUD shows reads like real aviation numbers
  if (sinkRate < 1.2) return { grade: 'GREASED', bonus: 5, note: 'textbook' };
  if (sinkRate < 2.8) return { grade: 'GOOD', bonus: 3, note: '' };
  if (sinkRate < 5.5) return { grade: 'FIRM', bonus: 2, note: '' };
  return { grade: 'HARD', bonus: 1, note: 'easy on the gear' };
}

function completeLanding() {
  const td = state.touchdown;
  td.scored = true;
  session.landings++;
  award('landing');
  economy.record('landings');

  const rearmed = weapons.bombs < weapons.maxBombs || weapons.ammo < weapons.maxAmmo;
  weapons.rearm();
  // patched up while you are on the ground
  state.hp = Math.min(state.maxHp, state.hp + state.maxHp * 0.35);

  hud.banner(
    `LANDED · ${td.grade}<small>+${td.bonus} &nbsp;·&nbsp; ${Math.round(td.sink * 196.85)} fpm${rearmed ? ' &nbsp;·&nbsp; rearmed' : ''}</small>`,
    'good',
    3.2
  );
}

/* ==========================================================================
   Flight
   ========================================================================== */

const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();

function updateFlight(dt) {
  const g = plane.group;
  const q = g.quaternion;
  const P = planeSpec;

  fwd.copy(FWD).applyQuaternion(q);
  up.copy(UP).applyQuaternion(q);
  right.copy(RIGHT).applyQuaternion(q);

  // The touch quadrant sets throttle absolutely; the keyboard nudges it.
  const thrKey = axis('ArrowDown', 'ArrowUp');
  if (thrKey !== 0 || !touch.active) {
    state.throttle = clamp(state.throttle + thrKey * 0.55 * dt, 0, 1);
    if (touch.active) touch.setThrottle(state.throttle);
  } else {
    state.throttle = touch.throttle;
  }
  state.braking = (!!keys.KeyB || touch.braking) && state.grounded;

  // --- longitudinal ---
  const thrust = state.throttle * P.thrust;
  const drag = P.drag * state.speed * state.speed;
  const slope = -GRAVITY * fwd.y * 0.85; // climbing bleeds speed, diving builds it
  state.speed = clamp(state.speed + (thrust - drag + slope) * dt, 0, P.maxSpeed);

  // --- controls: W/S pitch, Q/E roll, A/D rudder, or the touch stick ---
  const auth = clamp(state.speed / P.stall, 0, 1.25);
  const pitch = mix('KeyW', 'KeyS', touch.pitch);
  const roll = mix('KeyE', 'KeyQ', touch.roll);
  const yaw = mix('KeyD', 'KeyA', touch.yaw);
  state.pitchIn = pitch;
  state.rollIn = roll;

  if (state.grounded) {
    g.rotateY(yaw * 0.5 * clamp(state.speed / 30, 0, 1) * dt);
    if (pitch > 0 && state.speed > P.stall * 0.82) g.rotateX(pitch * 0.7 * dt);
    levelOut(g, dt, 3.2);
  } else {
    g.rotateX(pitch * P.pitch * auth * dt);
    g.rotateZ(roll * P.roll * auth * dt);
    g.rotateY(yaw * P.yaw * auth * dt);

    // banked turn: the lift vector's horizontal component swings the nose round
    const bank = Math.asin(clamp(-right.y, -1, 1));
    const turn = -Math.tan(clamp(bank, -1.2, 1.2)) * (GRAVITY / Math.max(state.speed, 34));
    g.rotateOnWorldAxis(UP, turn * dt);
  }

  // --- lift / sink ---
  const liftFactor = Math.min(1, (state.speed / P.stall) ** 2);
  const support = liftFactor * Math.max(0, up.y);
  const sink = clamp(GRAVITY * (1 - support) * 0.8, 0, 34);

  state.velocity.copy(fwd).multiplyScalar(state.speed);
  if (!state.grounded) state.velocity.y -= sink;

  g.position.addScaledVector(state.velocity, dt);

  if (g.position.y > P.ceiling) {
    g.position.y = P.ceiling;
    state.speed *= 1 - 0.6 * dt;
  }

  // --- ground contact ---
  const surface = world.surfaceAt(g.position);
  const deck = surface.y;
  const gear = plane.gearHeight;
  if (g.position.y <= deck + gear) {
    if (surface.water) {
      crash('DITCHED IN THE WATER');
      return;
    }
    const sinkRate = -state.velocity.y;
    const bankAbs = Math.abs(Math.asin(clamp(-right.y, -1, 1)));
    const noseAngle = Math.asin(clamp(fwd.y, -1, 1));
    const survivable =
      sinkRate < MAX_SINK && bankAbs < MAX_BANK && noseAngle > -0.12 && noseAngle < 0.42;

    if (!survivable) {
      g.position.y = deck + gear;
      crash(
        sinkRate >= MAX_SINK ? 'FLEW INTO THE GROUND'
          : bankAbs >= MAX_BANK ? 'DUG A WINGTIP IN'
          : 'BOTCHED THE LANDING'
      );
      return;
    }

    const wasAirborne = !state.grounded;
    g.position.y = deck + gear;
    state.grounded = true;
    state.velocity.y = 0;

    if (wasAirborne) {
      const onStrip = runway.contains(g.position);
      const alignment = Math.abs(fwd.x * runway.forward.x + fwd.z * runway.forward.z);
      const result = gradeTouchdown(sinkRate, alignment, onStrip);
      state.touchdown = { ...result, sink: sinkRate, scored: false };

      effects.puff(g.position, { r0: 1.5, r1: 9, life: 1.1, opacity: 0.4 });
      state.shake = Math.max(state.shake, clamp(sinkRate / 26, 0, 0.5));
      hud.banner(
        `TOUCHDOWN · ${result.grade}<small>${Math.round(sinkRate * 196.85)} fpm — brake to a stop${result.note ? ` · ${result.note}` : ''}</small>`,
        'good',
        2.4
      );
    }

    const brake = state.braking ? 30 : state.throttle < 0.1 ? 12 : 3;
    state.speed = Math.max(0, state.speed - brake * dt);

    if (state.speed < 4) {
      if (state.touchdown && !state.touchdown.scored) {
        completeLanding();
      } else if (
        !state.touchdown && runway.contains(g.position) &&
        (weapons.bombs < weapons.maxBombs || weapons.ammo < weapons.maxAmmo)
      ) {
        weapons.rearm();
        hud.banner('REARMED', 'good', 1.4);
      }
    }
  } else if (state.grounded && g.position.y > deck + gear + 0.05) {
    state.grounded = false;
    state.touchdown = null;
  }

  // --- structures and terrain ---
  g.updateMatrixWorld(true);
  for (const local of plane.hull) {
    _hull.copy(local).applyMatrix4(g.matrixWorld);
    const struck = world.buildingAt(_hull, 1.2);
    if (struck) {
      demolish(struck);
      crash('HIT A BUILDING');
      return;
    }
    if (world.hazardAt(_hull)) {
      crash('FLEW INTO TERRAIN');
      return;
    }
  }

  // --- ramming another aircraft takes you both out ---
  for (const r of remotes.values()) {
    if (!r.alive) continue;
    if (g.position.distanceTo(r.group.position) < 7) {
      net.reportHit(r.id, 9999);
      crash('MID-AIR COLLISION');
      return;
    }
  }

  // --- arena bounds (free flight has none) ---
  if (session.mode.bounded) {
    const outside = Math.abs(g.position.x) > ARENA || Math.abs(g.position.z) > ARENA;
    state.outOfArea = outside ? state.outOfArea + dt : 0;
    if (outside && state.outOfArea > 0.2 && state.outOfArea < 0.4) {
      hud.banner('TURN BACK<small>leaving the operating area</small>', 'bad', 2.2);
    }
    if (state.outOfArea > 12) crash('LOST OVER OPEN COUNTRY');
  }
}

function levelOut(g, dt, rate) {
  _euler.setFromQuaternion(g.quaternion, 'YXZ');
  const k = Math.min(1, rate * dt);
  _euler.x -= _euler.x * k;
  _euler.z -= _euler.z * k;
  g.quaternion.setFromEuler(_euler);
}

/* ==========================================================================
   Approach guidance
   ========================================================================== */

function approachInfo() {
  const p = plane.group.position;
  const td = runway.touchdown;
  const dx = p.x - td.x;
  const dz = p.z - td.z;
  const dist = Math.hypot(dx, dz);
  return {
    distance: dist,
    along: dx * runway.forward.x + dz * runway.forward.z,
    height: p.y - td.y,
    angle: Math.atan2(p.y - td.y, Math.max(dist, 1)) * DEG,
    target: GLIDESLOPE
  };
}

const PAPI_WHITE = new THREE.Color(0xffffff);
const PAPI_RED = new THREE.Color(0xff3b22);

function updatePAPI(info) {
  for (const light of runway.papi) {
    light.material.color.copy(info.angle > light.angle ? PAPI_WHITE : PAPI_RED);
  }
}

function updateSight() {
  const p = plane.group.position;
  if (!state.alive || state.grounded || p.y < 6 || state.scoped) {
    sight.visible = false;
    return;
  }
  const vy = state.velocity.y;
  const t = (vy + Math.sqrt(vy * vy + 2 * BOMB_GRAVITY * p.y)) / BOMB_GRAVITY;
  sight.visible = true;
  sight.position.set(p.x + state.velocity.x * t, 0.9, p.z + state.velocity.z * t);
  sight.scale.setScalar(clamp(p.y / 90, 0.6, 4));
  sight.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(performance.now() * 0.004));
}

/* ==========================================================================
   Remote aircraft (multiplayer)
   ========================================================================== */

const remotes = new Map();

function syncRemotes(dt) {
  if (!session.room) return;

  for (const [id, p] of net.players) {
    let r = remotes.get(id);
    if (!r) {
      const spec = planeById(p.plane ?? 'falcon');
      const model = buildPlane(spec, { guns: spec.guns });
      scene.add(model.group);
      r = {
        id, model, group: model.group, name: p.name, alive: true,
        target: new THREE.Vector3(),
        targetQ: new THREE.Quaternion()
      };
      remotes.set(id, r);
    }
    if (p.p) r.target.set(p.p[0], p.p[1], p.p[2]);
    if (p.q) r.targetQ.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    r.alive = p.alive !== 0;
    r.group.visible = r.alive;

    // interpolate toward the last received state rather than snapping
    r.group.position.lerp(r.target, Math.min(1, 10 * dt));
    r.group.quaternion.slerp(r.targetQ, Math.min(1, 10 * dt));
    for (const prop of r.model.propellers) prop.rotation.z += 40 * dt;
  }

  for (const [id, r] of remotes) {
    if (!net.players.has(id)) {
      disposeRemote(r);
      remotes.delete(id);
    }
  }
}

function disposeRemote(r) {
  disposePlane(r.model);
}

function clearRemotes() {
  for (const r of remotes.values()) disposeRemote(r);
  remotes.clear();
}

/** Aircraft the guns can hit: everyone else in the room. */
function gunTargets() {
  const list = [];
  for (const r of remotes.values()) {
    if (r.alive) list.push({ id: r.id, position: r.group.position, radius: 6, alive: true });
  }
  return list;
}

/* ==========================================================================
   Camera
   ========================================================================== */

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const chaseOffset = new THREE.Vector3(0, 5.2, 20);

function updateCamera(dt) {
  const g = plane.group;

  if (!state.alive) {
    const p = state.wreck ?? g.position;
    const a = performance.now() * 0.00016;
    camTarget.set(p.x + Math.cos(a) * 96, p.y + 42, p.z + Math.sin(a) * 96);
    camera.position.lerp(camTarget, Math.min(1, 2.4 * dt));
    camLook.copy(p);
    camera.up.copy(UP);
    camera.lookAt(camLook);
    applyShake(dt);
    tweenFov(BASE_FOV, dt);
    return;
  }

  if (state.cockpit) {
    camera.position.copy(plane.eye).applyMatrix4(g.matrixWorld);
    camera.quaternion.copy(g.quaternion);
    applyShake(dt);
    tweenFov(state.scoped ? SCOPE_FOV : 70, dt);
    return;
  }

  chaseOffset.set(0, 5.2, state.scoped ? 12 : 20);
  camTarget.copy(chaseOffset).applyMatrix4(g.matrixWorld);
  camTarget.y = Math.max(camTarget.y, world.surfaceAt(camTarget).y + 2.2);
  camera.position.lerp(camTarget, Math.min(1, 5.5 * dt));
  camLook.copy(g.position).addScaledVector(fwd, 26).addScaledVector(up, 1.5);

  camera.up.copy(up).lerp(UP, 0.35);
  camera.lookAt(camLook);
  applyShake(dt);
  tweenFov(state.scoped ? SCOPE_FOV : BASE_FOV + (state.speed / planeSpec.maxSpeed) * 12, dt);
}

function tweenFov(target, dt) {
  camera.fov += (target - camera.fov) * Math.min(1, 7 * dt);
  camera.updateProjectionMatrix();
}

function applyShake(dt) {
  if (state.shake <= 0) return;
  const s = state.shake * 1.4;
  camera.position.x += (Math.random() - 0.5) * s;
  camera.position.y += (Math.random() - 0.5) * s;
  camera.position.z += (Math.random() - 0.5) * s;
  camera.rotateZ((Math.random() - 0.5) * state.shake * 0.02);
  state.shake = Math.max(0, state.shake - dt * 1.6);
}

/* ==========================================================================
   Session end / menu
   ========================================================================== */

function endSortie(reason) {
  if (!session.running) return;
  session.running = false;
  running = false;
  weapons.trigger = false;
  touch.release();
  hideDownCard();
  audio.playMusic();

  // Half the score was too thin against the price list; see catalog.js for the
  // retuned curve. Landings pay a flat completion bonus on top, so flying the
  // aircraft home is worth more than one last pass over the city.
  const coins = Math.round(session.score * 0.6) + (session.landings > 0 ? 120 : 0);
  economy.addCoins(coins);
  economy.record('sorties');
  economy.record('buildings', session.buildings);
  economy.record('kills', session.kills);
  economy.recordBest('bestRun', session.score);

  hud.hide();
  ui.showResults({
    title: reason ?? 'Sortie complete',
    subtitle: `${session.mode.name} · ${session.map?.name ?? 'Free Flight'}`,
    rows: [
      ['Score', session.score.toLocaleString('en-GB')],
      ['Buildings destroyed', String(session.buildings)],
      ['Casualties', String(session.peds)],
      ['Flak batteries silenced', String(session.flak)],
      ...(session.mode.multiplayer
        ? [['Kills', String(session.kills)], ['Deaths', String(session.deaths)]]
        : []),
      ['Landings', String(session.landings)]
    ],
    coins
  });
}

function openMenu() {
  running = false;
  weapons.trigger = false;
  touch.release();
  hud.hide();
  hideDownCard();
  ui.show('menu');
  audio.playMusic();
}

function resumeFromMenu() {
  ui.hide();
  hud.show();
  last = performance.now();
  nextFrameDue = 0;
  running = true;
  governor.reset();
  audio.resume();
  audio.stopMusic(0.8);
  // Coming back to a wreck: the card has to come back with it.
  if (!state.alive) showDownCard(lastDownReason);
}

/* ==========================================================================
   Loop
   ========================================================================== */

let last = performance.now();
let running = false;

/**
 * Frame cap.
 *
 * A 120Hz phone will happily render 120fps and cook itself doing it, for no
 * visible gain in a sim where the camera is smoothed anyway. Capping to 60
 * roughly halves GPU power draw on those devices — the single most effective
 * anti-overheating measure here after resolution.
 */
const FRAME_CAP = 1000 / 60;
let nextFrameDue = 0;

const governor = new Governor({
  targetFps: 60,
  onScale: (s) => {
    renderScale = s;
    applyResolution();
  },
  onTier: (t) => {
    // The governor only ever steps down, and only after resolution has already
    // bottomed out. Tell the player, because the picture visibly changes.
    setTier(t, { auto: true });
    hud.banner(
      `GRAPHICS: ${TIERS[t].name.toUpperCase()}<small>lowered to hold the frame rate</small>`,
      '',
      2.6
    );
  }
});

const _flakTarget = { position: null, velocity: null, alive: true };

function frame(now) {
  requestAnimationFrame(frame);

  if (now < nextFrameDue) return;
  // Schedule from the deadline rather than from now, so an early frame does not
  // pull the whole cadence forward and the cap holds at a steady 60.
  nextFrameDue = Math.max(now, nextFrameDue + FRAME_CAP);

  const frameMs = now - last;
  const dt = Math.min(0.05, frameMs / 1000);
  last = now;
  if (!running || dt <= 0 || !world) return;

  governor.update(frameMs, dt);

  if (state.alive) updateFlight(dt);
  if (!world) return; // a crash during updateFlight can tear the world down

  // engines
  const rpm = state.alive ? 0.18 + state.throttle * 0.82 : 0;
  for (const prop of plane.propellers) prop.rotation.z += rpm * 62 * dt;
  for (const disc of plane.propDiscs) disc.material.opacity = Math.min(0.3, rpm * 0.34);

  // weapons
  if (state.alive) {
    weapons.update(dt, {
      matrix: plane.group.matrixWorld,
      muzzles: plane.muzzles,
      forward: fwd,
      world,
      pedestrians,
      targets: gunTargets(),
      onHit: (hit) => {
        if (hit.kind === 'building') demolish(hit.target);
        else if (hit.kind === 'pedestrian') award('pedestrian');
        else if (hit.kind === 'vehicle') award('vehicle');
        else if (hit.kind === 'flak') award('flak');
        else if (hit.kind === 'plane') net.reportHit(hit.target.id, hit.damage);
      }
    });
  } else {
    weapons.updateTracers(dt);
  }

  weapons.updateBombs(dt, { gravity: BOMB_GRAVITY, world, onDetonate: detonate });

  // free flight never runs dry
  if (!session.mode.finiteAmmo) {
    weapons.ammo = weapons.maxAmmo;
    weapons.bombs = weapons.maxBombs;
  }

  // anti-aircraft fire
  if (world.flak) {
    _flakTarget.position = plane.group.position;
    _flakTarget.velocity = state.velocity;
    _flakTarget.alive = state.alive && !state.grounded;
    world.flak.update(dt, _flakTarget, (amount) => {
      // Being shot at by something you cannot see needs to be legible, so the
      // first burst of a sortie says so explicitly and names the way out.
      if (!session.flakWarned) {
        session.flakWarned = true;
        hud.banner(
          'FLAK<small>get low or kill the guns — they cannot depress below the rooftops</small>',
          'bad',
          3
        );
      }
      damage(amount, null, 'HIT BY FLAK');
    });
  }

  updateFires(dt);
  updateCollapses(dt);
  pedestrians?.update(dt, plane.group.position);
  world.vehicles?.update(dt, plane.group.position);
  // one instance-buffer upload per frame, and only if a building moved
  world.batch?.flush();
  effects.update(dt);
  updateSight();
  syncRemotes(dt);
  updateCamera(dt);

  // stream the endless world in around the aircraft
  if (session.mode.infinite) world.update(plane.group.position);

  const info = approachInfo();
  updatePAPI(info);

  const focus = state.alive ? plane.group.position : state.wreck ?? plane.group.position;
  sky.position.copy(camera.position);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 420);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  audio.update(rpm, state.speed / planeSpec.maxSpeed, state.alive);

  cockpit.update(dt, {
    speed: state.speed,
    maxSpeed: planeSpec.maxSpeed,
    altitude: Math.max(0, plane.group.position.y),
    throttle: state.throttle,
    rpm,
    hp: state.hp,
    maxHp: state.maxHp,
    pitchIn: state.pitchIn,
    rollIn: state.rollIn
  });

  if (session.room) {
    net.pushState(dt, {
      position: plane.group.position,
      quaternion: plane.group.quaternion,
      speed: state.speed,
      hp: state.hp,
      alive: state.alive,
      plane: planeSpec.id
    });
  }

  // sortie clock
  if (session.mode.timed && session.running) {
    session.timeLeft -= dt;
    if (session.timeLeft <= 0) {
      endSortie('Time up');
      return;
    }
  }

  const onFinal =
    state.alive && !state.grounded &&
    info.along < -90 && info.distance < 1700 && info.height > 2 && info.angle < 16;

  hud.tick(dt);
  hud.update({
    speed: state.speed,
    altitude: Math.max(0, plane.group.position.y - plane.gearHeight),
    verticalSpeed: state.grounded ? 0 : state.velocity.y,
    heading: (Math.atan2(fwd.x, -fwd.z) * DEG + 360) % 360,
    throttle: state.throttle,
    ammo: weapons.ammo,
    bombs: weapons.bombs,
    score: session.score,
    hp: state.hp / state.maxHp,
    fieldDistance: info.distance,
    mapName: session.map?.name ?? 'Free Flight',
    stalling: state.alive && !state.grounded && state.speed < planeSpec.stall,
    braking: state.braking,
    approach: onFinal ? info : null,
    modeValue: session.mode.timed ? formatClock(session.timeLeft) : '∞'
  });

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

/* ==========================================================================
   Boot
   ========================================================================== */

/**
 * Switches quality tier.
 *
 * Population figures are baked into the world at build time, so a manual change
 * only takes full effect on the next sortie; everything the renderer owns
 * (resolution, shadows, tone mapping, draw distance) applies immediately, which
 * is enough to recover a frame rate mid-flight.
 *
 * @param {string} name
 * @param {object} opts  {auto} — an automatic step-down keeps the `auto`
 *   preference, so the governor stays in charge; a manual pick pins it.
 */
function setTier(name, { auto = false } = {}) {
  tierName = name;
  quality = { ...TIERS[name] };
  if (!auto) {
    tierPref = name;
    storeTier(name);
  }
  renderScale = 1;
  applyQuality();
  governor.setTier(name);
  world?.batch?.setShadows(quality.shadows);
  ui?.setTier?.(tierPref, tierName);
}

// Debounced, because the address bar hiding on a phone fires a storm of these
// and each one reallocates the drawing buffer.
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyResolution, 120);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
    touch.release();
  } else if (!ui.visible && world) {
    last = performance.now();
    nextFrameDue = 0;
    running = true;
    governor.reset();
    audio.resume();
  }
});

const ui = new UI({
  economy,
  net,
  onLaunch: launch,
  quality: {
    tiers: TIERS,
    get pref() { return tierPref; },
    get active() { return tierName; },
    set: (name) => {
      if (name === 'auto') {
        tierPref = 'auto';
        storeTier('auto');
        setTier(guessTier(), { auto: true });
        ui.setTier?.(tierPref, tierName);
      } else {
        setTier(name);
      }
    }
  }
});

applyQuality();
if (touchDevice) touch.enable();

/* ---------- multiplayer events that reach into the flight ---------- */

net.on('killed', (msg) => {
  hud.killFeed(msg.killerName ?? 'Someone', msg.victimName ?? 'someone');
  if (msg.killer === net.id && msg.victim !== net.id) award('kill');
});

// The server delivers damage straight to the victim; splice that into the
// client's message handling without the net layer needing to know about flight.
net.handle = ((original) => function patched(msg) {
  if (msg.t === 'damaged') {
    damage(msg.damage, msg.by, 'SHOT DOWN');
    return;
  }
  original.call(net, msg);
  if (msg.t === 'over') endSortie('Match over');
})(net.handle);

/* ---------- debug handle ---------- */

window.sim = {
  state, session, economy, net, weapons, effects, camera, scene, hud,
  renderer, touch, governor, audio,
  get quality() { return { pref: tierPref, active: tierName, renderScale, ...quality }; },
  setTier,
  get plane() { return plane; },
  get world() { return world; },
  get runway() { return runway; },
  get pedestrians() { return pedestrians; },
  get remotes() { return remotes; },
  crash, respawn, detonate, approachInfo, launch, endSortie, buildAircraft,
  setRunning(v) {
    running = v;
    last = performance.now();
  }
};
