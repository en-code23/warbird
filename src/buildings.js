import * as THREE from 'three';

/**
 * Instanced building batch.
 *
 * Buildings used to be one Mesh + one roof Mesh each. A 237-building city was
 * therefore ~500 draw calls, doubled by the shadow pass — measured at 669 calls
 * a frame, which is most of a mobile frame budget in driver overhead alone.
 *
 * Every building is a box, so they all fit in two InstancedMeshes: one for the
 * facades and one for the roofs. A city is 2 draw calls, whatever its size.
 *
 * Two things made that non-obvious, and both are solved here:
 *
 *  - **Per-face UV tiling.** Window tiles must repeat at a constant world size
 *    rather than stretch with the building, which used to be baked per-geometry
 *    by rewriting the box's UVs. Instancing shares one geometry, so the tiling
 *    moves into the vertex shader and reads a per-instance size attribute.
 *
 *  - **Per-building state.** Collapsing scales and leans one building; gunfire
 *    scorches one facade. Both are per-instance writes (matrix and colour), so
 *    they stay independent — and only buildings that are actually changing get
 *    rewritten, rather than the whole buffer.
 *
 * Slots come from a free list so the endless world can add and drop chunks
 * without reallocating. Retired slots are parked at zero scale rather than
 * removed, which keeps every live index stable.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const ZERO = new THREE.Vector3(0, 0, 0);

/** Unit box pivoted at its base, so scaling Y collapses it downward. */
function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Rewrites the standard material's UV stage to tile from a per-instance size.
 *
 * The face normal picks which two of the instance's dimensions span this face,
 * and the tile count is that span rounded to whole tiles — matching what the
 * old per-geometry version did, so the cities look identical.
 */
function tileByInstanceSize(material, tile) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: tile };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute vec3 iSize;
        uniform float uTile;
        `
      )
      .replace(
        '#include <uv_vertex>',
        /* glsl */ `
        vec3 aN = abs(normal);
        vec2 span = aN.y > 0.5 ? vec2(iSize.x, iSize.z)
                  : aN.x > 0.5 ? vec2(iSize.z, iSize.y)
                  : vec2(iSize.x, iSize.y);
        vec2 tiledUv = uv * max(vec2(1.0), floor(span / uTile + 0.5));
        #ifdef USE_MAP
          vMapUv = tiledUv;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = tiledUv;
        #endif
        `
      );
  };
  // Any change to onBeforeCompile needs a distinct cache key, or three hands
  // back the program it compiled for a material that did not have this hook.
  material.customProgramCacheKey = () => `warbird-tiled-${tile}`;
  return material;
}

export class BuildingBatch {
  /**
   * @param {THREE.Object3D} parent  scene or chunk group to attach to
   * @param {object} opts
   * @param {number} opts.capacity     maximum simultaneous buildings
   * @param {THREE.Texture} opts.map   shared facade texture
   * @param {number} opts.tile         facade tile size in world units
   * @param {number} opts.roofColor
   * @param {boolean} opts.night       facade doubles as an emissive mask
   * @param {boolean} opts.shadows
   */
  constructor(parent, opts) {
    const capacity = opts.capacity;
    this.capacity = capacity;
    this.tile = opts.tile;

    const facadeMat = tileByInstanceSize(
      new THREE.MeshStandardMaterial({
        map: opts.map,
        roughness: 0.85,
        metalness: 0.02,
        ...(opts.night && opts.map
          ? { emissive: 0xffcb7a, emissiveMap: opts.map, emissiveIntensity: 0.55 }
          : {})
      }),
      opts.tile
    );

    const facadeGeo = unitBox();
    // Per-instance dimensions, read by the vertex shader to tile the facade.
    this.sizes = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    facadeGeo.setAttribute('iSize', this.sizes);

    this.facades = new THREE.InstancedMesh(facadeGeo, facadeMat, capacity);
    this.roofs = new THREE.InstancedMesh(
      unitBox(),
      new THREE.MeshStandardMaterial({ color: opts.roofColor, roughness: 0.95 }),
      capacity
    );

    for (const mesh of [this.facades, this.roofs]) {
      mesh.castShadow = !!opts.shadows;
      mesh.receiveShadow = !!opts.shadows;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The batch spans the whole city, so it is never off-screen as a whole.
      // Culling it per-instance is not possible and not worth it at 2 calls.
      mesh.frustumCulled = false;
    }

    // instanceColor has to exist before the first setColorAt, or three will not
    // define USE_INSTANCING_COLOR when it compiles the program
    _c.setHex(0xffffff);
    for (let i = 0; i < capacity; i++) this.facades.setColorAt(i, _c);
    this.facades.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // every slot starts parked
    _m.compose(ZERO, _q.identity(), ZERO);
    for (let i = 0; i < capacity; i++) {
      this.facades.setMatrixAt(i, _m);
      this.roofs.setMatrixAt(i, _m);
    }
    this.facades.instanceMatrix.needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;

    parent.add(this.facades, this.roofs);

    this.free = [];
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this._dirty = false;
    this._colorDirty = false;
  }

  /**
   * Claims a slot and returns a building record.
   * @returns {object|null} null when the batch is full
   */
  create(x, z, w, d, h, opts = {}) {
    const index = this.free.pop();
    if (index === undefined) return null;

    this.sizes.setXYZ(index, w, h, d);
    this.sizes.needsUpdate = true;

    const roofPad = opts.roofPad ?? 1.04;
    const roofThickness = opts.roofThickness ?? 0.8;
    // Structures on a raised deck (hangars on the Bayside causeway) sit above
    // y=0; everything else is grounded.
    const baseY = opts.baseY ?? 0;
    const maxHp = Math.round(40 + w * d * 0.35 + h * 5);
    const batch = this;

    const b = {
      batch,
      index,
      x,
      z,
      height: h,
      size: new THREE.Vector3(w, h, d),
      min: new THREE.Vector3(x - w / 2, baseY, z - d / 2),
      max: new THREE.Vector3(x + w / 2, baseY + h, z + d / 2),
      center: new THREE.Vector3(x, baseY + h / 2, z),
      alive: true,
      collapse: 0,
      // Strength scales with footprint and height, so a tower soaks up far more
      // gunfire than a shed. Bombs bypass this and destroy outright.
      hp: maxHp,
      maxHp,
      baseColor: new THREE.Color(opts.color ?? 0xffffff),
      burning: false,
      extras: null,
      chunkKey: null,
      _roofPad: roofPad,
      _roofThickness: roofThickness,

      /** Facade tint — gunfire scorches, collapse darkens. */
      setTint(color) {
        batch.facades.setColorAt(index, color);
        batch._colorDirty = true;
      },

      /**
       * Collapse pose.
       * @param {number} k  0 upright .. 1 flattened
       */
      setCollapse(k) {
        const s = 1 - 0.88 * (k * k * (3 - 2 * k)); // smoothstep
        // leans on two axes as it goes rather than sinking straight down
        _e.set(Math.cos(k * 3.3) * 0.04 * (1 - k), 0, Math.sin(k * 4) * 0.05 * (1 - k));
        _q.setFromEuler(_e);
        _p.set(x, baseY, z);
        _s.set(w, h * s, d);
        _m.compose(_p, _q, _s);
        batch.facades.setMatrixAt(index, _m);

        const roofScale = 1 - 0.25 * k;
        _p.set(x, baseY + h * s, z);
        _s.set(w * roofPad * roofScale, roofThickness, d * roofPad * roofScale);
        _m.compose(_p, _q, _s);
        batch.roofs.setMatrixAt(index, _m);

        batch._dirty = true;
        this.max.y = baseY + h * s;
        return s;
      },

      /** Sinks the roof out of sight once the building is fully down. */
      hideRoof() {
        _m.compose(ZERO, _q.identity(), ZERO);
        batch.roofs.setMatrixAt(index, _m);
        batch._dirty = true;
      },

      /** Returns the slot to the pool. Used when a chunk is dropped. */
      release() {
        _m.compose(ZERO, _q.identity(), ZERO);
        batch.facades.setMatrixAt(index, _m);
        batch.roofs.setMatrixAt(index, _m);
        batch._dirty = true;
        batch.free.push(index);
      }
    };

    b.setCollapse(0);
    if (opts.color !== undefined) b.setTint(b.baseColor);
    return b;
  }

  /** One upload per frame, and only if something actually moved. */
  flush() {
    if (this._dirty) {
      this.facades.instanceMatrix.needsUpdate = true;
      this.roofs.instanceMatrix.needsUpdate = true;
      this._dirty = false;
    }
    if (this._colorDirty) {
      this.facades.instanceColor.needsUpdate = true;
      this._colorDirty = false;
    }
  }

  setShadows(on) {
    this.facades.castShadow = this.roofs.castShadow = on;
    this.facades.receiveShadow = this.roofs.receiveShadow = on;
  }

  dispose() {
    for (const mesh of [this.facades, this.roofs]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
      mesh.removeFromParent();
    }
  }
}
