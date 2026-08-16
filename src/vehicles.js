import * as THREE from 'three';

/**
 * Street traffic.
 *
 * Cars drive the same road grid the crowd walks, one lane either side of each
 * centreline, turning at random at intersections. Like the pedestrians they
 * live in InstancedMeshes — a body and a roof — so a city full of traffic is
 * two draw calls, not two hundred.
 *
 * They are worth points, they burn when hit, and a bomb in a junction takes out
 * everything in it. Aircraft do not collide with them; you fly over.
 */

const UP = new THREE.Vector3(0, 1, 0);
const HIT_RADIUS = 1.9;

const PAINT = [
  0x2f3a45, 0x6b3630, 0x39503a, 0x8a7a52, 0x4a4550,
  0x7d3f45, 0x2c4a5a, 0x6d6459, 0x8e8b84
];

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Vector3(0, 0, 0);

export class Vehicles {
  /**
   * @param {THREE.Object3D} parent
   * @param {object} opts {count, grid, cell, half, road, effects}
   */
  constructor(parent, opts) {
    const count = opts.count ?? 80;
    this.count = count;
    this.effects = opts.effects;

    /* ---- lanes: one each way down every road centreline ---- */
    this.lanes = [];
    const { grid, cell, half, road } = opts;
    const laneOff = road * 0.13; // keep-right offset from the centreline
    for (let i = 0; i <= grid; i++) {
      const p = -half + i * cell;
      // running along Z
      this.lanes.push({ x: p + laneOff, z: -half, dx: 0, dz: 1, len: half * 2 });
      this.lanes.push({ x: p - laneOff, z: half, dx: 0, dz: -1, len: half * 2 });
      // running along X
      this.lanes.push({ x: -half, z: p - laneOff, dx: 1, dz: 0, len: half * 2 });
      this.lanes.push({ x: half, z: p + laneOff, dx: -1, dz: 0, len: half * 2 });
    }
    this.half = half;
    this.cell = cell;
    this.gridOrigin = -half;

    /* ---- state ---- */
    this.pos = new Float32Array(count * 3);
    this.dir = new Float32Array(count * 2);
    this.speed = new Float32Array(count);
    this.alive = new Uint8Array(count);
    this.nextTurn = new Float32Array(count);

    /* ---- meshes ---- */
    const bodyGeo = new THREE.BoxGeometry(2.0, 1.15, 4.4);
    bodyGeo.translate(0, 0.6, 0);
    const roofGeo = new THREE.BoxGeometry(1.75, 0.85, 2.1);
    roofGeo.translate(0, 1.55, -0.15);

    this.bodies = new THREE.InstancedMesh(
      bodyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 }),
      count
    );
    this.roofs = new THREE.InstancedMesh(
      roofGeo,
      new THREE.MeshStandardMaterial({ color: 0x1d2429, roughness: 0.3, metalness: 0.2 }),
      count
    );

    for (const mesh of [this.bodies, this.roofs]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
    }
    this.bodies.castShadow = !!opts.shadows;

    for (let i = 0; i < count; i++) {
      _c.setHex(PAINT[(Math.random() * PAINT.length) | 0]);
      this.bodies.setColorAt(i, _c);
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;

    parent.add(this.bodies, this.roofs);

    for (let i = 0; i < count; i++) this.respawn(i);
    this.aliveCount = count;
    this.visible = true;
  }

  respawn(i) {
    const lane = this.lanes[(Math.random() * this.lanes.length) | 0];
    const along = Math.random() * lane.len;
    this.pos[i * 3] = lane.x + lane.dx * along;
    this.pos[i * 3 + 1] = 0;
    this.pos[i * 3 + 2] = lane.z + lane.dz * along;
    this.dir[i * 2] = lane.dx;
    this.dir[i * 2 + 1] = lane.dz;
    this.speed[i] = 7 + Math.random() * 7;
    this.alive[i] = 1;
    this.nextTurn[i] = 2 + Math.random() * 8;
  }

  /** Everything inside the blast. @returns number destroyed */
  blast(point, radius) {
    let hit = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const dx = this.pos[i * 3] - point.x;
      const dy = this.pos[i * 3 + 1] - point.y;
      const dz = this.pos[i * 3 + 2] - point.z;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      this.destroy(i);
      hit++;
    }
    return hit;
  }

  /** Nearest car along a ray. @returns {{t:number,index:number}|null} */
  rayHit(origin, dir, maxT) {
    let bestT = maxT;
    let best = -1;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const ex = this.pos[i * 3] - origin.x;
      const ey = this.pos[i * 3 + 1] + 0.8 - origin.y;
      const ez = this.pos[i * 3 + 2] - origin.z;
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

  destroy(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.aliveCount--;
    _v.set(this.pos[i * 3], this.pos[i * 3 + 1] + 0.8, this.pos[i * 3 + 2]);
    // a car going up is a small fuel fire, not a building collapse
    this.effects?.explode(_v, { radius: 3.4, debris: 8, smoke: 5 });
  }

  update(dt, focus) {
    // Traffic is only legible below a few hundred feet. Above that, stop
    // uploading the instance buffers entirely rather than just hiding them.
    const visible = !focus || focus.y < 420;
    if (!visible) {
      if (this.visible) {
        this.visible = false;
        this.bodies.visible = this.roofs.visible = false;
      }
      return;
    }
    if (!this.visible) {
      this.visible = true;
      this.bodies.visible = this.roofs.visible = true;
    }

    const lim = this.half + 40;

    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        _m.compose(ZERO, _q.identity(), ZERO);
        this.bodies.setMatrixAt(i, _m);
        this.roofs.setMatrixAt(i, _m);
        continue;
      }

      let dx = this.dir[i * 2];
      let dz = this.dir[i * 2 + 1];

      // Turning happens near a junction: snap to the crossing centreline so the
      // car does not cut the corner across the pavement.
      this.nextTurn[i] -= dt;
      if (this.nextTurn[i] <= 0) {
        this.nextTurn[i] = 4 + Math.random() * 10;
        const x = this.pos[i * 3];
        const z = this.pos[i * 3 + 2];
        const gx = Math.round((x - this.gridOrigin) / this.cell) * this.cell + this.gridOrigin;
        const gz = Math.round((z - this.gridOrigin) / this.cell) * this.cell + this.gridOrigin;
        if (Math.abs(x - gx) < 6 && Math.abs(z - gz) < 6) {
          const turn = Math.random() < 0.5 ? 1 : -1;
          const ndx = -dz * turn;
          const ndz = dx * turn;
          this.pos[i * 3] = gx;
          this.pos[i * 3 + 2] = gz;
          dx = ndx;
          dz = ndz;
          this.dir[i * 2] = dx;
          this.dir[i * 2 + 1] = dz;
        }
      }

      const x = this.pos[i * 3] + dx * this.speed[i] * dt;
      const z = this.pos[i * 3 + 2] + dz * this.speed[i] * dt;
      if (Math.abs(x) > lim || Math.abs(z) > lim) {
        this.respawn(i);
        continue;
      }
      this.pos[i * 3] = x;
      this.pos[i * 3 + 2] = z;

      _q.setFromAxisAngle(UP, Math.atan2(dx, dz));
      _v.set(x, 0, z);
      _s.set(1, 1, 1);
      _m.compose(_v, _q, _s);
      this.bodies.setMatrixAt(i, _m);
      this.roofs.setMatrixAt(i, _m);
    }

    this.bodies.instanceMatrix.needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.bodies, this.roofs]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
      mesh.removeFromParent();
    }
  }
}
