import * as THREE from 'three';

/**
 * Builds a playable world from a map definition (see maps.js) and tears it
 * down again. Returns:
 *
 *   group     everything in the scene for this map
 *   buildings destructible boxes with world-space AABBs
 *   hazards   indestructible terrain (buttes, peaks) with cylinder/cone tests
 *   runway    field geometry plus spawn, touchdown and PAPI data
 */

const UP = new THREE.Vector3(0, 1, 0);

/* ====================== textures ====================== */

function noise(g, S, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * alpha})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
}

function officeFacade(g, S) {
  g.fillStyle = '#d8d4cc';
  g.fillRect(0, 0, S, S);
  noise(g, S, 900, 0.05);
  const n = 4;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const lit = Math.random();
      const v = lit > 0.78 ? 130 : lit > 0.4 ? 62 : 40;
      g.fillStyle = `rgb(${v},${v + 8},${v + 16})`;
      g.fillRect(x * cell + cell * 0.2, y * cell + cell * 0.22, cell * 0.6, cell * 0.44);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x * cell + cell * 0.2, y * cell + cell * 0.22, cell * 0.6, cell * 0.07);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < n; y++) g.fillRect(0, y * cell + cell * 0.72, S, 3);
}

function adobeFacade(g, S) {
  g.fillStyle = '#e6d3b3';
  g.fillRect(0, 0, S, S);
  noise(g, S, 2600, 0.09);
  const n = 3;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (Math.random() < 0.35) continue; // plenty of blank wall
      const w = cell * 0.26;
      const h = cell * 0.3;
      g.fillStyle = '#4a3a2a';
      g.fillRect(x * cell + cell * 0.37, y * cell + cell * 0.3, w, h);
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.fillRect(x * cell + cell * 0.34, y * cell + cell * 0.26, w + cell * 0.06, 3);
    }
    // projecting roof beams
    g.fillStyle = 'rgba(90,60,35,0.35)';
    g.fillRect(0, y * cell + cell * 0.86, S, 5);
  }
}

function chaletFacade(g, S) {
  g.fillStyle = '#e2d6bf';
  g.fillRect(0, 0, S, S);
  noise(g, S, 700, 0.05);
  // horizontal boarding
  g.fillStyle = 'rgba(120,90,60,0.16)';
  for (let y = 0; y < S; y += 10) g.fillRect(0, y, S, 3);
  const n = 3;
  const cell = S / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const wx = x * cell + cell * 0.3;
      const wy = y * cell + cell * 0.28;
      const w = cell * 0.4;
      const h = cell * 0.34;
      g.fillStyle = '#3c4a52';
      g.fillRect(wx, wy, w, h);
      g.fillStyle = '#8a5a3c'; // shutters
      g.fillRect(wx - cell * 0.09, wy, cell * 0.08, h);
      g.fillRect(wx + w + cell * 0.01, wy, cell * 0.08, h);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(wx, wy + h, w, 3);
    }
  }
}

function facadeTexture(style) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (style === 'adobe') adobeFacade(g, S);
  else if (style === 'chalet') chaletFacade(g, S);
  else officeFacade(g, S);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function runwayTexture() {
  const W = 64;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d40';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.fillStyle = '#d9d6cc';
  g.fillRect(4, 0, 3, H);
  g.fillRect(W - 7, 0, 3, H);
  for (let y = 20; y < H - 20; y += 64) g.fillRect(W / 2 - 2, y, 4, 34);
  for (let i = 0; i < 5; i++) {
    g.fillRect(12 + i * 9, 16, 5, 60);
    g.fillRect(12 + i * 9, H - 76, 5, 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function cloudTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.62;
    const y = S / 2 + (Math.random() - 0.5) * S * 0.34;
    const r = S * (0.09 + Math.random() * 0.15);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ====================== geometry helpers ====================== */

/**
 * BoxGeometry UVs are 0..1 per face. Scale each face's UVs so the facade tile
 * repeats at a constant world size instead of stretching with the building.
 * Face order: +X, -X, +Y, -Y, +Z, -Z (4 vertices each).
 */
function tileBoxUVs(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const su = Math.max(1, Math.round(spans[f][0] / tile));
    const sv = Math.max(1, Math.round(spans[f][1] / tile));
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  }
  uv.needsUpdate = true;
}

function makeBuilding(x, z, w, d, h, opts) {
  const geo = new THREE.BoxGeometry(w, h, d);
  tileBoxUVs(geo, w, h, d, opts.tile);
  geo.translate(0, h / 2, 0); // pivot at the base so collapse scales downward

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: opts.map,
      color: opts.color,
      roughness: 0.85,
      metalness: 0.02,
      // On night maps the facade texture doubles as an emissive mask, so the
      // window rectangles in it glow while the surrounding wall stays dark.
      ...(opts.night && opts.map
        ? { emissive: 0xffcb7a, emissiveMap: opts.map, emissiveIntensity: 0.55 }
        : {})
    })
  );
  mesh.position.set(x, 0, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.04, opts.roofThickness ?? 0.8, d * 1.04),
    opts.roofMat
  );
  roof.position.set(x, h, z);
  roof.castShadow = true;

  const maxHp = Math.round(40 + w * d * 0.35 + h * 5);

  return {
    mesh,
    roof,
    height: h,
    size: new THREE.Vector3(w, h, d),
    min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
    max: new THREE.Vector3(x + w / 2, h, z + d / 2),
    center: new THREE.Vector3(x, h / 2, z),
    alive: true,
    collapse: 0,
    // Structural strength scales with footprint and height, so a tower soaks up
    // far more gunfire than a shed. Bomb blasts bypass this and destroy outright.
    hp: maxHp,
    maxHp,
    baseColor: mesh.material.color.clone(),
    burning: false
  };
}

function scatterInstances(count, geoA, matA, geoB, matB, placer) {
  const out = [];
  const a = new THREE.InstancedMesh(geoA, matA, count);
  a.castShadow = true;
  out.push(a);
  const b = geoB ? new THREE.InstancedMesh(geoB, matB, count) : null;
  if (b) {
    b.castShadow = true;
    out.push(b);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    placer(p);
    const k = 0.75 + Math.random() * 0.7;
    s.set(k, k * (0.85 + Math.random() * 0.45), k);
    q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
    m.compose(p, q, s);
    a.setMatrixAt(i, m);
    if (b) b.setMatrixAt(i, m);
  }
  a.instanceMatrix.needsUpdate = true;
  if (b) b.instanceMatrix.needsUpdate = true;
  return out;
}

function vegetation(kind) {
  if (kind === 'pine') {
    const trunk = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
    trunk.translate(0, 1.75, 0);
    const canopy = new THREE.ConeGeometry(2.4, 9, 7);
    canopy.translate(0, 7, 0);
    return [
      trunk, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
      canopy, new THREE.MeshStandardMaterial({ color: 0x2f4a30, roughness: 0.9, flatShading: true })
    ];
  }
  if (kind === 'cactus') {
    const body = new THREE.CapsuleGeometry(0.7, 5, 3, 7);
    body.translate(0, 3.2, 0);
    const arm = new THREE.CapsuleGeometry(0.45, 2.2, 3, 6);
    arm.translate(1.5, 4.2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4b6b3a, roughness: 0.85 });
    return [body, mat, arm, mat];
  }
  const trunk = new THREE.CylinderGeometry(0.4, 0.55, 4, 6);
  trunk.translate(0, 2, 0);
  const canopy = new THREE.IcosahedronGeometry(2.6, 0);
  canopy.translate(0, 5.6, 0);
  return [
    trunk, new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95 }),
    canopy, new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.9, flatShading: true })
  ];
}

/* ====================== the builder ====================== */

export function createWorld(map) {
  const group = new THREE.Group();
  group.name = `world:${map.id}`;
  const buildings = [];
  const hazards = [];

  const t = map.town;
  const CELL = t.block + t.road;
  const TOWN_HALF = (t.grid * CELL) / 2;

  const facade = facadeTexture(t.style);
  const roofMat = new THREE.MeshStandardMaterial({ color: t.roofColor, roughness: 0.95 });
  const asphalt = new THREE.MeshStandardMaterial({ color: t.roadColor, roughness: 0.95 });
  const tile = t.style === 'office' ? 16 : 12;

  /* ---------- ground ---------- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshStandardMaterial({ color: map.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  /* ---------- water ---------- */
  if (map.water) {
    const w = map.water;
    const depth = 3500 - w.at;
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(7000, depth),
      new THREE.MeshStandardMaterial({
        color: w.color,
        roughness: 0.16,
        metalness: 0.45,
        transparent: true,
        opacity: w.opacity
      })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, w.level, w.at + depth / 2);
    group.add(sea);
  }

  /* ---------- roads ---------- */
  const roadSpan = t.grid * CELL + t.road;
  for (let i = 0; i <= t.grid; i++) {
    const p = -TOWN_HALF + i * CELL;
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(roadSpan, t.road), asphalt);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.05, p);
    ew.receiveShadow = true;
    group.add(ew);

    const ns = new THREE.Mesh(new THREE.PlaneGeometry(t.road, roadSpan), asphalt);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(p, 0.06, 0);
    ns.receiveShadow = true;
    group.add(ns);
  }

  /* ---------- blocks ---------- */
  for (let i = 0; i < t.grid; i++) {
    for (let j = 0; j < t.grid; j++) {
      const bx = -TOWN_HALF + t.road / 2 + i * CELL + t.block / 2;
      const bz = -TOWN_HALF + t.road / 2 + j * CELL + t.block / 2;

      if (t.park && t.park[0] === i && t.park[1] === j) {
        const lawn = new THREE.Mesh(
          new THREE.PlaneGeometry(t.block, t.block),
          new THREE.MeshStandardMaterial({ color: t.lawnColor, roughness: 1 })
        );
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(bx, 0.08, bz);
        lawn.receiveShadow = true;
        group.add(lawn);
        const [ga, ma, gb, mb] = vegetation(map.scatter?.[0]?.kind ?? 'tree');
        for (const inst of scatterInstances(24, ga, ma, gb, mb, (p) =>
          p.set(
            bx + (Math.random() - 0.5) * t.block * 0.85,
            0,
            bz + (Math.random() - 0.5) * t.block * 0.85
          )
        )) {
          group.add(inst);
        }
        continue;
      }

      const downtown = Math.max(0, 1 - (Math.hypot(bx, bz) / TOWN_HALF) * 1.25);
      const lots = Math.random() < t.bigLotChance ? 1 : 2;
      const step = t.block / lots;

      for (let a = 0; a < lots; a++) {
        for (let b = 0; b < lots; b++) {
          if (lots === 2 && Math.random() < t.vacancy) continue;
          const pad = 3 + Math.random() * 4;
          const w = step - pad;
          const d = step - pad;
          const h = (t.minH + Math.random() * (t.maxH - t.minH)) * (1 + downtown * t.downtown);
          const x = bx - t.block / 2 + step * (a + 0.5);
          const z = bz - t.block / 2 + step * (b + 0.5);

          const bld = makeBuilding(x, z, w, d, h, {
            map: facade,
            color: t.facades[(Math.random() * t.facades.length) | 0],
            roofMat,
            tile,
            night: !!map.night,
            roofThickness: t.style === 'chalet' ? 1.6 : 0.8
          });
          group.add(bld.mesh, bld.roof);
          buildings.push(bld);

          if (h > 45) {
            const mast = new THREE.Mesh(
              new THREE.CylinderGeometry(0.25, 0.35, 12, 6),
              new THREE.MeshStandardMaterial({ color: 0xcc4433, roughness: 0.7 })
            );
            mast.position.set(x, h + 6, z);
            bld.extras = [mast];
            group.add(mast);
          }
        }
      }
    }
  }

  /* ---------- airfield ---------- */
  const r = map.runway;
  const forward = new THREE.Vector3();
  if (r.axis === 'z') forward.set(0, 0, r.dir);
  else forward.set(r.dir, 0, 0);
  const side = new THREE.Vector3().crossVectors(UP, forward); // left of the nose
  const centre = new THREE.Vector3(r.x, 0, r.z);

  const toWorld = (along, across, y = 0) =>
    new THREE.Vector3(
      centre.x + forward.x * along + side.x * across,
      y,
      centre.z + forward.z * along + side.z * across
    );

  // a box sized in runway-local terms, still axis-aligned in world space
  const localBox = (alongLen, acrossLen) =>
    r.axis === 'z' ? [acrossLen, alongLen] : [alongLen, acrossLen];

  /**
   * True when (x, z) is far enough from the field to drop scenery there.
   * Covers the strip itself, the long approach corridor off the landing end,
   * and a shorter climb-out corridor — a peak on short final is not "hard",
   * it just makes the field unusable.
   */
  const clearOfField = (x, z, pad) => {
    const along = (x - centre.x) * forward.x + (z - centre.z) * forward.z;
    const across = Math.abs((x - centre.x) * side.x + (z - centre.z) * side.z);
    const half = r.length / 2;
    const onStrip = Math.abs(along) < half + pad && across < r.width / 2 + pad;
    const onApproach = along < -half && along > -(half + 950) && across < 170 + pad;
    const onClimbOut = along > half && along < half + 550 && across < 140 + pad;
    return !(onStrip || onApproach || onClimbOut);
  };

  // causeway platform when the field sits out over the water
  let pad = null;
  if (map.water && r.z > map.water.at) {
    const [cw, cd] = localBox(r.length + 90, r.width + 70);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(cw, 2.2, cd),
      new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.95 })
    );
    slab.position.set(r.x, 1.1, r.z);
    slab.receiveShadow = true;
    group.add(slab);
    pad = { x: r.x, z: r.z, hx: cw / 2, hz: cd / 2 };

    // link road back to the shore
    const link = new THREE.Mesh(new THREE.BoxGeometry(16, 2, r.z - map.water.at + 40), asphalt);
    link.position.set(r.x, 1.0, (r.z + map.water.at) / 2 - 20);
    group.add(link);
  }

  // Collision deck: only a causeway actually raises the surface. On land maps
  // the strip is painted just above the ground and collides at zero.
  const deck = pad ? 2.25 : 0;
  const stripY = pad ? deck : 0.07;

  const stripGroup = new THREE.Group();
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(r.width, r.length),
    new THREE.MeshStandardMaterial({ map: runwayTexture(), roughness: 0.92 })
  );
  strip.rotation.x = -Math.PI / 2;
  strip.receiveShadow = true;
  stripGroup.add(strip);
  stripGroup.rotation.y = r.axis === 'x' ? Math.PI / 2 : 0;
  stripGroup.position.set(r.x, stripY, r.z);
  group.add(stripGroup);

  // apron + hangars, laid out in runway-local coordinates
  const [aw, ad] = localBox(70, 46);
  const apronPos = toWorld(-40, -(r.width / 2 + 34), stripY - 0.01);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.12, ad), asphalt);
  apron.position.copy(apronPos);
  group.add(apron);

  for (let i = 0; i < (r.hangars ?? 1); i++) {
    const hp = toWorld(-20 + i * 34, -(r.width / 2 + 34));
    const [hw, hd] = localBox(22, 30);
    const hangar = makeBuilding(hp.x, hp.z, hw, hd, 11, {
      map: null,
      color: 0x6c7378,
      roofMat,
      tile
    });
    hangar.min.y = deck;
    hangar.max.y += deck;
    hangar.mesh.position.y = deck;
    hangar.roof.position.y = 11 + deck;
    group.add(hangar.mesh, hangar.roof);
    buildings.push(hangar);
  }

  /* ---------- approach lights (PAPI) ---------- */
  const touchdown = toWorld(-(r.length / 2 - 60), 0, deck);
  const papiGeo = new THREE.SphereGeometry(0.85, 10, 8);
  const papi = [];
  // innermost unit switches at the highest angle: 4 white = high, 4 red = low
  const ANGLES = [4.6, 4.2, 3.8, 3.4];
  for (let i = 0; i < 4; i++) {
    const p = toWorld(-(r.length / 2 - 60), r.width / 2 + 9 + i * 4.5, deck + 1.1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(papiGeo, material);
    mesh.position.copy(p);
    group.add(mesh);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a3f42 })
    );
    post.position.set(p.x, deck + 0.55, p.z);
    group.add(post);

    papi.push({ mesh, material, angle: ANGLES[i] });
  }

  /* ---------- terrain hazards ---------- */
  const rock = map.mesas ?? map.mountains;
  if (rock) {
    const isCone = !!map.mountains;
    const rockMat = new THREE.MeshStandardMaterial({
      color: rock.color,
      roughness: 1,
      flatShading: true
    });
    const snowMat = rock.snow
      ? new THREE.MeshStandardMaterial({ color: rock.snow, roughness: 0.85, flatShading: true })
      : null;

    for (let i = 0; i < rock.count; i++) {
      const radius = rock.minR + Math.random() * (rock.maxR - rock.minR);
      const height = rock.minH + Math.random() * (rock.maxH - rock.minH);

      // ring placement, kept off the runway and its approach corridor
      let x, z, tries = 0;
      do {
        const a = Math.random() * Math.PI * 2;
        const dist = rock.ring[0] + Math.random() * (rock.ring[1] - rock.ring[0]);
        x = Math.cos(a) * dist;
        z = Math.sin(a) * dist;
        tries++;
      } while (tries < 60 && !clearOfField(x, z, radius + 60));

      if (!clearOfField(x, z, radius + 60)) continue; // never block the field

      const geo = isCone
        ? new THREE.ConeGeometry(radius, height, 9, 1)
        : new THREE.CylinderGeometry(radius * 0.78, radius, height, 9, 1);
      geo.translate(0, height / 2, 0);
      const mesh = new THREE.Mesh(geo, rockMat);
      mesh.position.set(x, 0, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);

      if (snowMat && height > 300) {
        const capH = height * 0.34;
        const cap = new THREE.ConeGeometry(radius * 0.35, capH, 9, 1);
        cap.translate(0, height - capH / 2, 0);
        const capMesh = new THREE.Mesh(cap, snowMat);
        capMesh.position.set(x, 0, z);
        group.add(capMesh);
      }

      hazards.push({ x, z, r: isCone ? radius : radius * 0.94, h: height, cone: isCone });
    }
  }

  /* ---------- harbour ---------- */
  if (map.piers) {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.95 });
    for (let i = 0; i < map.piers; i++) {
      const px = -260 + i * 150 + (Math.random() - 0.5) * 30;
      const len = 90 + Math.random() * 70;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(18, 2, len), deckMat);
      pier.position.set(px, 1.4, map.water.at + len / 2);
      pier.receiveShadow = true;
      group.add(pier);

      const shed = makeBuilding(px, map.water.at - 26, 30, 22, 12, {
        map: facade,
        color: 0x8d8577,
        roofMat,
        tile,
        night: !!map.night
      });
      group.add(shed.mesh, shed.roof);
      buildings.push(shed);

      // a ship alongside
      if (i % 2 === 0) {
        const hull = new THREE.Mesh(
          new THREE.BoxGeometry(14, 9, 62),
          new THREE.MeshStandardMaterial({ color: 0x33404a, roughness: 0.7, metalness: 0.3 })
        );
        hull.position.set(px + 26, 3, map.water.at + len * 0.55);
        hull.castShadow = true;
        group.add(hull);
        const house = new THREE.Mesh(
          new THREE.BoxGeometry(11, 8, 14),
          new THREE.MeshStandardMaterial({ color: 0xcdc8bd, roughness: 0.8 })
        );
        house.position.set(px + 26, 11, map.water.at + len * 0.55 + 16);
        group.add(house);
      }
    }
  }

  /* ---------- scatter ---------- */
  for (const s of map.scatter ?? []) {
    const [ga, ma, gb, mb] = vegetation(s.kind);
    const [ox, oz] = s.offset ?? [0, 0];
    for (const inst of scatterInstances(s.count, ga, ma, gb, mb, (p) => {
      let x, z, tries = 0;
      do {
        x = (Math.random() - 0.5) * s.spread + ox;
        z = (Math.random() - 0.5) * s.spread + oz;
        tries++;
      } while (
        tries < 30 &&
        ((Math.abs(x) < TOWN_HALF + 40 && Math.abs(z) < TOWN_HALF + 40) ||
          !clearOfField(x, z, 40) ||
          (map.water && z > map.water.at - 20))
      );
      p.set(x, 0, z);
    })) {
      group.add(inst);
    }
  }

  /* ---------- clouds ---------- */
  const cl = map.env.clouds;
  if (cl) {
    const cloudMat = new THREE.SpriteMaterial({
      map: cloudTexture(),
      color: cl.color,
      transparent: true,
      opacity: cl.opacity,
      depthWrite: false,
      fog: true
    });
    for (let i = 0; i < cl.count; i++) {
      const s = new THREE.Sprite(cloudMat);
      const k = 160 + Math.random() * 340;
      s.scale.set(k, k * (0.35 + Math.random() * 0.2), 1);
      s.position.set(
        (Math.random() - 0.5) * 3600,
        cl.baseY + Math.random() * cl.spread,
        (Math.random() - 0.5) * 3600
      );
      group.add(s);
    }
  }

  /* ---------- runway record ---------- */
  const runway = {
    ...r,
    deck,
    forward,
    side,
    centre,
    papi,
    touchdown,
    start: toWorld(-(r.length / 2 - 30), 0, deck),
    townHalf: TOWN_HALF,
    contains(p) {
      const along = (p.x - centre.x) * forward.x + (p.z - centre.z) * forward.z;
      const across = (p.x - centre.x) * side.x + (p.z - centre.z) * side.z;
      return Math.abs(along) < r.length / 2 && Math.abs(across) < r.width / 2 + 5;
    }
  };

  /**
   * Surface under a point: the causeway deck, open water, or plain ground.
   * Ditching in water is not survivable, so the flight code needs to tell
   * these apart rather than just asking for a height.
   */
  const surfaceAt = (p) => {
    if (pad && Math.abs(p.x - pad.x) < pad.hx && Math.abs(p.z - pad.z) < pad.hz) {
      return { y: deck, water: false };
    }
    if (map.water && p.z > map.water.at) {
      return { y: map.water.level, water: true };
    }
    return { y: 0, water: false };
  };

  /** Destructible box containing `p`, grown by `pad`. */
  const buildingAt = (p, pad = 0) => {
    for (const b of buildings) {
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
  };

  /** Indestructible terrain: buttes are cylinders, peaks are cones. */
  const hazardAt = (p) => {
    for (const h of hazards) {
      if (p.y > h.h || p.y < 0) continue;
      const rr = h.cone ? h.r * (1 - p.y / h.h) : h.r;
      const dx = p.x - h.x;
      const dz = p.z - h.z;
      if (dx * dx + dz * dz < rr * rr) return h;
    }
    return null;
  };

  return {
    map,
    group,
    buildings,
    hazards,
    runway,
    surfaceAt,
    buildingAt,
    hazardAt,
    /** street layout, so the crowd knows where the pavements are */
    streets: { grid: t.grid, cell: CELL, half: TOWN_HALF, road: t.road }
  };
}

/* ====================== teardown ====================== */

export function disposeWorld(world) {
  if (!world) return;
  const geometries = new Set();
  const materials = new Set();

  world.group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
  });

  for (const m of materials) {
    for (const key of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap']) {
      if (m[key]) m[key].dispose();
    }
    m.dispose();
  }
  for (const g of geometries) g.dispose();

  world.group.removeFromParent();
  world.buildings.length = 0;
  world.hazards.length = 0;
}
