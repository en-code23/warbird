import * as THREE from 'three';

/**
 * Street crowd.
 *
 * People walk the road grid on fixed lanes, turning at intersections. Everyone
 * lives in two InstancedMeshes (body and head), so a few hundred pedestrians
 * cost two draw calls rather than several hundred.
 *
 * They are cosmetic to the aircraft — no collision — but they can be shot, and
 * they scatter from explosions, which is what makes a city feel inhabited.
 */

const UP = new THREE.Vector3(0, 1, 0);
const BODY_H = 1.7;
const HIT_RADIUS = 0.75;

const SHIRTS = [0x3f5f8a, 0x8a4a3f, 0x4a6b4a, 0x6b5a8a, 0x8a7a3f, 0x3f6b6b, 0x7a3f5a];

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();

export class Pedestrians {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts {count, grid, cell, half, road, effects}
   */
  constructor(scene, opts) {
    const count = opts.count ?? 240;
    this.count = count;
    this.effects = opts.effects;
    this.scene = scene;

    // lanes: one per road centreline, offset to either kerb
    this.lanes = [];
    const { grid, cell, half, road } = opts;
    const kerb = road * 0.28;
    const extent = half;
    for (let i = 0; i <= grid; i++) {
      const p = -half + i * cell;
      for (const off of [-kerb, kerb]) {
        // lanes running along Z at x = p
        this.lanes.push({ x: p + off, z: -extent, dx: 0, dz: 1, len: extent * 2 });
        // lanes running along X at z = p
        this.lanes.push({ x: -extent, z: p + off, dx: 1, dz: 0, len: extent * 2 });
      }
    }

    /* ---- state arrays ---- */
    this.pos = new Float32Array(count * 3);
    this.dir = new Float32Array(count * 2); // dx, dz
    this.speed = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.alive = new Uint8Array(count);
    this.panic = new Float32Array(count);

    /* ---- meshes ---- */
    const bodyGeo = new THREE.CapsuleGeometry(0.28, BODY_H * 0.55, 3, 6);
    bodyGeo.translate(0, BODY_H * 0.48, 0);
    const headGeo = new THREE.SphereGeometry(0.22, 7, 5);
    headGeo.translate(0, BODY_H * 0.92, 0);

    this.bodies = new THREE.InstancedMesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      count
    );
    this.heads = new THREE.InstancedMesh(
      headGeo,
      new THREE.MeshStandardMaterial({ color: 0xc9a48a, roughness: 0.85 }),
      count
    );
    this.bodies.castShadow = true;
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // per-person shirt colour
    const colour = new THREE.Color();
    for (let i = 0; i < count; i++) {
      colour.setHex(SHIRTS[(Math.random() * SHIRTS.length) | 0]);
      this.bodies.setColorAt(i, colour);
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;

    scene.add(this.bodies, this.heads);

    for (let i = 0; i < count; i++) this.respawn(i);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this.aliveCount = count;
  }

  respawn(i) {
    const lane = this.lanes[(Math.random() * this.lanes.length) | 0];
    const along = Math.random() * lane.len;
    this.pos[i * 3] = lane.x + lane.dx * along;
    this.pos[i * 3 + 1] = 0;
    this.pos[i * 3 + 2] = lane.z + lane.dz * along;
    const back = Math.random() < 0.5 ? -1 : 1;
    this.dir[i * 2] = lane.dx * back;
    this.dir[i * 2 + 1] = lane.dz * back;
    this.speed[i] = 1.1 + Math.random() * 0.9;
    this.phase[i] = Math.random() * Math.PI * 2;
    this.alive[i] = 1;
    this.panic[i] = 0;
  }

  /** Everyone within `radius` of `point` starts running. */
  scare(point, radius = 90) {
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const dx = this.pos[i * 3] - point.x;
      const dz = this.pos[i * 3 + 2] - point.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      this.panic[i] = 1;
      // turn away from the blast
      const d = Math.sqrt(d2) || 1;
      if (Math.abs(this.dir[i * 2]) > 0.5) {
        this.dir[i * 2] = Math.sign(dx / d) || 1;
      } else {
        this.dir[i * 2 + 1] = Math.sign(dz / d) || 1;
      }
    }
  }

  /** Kill everyone inside a blast. @returns number killed */
  blast(point, radius) {
    let killed = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const dx = this.pos[i * 3] - point.x;
      const dy = this.pos[i * 3 + 1] - point.y;
      const dz = this.pos[i * 3 + 2] - point.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      this.alive[i] = 0;
      killed++;
    }
    if (killed) this.aliveCount -= killed;
    this.scare(point, radius * 2.4);
    return killed;
  }

  /**
   * Closest pedestrian along a ray, if any is nearer than `maxT`.
   * @returns {{t:number,index:number}|null}
   */
  rayHit(origin, dir, maxT) {
    let bestT = maxT;
    let best = -1;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const cx = this.pos[i * 3];
      const cy = this.pos[i * 3 + 1] + BODY_H * 0.55;
      const cz = this.pos[i * 3 + 2];

      const ex = cx - origin.x;
      const ey = cy - origin.y;
      const ez = cz - origin.z;
      const b = ex * dir.x + ey * dir.y + ez * dir.z;
      if (b < 0 || b > bestT) continue;
      const c = ex * ex + ey * ey + ez * ez - HIT_RADIUS * HIT_RADIUS;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = b - Math.sqrt(disc);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = i;
      }
    }
    return best >= 0 ? { t: bestT, index: best } : null;
  }

  kill(i, point) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.aliveCount--;
    this.effects?.spark(
      _v.set(this.pos[i * 3], this.pos[i * 3 + 1] + 1, this.pos[i * 3 + 2]),
      _e.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4),
      0.8,
      0.2
    );
    if (point) this.scare(point, 34);
  }

  update(dt, focus) {
    const m = this._m;
    const q = this._q;
    const s = this._s;

    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        // parked far below the map rather than removed, so the instance index
        // stays stable and the buffer never needs rebuilding
        m.makeTranslation(0, -9999, 0);
        this.bodies.setMatrixAt(i, m);
        this.heads.setMatrixAt(i, m);
        continue;
      }

      if (this.panic[i] > 0) this.panic[i] = Math.max(0, this.panic[i] - dt * 0.22);
      const speed = this.speed[i] * (1 + this.panic[i] * 2.2);

      let x = this.pos[i * 3] + this.dir[i * 2] * speed * dt;
      let z = this.pos[i * 3 + 2] + this.dir[i * 2 + 1] * speed * dt;

      // wrap back onto the grid rather than wandering off into the fields
      const lim = this.lanes[0] ? 2200 : 2200;
      if (Math.abs(x) > lim || Math.abs(z) > lim) {
        this.respawn(i);
        continue;
      }

      this.pos[i * 3] = x;
      this.pos[i * 3 + 2] = z;
      this.phase[i] += dt * speed * 3.4;

      // a small vertical bob sells the walk cycle at almost no cost
      const bob = Math.sin(this.phase[i]) * 0.05;
      const heading = Math.atan2(this.dir[i * 2], this.dir[i * 2 + 1]);
      q.setFromAxisAngle(UP, heading);
      s.set(1, 1 + bob * 0.4, 1);
      _v.set(x, bob, z);
      m.compose(_v, q, s);
      this.bodies.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
    }

    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;

    // crowds are only worth drawing when the player is low enough to see them
    const visible = !focus || focus.y < 320;
    this.bodies.visible = visible;
    this.heads.visible = visible;
  }

  dispose() {
    this.bodies.geometry.dispose();
    this.bodies.material.dispose();
    this.heads.geometry.dispose();
    this.heads.material.dispose();
    this.bodies.removeFromParent();
    this.heads.removeFromParent();
  }
}
