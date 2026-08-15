import * as THREE from 'three';

/**
 * Procedural aircraft model.
 *
 * The whole model is built here so the rest of the sim only ever touches
 * createPlane(). Swapping in a Blender export is a one-function change:
 * load the .glb, orient it nose-down -Z, and return the same shape of object
 * ({ group, propeller, propDisc, hardpoints }). See README.
 *
 * Convention: nose points down -Z, wings span X, up is +Y. Length ~9 units.
 */

const OLIVE = 0x4b5d3a;
const OLIVE_DARK = 0x39482d;
const CREAM = 0xb9b295;
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

function fuselage() {
  // (radius, distance from nose) profile, lathed around Y then laid along Z.
  const profile = [
    [0.05, 0.0],
    [0.34, 0.25],
    [0.62, 0.9],
    [0.78, 1.9],
    [0.82, 3.2],
    [0.72, 4.6],
    [0.52, 6.2],
    [0.32, 7.6],
    [0.20, 8.6],
    [0.04, 8.9]
  ];
  const geo = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    22
  );
  geo.rotateX(Math.PI / 2); // +Y (nose->tail) becomes +Z, so nose sits at -Z
  geo.translate(0, 0, -3.4);
  return geo;
}

function propeller() {
  const group = new THREE.Group();

  const hub = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.85, 16),
    mat(0x8e2f27, { roughness: 0.4, metalness: 0.35 })
  );
  hub.rotation.x = -Math.PI / 2;
  hub.position.z = -0.3;
  group.add(hub);

  const bladeGeo = new THREE.BoxGeometry(0.16, 2.5, 0.05);
  bladeGeo.translate(0, 1.25, 0);
  const bladeMat = mat(0x24262a, { roughness: 0.45 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (i / 3) * Math.PI * 2;
    blade.rotation.y = 0.35; // pitch
    group.add(blade);
  }

  return group;
}

function wheel(radius) {
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, radius * 0.72, 14),
    mat(RUBBER, { roughness: 0.9, metalness: 0.0 })
  );
  tyre.rotation.z = Math.PI / 2;
  return tyre;
}

function gearLeg(x, z, strutLen, radius) {
  const leg = new THREE.Group();
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, strutLen, 8),
    mat(METAL, { metalness: 0.6, roughness: 0.4 })
  );
  strut.position.y = -strutLen / 2;
  leg.add(strut);

  const w = wheel(radius);
  w.position.y = -strutLen;
  leg.add(w);

  leg.position.set(x, -0.45, z);
  return leg;
}

export function createPlane() {
  const group = new THREE.Group();
  group.name = 'plane';

  const bodyMat = mat(OLIVE);
  const bellyMat = mat(CREAM, { roughness: 0.7 });
  const wingMat = mat(OLIVE, { side: THREE.DoubleSide });
  const trimMat = mat(OLIVE_DARK);

  // --- fuselage ---
  const body = new THREE.Mesh(fuselage(), bodyMat);
  group.add(body);

  // underside stripe
  const belly = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.18, 6.4),
    bellyMat
  );
  belly.position.set(0, -0.62, 0.3);
  group.add(belly);

  // engine cowl ring
  const cowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.66, 0.6, 0.9, 18, 1, true),
    mat(0x8e2f27, { side: THREE.DoubleSide, roughness: 0.45, metalness: 0.4 })
  );
  cowl.rotation.x = Math.PI / 2;
  cowl.position.z = -2.9;
  group.add(cowl);

  // --- wings ---
  const wingGeo = liftingSurface(5.6, 2.9, 1.5, 0.55, 0.3);
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeo, wingMat);
    wing.scale.x = side;
    wing.position.set(0, -0.22, -0.25);
    wing.rotation.z = side * 0.09; // dihedral
    group.add(wing);

    // roundel
    const roundel = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 20),
      new THREE.MeshStandardMaterial({ color: 0x2b4f8e, roughness: 0.6 })
    );
    roundel.rotation.x = -Math.PI / 2;
    roundel.position.set(side * 3.4, -0.03, -0.1);
    group.add(roundel);

    // bomb rack
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 1.5), trimMat);
    rack.position.set(side * 2.1, -0.5, -0.2);
    group.add(rack);
  }

  // --- tail ---
  const stabGeo = liftingSurface(2.0, 1.5, 0.85, 0.25, 0.2);
  for (const side of [1, -1]) {
    const stab = new THREE.Mesh(stabGeo, wingMat);
    stab.scale.x = side;
    stab.position.set(0, 0.12, 4.5);
    group.add(stab);
  }

  const finShape = new THREE.Shape();
  finShape.moveTo(-0.2, 0);
  finShape.lineTo(1.6, 0);
  finShape.lineTo(1.5, 1.7);
  finShape.lineTo(0.55, 1.75);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.06,
    bevelSegments: 2
  });
  finGeo.translate(0, 0, -0.08);
  const fin = new THREE.Mesh(finGeo, wingMat);
  fin.rotation.y = Math.PI / 2;
  fin.position.set(0, 0.3, 4.3);
  group.add(fin);

  // --- canopy ---
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x9fd8e8,
      transparent: true,
      opacity: 0.42,
      roughness: 0.12,
      metalness: 0.1
    })
  );
  canopy.scale.set(0.95, 0.85, 1.9);
  canopy.position.set(0, 0.5, 0.7);
  group.add(canopy);

  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.3), trimMat);
  headrest.position.set(0, 0.62, 1.9);
  group.add(headrest);

  // --- landing gear ---
  const gear = new THREE.Group();
  gear.add(gearLeg(1.35, -0.9, 0.95, 0.36));
  gear.add(gearLeg(-1.35, -0.9, 0.95, 0.36));
  const tailLeg = gearLeg(0, 4.6, 0.42, 0.18);
  tailLeg.position.y = -0.15;
  gear.add(tailLeg);
  group.add(gear);

  // --- propeller ---
  const prop = propeller();
  prop.position.z = -3.5;
  group.add(prop);

  // blur disc that fades in with RPM
  const propDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.5, 28),
    new THREE.MeshBasicMaterial({
      color: 0xbfc6cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  propDisc.position.z = -3.55;
  group.add(propDisc);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    propeller: prop,
    propDisc,
    gear,
    /** local-space points bombs fall from */
    hardpoints: [new THREE.Vector3(-2.1, -0.7, -0.2), new THREE.Vector3(2.1, -0.7, -0.2)],
    /** local-space eye point for cockpit view */
    eye: new THREE.Vector3(0, 0.62, 0.35)
  };
}
