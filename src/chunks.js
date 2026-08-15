import * as THREE from 'three';

/**
 * Endless procedural world for Free Flight.
 *
 * Space is divided into square chunks. Chunks within `RADIUS` of the aircraft
 * are built; ones that fall outside are torn down and their geometry returned
 * to the pool. Every chunk's contents come from a hash of its coordinates, so
 * the same patch of world is identical every time you fly back over it —
 * nothing is stored, and the world is effectively infinite.
 *
 * It exposes the same surface as `createWorld()` in world.js (buildings,
 * hazards, runway, surfaceAt/buildingAt/hazardAt) so the flight code does not
 * care which kind of world it is flying over.
 */

const CHUNK = 420;
const RADIUS = 3; // chunks loaded in each direction -> (2R+1)^2 live chunks
const LOT = 60;

/** Deterministic PRNG so a chunk always regenerates identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth-ish value noise, used to decide where towns and hills go. */
function valueNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const at = (i, j) => (hash2(i, j) % 1000) / 1000;
  const a = at(xi, zi);
  const b = at(xi + 1, zi);
  const c = at(xi, zi + 1);
  const d = at(xi + 1, zi + 1);
  const u = s(xf);
  const v = s(zf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

const FACADES = [0xa89f92, 0x8f9aa3, 0xb0857a, 0x9aa08d, 0xc2b7a4, 0x7f8a92];

function facadeTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d4cc';
  g.fillRect(0, 0, S, S);
  const n = 4;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const lit = Math.random();
      const v = lit > 0.78 ? 130 : lit > 0.4 ? 62 : 40;
      g.fillStyle = `rgb(${v},${v + 8},${v + 16})`;
      g.fillRect(x * cell + cell * 0.2, y * cell + cell * 0.22, cell * 0.6, cell * 0.44);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const FREEFLIGHT_ENV = {
  skyTop: 0x2f6fb0,
  skyHorizon: 0xbcd4e2,
  fogDensity: 0.00045,
  sunDir: [0.42, 0.62, -0.66],
  sunColor: 0xfff2dc,
  sunIntensity: 2.5,
  hemiSky: 0xbdd7ef,
  hemiGround: 0x4a5a3a,
  hemiIntensity: 1.15,
  ambient: 0.18,
  exposure: 1.05
};

export class ChunkWorld {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'world:freeflight';
    scene.add(this.group);

    this.map = {
      id: 'freeflight',
      name: 'Free Flight',
      night: false,
      env: FREEFLIGHT_ENV
    };

    this.chunks = new Map(); // "cx,cz" -> {group, buildings, hazards}
    this.buildings = [];
    this.hazards = [];

    /* shared assets — created once, reused by every chunk */
    this.facade = facadeTexture();
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.95 });
    this.roadMat = new THREE.MeshStandardMaterial({ color: 0x2f3235, roughness: 0.95 });
    this.trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 4, 5);
    this.trunkGeo.translate(0, 2, 0);
    this.leafGeo = new THREE.IcosahedronGeometry(2.6, 0);
    this.leafGeo.translate(0, 5.6, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95 });
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x3f6b34, roughness: 0.9, flatShading: true
    });
    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x6f6a5e, roughness: 1, flatShading: true
    });

    /* ground follows the aircraft rather than tiling per chunk */
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CHUNK * (RADIUS * 2 + 3), CHUNK * (RADIUS * 2 + 3)),
      new THREE.MeshStandardMaterial({ color: 0x5f7a45, roughness: 1 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    /* a home strip at the origin so Free Flight still has somewhere to land */
    this.runway = this.buildRunway();

    this.streets = { grid: 6, cell: LOT * 2, half: CHUNK / 2, road: 16 };
  }

  buildRunway() {
    const length = 320;
    const width = 32;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.92 })
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.07, 0);
    strip.receiveShadow = true;
    this.group.add(strip);

    for (let i = -1; i <= 1; i += 2) {
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, length),
        new THREE.MeshBasicMaterial({ color: 0xd9d6cc })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set((i * width) / 2 - i * 1.4, 0.08, 0);
      this.group.add(edge);
    }

    const forward = new THREE.Vector3(0, 0, -1);
    const side = new THREE.Vector3(1, 0, 0);
    const centre = new THREE.Vector3(0, 0, 0);
    const papi = [];

    return {
      x: 0, z: 0, length, width, axis: 'z', dir: -1, deck: 0,
      forward, side, centre, papi,
      touchdown: new THREE.Vector3(0, 0, length / 2 - 60),
      start: new THREE.Vector3(0, 0, length / 2 - 30),
      contains(p) {
        return Math.abs(p.x) < width / 2 + 5 && Math.abs(p.z) < length / 2;
      }
    };
  }

  /* ================= chunk lifecycle ================= */

  update(focus) {
    const cx = Math.round(focus.x / CHUNK);
    const cz = Math.round(focus.z / CHUNK);

    // keep the ground slab centred under the aircraft
    this.ground.position.set(cx * CHUNK, 0, cz * CHUNK);

    // build anything newly in range
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        if (!this.chunks.has(key)) this.buildChunk(cx + dx, cz + dz, key);
      }
    }

    // drop anything that has fallen out of range
    for (const [key, chunk] of this.chunks) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.abs(kx - cx) > RADIUS || Math.abs(kz - cz) > RADIUS) {
        this.dropChunk(key, chunk);
      }
    }
  }

  buildChunk(cx, cz, key) {
    const rand = mulberry32(hash2(cx, cz));
    const group = new THREE.Group();
    const buildings = [];
    const hazards = [];

    const ox = cx * CHUNK;
    const oz = cz * CHUNK;

    // never build on top of the home strip
    const isHome = cx === 0 && cz === 0;

    const density = valueNoise(cx * 0.35, cz * 0.35);
    const hilly = valueNoise(cx * 0.2 + 40, cz * 0.2 - 17);

    if (!isHome && density > 0.52) {
      /* ---- a town ---- */
      const cols = 5 + Math.floor(rand() * 3);
      const downtown = (density - 0.52) / 0.48; // 0..1, denser cores build taller
      const pitch = CHUNK / cols;

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
          if (rand() < 0.18) continue; // gaps and squares
          const bx = ox - CHUNK / 2 + pitch * (i + 0.5);
          const bz = oz - CHUNK / 2 + pitch * (j + 0.5);

          const w = pitch * (0.42 + rand() * 0.26);
          const d = pitch * (0.42 + rand() * 0.26);
          const centreBias = 1 - Math.hypot(i - cols / 2, j - cols / 2) / cols;
          const h = (8 + rand() * 20) * (1 + downtown * centreBias * 4);

          buildings.push(this.makeBuilding(group, bx, bz, w, d, h, rand));
        }
      }

      // road grid through the block
      for (let i = 0; i <= cols; i++) {
        const p = -CHUNK / 2 + i * pitch;
        const ew = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK, 14), this.roadMat);
        ew.rotation.x = -Math.PI / 2;
        ew.position.set(ox, 0.05, oz + p);
        group.add(ew);
        const ns = new THREE.Mesh(new THREE.PlaneGeometry(14, CHUNK), this.roadMat);
        ns.rotation.x = -Math.PI / 2;
        ns.position.set(ox + p, 0.06, oz);
        group.add(ns);
      }
    } else if (!isHome && hilly > 0.68) {
      /* ---- rocky outcrops ---- */
      const n = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const r = 28 + rand() * 55;
        const h = 60 + rand() * 160;
        const x = ox + (rand() - 0.5) * CHUNK * 0.8;
        const z = oz + (rand() - 0.5) * CHUNK * 0.8;
        const geo = new THREE.ConeGeometry(r, h, 8, 1);
        geo.translate(0, h / 2, 0);
        const mesh = new THREE.Mesh(geo, this.rockMat);
        mesh.position.set(x, 0, z);
        mesh.castShadow = true;
        group.add(mesh);
        hazards.push({ x, z, r, h, cone: true, geo });
      }
    }

    /* ---- trees everywhere else ---- */
    const treeCount = isHome ? 20 : Math.floor(24 + rand() * 46);
    const trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, treeCount);
    const leaves = new THREE.InstancedMesh(this.leafGeo, this.leafMat, treeCount);
    trunks.castShadow = leaves.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < treeCount; i++) {
      let x = ox + (rand() - 0.5) * CHUNK;
      let z = oz + (rand() - 0.5) * CHUNK;
      if (isHome && Math.abs(x) < 90 && Math.abs(z) < 260) x += 200; // keep off the strip
      const k = 0.75 + rand() * 0.7;
      p.set(x, 0, z);
      s.set(k, k * (0.85 + rand() * 0.4), k);
      q.setFromAxisAngle(UP, rand() * Math.PI);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    group.add(trunks, leaves);

    this.group.add(group);
    this.chunks.set(key, { group, buildings, hazards });
    this.buildings.push(...buildings);
    this.hazards.push(...hazards);
  }

  makeBuilding(group, x, z, w, d, h, rand) {
    const geo = new THREE.BoxGeometry(w, h, d);
    // repeat the facade at a constant world size instead of stretching it
    const uv = geo.attributes.uv;
    const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const su = Math.max(1, Math.round(spans[f][0] / 16));
      const sv = Math.max(1, Math.round(spans[f][1] / 16));
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
      }
    }
    geo.translate(0, h / 2, 0);

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        map: this.facade,
        color: FACADES[Math.floor(rand() * FACADES.length)],
        roughness: 0.85
      })
    );
    mesh.position.set(x, 0, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, 0.8, d * 1.04), this.roofMat);
    roof.position.set(x, h, z);
    group.add(roof);

    const maxHp = Math.round(40 + w * d * 0.35 + h * 5);
    return {
      mesh, roof, height: h,
      size: new THREE.Vector3(w, h, d),
      min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
      max: new THREE.Vector3(x + w / 2, h, z + d / 2),
      center: new THREE.Vector3(x, h / 2, z),
      alive: true, collapse: 0,
      hp: maxHp, maxHp,
      baseColor: mesh.material.color.clone(),
      burning: false,
      chunkKey: null
    };
  }

  dropChunk(key, chunk) {
    for (const b of chunk.buildings) {
      const i = this.buildings.indexOf(b);
      if (i >= 0) this.buildings.splice(i, 1);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      b.roof.geometry.dispose();
    }
    for (const h of chunk.hazards) {
      const i = this.hazards.indexOf(h);
      if (i >= 0) this.hazards.splice(i, 1);
      h.geo?.dispose();
    }
    chunk.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    chunk.group.removeFromParent();
    this.chunks.delete(key);
  }

  /* ================= the world interface ================= */

  surfaceAt() {
    return SURFACE;
  }

  buildingAt(p, pad = 0) {
    for (const b of this.buildings) {
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

  hazardAt(p) {
    for (const h of this.hazards) {
      if (p.y > h.h || p.y < 0) continue;
      const r = h.cone ? h.r * (1 - p.y / h.h) : h.r;
      const dx = p.x - h.x;
      const dz = p.z - h.z;
      if (dx * dx + dz * dz < r * r) return h;
    }
    return null;
  }

  dispose() {
    for (const [key, chunk] of [...this.chunks]) this.dropChunk(key, chunk);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material && !Array.isArray(o.material)) o.material.dispose();
      }
    });
    this.facade.dispose();
    this.trunkGeo.dispose();
    this.leafGeo.dispose();
    this.group.removeFromParent();
    this.buildings.length = 0;
    this.hazards.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const SURFACE = { y: 0, water: false };
