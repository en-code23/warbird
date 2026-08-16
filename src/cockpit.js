import * as THREE from 'three';

/**
 * Cockpit interior.
 *
 * Built as a child of the aircraft and shown only in the cockpit view, so the
 * chase view never pays for it. The instrument panel is a canvas texture with
 * live needles redrawn each frame — cheap at this resolution, and it gives the
 * view something to actually fly on instead of a bare camera position.
 */

const PANEL_W = 512;
const PANEL_H = 256;

/** One round instrument face. */
function drawDial(g, cx, cy, r, label, value, max, opts = {}) {
  const { ticks = 8, redline = null, sweep = 1.55 } = opts;

  // bezel
  g.fillStyle = '#15181a';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3d4348';
  g.lineWidth = 2.5;
  g.stroke();

  // graduations
  const start = Math.PI * (1 - sweep / 2 + 0.5);
  const span = Math.PI * sweep;
  g.strokeStyle = '#8c959b';
  g.lineWidth = 1.6;
  for (let i = 0; i <= ticks; i++) {
    const a = start + (i / ticks) * span;
    const inner = i % 2 === 0 ? r * 0.72 : r * 0.8;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    g.stroke();
  }

  if (redline != null) {
    const a0 = start + Math.min(1, redline / max) * span;
    g.strokeStyle = '#c8352a';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r * 0.86, a0, start + span);
    g.stroke();
  }

  // label
  g.fillStyle = '#7d868c';
  g.font = '600 11px ui-monospace, monospace';
  g.textAlign = 'center';
  g.fillText(label, cx, cy + r * 0.46);

  // needle
  const t = Math.max(0, Math.min(1, value / max));
  const a = start + t * span;
  g.strokeStyle = '#e8ece8';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - Math.cos(a) * r * 0.16, cy - Math.sin(a) * r * 0.16);
  g.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  g.stroke();

  g.fillStyle = '#c8ccc8';
  g.beginPath();
  g.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
  g.fill();
}

export class Cockpit {
  /**
   * @param {THREE.Object3D} planeGroup  aircraft to attach to
   * @param {object} dims  {length, span, radius} from createPlane()
   */
  constructor(planeGroup, dims, eye) {
    this.group = new THREE.Group();
    this.group.visible = false;
    planeGroup.add(this.group);

    const r = dims.radius;
    // everything is placed relative to the pilot's actual eye point, so the
    // panel lands at a readable distance whatever size the airframe is
    const eyeZ = eye.z;
    const eyeY = eye.y;

    /* ---- instrument panel ---- */
    this.canvas = document.createElement('canvas');
    this.canvas.width = PANEL_W;
    this.canvas.height = PANEL_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 1.9, r * 0.95),
      new THREE.MeshBasicMaterial({ map: this.texture })
    );
    panel.position.set(0, eyeY - r * 0.62, eyeZ - r * 2.5);
    panel.rotation.x = -0.42; // tilted back toward the pilot
    this.group.add(panel);

    // Coaming: the padded lip along the top of the panel. There is deliberately
    // no shroud box behind the panel — one used to sit there and its front face
    // punched through the instrument face, hiding the dials completely.
    const coaming = new THREE.Mesh(
      new THREE.BoxGeometry(r * 2.0, r * 0.15, r * 0.34),
      new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.95 })
    );
    coaming.position.set(0, eyeY - r * 0.12, eyeZ - r * 2.42);
    this.group.add(coaming);

    /* ---- reflector gunsight ---- */
    const sightBase = new THREE.Mesh(
      new THREE.BoxGeometry(r * 0.34, r * 0.28, r * 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.7, metalness: 0.4 })
    );
    sightBase.position.set(0, eyeY - r * 0.06, eyeZ - r * 2.1);
    this.group.add(sightBase);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 0.62, r * 0.5),
      new THREE.MeshBasicMaterial({
        color: 0x86e8b4,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    glass.position.set(0, eyeY + r * 0.3, eyeZ - r * 2.15);
    glass.rotation.x = 0.22;
    this.group.add(glass);

    /* ---- canopy frame ---- */
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c3134, roughness: 0.8 });
    const barGeo = new THREE.BoxGeometry(0.07, 0.07, r * 3.4);
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(barGeo, frameMat);
      bar.position.set(side * r * 0.8, eyeY + r * 0.34, eyeZ - r * 1.2);
      bar.rotation.z = side * 0.12;
      this.group.add(bar);
    }
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.68, 0.05, 6, 16, Math.PI),
      frameMat
    );
    arch.position.set(0, eyeY - r * 0.1, eyeZ + r * 1.4);
    this.group.add(arch);

    /* ---- side consoles and stick ---- */
    for (const side of [-1, 1]) {
      const console_ = new THREE.Mesh(
        new THREE.BoxGeometry(r * 0.3, r * 0.5, r * 1.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2f32, roughness: 0.9 })
      );
      console_.position.set(side * r * 0.86, eyeY - r * 1.1, eyeZ - r * 1.1);
      this.group.add(console_);
    }

    this.stick = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, r * 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.6, metalness: 0.3 })
    );
    shaft.position.y = r * 0.45;
    this.stick.add(shaft);
    const grip = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.075, r * 0.22, 3, 7),
      new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.85 })
    );
    grip.position.y = r * 0.98;
    this.stick.add(grip);
    this.stick.position.set(0, eyeY - r * 1.75, eyeZ - r * 0.7);
    this.group.add(this.stick);

    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = false;
    });

    this._acc = 0;
  }

  set visible(v) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }

  /**
   * @param {number} dt
   * @param {object} s {speed, maxSpeed, altitude, throttle, rpm, hp, maxHp, pitchIn, rollIn}
   */
  update(dt, s) {
    // the stick moves with the controls — a small thing that sells the view
    this.stick.rotation.x = THREE.MathUtils.lerp(this.stick.rotation.x, s.pitchIn * -0.3, 0.2);
    this.stick.rotation.z = THREE.MathUtils.lerp(this.stick.rotation.z, s.rollIn * 0.3, 0.2);

    if (!this.group.visible) return;

    // redraw the panel at ~20fps rather than every frame
    this._acc += dt;
    if (this._acc < 0.05) return;
    this._acc = 0;

    const g = this.ctx;
    g.fillStyle = '#0e1113';
    g.fillRect(0, 0, PANEL_W, PANEL_H);

    // faint panel grain
    g.fillStyle = 'rgba(255,255,255,0.02)';
    for (let i = 0; i < 60; i++) {
      g.fillRect(Math.random() * PANEL_W, Math.random() * PANEL_H, 3, 1);
    }

    const R = 52;
    drawDial(g, 92, 96, R, 'AIRSPEED', s.speed * 1.15, s.maxSpeed * 1.25, {
      ticks: 10, redline: s.maxSpeed * 1.1
    });
    drawDial(g, 214, 96, R, 'ALTITUDE', s.altitude * 3.28, 4000, { ticks: 10 });
    drawDial(g, 336, 96, R, 'RPM', s.rpm * 100, 120, { ticks: 8, redline: 105 });
    drawDial(g, 452, 76, 38, 'FUEL', 82, 100, { ticks: 4 });

    // damage / integrity strip
    const hpFrac = Math.max(0, s.hp / s.maxHp);
    g.fillStyle = '#20262a';
    g.fillRect(404, 150, 96, 12);
    g.fillStyle = hpFrac > 0.5 ? '#5fbf7a' : hpFrac > 0.22 ? '#d8a33c' : '#c8352a';
    g.fillRect(404, 150, 96 * hpFrac, 12);
    g.fillStyle = '#7d868c';
    g.font = '600 10px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillText('AIRFRAME', 404, 144);

    // throttle quadrant
    g.fillStyle = '#20262a';
    g.fillRect(404, 186, 96, 12);
    g.fillStyle = '#cde06a';
    g.fillRect(404, 186, 96 * s.throttle, 12);
    g.fillStyle = '#7d868c';
    g.fillText('THROTTLE', 404, 180);

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        if (o.material && !Array.isArray(o.material)) o.material.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
