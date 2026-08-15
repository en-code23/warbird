import * as THREE from 'three';
import { bombCount } from './catalog.js';

/**
 * Guns and bombs.
 *
 * Gunnery is hitscan with cosmetic tracers: each round resolves instantly
 * against the world, and a visible tracer is spawned for a fraction of shots
 * purely so the burst reads on screen. At the Gatling's 3600rpm across six
 * mounts, simulating every round as a physical projectile would cost far more
 * than it buys — the player cannot perceive the 0.05s time of flight anyway.
 *
 * Bombs are real projectiles, because their arc is the whole point.
 */

const FWD = new THREE.Vector3(0, 0, -1);
const MAX_RANGE = 900;
/** Rounds actually resolved per frame, however fast the gun nominally fires. */
const MAX_SHOTS_PER_FRAME = 14;

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Vector3();

/* ==========================================================================
   Ray helpers
   ========================================================================== */

/**
 * Ray vs axis-aligned box (slab method).
 * @returns {number} distance along the ray, or -1 for a miss
 */
function rayBox(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = 0;
  let tmax = MAX_RANGE;

  // x slab
  if (Math.abs(dx) < 1e-8) {
    if (ox < min.x || ox > max.x) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (min.x - ox) * inv;
    let t2 = (max.x - ox) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // y slab
  if (Math.abs(dy) < 1e-8) {
    if (oy < min.y || oy > max.y) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (min.y - oy) * inv;
    let t2 = (max.y - oy) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  // z slab
  if (Math.abs(dz) < 1e-8) {
    if (oz < min.z || oz > max.z) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (min.z - oz) * inv;
    let t2 = (max.z - oz) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Ray vs sphere; used for aircraft and pedestrians. */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const ex = cx - ox;
  const ey = cy - oy;
  const ez = cz - oz;
  const b = ex * dx + ey * dy + ez * dz;
  if (b < 0) return -1;
  const c = ex * ex + ey * ey + ez * ez - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/* ==========================================================================
   Weapons
   ========================================================================== */

export class Weapons {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./effects.js').Effects} effects
   * @param {import('./audio.js').Audio} audio
   */
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;

    this.gun = null;
    this.bomb = null;
    this.plane = null;

    this.trigger = false;
    this.ammo = 0;
    this.maxAmmo = 0;
    this.bombs = 0;
    this.maxBombs = 0;

    this._shotAccum = 0;
    this._spin = 0; // Gatling spin-up, 0..1
    this._rackIndex = 0;
    this._tracerSkip = 0;

    /* ---- tracer pool ---- */
    const tracerGeo = new THREE.BoxGeometry(0.13, 0.13, 1);
    this.tracers = Array.from({ length: 140 }, () => {
      const m = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd24a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return { m, t: 0, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), len: 0 };
    });

    /* ---- bomb pool ---- */
    this.bombProto = buildBombMesh();
    this.projectiles = Array.from({ length: 48 }, () => {
      const mesh = this.bombProto.clone(true);
      scene.add(mesh);
      return {
        mesh,
        vel: new THREE.Vector3(),
        live: false,
        t: 0,
        spec: null,
        split: false
      };
    });
  }

  /** Apply a shop loadout. Resets ammunition and bomb count to a full sortie. */
  setLoadout({ plane, gun, bomb }) {
    this.plane = plane;
    this.gun = gun;
    this.bomb = bomb;
    this.rearm();

    const colour = new THREE.Color(gun.tracer);
    for (const t of this.tracers) t.m.material.color.copy(colour);
    for (const p of this.projectiles) {
      p.mesh.traverse((o) => {
        if (o.isMesh && o.userData.bombBody) o.material.color.setHex(bomb.colour);
      });
    }
  }

  rearm() {
    this.maxAmmo = this.gun.ammo * this.plane.guns;
    this.ammo = this.maxAmmo;
    this.maxBombs = bombCount(this.plane, this.bomb);
    this.bombs = this.maxBombs;
  }

  get mounts() {
    return this.plane?.guns ?? 1;
  }

  /* ---------- gunnery ---------- */

  /**
   * @param {number} dt
   * @param {object} ctx {matrix, muzzles, forward, world, targets, pedestrians, onHit}
   */
  updateGuns(dt, ctx) {
    const gun = this.gun;
    if (!gun) return;

    // Gatlings take a moment to come up to speed, and spin down when released
    if (gun.spinUp) {
      this._spin = THREE.MathUtils.clamp(
        this._spin + (this.trigger ? dt / gun.spinUp : -dt / (gun.spinUp * 1.6)),
        0,
        1
      );
    } else {
      this._spin = this.trigger ? 1 : 0;
    }

    const firing = this.trigger && this.ammo > 0 && this._spin > 0.05;
    if (!firing) {
      this._shotAccum = 0;
      return;
    }

    const rps = (gun.rpm / 60) * this.mounts * (gun.spinUp ? this._spin : 1);
    this._shotAccum += rps * dt;

    let shots = Math.min(Math.floor(this._shotAccum), MAX_SHOTS_PER_FRAME);
    this._shotAccum -= shots;
    if (shots <= 0) return;

    shots = Math.min(shots, this.ammo);
    this.ammo -= shots;

    for (let i = 0; i < shots; i++) {
      const muzzle = ctx.muzzles[i % ctx.muzzles.length];
      _o.copy(muzzle).applyMatrix4(ctx.matrix);

      // aim along the nose with a random spread cone
      _d.copy(ctx.forward);
      _d.x += (Math.random() - 0.5) * gun.spread * 2;
      _d.y += (Math.random() - 0.5) * gun.spread * 2;
      _d.z += (Math.random() - 0.5) * gun.spread * 2;
      _d.normalize();

      this._resolveShot(_o, _d, ctx);
    }

    this.audio?.gun(gun, this._spin);
  }

  _resolveShot(origin, dir, ctx) {
    const gun = this.gun;
    let bestT = MAX_RANGE;
    let hitKind = null;
    let hitRef = null;

    // --- aircraft ---
    for (const target of ctx.targets ?? []) {
      if (!target.alive) continue;
      const t = raySphere(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        target.position.x, target.position.y, target.position.z,
        target.radius ?? 5
      );
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitKind = 'plane';
        hitRef = target;
      }
    }

    // --- buildings ---
    for (const b of ctx.world.buildings) {
      if (!b.alive) continue;
      // cheap reject: skip anything obviously behind or far off the line
      _q.set(b.center.x - origin.x, b.center.y - origin.y, b.center.z - origin.z);
      const along = _q.dot(dir);
      if (along < 0 || along > bestT) continue;
      if (_q.lengthSq() - along * along > 9000) continue;

      const t = rayBox(
        origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, b.min, b.max
      );
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitKind = 'building';
        hitRef = b;
      }
    }

    // --- pedestrians ---
    if (ctx.pedestrians) {
      const ped = ctx.pedestrians.rayHit(origin, dir, bestT);
      if (ped) {
        bestT = ped.t;
        hitKind = 'pedestrian';
        hitRef = ped.index;
      }
    }

    // --- ground ---
    if (dir.y < -1e-6) {
      const t = -(origin.y - 0.2) / dir.y;
      if (t >= 0 && t < bestT) {
        bestT = t;
        hitKind = 'ground';
        hitRef = null;
      }
    }

    _p.copy(origin).addScaledVector(dir, Math.min(bestT, MAX_RANGE));

    // one visible tracer every few rounds keeps the burst readable without
    // flooding the pool at high rates of fire
    if (++this._tracerSkip % 3 === 0) this._spawnTracer(origin, _p);

    if (!hitKind) return;

    switch (hitKind) {
      case 'plane':
        ctx.onHit?.({ kind: 'plane', target: hitRef, damage: gun.damage, point: _p });
        this.effects.spark(_p, _q.set(0, 6, 0), 0.4, 0.28);
        break;
      case 'building':
        this._damageBuilding(hitRef, gun.damage, _p, ctx);
        break;
      case 'pedestrian':
        ctx.pedestrians.kill(hitRef, _p);
        ctx.onHit?.({ kind: 'pedestrian', point: _p });
        break;
      case 'ground':
        this.effects.puff(_p, { r0: 0.4, r1: 2.6, life: 0.6, opacity: 0.3 });
        break;
    }
  }

  _damageBuilding(b, damage, point, ctx) {
    b.hp -= damage;

    // scorch the facade as it takes punishment
    const wear = THREE.MathUtils.clamp(1 - b.hp / b.maxHp, 0, 1);
    if (b.mesh.material.color && wear > 0.05) {
      b.mesh.material.color.copy(b.baseColor).multiplyScalar(1 - wear * 0.45);
    }

    this.effects.puff(point, { r0: 0.3, r1: 2.2, life: 0.5, opacity: 0.35 });
    if (Math.random() < 0.4) {
      this.effects.spark(point, _q.set((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8), 0.7, 0.22);
    }

    if (b.hp <= 0) ctx.onHit?.({ kind: 'building', target: b, point });
  }

  _spawnTracer(from, to) {
    let slot = this.tracers.find((t) => t.life <= 0);
    if (!slot) slot = this.tracers[0];

    slot.from.copy(from);
    slot.to.copy(to);
    slot.len = from.distanceTo(to);
    slot.t = 0;
    slot.life = Math.min(0.13, slot.len / (this.gun.velocity * 0.9));
    slot.m.visible = true;
  }

  updateTracers(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.t += dt;
      const k = t.t / t.life;
      if (k >= 1) {
        t.life = 0;
        t.m.visible = false;
        t.m.material.opacity = 0;
        continue;
      }
      // stretch a bright sliver along the path as it travels
      const head = Math.min(1, k * 1.15);
      const streak = Math.min(t.len * 0.22, 26);
      _p.copy(t.from).lerp(t.to, head);
      _q.copy(t.to).sub(t.from).normalize();
      t.m.position.copy(_p).addScaledVector(_q, -streak / 2);
      t.m.lookAt(_p);
      t.m.scale.set(1, 1, streak);
      t.m.material.opacity = 0.9 * (1 - k);
    }
  }

  /* ---------- bombs ---------- */

  dropBomb(ctx) {
    if (this.bombs <= 0) return false;
    const slot = this.projectiles.find((p) => !p.live);
    if (!slot) return false;

    const hp = ctx.hardpoints[this._rackIndex++ % ctx.hardpoints.length];
    slot.mesh.position.copy(hp).applyMatrix4(ctx.matrix);
    slot.vel.copy(ctx.velocity);
    slot.vel.y -= 2; // pushed clear of the rack
    slot.live = true;
    slot.t = 0;
    slot.split = false;
    slot.spec = this.bomb;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(this.bomb.weight > 400 ? 1.35 : this.bomb.weight < 100 ? 0.72 : 1);

    this.bombs--;
    this.audio?.release();
    return true;
  }

  /**
   * @param {object} ctx {gravity, world, onDetonate}
   */
  updateBombs(dt, ctx) {
    for (const b of this.projectiles) {
      if (!b.live) continue;
      b.t += dt;
      const spec = b.spec;

      b.vel.y -= ctx.gravity * dt;
      b.vel.multiplyScalar(1 - spec.dragCoef * dt);
      b.mesh.position.addScaledVector(b.vel, dt);

      // weathervane into the airflow
      _d.copy(b.vel).normalize();
      if (_d.lengthSq() > 0.001) b.mesh.quaternion.setFromUnitVectors(FWD, _d);

      // cluster munitions open at altitude and scatter bomblets
      if (spec.cluster && !b.split && b.mesh.position.y < spec.clusterAt) {
        b.split = true;
        b.live = false;
        b.mesh.visible = false;
        this.effects.puff(b.mesh.position, { r0: 1, r1: 7, life: 0.7, opacity: 0.4 });
        for (let i = 0; i < spec.cluster; i++) {
          const sub = this.projectiles.find((p) => !p.live);
          if (!sub) break;
          sub.mesh.position.copy(b.mesh.position);
          sub.vel.copy(b.vel);
          sub.vel.x += (Math.random() - 0.5) * 26;
          sub.vel.z += (Math.random() - 0.5) * 26;
          sub.vel.y += (Math.random() - 0.5) * 6;
          sub.live = true;
          sub.t = 0;
          sub.split = true;
          sub.spec = { ...spec, cluster: 0, blast: spec.blast, countMult: 1 };
          sub.mesh.visible = true;
          sub.mesh.scale.setScalar(0.5);
        }
        continue;
      }

      if (b.t > 0.25 && Math.random() < 0.3) {
        this.effects.puff(b.mesh.position, {
          r0: 0.5, r1: 3, life: 0.7, opacity: 0.15
        });
      }

      let hit = null;
      if (b.mesh.position.y <= 0.4) {
        hit = _p.set(b.mesh.position.x, 0.4, b.mesh.position.z);
      } else if (
        ctx.world.buildingAt(b.mesh.position, 0) ||
        ctx.world.hazardAt?.(b.mesh.position)
      ) {
        hit = _p.copy(b.mesh.position);
      }

      if (hit || b.t > 30) {
        b.live = false;
        b.mesh.visible = false;
        if (hit) ctx.onDetonate(hit, spec);
      }
    }
  }

  update(dt, ctx) {
    this.updateGuns(dt, ctx);
    this.updateTracers(dt);
  }

  /** Hide everything in flight — used when swapping map or mode. */
  reset() {
    for (const t of this.tracers) {
      t.life = 0;
      t.m.visible = false;
    }
    for (const p of this.projectiles) {
      p.live = false;
      p.mesh.visible = false;
    }
    this._shotAccum = 0;
    this._spin = 0;
  }
}

/* ------------------------------------------------------------------ */

function buildBombMesh() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.15, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.5, metalness: 0.5 })
  );
  body.rotation.x = Math.PI / 2;
  body.userData.bombBody = true;
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
