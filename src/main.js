import * as THREE from 'three';
import { createPlane } from './plane.js';
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

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbcd4e2, 0.00052);
const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.4, 9000);

/* ---------- sky ---------- */

const skyUniforms = {
  top: { value: new THREE.Color(0x2f6fb0) },
  horizon: { value: new THREE.Color(0xbcd4e2) },
  sun: { value: new THREE.Vector3(0.42, 0.62, -0.66).normalize() }
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(4500, 32, 20),
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
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 1000;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
{
  const c = sun.shadow.camera;
  c.left = -260; c.right = 260; c.top = 260; c.bottom = -260;
  c.updateProjectionMatrix();
}
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xbdd7ef, 0x4a5a3a, 1.15);
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(hemi, ambient);

/* ==========================================================================
   Services
   ========================================================================== */

const effects = new Effects(scene);
const audio = new Audio();
const hud = new Hud();
const economy = new Economy();
const net = new Net();
const weapons = new Weapons(scene, effects, audio);

/* ---------- bomb sight ---------- */

const sight = new THREE.Mesh(
  new THREE.RingGeometry(4.2, 5.4, 32),
  new THREE.MeshBasicMaterial({
    color: 0x8ef2c4, transparent: true, opacity: 0.8,
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
  running: false
};

let world = null;
let runway = null;
let pedestrians = null;
let plane = null;
let cockpit = null;
let planeSpec = planeById(economy.data.loadout.plane);

/* ==========================================================================
   Aircraft construction
   ========================================================================== */

/** Rebuilds the player's aircraft from the equipped loadout. */
function buildAircraft() {
  if (plane) {
    cockpit?.dispose();
    plane.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material && !Array.isArray(o.material)) o.material.dispose();
      }
    });
    plane.group.removeFromParent();
  }

  planeSpec = economy.loadout.plane;
  plane = createPlane(planeSpec.model, { guns: planeSpec.guns });
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
  scene.fog.density = env.fogDensity;

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
  weapons.reset();
  effects.reset();
  clearRemotes();
}

/* ==========================================================================
   Launching a sortie
   ========================================================================== */

function launch({ mode, map, duration, room }) {
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
  session.running = true;
  session.room = room ?? null;

  if (mode.infinite) {
    world = new ChunkWorld(scene);
    world.update(new THREE.Vector3());
    applyEnv(FREEFLIGHT_ENV);
  } else {
    world = createWorld(map);
    scene.add(world.group);
    applyEnv(map.env);
  }
  runway = world.runway;

  // crowds only exist where there are streets to walk
  if (world.streets) {
    pedestrians = new Pedestrians(scene, {
      count: mode.infinite ? 120 : 260,
      grid: world.streets.grid,
      cell: world.streets.cell,
      half: world.streets.half,
      road: world.streets.road,
      effects
    });
  }

  resetPlane();
  hud.show();
  hud.setMode(mode);
  running = true;
  last = performance.now();
  audio.start();
  audio.resume();

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

function setScoped(on) {
  state.scoped = on;
  hud.setScoped(on);
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
}

/* ==========================================================================
   Ordnance
   ========================================================================== */

const burning = [];
const fires = [];
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hull = new THREE.Vector3();
const _euler = new THREE.Euler();

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

function updateCollapses(dt) {
  for (const b of world.buildings) {
    if (b.collapse <= 0 || b.collapse >= 1) continue;
    b.collapse = Math.min(1, b.collapse + dt * 0.85);
    const k = b.collapse;
    const s = 1 - 0.88 * (k * k * (3 - 2 * k)); // smoothstep
    const base = b.min.y;

    b.mesh.scale.y = s;
    // it leans as it goes rather than sinking straight down
    b.mesh.rotation.z = Math.sin(k * 4) * 0.05 * (1 - k);
    b.mesh.rotation.x = Math.cos(k * 3.3) * 0.04 * (1 - k);
    b.roof.position.y = base + b.height * s;
    b.roof.scale.setScalar(1 - 0.25 * k);
    b.max.y = base + b.height * s;

    if (b.extras) for (const e of b.extras) e.position.y = base + b.height * s + 6;

    if (Math.random() < 14 * dt) {
      effects.puff(
        _v.set(
          b.center.x + (Math.random() - 0.5) * b.size.x * 1.3,
          base + Math.random() * b.height * s,
          b.center.z + (Math.random() - 0.5) * b.size.z * 1.3
        ),
        { r0: 3, r1: 18, life: 2.6, opacity: 0.42 }
      );
    }

    if (b.collapse >= 1) {
      b.mesh.material.color.multiplyScalar(0.45);
      b.roof.visible = false;
      if (b.extras) for (const e of b.extras) e.visible = false;
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
  if (session.room) net.reportDeath(state.lastHitBy);

  hud.banner(`DOWN<small>${reason} — press R to respawn</small>`, 'bad', 999);
}

function respawn() {
  if (!world) return;
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

  state.throttle = clamp(state.throttle + axis('ArrowDown', 'ArrowUp') * 0.55 * dt, 0, 1);
  state.braking = !!keys.KeyB && state.grounded;

  // --- longitudinal ---
  const thrust = state.throttle * P.thrust;
  const drag = P.drag * state.speed * state.speed;
  const slope = -GRAVITY * fwd.y * 0.85; // climbing bleeds speed, diving builds it
  state.speed = clamp(state.speed + (thrust - drag + slope) * dt, 0, P.maxSpeed);

  // --- controls: W/S pitch, Q/E roll, A/D rudder ---
  const auth = clamp(state.speed / P.stall, 0, 1.25);
  const pitch = axis('KeyW', 'KeyS');
  const roll = axis('KeyE', 'KeyQ');
  const yaw = axis('KeyD', 'KeyA');
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
      const model = createPlane(spec.model, { guns: spec.guns });
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
  r.group.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      if (o.material && !Array.isArray(o.material)) o.material.dispose();
    }
  });
  r.group.removeFromParent();
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

  const coins = Math.round(session.score * 0.5);
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
  hud.hide();
  ui.show('menu');
}

function resumeFromMenu() {
  ui.hide();
  hud.show();
  last = performance.now();
  running = true;
  audio.resume();
}

/* ==========================================================================
   Loop
   ========================================================================== */

let last = performance.now();
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running || dt <= 0 || !world) return;

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

  updateFires(dt);
  updateCollapses(dt);
  pedestrians?.update(dt, plane.group.position);
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

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) running = false;
  else if (!ui.visible && world) {
    last = performance.now();
    running = true;
    audio.resume();
  }
});

const ui = new UI({ economy, net, onLaunch: launch });

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
