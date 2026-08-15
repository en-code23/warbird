import * as THREE from 'three';

/**
 * Pooled particle effects: fireballs, ground shockwaves, tumbling debris and
 * smoke puffs. Everything is allocated up front — nothing is added to or
 * removed from the scene graph at runtime, so explosions never trigger a
 * shader recompile or a GC spike mid-flight.
 */

function puffTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const V = new THREE.Vector3();
const T = new THREE.Vector3();
const P = new THREE.Vector3();
const V0 = new THREE.Vector3(0, 0, 0);

const FIRE_HOT = new THREE.Color(0xfff0b0);
const FIRE_COOL = new THREE.Color(0xd93a12);
const SMOKE_LIGHT = new THREE.Color(0x9a938c);
const SMOKE_DARK = new THREE.Color(0x2a2724);

function pick(pool) {
  for (const p of pool) if (p.life <= 0) return p;
  // all busy: steal the oldest
  let oldest = pool[0];
  for (const p of pool) if (p.t / p.life > oldest.t / oldest.life) oldest = p;
  return oldest;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;

    const ballGeo = new THREE.IcosahedronGeometry(1, 2);
    const ringGeo = new THREE.RingGeometry(0.55, 1, 36);
    ringGeo.rotateX(-Math.PI / 2);
    const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
    const puffTex = puffTexture();

    this.fireballs = Array.from({ length: 30 }, () => {
      const m = new THREE.Mesh(
        ballGeo,
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      m.visible = false;
      scene.add(m);
      return { m, t: 0, life: 0, r: 1 };
    });

    this.rings = Array.from({ length: 14 }, () => {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffd68a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        })
      );
      m.visible = false;
      scene.add(m);
      return { m, t: 0, life: 0, r: 1 };
    });

    const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, roughness: 0.95 });
    this.debris = Array.from({ length: 300 }, () => {
      const m = new THREE.Mesh(debrisGeo, debrisMat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      return { m, t: 0, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() };
    });

    this.puffs = Array.from({ length: 460 }, () => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0, depthWrite: false })
      );
      s.visible = false;
      scene.add(s);
      return {
        s,
        t: 0,
        life: 0,
        r0: 1,
        r1: 6,
        peak: 0.5,
        vel: new THREE.Vector3(),
        from: new THREE.Color(),
        to: new THREE.Color()
      };
    });

    // Lights are created once and only ever change intensity/position.
    this.lights = Array.from({ length: 4 }, () => {
      const l = new THREE.PointLight(0xff9840, 0, 260, 2);
      scene.add(l);
      return { l, t: 0, life: 0, power: 0 };
    });
  }

  /* ---------- spawners ---------- */

  puff(pos, opts = {}) {
    const p = pick(this.puffs);
    p.t = 0;
    p.life = opts.life ?? 1.6 + Math.random() * 1.2;
    p.r0 = opts.r0 ?? 2;
    p.r1 = opts.r1 ?? 9;
    p.from.copy(opts.from ?? SMOKE_LIGHT);
    p.to.copy(opts.to ?? SMOKE_DARK);
    p.peak = opts.opacity ?? 0.55;
    p.s.position.copy(pos); // copy before touching shared temporaries
    p.vel.copy(opts.vel ?? V0).add(
      T.set((Math.random() - 0.5) * 4, Math.random() * 3 + 1.5, (Math.random() - 0.5) * 4)
    );
    p.s.material.rotation = Math.random() * Math.PI * 2;
    p.s.visible = true;
    return p;
  }

  spark(pos, vel, life = 1.2, size = 0.6) {
    const d = pick(this.debris);
    d.t = 0;
    d.life = life;
    d.vel.copy(vel);
    d.spin.set(
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12
    );
    d.m.position.copy(pos);
    d.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    const s = size * (0.5 + Math.random());
    d.m.scale.set(s, s * (0.4 + Math.random()), s * (0.6 + Math.random()));
    d.m.visible = true;
    return d;
  }

  /**
   * @param {THREE.Vector3} pos
   * @param {object} opts  radius, debris count, smoke amount
   */
  explode(pos, opts = {}) {
    const R = opts.radius ?? 16;
    const nDebris = opts.debris ?? 26;
    const nSmoke = opts.smoke ?? 14;

    // layered fireballs of slightly different size and timing
    for (let i = 0; i < 3; i++) {
      const f = pick(this.fireballs);
      f.t = -i * 0.045;
      f.life = 0.5 + i * 0.16;
      f.r = R * (0.45 + i * 0.22);
      f.m.position.copy(pos).add(
        V.set((Math.random() - 0.5) * R * 0.3, Math.random() * R * 0.25, (Math.random() - 0.5) * R * 0.3)
      );
      f.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      f.m.visible = true;
    }

    // ground shockwave
    const ring = pick(this.rings);
    ring.t = 0;
    ring.life = 0.75;
    ring.r = R * 2.6;
    ring.m.position.set(pos.x, 0.6, pos.z);
    ring.m.visible = true;

    // flash
    const lg = pick(this.lights);
    lg.t = 0;
    lg.life = 0.55;
    lg.power = R * 70;
    lg.l.position.copy(pos);

    // debris
    for (let i = 0; i < nDebris; i++) {
      const dir = V.set(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.5 + 0.35,
        (Math.random() - 0.5) * 2
      )
        .normalize()
        .multiplyScalar(R * (0.9 + Math.random() * 1.8));
      this.spark(pos, dir, 1.6 + Math.random() * 1.8, R * 0.075);
    }

    // smoke
    for (let i = 0; i < nSmoke; i++) {
      this.puff(
        P.set(
          pos.x + (Math.random() - 0.5) * R,
          pos.y + Math.random() * R * 0.5,
          pos.z + (Math.random() - 0.5) * R
        ),
        {
          r0: R * 0.35,
          r1: R * (1.1 + Math.random()),
          life: 2 + Math.random() * 2.4,
          from: FIRE_HOT,
          to: SMOKE_DARK,
          opacity: 0.7
        }
      );
    }
  }

  /** Lingering fire/smoke column, called repeatedly for burning wreckage. */
  burn(pos, intensity = 1) {
    if (Math.random() < 0.55 * intensity) {
      this.puff(pos, {
        r0: 2 + Math.random() * 3,
        r1: 12 + Math.random() * 10,
        life: 3 + Math.random() * 2.5,
        from: Math.random() < 0.3 ? FIRE_COOL : SMOKE_LIGHT,
        to: SMOKE_DARK,
        opacity: 0.4,
        vel: V0
      });
    }
  }

  /** Kill everything in flight — used when swapping maps. */
  reset() {
    for (const f of this.fireballs) { f.life = 0; f.m.visible = false; }
    for (const r of this.rings) { r.life = 0; r.m.visible = false; }
    for (const d of this.debris) { d.life = 0; d.m.visible = false; }
    for (const p of this.puffs) { p.life = 0; p.s.visible = false; }
    for (const lg of this.lights) { lg.life = 0; lg.l.intensity = 0; }
  }

  /* ---------- update ---------- */

  update(dt) {
    const g = 34;

    for (const f of this.fireballs) {
      if (f.life <= 0) continue;
      f.t += dt;
      if (f.t < 0) continue;
      const k = f.t / f.life;
      if (k >= 1) {
        f.life = 0;
        f.m.visible = false;
        f.m.material.opacity = 0;
        continue;
      }
      const s = f.r * (0.35 + 0.65 * Math.sqrt(k));
      f.m.scale.setScalar(s);
      f.m.material.opacity = 0.72 * (1 - k) ** 1.7;
      f.m.material.color.copy(FIRE_HOT).lerp(FIRE_COOL, Math.min(1, k * 1.6));
      f.m.rotation.y += dt * 1.4;
    }

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.life = 0;
        r.m.visible = false;
        continue;
      }
      r.m.scale.setScalar(r.r * (0.1 + k));
      r.m.material.opacity = 0.75 * (1 - k) ** 2;
    }

    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.t += dt;
      if (d.t >= d.life) {
        d.life = 0;
        d.m.visible = false;
        continue;
      }
      d.vel.y -= g * dt;
      d.m.position.addScaledVector(d.vel, dt);
      d.m.rotation.x += d.spin.x * dt;
      d.m.rotation.y += d.spin.y * dt;
      d.m.rotation.z += d.spin.z * dt;
      if (d.m.position.y < 0.2) {
        d.m.position.y = 0.2;
        d.vel.y *= -0.32;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.5);
      }
    }

    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.life = 0;
        p.s.visible = false;
        p.s.material.opacity = 0;
        continue;
      }
      p.vel.multiplyScalar(1 - 1.1 * dt);
      p.vel.y += 2.2 * dt; // buoyancy
      p.s.position.addScaledVector(p.vel, dt);
      const r = p.r0 + (p.r1 - p.r0) * k;
      p.s.scale.set(r, r, 1);
      p.s.material.opacity = p.peak * Math.min(1, k * 6) * (1 - k) ** 1.4;
      p.s.material.color.copy(p.from).lerp(p.to, Math.min(1, k * 2.2));
      p.s.material.rotation += dt * 0.25;
    }

    for (const lg of this.lights) {
      if (lg.life <= 0) {
        if (lg.l.intensity !== 0) lg.l.intensity = 0;
        continue;
      }
      lg.t += dt;
      const k = lg.t / lg.life;
      if (k >= 1) {
        lg.life = 0;
        lg.l.intensity = 0;
        continue;
      }
      lg.l.intensity = lg.power * (1 - k) ** 2;
    }
  }
}
