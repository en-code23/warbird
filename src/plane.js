import * as THREE from 'three';

/**
 * Aircraft model factory.
 *
 * `createPlane(spec)` builds a complete airframe from a catalogue entry's
 * `model` block, so one function covers everything from a single-engine trainer
 * to a four-engine heavy bomber. Nothing outside this file knows how the
 * aircraft is constructed — see HANDOFF.md for the contract if you are
 * replacing this with Blender exports.
 *
 * Convention: nose points down -Z, wings span X, up is +Y.
 */

const METAL = 0x5a5f63;
const RUBBER = 0x1b1c1e;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.62,
    metalness: 0.18,
    ...opts
  });
}

/** Trapezoidal lifting surface: root chord at x=0, tip chord at x=span. */
function liftingSurface(span, rootChord, tipChord, sweep, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -rootChord * 0.6);
  shape.lineTo(0, rootChord * 0.4);
  shape.lineTo(span, sweep + tipChord * 0.4);
  shape.lineTo(span, sweep - tipChord * 0.6);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.4,
    bevelSize: thickness * 0.45,
    bevelSegments: 2
  });
  // shape-X -> span (X), shape-Y -> chord (-Z), extrude -> thickness (Y)
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -thickness / 2, 0);
  return geo;
}

/** Lathed body: a radius profile from nose (0) to tail (length), laid along Z. */
function fuselage(length, radius) {
  const profile = [
    [0.06, 0.00], [0.40, 0.03], [0.73, 0.10], [0.92, 0.21],
    [1.00, 0.36], [0.88, 0.52], [0.63, 0.70], [0.39, 0.85],
    [0.24, 0.96], [0.05, 1.00]
  ];
  const geo = new THREE.LatheGeometry(
    profile.map(([r, t]) => new THREE.Vector2(r * radius, t * length)),
    22
  );
  geo.rotateX(Math.PI / 2); // nose->tail runs +Z, so the nose sits at -Z
  geo.translate(0, 0, -length * 0.38);
  return geo;
}

function propeller(radius, spinnerColor) {
  const group = new THREE.Group();

  const hub = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.12, radius * 0.34, 16),
    mat(spinnerColor, { roughness: 0.4, metalness: 0.35 })
  );
  hub.rotation.x = -Math.PI / 2;
  hub.position.z = -radius * 0.12;
  group.add(hub);

  const bladeGeo = new THREE.BoxGeometry(radius * 0.064, radius, 0.05);
  bladeGeo.translate(0, radius / 2, 0);
  const bladeMat = mat(0x24262a, { roughness: 0.45 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.y = 0.35; // blade pitch
    group.add(blade);
  }
  return group;
}

function gearLeg(x, z, strutLen, wheelR) {
  const leg = new THREE.Group();
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, strutLen, 8),
    mat(METAL, { metalness: 0.6, roughness: 0.4 })
  );
  strut.position.y = -strutLen / 2;
  leg.add(strut);

  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(wheelR, wheelR, wheelR * 0.72, 14),
    mat(RUBBER, { roughness: 0.9, metalness: 0 })
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.y = -strutLen;
  leg.add(wheel);

  leg.position.set(x, -0.45, z);
  return leg;
}

/** Podded engine nacelle for multi-engine types. */
function nacelle(x, z, radius, len, jet) {
  const pod = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * (jet ? 0.86 : 0.78), len, 14),
    mat(jet ? 0x4a5257 : METAL, { metalness: 0.5, roughness: 0.45 })
  );
  shell.rotation.x = Math.PI / 2;
  pod.add(shell);

  if (jet) {
    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.7, radius * 0.5, len * 0.25, 12),
      mat(0x2a2e31, { metalness: 0.7, roughness: 0.35 })
    );
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = len * 0.6;
    pod.add(exhaust);
  }

  pod.position.set(x, -0.25, z);
  return pod;
}

/** Translucent disc that fades in with RPM to suggest a spinning propeller. */
function addPropDisc(group, radius, z, x = 0, y = 0) {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({
      color: 0xbfc6cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  disc.position.set(x, y, z);
  group.add(disc);
  return disc;
}

function finShape(height, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.2, 0);
  shape.lineTo(chord, 0);
  shape.lineTo(chord * 0.94, height);
  shape.lineTo(chord * 0.34, height * 1.03);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.06,
    bevelSegments: 2
  });
  geo.translate(0, 0, -0.08);
  return geo;
}

/**
 * @param {object} spec   a PLANES[].model block from catalog.js
 * @param {object} [opts] { guns: number } — how many gun mounts to fit
 */
export function createPlane(spec, opts = {}) {
  const s = {
    length: 9, span: 5.6, chord: 2.9, tail: 'single', engines: 1,
    body: 0x4b5d3a, trim: 0xb9b295, wing: 0x4b5d3a, spinner: 0x8e2f27,
    jet: false,
    ...spec
  };
  const gunMounts = opts.guns ?? 4;

  const group = new THREE.Group();
  group.name = 'plane';

  const bodyMat = mat(s.body);
  const trimMat = mat(s.trim, { roughness: 0.7 });
  const wingMat = mat(s.wing, { side: THREE.DoubleSide });
  const darkMat = mat(0x2b2f33);

  const radius = s.length * 0.093;
  const noseZ = -s.length * 0.38;
  const tailZ = s.length * 0.62;
  const wingZ = -s.length * 0.03;

  /* ---------- fuselage ---------- */
  group.add(new THREE.Mesh(fuselage(s.length, radius), bodyMat));

  const belly = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 1.4, 0.18, s.length * 0.7),
    trimMat
  );
  belly.position.set(0, -radius * 0.78, s.length * 0.03);
  group.add(belly);

  /* ---------- wings ---------- */
  const wingGeo = liftingSurface(s.span, s.chord, s.chord * 0.52, s.chord * 0.19, 0.3);
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.scale.x = side;
    wing.position.set(0, -0.22, wingZ);
    wing.rotation.z = side * 0.09; // dihedral
    group.add(wing);

    const roundel = new THREE.Mesh(
      new THREE.CircleGeometry(s.span * 0.093, 20),
      mat(0x2b4f8e, { roughness: 0.6 })
    );
    roundel.rotation.x = -Math.PI / 2;
    roundel.position.set(side * s.span * 0.6, -0.03, wingZ + 0.15);
    group.add(roundel);
  }

  /* ---------- engines ---------- */
  const propellers = [];
  const propDiscs = [];

  if (s.engines === 1 && !s.jet) {
    const cowl = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.82, radius * 0.75, 0.9, 18, 1, true),
      mat(s.spinner, { side: THREE.DoubleSide, roughness: 0.45, metalness: 0.4 })
    );
    cowl.rotation.x = Math.PI / 2;
    cowl.position.z = noseZ + 0.55;
    group.add(cowl);

    const prop = propeller(s.span * 0.45, s.spinner);
    prop.position.z = noseZ - 0.1;
    group.add(prop);
    propellers.push(prop);
    propDiscs.push(addPropDisc(group, s.span * 0.45, noseZ - 0.15));
  } else {
    const perSide = Math.max(1, Math.round(s.engines / 2));
    const podLen = s.length * (s.jet ? 0.34 : 0.3);
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        const x = side * s.span * (0.32 + i * 0.3);
        group.add(nacelle(x, wingZ - podLen * 0.15, radius * 0.5, podLen, s.jet));

        if (!s.jet) {
          const prop = propeller(s.span * 0.26, s.spinner);
          prop.position.set(x, -0.25, wingZ - podLen * 0.7);
          group.add(prop);
          propellers.push(prop);
          propDiscs.push(addPropDisc(group, s.span * 0.26, wingZ - podLen * 0.72, x, -0.25));
        }
      }
    }
    if (s.jet) {
      const intake = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.7, radius * 0.82, 0.7, 16, 1, true),
        mat(0x21262a, { side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 })
      );
      intake.rotation.x = Math.PI / 2;
      intake.position.z = noseZ + 0.4;
      group.add(intake);
    }
  }

  /* ---------- tail ---------- */
  const stabSpan = s.span * 0.36;
  const stabGeo = liftingSurface(stabSpan, s.chord * 0.52, s.chord * 0.3, 0.25, 0.2);
  for (const side of [1, -1]) {
    const stab = new THREE.Mesh(stabGeo, wingMat);
    stab.scale.x = side;
    stab.position.set(0, 0.12, tailZ - s.length * 0.11);
    group.add(stab);
  }

  const finGeo = finShape(s.length * 0.19, s.length * 0.19);
  if (s.tail === 'twin') {
    for (const side of [1, -1]) {
      const fin = new THREE.Mesh(finGeo, wingMat);
      fin.rotation.y = Math.PI / 2;
      fin.position.set(side * stabSpan * 0.92, 0.2, tailZ - s.length * 0.13);
      group.add(fin);
    }
  } else {
    const fin = new THREE.Mesh(finGeo, wingMat);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(0, 0.3, tailZ - s.length * 0.14);
    group.add(fin);
  }

  /* ---------- canopy ---------- */
  const canopyZ = s.length * 0.08;
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.78, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x9fd8e8,
      transparent: true,
      opacity: 0.4,
      roughness: 0.12,
      metalness: 0.1
    })
  );
  canopy.scale.set(0.95, 0.9, 2.1);
  canopy.position.set(0, radius * 0.62, canopyZ);
  group.add(canopy);

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.3), darkMat);
  headrest.position.set(0, radius * 0.78, canopyZ + s.length * 0.13);
  group.add(headrest);

  /* ---------- gun mounts ---------- */
  const muzzles = [];
  for (let i = 0; i < gunMounts; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const slot = Math.floor(i / 2);
    const x = side * s.span * (0.3 + slot * 0.16);
    const y = -0.18;
    const z = wingZ - s.chord * 0.55;

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 1.1, 8),
      mat(0x1e2124, { metalness: 0.7, roughness: 0.35 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, y, z - 0.2);
    group.add(barrel);

    muzzles.push(new THREE.Vector3(x, y, z - 0.8));
  }

  /* ---------- bomb racks ---------- */
  const hardpoints = [];
  for (const side of [-1, 1]) {
    const x = side * s.span * 0.38;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 1.5), darkMat);
    rack.position.set(x, -0.5, wingZ);
    group.add(rack);
    hardpoints.push(new THREE.Vector3(x, -0.72, wingZ));
  }

  /* ---------- landing gear ---------- */
  const strut = radius * 1.15;
  group.add(gearLeg(s.span * 0.24, wingZ - 0.6, strut, radius * 0.42));
  group.add(gearLeg(-s.span * 0.24, wingZ - 0.6, strut, radius * 0.42));
  const tailLeg = gearLeg(0, tailZ - s.length * 0.06, strut * 0.42, radius * 0.2);
  tailLeg.position.y = -0.15;
  group.add(tailLeg);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    propellers,
    propDiscs,
    /** convenience aliases for callers that only care about the main engine */
    propeller: propellers[0] ?? new THREE.Group(),
    propDisc: propDiscs[0] ?? { material: { opacity: 0 } },
    hardpoints,
    muzzles,
    /** local-space eye point for the cockpit view */
    eye: new THREE.Vector3(0, radius * 0.62, canopyZ - s.length * 0.02),
    dimensions: { length: s.length, span: s.span, radius },
    gearHeight: 0.45 + strut + radius * 0.42,
    /** hull sample points for collision, derived from the actual airframe */
    hull: [
      new THREE.Vector3(0, 0, noseZ),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, tailZ * 0.85),
      new THREE.Vector3(-s.span * 0.96, 0, wingZ),
      new THREE.Vector3(s.span * 0.96, 0, wingZ)
    ]
  };
}
