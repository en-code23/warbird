import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPlane } from './plane.js';

/**
 * Blender-built airframes.
 *
 * `tools/build_planes.py` exports one GLB per aircraft from the same catalogue
 * specs the shop reads, using the node names this module looks for:
 *
 *   HULL      fuselage, scoop, exhausts, headrest   (hidden in cockpit view)
 *   GLASS     canopy                                (hidden in cockpit view)
 *   AIRFRAME  wings, tail, nacelles, gear, guns, racks
 *   PROP_n    one per propeller, spun about its own Z
 *   EYE / MUZZLE_n / HARD_L / HARD_R / DISC_n / GEARBOTTOM   marker empties
 *
 * Everything here degrades: if a GLB is missing, slow or malformed, callers get
 * the procedural airframe from plane.js instead. A model download failing on a
 * phone should cost you detail, not the sortie.
 *
 * Geometry and materials are shared between clones of the same type — a lobby
 * of eight Falcons uploads one set of buffers. That makes disposal a hazard, so
 * every shared resource is flagged and `disposePlane()` is the only thing that
 * should ever free one.
 */

const MODEL_URL = (id) => new URL(`../assets/models/${id}.glb`, import.meta.url).href;

const loader = new GLTFLoader();
/** @type {Map<string, THREE.Object3D>} parsed templates, cloned per aircraft */
const templates = new Map();
/** @type {Map<string, Promise<THREE.Object3D|null>>} in-flight loads */
const inflight = new Map();
/** ids we have already failed on, so we stop retrying every respawn */
const failed = new Set();

/**
 * Loads and caches one airframe. Resolves to null on any failure — callers are
 * expected to fall back rather than treat this as fatal.
 * @param {string} id catalogue plane id
 */
export function preloadPlane(id) {
  if (!id || failed.has(id)) return Promise.resolve(null);
  if (templates.has(id)) return Promise.resolve(templates.get(id));
  if (inflight.has(id)) return inflight.get(id);

  const job = new Promise((resolve) => {
    loader.load(
      MODEL_URL(id),
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          // Flag every buffer that came out of the template. Clones point at
          // these same objects, so nothing may dispose them per-aircraft.
          o.userData.shared = true;
          o.geometry.userData.shared = true;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (!m) continue;
            m.userData.shared = true;
            if (m.name === 'glass') {
              m.transparent = true;
              m.depthWrite = false;
              m.side = THREE.DoubleSide;
            }
          }
          if (o.name === 'GLASS') o.castShadow = false;
        });
        templates.set(id, root);
        inflight.delete(id);
        resolve(root);
      },
      undefined,
      () => {
        failed.add(id);
        inflight.delete(id);
        resolve(null);
      }
    );
  });

  inflight.set(id, job);
  return job;
}

/** True once `id` can be built synchronously. */
export function planeReady(id) {
  return templates.has(id);
}

/**
 * Frees an aircraft's scene graph, leaving shared template buffers alone.
 * @param {{group: THREE.Object3D}} plane
 */
export function disposePlane(plane) {
  const group = plane?.group ?? plane;
  if (!group) return;
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry?.userData?.shared) o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !m.userData?.shared) m.dispose();
    }
  });
  group.removeFromParent();
}

/** Marker empties carry their meaning in the node name. */
function markers(group) {
  const found = new Map();
  group.traverse((o) => {
    if (o.name) found.set(o.name, o);
  });
  return found;
}

/**
 * Builds an aircraft from the loaded GLB, matching the object contract that
 * `createPlane` returns so callers cannot tell which path produced it.
 */
function assemble(template, spec, opts) {
  const group = template.clone(true);
  group.name = 'plane';
  const node = markers(group);

  const s = spec.model ?? spec;
  const radius = s.length * 0.093;

  const hideInCockpit = [];
  for (const name of ['HULL', 'GLASS']) {
    const o = node.get(name);
    if (o) {
      o.userData.hideInCockpit = true;
      hideInCockpit.push(o);
    }
  }

  // Propellers, and the translucent disc that stands in for one at speed. The
  // disc is built here rather than exported: it needs its own material per
  // aircraft because its opacity is animated, and a shared one would fade
  // every aircraft in the lobby at once.
  const propellers = [];
  const propDiscs = [];
  for (let i = 0; ; i++) {
    const prop = node.get(`PROP_${i}`);
    if (!prop) break;
    propellers.push(prop);

    const marker = node.get(`DISC_${i}`);
    if (!marker) continue;
    const discRadius = Math.abs(marker.scale.x) || s.span * 0.3;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(discRadius, 26),
      new THREE.MeshBasicMaterial({
        color: 0xbfc6cc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    disc.position.copy(marker.position);
    group.add(disc);
    propDiscs.push(disc);
  }

  const muzzles = [];
  const wanted = opts.guns ?? 4;
  for (let i = 0; i < wanted; i++) {
    const m = node.get(`MUZZLE_${i}`);
    if (m) muzzles.push(m.position.clone());
  }

  const hardpoints = [];
  for (const name of ['HARD_L', 'HARD_R']) {
    const h = node.get(name);
    if (h) hardpoints.push(h.position.clone());
  }

  const ground = node.get('GEARBOTTOM');
  const eye = node.get('EYE');

  const noseZ = -s.length * 0.38;
  const tailZ = s.length * 0.62;
  const wingZ = -s.length * 0.03;

  return {
    group,
    propellers,
    propDiscs,
    hideInCockpit,
    propeller: propellers[0] ?? new THREE.Group(),
    propDisc: propDiscs[0] ?? { material: { opacity: 0 } },
    hardpoints: hardpoints.length
      ? hardpoints
      : [new THREE.Vector3(-s.span * 0.38, -0.7, wingZ),
         new THREE.Vector3(s.span * 0.38, -0.7, wingZ)],
    muzzles: muzzles.length
      ? muzzles
      : [new THREE.Vector3(0, -0.18, noseZ)],
    eye: eye ? eye.position.clone() : new THREE.Vector3(0, radius * 1.05, s.length * 0.14),
    dimensions: { length: s.length, span: s.span, radius },
    gearHeight: ground ? Math.abs(ground.position.y) : 0.45 + radius * 1.57,
    hull: [
      new THREE.Vector3(0, 0, noseZ),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, tailZ * 0.85),
      new THREE.Vector3(-s.span * 0.96, 0, wingZ),
      new THREE.Vector3(s.span * 0.96, 0, wingZ)
    ]
  };
}

/**
 * The one call sites should use. Returns the Blender airframe when it is
 * loaded and the procedural one otherwise, and kicks off a load either way so
 * the next aircraft of this type gets the good model.
 *
 * @param {object} spec full catalogue entry (needs `.id` and `.model`)
 * @param {object} [opts] { guns }
 */
export function buildPlane(spec, opts = {}) {
  const template = templates.get(spec.id);
  if (template) return assemble(template, spec, opts);
  preloadPlane(spec.id);
  return createPlane(spec.model, opts);
}
