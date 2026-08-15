import * as THREE from 'three';
import { createPlane } from './plane.js';
import { createWorld, disposeWorld } from './world.js';
import { MapMenu } from './mapselect.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';

/* ==========================================================================
   Flight model constants (arcade, tuned for feel rather than realism)
   ========================================================================== */

const MAX_SPEED = 168;
const STALL_SPEED = 42;
const THRUST = 96;
const DRAG = 0.0052;
const GRAVITY = 32;
const BOMB_GRAVITY = 30;

const PITCH_RATE = 1.15;
const ROLL_RATE = 2.35;
const YAW_RATE = 0.55;

const GEAR_HEIGHT = 1.8;
const CEILING = 900;
const ARENA = 2400;

const BOMB_LOAD = 24;
const BLAST_RADIUS = 30;

/** Touchdown limits. Outside these the aircraft is written off. */
const MAX_SINK = 14;
const MAX_BANK = 0.35;
const GLIDESLOPE = 4.0; // degrees, what the PAPI is set to

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = 180 / Math.PI;

/* ==========================================================================
   Renderer / scene
   ========================================================================== */

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbcd4e2, 0.00052);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.6, 8000);

/* ---------- sky dome ---------- */

const skyUniforms = {
  top: { value: new THREE.Color(0x2f6fb0) },
  horizon: { value: new THREE.Color(0xbcd4e2) },
  sun: { value: new THREE.Vector3(0.42, 0.62, -0.66).normalize() }
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(4000, 32, 20),
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
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sun;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.15 + 0.06, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.72));
        float d = max(dot(normalize(vDir), sun), 0.0);
        col += vec3(1.0, 0.86, 0.62) * pow(d, 26.0) * 0.9;
        col += vec3(1.0, 0.88, 0.72) * pow(d, 3.5) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }
    `
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
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
{
  const c = sun.shadow.camera;
  c.left = -240;
  c.right = 240;
  c.top = 240;
  c.bottom = -240;
  c.updateProjectionMatrix();
}
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xbdd7ef, 0x4a5a3a, 1.15);
const ambient = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(hemi, ambient);

const effects = new Effects(scene);
const audio = new Audio();
const hud = new Hud();

/* ---------- aircraft ---------- */

const plane = createPlane();
scene.add(plane.group);

/* ---------- bomb sight ---------- */

const sight = new THREE.Mesh(
  new THREE.RingGeometry(4.2, 5.4, 32),
  new THREE.MeshBasicMaterial({
    color: 0x8ef2c4,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
);
sight.rotation.x = -Math.PI / 2;
sight.renderOrder = 5;
scene.add(sight);

/* ==========================================================================
   Bombs
   ========================================================================== */

function bombPrototype() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.15, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.5, metalness: 0.5 })
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 0.5, 10),
    new THREE.MeshStandardMaterial({ color: 0xc4b03a, roughness: 0.5, metalness: 0.3 })
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.15;
  g.add(nose);

  const finMat = new THREE.MeshStandardMaterial({ color: 0x2a2e31, roughness: 0.7 });
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.55), finMat);
    fin.position.set(0, 0.36, 1.0);
    const pivot = new THREE.Group();
    pivot.add(fin);
    pivot.rotation.z = (i / 4) * Math.PI * 2;
    g.add(pivot);
  }
  g.visible = false;
  return g;
}

const bombProto = bombPrototype();
const bombs = Array.from({ length: 30 }, () => {
  const mesh = bombProto.clone(true);
  scene.add(mesh);
  return { mesh, vel: new THREE.Vector3(), live: false, t: 0 };
});

/* ==========================================================================
   World / map loading
   ========================================================================== */

let world = null;
let runway = null;

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

function loadMap(map) {
  disposeWorld(world);
  world = createWorld(map);
  runway = world.runway;
  scene.add(world.group);
  applyEnv(map.env);

  burning.length = 0;
  effects.reset();
  state.score = 0;
  resetPlane();

  hud.banner(
    `${map.name.toUpperCase()}<small>${map.difficulty} — cleared for takeoff</small>`,
    'good',
    3
  );
}

/* ==========================================================================
   Flight state
   ========================================================================== */

const state = {
  speed: 0,
  throttle: 0.7,
  velocity: new THREE.Vector3(),
  bombs: BOMB_LOAD,
  score: 0,
  alive: true,
  grounded: true,
  cockpit: false,
  braking: false,
  shake: 0,
  wreck: null,
  outOfArea: 0,
  /** set on touchdown, cleared when the wheels leave the ground */
  touchdown: null
};

function resetPlane() {
  const g = plane.group;
  g.position.copy(runway.start);
  g.position.y = runway.deck + GEAR_HEIGHT;
  // face down the runway
  g.quaternion.setFromAxisAngle(UP, Math.atan2(-runway.forward.x, -runway.forward.z));
  g.visible = true;

  state.speed = 0;
  state.throttle = 0.7;
  state.velocity.set(0, 0, 0);
  state.bombs = BOMB_LOAD;
  state.alive = true;
  state.grounded = true;
  state.shake = 0;
  state.wreck = null;
  state.outOfArea = 0;
  state.touchdown = null;

  for (const b of bombs) {
    b.live = false;
    b.mesh.visible = false;
  }
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

  if (menu.open) {
    // reopening the menu by accident shouldn't strand you in it
    if ((e.code === 'KeyM' || e.code === 'Escape') && world) resumeFromMenu();
    return;
  }
  if (e.code === 'KeyC') state.cockpit = !state.cockpit;
  if (e.code === 'KeyR') respawn();
  if (e.code === 'Space') dropBomb();
  if (e.code === 'KeyM') openMenu();
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

const axis = (neg, pos) => (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0);

/* ==========================================================================
   Bombing
   ========================================================================== */

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const TRAIL_FROM = new THREE.Color(0xffffff);
const TRAIL_TO = new THREE.Color(0xbfbfbf);

let rackIndex = 0;

function dropBomb() {
  if (!state.alive || state.bombs <= 0) return;
  const slot = bombs.find((b) => !b.live);
  if (!slot) return;

  const hp = plane.hardpoints[rackIndex++ % plane.hardpoints.length];
  slot.mesh.position.copy(hp).applyMatrix4(plane.group.matrixWorld);
  slot.vel.copy(state.velocity);
  slot.vel.y -= 2;
  slot.live = true;
  slot.t = 0;
  slot.mesh.visible = true;

  state.bombs--;
  audio.release();
}

function updateBombs(dt) {
  for (const b of bombs) {
    if (!b.live) continue;
    b.t += dt;

    b.vel.y -= BOMB_GRAVITY * dt;
    b.vel.multiplyScalar(1 - 0.09 * dt);
    b.mesh.position.addScaledVector(b.vel, dt);

    _n.copy(b.vel).normalize();
    if (_n.lengthSq() > 0.001) b.mesh.quaternion.setFromUnitVectors(FWD, _n);

    if (b.t > 0.25 && Math.random() < 0.35) {
      effects.puff(b.mesh.position, {
        r0: 0.6, r1: 3.5, life: 0.8, opacity: 0.18,
        from: TRAIL_FROM, to: TRAIL_TO
      });
    }

    let hit = null;
    if (b.mesh.position.y <= 0.4) {
      hit = _v.set(b.mesh.position.x, 0.4, b.mesh.position.z);
    } else if (buildingAt(b.mesh.position, 0) || hazardAt(b.mesh.position)) {
      hit = _v.copy(b.mesh.position);
    }

    if (hit || b.t > 30) {
      b.live = false;
      b.mesh.visible = false;
      if (hit) detonate(hit);
    }
  }
}

function detonate(pos) {
  effects.explode(pos, { radius: 13, debris: 30, smoke: 16 });
  audio.boom(0.75);

  const d = plane.group.position.distanceTo(pos);
  state.shake = Math.max(state.shake, clamp(90 / (d + 12), 0, 1.1));

  for (const bld of world.buildings) {
    if (!bld.alive) continue;
    const dx = Math.max(bld.min.x - pos.x, 0, pos.x - bld.max.x);
    const dz = Math.max(bld.min.z - pos.z, 0, pos.z - bld.max.z);
    if (dx * dx + dz * dz > BLAST_RADIUS * BLAST_RADIUS) continue;
    if (pos.y > bld.max.y + BLAST_RADIUS * 0.7) continue;
    demolish(bld);
  }

  if (state.alive && d < 22) crash('CAUGHT IN YOUR OWN BLAST');
}

const burning = [];

function demolish(bld) {
  bld.alive = false;
  bld.collapse = 0.0001;
  state.score++;

  const p = bld.center;
  effects.explode(_n.set(p.x, bld.min.y + Math.min(bld.height * 0.6, 30), p.z), {
    radius: 10 + Math.min(bld.height, 40) * 0.28,
    debris: 16,
    smoke: 10
  });

  if (burning.length < 16) burning.push({ bld, t: 0 });
}

function updateCollapses(dt) {
  for (const bld of world.buildings) {
    if (bld.collapse <= 0 || bld.collapse >= 1) continue;
    bld.collapse = Math.min(1, bld.collapse + dt * 0.85);
    const k = bld.collapse;
    const s = 1 - 0.88 * (k * k * (3 - 2 * k)); // smoothstep
    const base = bld.min.y;

    bld.mesh.scale.y = s;
    bld.mesh.rotation.z = Math.sin(k * 4) * 0.035 * (1 - k);
    bld.roof.position.y = base + bld.height * s;
    bld.roof.scale.setScalar(1 - 0.25 * k);
    bld.max.y = base + bld.height * s;

    if (bld.extras) for (const e of bld.extras) e.position.y = base + bld.height * s + 6;

    if (Math.random() < 12 * dt) {
      effects.puff(
        _v.set(
          bld.center.x + (Math.random() - 0.5) * bld.size.x,
          base + Math.random() * bld.height * s,
          bld.center.z + (Math.random() - 0.5) * bld.size.z
        ),
        { r0: 3, r1: 16, life: 2.4, opacity: 0.4 }
      );
    }

    if (bld.collapse >= 1) {
      bld.mesh.material.color.multiplyScalar(0.45);
      bld.roof.visible = false;
      if (bld.extras) for (const e of bld.extras) e.visible = false;
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
        f.bld.min.y + 2 + Math.random() * 4,
        f.bld.center.z + (Math.random() - 0.5) * f.bld.size.z * 0.6
      ),
      dt * 6 * (1 - f.t / 26)
    );
  }
}

/** Destructible box containing `p`, grown by `pad`. */
function buildingAt(p, pad = 0) {
  for (const b of world.buildings) {
    if (!b.alive) continue;
    if (
      p.x > b.min.x - pad && p.x < b.max.x + pad &&
      p.z > b.min.z - pad && p.z < b.max.z + pad &&
      p.y > b.min.y - pad && p.y < b.max.y + pad
    ) {
      return b;
    }
  }
  return null;
}

/** Indestructible terrain (buttes are cylinders, peaks are cones). */
function hazardAt(p) {
  for (const h of world.hazards) {
    if (p.y > h.h || p.y < 0) continue;
    const r = h.cone ? h.r * (1 - p.y / h.h) : h.r;
    const dx = p.x - h.x;
    const dz = p.z - h.z;
    if (dx * dx + dz * dz < r * r) return h;
  }
  return null;
}

/* ==========================================================================
   Crash / landing / respawn
   ========================================================================== */

function crash(reason) {
  if (!state.alive) return;
  state.alive = false;
  state.grounded = false;
  state.touchdown = null;

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
  hud.banner(`CRASHED<small>${reason} — press R to respawn</small>`, 'bad', 999);
}

/**
 * Grades a touchdown. Anything outside the structural limits is a crash and
 * never reaches here; this only decides how good a survivable arrival was.
 */
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
  state.score += td.bonus;
  const rearmed = state.bombs < BOMB_LOAD;
  state.bombs = BOMB_LOAD;
  hud.banner(
    `LANDED · ${td.grade}<small>+${td.bonus} &nbsp;·&nbsp; ${Math.round(td.sink * 196.85)} fpm${rearmed ? ' &nbsp;·&nbsp; rearmed' : ''}</small>`,
    'good',
    3.4
  );
}

function respawn() {
  resetPlane();
  hud.banner('CLEARED FOR TAKEOFF', 'good', 1.8);
}

/* ==========================================================================
   Flight update
   ========================================================================== */

const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();

const _hull = new THREE.Vector3();
const _euler = new THREE.Euler();
const HULL_POINTS = [
  new THREE.Vector3(0, 0, -3.4),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 4.8),
  new THREE.Vector3(-5.4, 0, -0.2),
  new THREE.Vector3(5.4, 0, -0.2)
];

/** Surface height under a point — the causeway deck sits above ground level. */
function groundHeightAt(p) {
  return world.surfaceAt(p).y;
}

function updateFlight(dt) {
  const g = plane.group;
  const q = g.quaternion;

  fwd.copy(FWD).applyQuaternion(q);
  up.copy(UP).applyQuaternion(q);
  right.copy(RIGHT).applyQuaternion(q);

  state.throttle = clamp(state.throttle + axis('ArrowDown', 'ArrowUp') * 0.55 * dt, 0, 1);
  state.braking = !!keys.KeyB && state.grounded;

  // --- longitudinal ---
  const thrust = state.throttle * THRUST;
  const drag = DRAG * state.speed * state.speed;
  const slope = -GRAVITY * fwd.y * 0.85;
  state.speed = clamp(state.speed + (thrust - drag + slope) * dt, 0, MAX_SPEED);

  // --- control surfaces (authority falls off with airspeed) ---
  const auth = clamp(state.speed / STALL_SPEED, 0, 1.25);
  const pitch = axis('KeyW', 'KeyS');
  const roll = axis('KeyD', 'KeyA');
  const yaw = axis('KeyE', 'KeyQ');

  if (state.grounded) {
    g.rotateY(yaw * 0.5 * clamp(state.speed / 30, 0, 1) * dt);
    if (pitch > 0 && state.speed > STALL_SPEED * 0.82) g.rotateX(pitch * 0.7 * dt);
    levelOut(g, dt, 3.2);
  } else {
    g.rotateX(pitch * PITCH_RATE * auth * dt);
    g.rotateZ(roll * ROLL_RATE * auth * dt);
    g.rotateY(yaw * YAW_RATE * auth * dt);

    const bank = Math.asin(clamp(-right.y, -1, 1));
    const turn = -Math.tan(clamp(bank, -1.2, 1.2)) * (GRAVITY / Math.max(state.speed, 34));
    g.rotateOnWorldAxis(UP, turn * dt);
  }

  // --- lift / sink ---
  const liftFactor = Math.min(1, (state.speed / STALL_SPEED) ** 2);
  const support = liftFactor * Math.max(0, up.y);
  const sink = clamp(GRAVITY * (1 - support) * 0.8, 0, 34);

  state.velocity.copy(fwd).multiplyScalar(state.speed);
  if (!state.grounded) state.velocity.y -= sink;

  g.position.addScaledVector(state.velocity, dt);

  if (g.position.y > CEILING) {
    g.position.y = CEILING;
    state.speed *= 1 - 0.6 * dt;
  }

  // --- ground contact ---
  const surface = world.surfaceAt(g.position);
  const deck = surface.y;
  if (g.position.y <= deck + GEAR_HEIGHT) {
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
      g.position.y = deck + GEAR_HEIGHT;
      crash(
        sinkRate >= MAX_SINK ? 'FLEW INTO THE GROUND'
          : bankAbs >= MAX_BANK ? 'DUG A WINGTIP IN'
          : 'BOTCHED THE LANDING'
      );
      return;
    }

    const wasAirborne = !state.grounded;
    g.position.y = deck + GEAR_HEIGHT;
    state.grounded = true;
    state.velocity.y = 0;

    if (wasAirborne) {
      const onStrip = runway.contains(g.position);
      const alignment = Math.abs(fwd.x * runway.forward.x + fwd.z * runway.forward.z);
      const result = gradeTouchdown(sinkRate, alignment, onStrip);
      state.touchdown = { ...result, sink: sinkRate, scored: false };

      effects.puff(g.position, { r0: 1.5, r1: 9, life: 1.1, opacity: 0.4 });
      effects.puff(g.position, { r0: 1.5, r1: 7, life: 0.9, opacity: 0.3 });
      state.shake = Math.max(state.shake, clamp(sinkRate / 26, 0, 0.5));
      hud.banner(
        `TOUCHDOWN · ${result.grade}<small>${Math.round(sinkRate * 196.85)} fpm — brake to a stop${result.note ? ` · ${result.note}` : ''}</small>`,
        'good',
        2.6
      );
    }

    // rolling friction, brakes, and the throttle held closed
    const brake = state.braking ? 30 : state.throttle < 0.1 ? 12 : 3;
    state.speed = Math.max(0, state.speed - brake * dt);

    if (state.speed < 4) {
      if (state.touchdown && !state.touchdown.scored) {
        completeLanding();
      } else if (!state.touchdown && runway.contains(g.position) && state.bombs < BOMB_LOAD) {
        state.bombs = BOMB_LOAD;
        hud.banner('REARMED', 'good', 1.6);
      }
    }
  } else if (state.grounded && g.position.y > deck + GEAR_HEIGHT + 0.05) {
    state.grounded = false;
    state.touchdown = null; // airborne again: the next arrival is graded fresh
  }

  // --- structures and terrain ---
  g.updateMatrixWorld(true);
  for (const local of HULL_POINTS) {
    _hull.copy(local).applyMatrix4(g.matrixWorld);
    const struck = buildingAt(_hull, 1.2);
    if (struck) {
      demolish(struck);
      crash('HIT A BUILDING');
      return;
    }
    if (hazardAt(_hull)) {
      crash(world.map.mountains ? 'FLEW INTO A MOUNTAIN' : 'FLEW INTO A BUTTE');
      return;
    }
  }

  // --- arena bounds ---
  const outside = Math.abs(g.position.x) > ARENA || Math.abs(g.position.z) > ARENA;
  state.outOfArea = outside ? state.outOfArea + dt : 0;
  if (outside && state.outOfArea > 0.2 && state.outOfArea < 0.4) {
    hud.banner('TURN BACK<small>leaving the operating area</small>', 'bad', 2.4);
  }
  if (state.outOfArea > 12) crash('LOST OVER OPEN COUNTRY');
}

/** Wheels-on-tarmac: bleed roll and pitch back to level. */
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

/**
 * Geometry of the current approach relative to the touchdown zone.
 * `along` is negative while the aircraft is still short of the aim point.
 */
function approachInfo() {
  const p = plane.group.position;
  const td = runway.touchdown;
  const dx = p.x - td.x;
  const dz = p.z - td.z;
  return {
    distance: Math.hypot(dx, dz),
    along: dx * runway.forward.x + dz * runway.forward.z,
    height: p.y - td.y,
    angle: Math.atan2(p.y - td.y, Math.max(Math.hypot(dx, dz), 1)) * DEG,
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

/* ==========================================================================
   Bomb sight
   ========================================================================== */

function updateSight() {
  const p = plane.group.position;
  if (!state.alive || state.grounded || p.y < 6) {
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
  } else if (state.cockpit) {
    camera.position.copy(plane.eye).applyMatrix4(g.matrixWorld);
    camera.quaternion.copy(g.quaternion);
    applyShake(dt);
    camera.fov = 68 + (state.speed / MAX_SPEED) * 8;
    camera.updateProjectionMatrix();
    return;
  } else {
    camTarget.copy(chaseOffset).applyMatrix4(g.matrixWorld);
    camTarget.y = Math.max(camTarget.y, groundHeightAt(camTarget) + 2.2);
    camera.position.lerp(camTarget, Math.min(1, 5.5 * dt));
    camLook.copy(g.position).addScaledVector(fwd, 26).addScaledVector(up, 1.5);
  }

  camera.up.copy(state.cockpit ? UP : up).lerp(UP, state.alive ? 0.35 : 1);
  camera.lookAt(camLook);
  applyShake(dt);

  const targetFov = 62 + (state.speed / MAX_SPEED) * 12;
  camera.fov += (targetFov - camera.fov) * Math.min(1, 3 * dt);
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
   Loop
   ========================================================================== */

let last = performance.now();
let running = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running || dt <= 0) return;

  if (state.alive) updateFlight(dt);

  const rpm = state.alive ? 0.18 + state.throttle * 0.82 : 0;
  plane.propeller.rotation.z += rpm * 62 * dt;
  plane.propDisc.material.opacity = Math.min(0.3, rpm * 0.34);

  updateBombs(dt);
  updateCollapses(dt);
  effects.update(dt);
  updateSight();
  updateCamera(dt);

  const info = approachInfo();
  updatePAPI(info);

  const focus = state.alive ? plane.group.position : state.wreck ?? plane.group.position;
  sky.position.copy(camera.position);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 420);
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();

  audio.update(rpm, state.speed / MAX_SPEED, state.alive);

  // Only a real final approach: short of the aim point, inbound, and at an
  // angle that means anything. Overflying the field at altitude is not one.
  const onFinal =
    state.alive &&
    !state.grounded &&
    info.along < -90 &&
    info.distance < 1700 &&
    info.height > 2 &&
    info.angle < 16;

  hud.tick(dt);
  hud.update({
    speed: state.speed,
    altitude: Math.max(0, plane.group.position.y - GEAR_HEIGHT),
    verticalSpeed: state.grounded ? 0 : state.velocity.y,
    heading: (Math.atan2(fwd.x, -fwd.z) * DEG + 360) % 360,
    throttle: state.throttle,
    bombs: state.bombs,
    score: state.score,
    fieldDistance: info.distance,
    mapName: world.map.name,
    stalling: state.alive && !state.grounded && state.speed < STALL_SPEED,
    braking: state.braking,
    approach: onFinal ? info : null
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
  if (document.hidden) {
    running = false;
  } else if (!menu.open) {
    last = performance.now();
    running = true;
    audio.resume();
  }
});

const menu = new MapMenu((map) => {
  audio.start();
  audio.resume();
  loadMap(map);
  hud.show();
  last = performance.now();
  running = true;
});

function openMenu() {
  running = false;
  hud.hide();
  menu.show(`Currently over ${world.map.name} — M or Esc to resume`);
}

function resumeFromMenu() {
  menu.hide();
  hud.show();
  last = performance.now();
  running = true;
  audio.resume();
}

// Debug handle — handy from the console for tuning, and for automated checks.
window.sim = {
  state, plane, camera, scene, effects, bombs,
  crash, respawn, detonate, loadMap, approachInfo,
  get world() { return world; },
  get runway() { return runway; },
  setRunning(v) {
    running = v;
    last = performance.now();
  }
};
