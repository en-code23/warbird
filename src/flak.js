import * as THREE from 'three';

/**
 * Anti-aircraft batteries.
 *
 * Until now nothing in a Strike sortie shot back, which made the whole mode
 * target practice: there was no reason to fly low, fast, or unpredictably, and
 * no reason to prefer one airframe's armour over another's.
 *
 * A battery tracks you, leads the shot, and fires a burst of shells that
 * detonate at the predicted point. The lead is deliberately imperfect and gets
 * worse the faster and lower you are, so the counterplay is real flying rather
 * than memorising positions: come in fast, stay under the guns' minimum
 * engagement height, or kill them first. They are destructible and worth
 * points, so suppressing the defences before the bomb run is a genuine choice.
 *
 * Bases and barrels are two InstancedMeshes, so a fully defended city costs two
 * draw calls. Shells are pooled sprites that never enter or leave the scene.
 */

const UP = new THREE.Vector3(0, 1, 0);

const _v = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3(0, 0, 0);

const SHELL_SPEED = 300;

export class Flak {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} opts
   * @param {Array<{x:number,z:number,y?:number}>} opts.sites
   * @param {number} opts.range       slant range the guns will engage inside
   * @param {number} opts.minHeight   they will not depress below this
   * @param {number} opts.accuracy    0..1, how well they lead the target
   * @param {number} opts.damage      damage at the centre of a burst
   * @param {object} opts.effects
   */
  constructor(parent, opts) {
    this.effects = opts.effects;
    this.range = opts.range ?? 1250;
    this.minHeight = opts.minHeight ?? 55;
    this.accuracy = opts.accuracy ?? 0.55;
    this.damage = opts.damage ?? 16;
    this.burstRadius = opts.burstRadius ?? 26;

    const sites = opts.sites;
    const n = sites.length;

    this.batteries = sites.map((s, i) => ({
      index: i,
      pos: new THREE.Vector3(s.x, s.y ?? 0, s.z),
      hp: 46,
      alive: true,
      cooldown: 1 + Math.random() * 3,
      rounds: 0,
      aim: new THREE.Vector3(0, 1, 0)
    }));

    /* ---- meshes ---- */
    const baseGeo = new THREE.CylinderGeometry(2.6, 3.4, 2.2, 7);
    baseGeo.translate(0, 1.1, 0);
    const barrelGeo = new THREE.CylinderGeometry(0.34, 0.46, 7.5, 6);
    // pivot at the breech so the instance rotation swings the muzzle up
    barrelGeo.translate(0, 3.4, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a5148, roughness: 0.72, metalness: 0.28
    });
    this.bases = new THREE.InstancedMesh(baseGeo, mat, n);
    this.barrels = new THREE.InstancedMesh(barrelGeo, mat.clone(), n);
    this.barrels.material.color.setHex(0x33383a);

    for (const mesh of [this.bases, this.barrels]) {
      mesh.castShadow = !!opts.shadows;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
    }

    for (const b of this.batteries) {
      _m.compose(b.pos, _q.identity(), _s);
      this.bases.setMatrixAt(b.index, _m);
      this.barrels.setMatrixAt(b.index, _m);
    }
    this.bases.instanceMatrix.needsUpdate = true;
    this.barrels.instanceMatrix.needsUpdate = true;
    parent.add(this.bases, this.barrels);

    /* ---- shell pool ---- */
    this.shells = [];
    this.aliveCount = n;
  }

  /** @returns the battery a ray hits first, or null */
  rayHit(origin, dir, maxT) {
    let bestT = maxT;
    let best = null;
    for (const b of this.batteries) {
      if (!b.alive) continue;
      const ex = b.pos.x - origin.x;
      const ey = b.pos.y + 2 - origin.y;
      const ez = b.pos.z - origin.z;
      const proj = ex * dir.x + ey * dir.y + ez * dir.z;
      if (proj < 0 || proj > bestT) continue;
      const c = ex * ex + ey * ey + ez * ez - 16; // r = 4
      const disc = proj * proj - c;
      if (disc < 0) continue;
      const t = proj - Math.sqrt(disc);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = b;
      }
    }
    return best ? { t: bestT, battery: best } : null;
  }

  /** @returns number of batteries destroyed */
  blast(point, radius) {
    let killed = 0;
    for (const b of this.batteries) {
      if (!b.alive) continue;
      if (b.pos.distanceTo(point) > radius) continue;
      this.destroy(b);
      killed++;
    }
    return killed;
  }

  /** @returns true if this hit destroyed it */
  hit(b, amount) {
    if (!b.alive) return false;
    b.hp -= amount;
    if (b.hp > 0) return false;
    this.destroy(b);
    return true;
  }

  destroy(b) {
    if (!b.alive) return;
    b.alive = false;
    this.aliveCount--;
    _v.copy(b.pos).setY(b.pos.y + 2);
    this.effects?.explode(_v, { radius: 8, debris: 18, smoke: 10 });
    _m.compose(ZERO, _q.identity(), ZERO);
    this.bases.setMatrixAt(b.index, _m);
    this.barrels.setMatrixAt(b.index, _m);
    this.bases.instanceMatrix.needsUpdate = true;
    this.barrels.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {object} target {position, velocity, alive}
   * @param {(damage:number)=>void} onDamage  called when a burst catches you
   */
  update(dt, target, onDamage) {
    const engaging =
      target.alive && target.position.y > this.minHeight;

    let barrelsMoved = false;

    for (const b of this.batteries) {
      if (!b.alive) continue;

      const dist = b.pos.distanceTo(target.position);
      const inRange = engaging && dist < this.range;

      // Track: swing the barrel toward the lead point even between bursts, so
      // you can see which guns have you before they fire.
      if (inRange) {
        const flight = dist / SHELL_SPEED;
        _lead.copy(target.position).addScaledVector(target.velocity, flight);
        _dir.subVectors(_lead, b.pos).normalize();
        b.aim.lerp(_dir, Math.min(1, 2.4 * dt));
        _q.setFromUnitVectors(UP, b.aim);
        _m.compose(b.pos, _q, _s);
        this.barrels.setMatrixAt(b.index, _m);
        barrelsMoved = true;
      }

      b.cooldown -= dt;
      if (!inRange || b.cooldown > 0) continue;

      // fire a burst of four, then a long reload
      if (b.rounds <= 0) {
        b.rounds = 4;
      }
      b.rounds--;
      b.cooldown = b.rounds > 0 ? 0.22 : 2.6 + Math.random() * 2.4;

      this.fire(b, target, dist);
    }

    if (barrelsMoved) this.barrels.instanceMatrix.needsUpdate = true;

    this.updateShells(dt, target, onDamage);
  }

  /** Predicts where you will be and sends a shell to burst there. */
  fire(b, target, dist) {
    const flight = dist / SHELL_SPEED;
    _lead.copy(target.position).addScaledVector(target.velocity, flight);

    // Aiming error: worse against a fast target, and worse low down where the
    // gun has to slew quickly. This is the whole counterplay.
    const speed = target.velocity.length();
    const slew = 1 - Math.min(1, target.position.y / 700) * 0.45;
    const spread = (1 - this.accuracy) * (26 + speed * 0.34) * slew;

    _lead.x += (Math.random() - 0.5) * spread * 2;
    _lead.y += (Math.random() - 0.5) * spread;
    _lead.z += (Math.random() - 0.5) * spread * 2;

    this.shells.push({
      from: b.pos.clone().setY(b.pos.y + 4),
      to: _lead.clone(),
      t: 0,
      flight: Math.max(0.35, flight)
    });

    // muzzle flash
    this.effects?.puff(_v.copy(b.pos).setY(b.pos.y + 6), {
      r0: 1.4, r1: 5, life: 0.5, opacity: 0.5,
      from: FLASH, to: SMOKE
    });
  }

  updateShells(dt, target, onDamage) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.t += dt;
      if (sh.t < sh.flight) continue;

      this.shells.splice(i, 1);
      this.burst(sh.to, target, onDamage);
    }
  }

  burst(at, target, onDamage) {
    // Flak bursts are black smoke with a brief orange core — not a fireball.
    this.effects?.puff(at, {
      r0: 2.5, r1: 15, life: 2.4, opacity: 0.72,
      from: FLASH, to: BLACK
    });
    for (let i = 0; i < 3; i++) {
      this.effects?.spark(
        at,
        _v.set(
          (Math.random() - 0.5) * 26,
          (Math.random() - 0.5) * 26,
          (Math.random() - 0.5) * 26
        ),
        1.1,
        0.32
      );
    }

    if (!target.alive) return;
    const d = at.distanceTo(target.position);
    if (d > this.burstRadius) return;
    onDamage?.(this.damage * (1 - d / this.burstRadius), at);
  }

  dispose() {
    for (const mesh of [this.bases, this.barrels]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
      mesh.removeFromParent();
    }
    this.shells.length = 0;
  }
}

const FLASH = new THREE.Color(0xffd08a);
const SMOKE = new THREE.Color(0x6a6660);
const BLACK = new THREE.Color(0x1b1b1c);

/**
 * Places batteries around a town: a ring on the outskirts plus a few inside,
 * always clear of the runway and its approach so a landing is still flyable.
 *
 * @param {number} half   town half-width
 * @param {number} count
 * @param {(x:number,z:number,pad:number)=>boolean} clear  airfield exclusion test
 */
export function flakSites(half, count, clear) {
  const sites = [];
  let guard = 0;
  while (sites.length < count && guard++ < count * 40) {
    // two thirds ring the town, one third sits among the buildings
    const inner = sites.length % 3 === 2;
    const r = inner ? Math.random() * half * 0.75 : half * (1.02 + Math.random() * 0.22);
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!clear(x, z, 200)) continue;
    if (sites.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 130 * 130)) continue;
    sites.push({ x, z, y: 0 });
  }
  return sites;
}
