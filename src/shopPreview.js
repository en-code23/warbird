import * as THREE from 'three';
import { preloadPlane, buildPlane, disposePlane } from './planeModel.js';

/**
 * Rotating 3D aircraft previews in the hangar.
 *
 * One WebGL context, not one per card. Browsers cap the number of live contexts
 * (typically around 16) and start evicting the oldest, which on a six-card shop
 * grid would fight with the game's own renderer for the slot. So a single small
 * offscreen renderer draws each aircraft in turn and the result is blitted into
 * an ordinary 2D canvas on each card.
 *
 * The models are the same GLBs the game flies, loaded through the same cache, so
 * a preview costs no extra download and shows exactly what you are buying.
 */

const W = 220;
const H = 150;

export class ShopPreview {
  constructor() {
    this.cards = [];
    this.running = false;
    this.renderer = null;
    this._frame = this._frame.bind(this);
  }

  _init() {
    if (this.renderer) return;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(W, H, false);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 400);

    // Lit like a hangar: one hard key from above-front, a cool fill from behind
    // so the silhouette separates from a dark card background.
    const key = new THREE.DirectionalLight(0xfff2dc, 4.2);
    key.position.set(6, 9, 7);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9ec4d8, 1.9);
    fill.position.set(-7, 3, -6);
    this.scene.add(fill);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
  }

  /**
   * Registers a card canvas to show `planeId`.
   * @param {HTMLCanvasElement} canvas
   * @param {string} planeId
   * @param {object} spec catalogue entry, used for framing and as the fallback
   */
  add(canvas, planeId, spec) {
    this._init();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = W;
    canvas.height = H;

    const card = { canvas, ctx, planeId, spec, model: null, angle: Math.random() * 6.28 };
    this.cards.push(card);

    preloadPlane(planeId).then(() => {
      if (!this.cards.includes(card)) return; // shop closed while loading
      card.model = buildPlane(spec, { guns: spec.guns });
      card.model.group.rotation.set(0, 0, 0);
    });

    if (!this.running) this.start();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
  }

  /** Frees every model and the context; call when the hangar closes. */
  dispose() {
    this.stop();
    for (const card of this.cards) {
      if (card.model) disposePlane(card.model);
    }
    this.cards.length = 0;
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    // 30fps is plenty for a slow turntable and halves the cost of having the
    // shop open on a phone.
    const dt = (now - this._last) / 1000;
    if (dt < 1 / 30) return;
    this._last = now;

    for (const card of this.cards) {
      if (!card.model) continue;
      // skip anything scrolled out of view
      const box = card.canvas.getBoundingClientRect();
      if (box.bottom < 0 || box.top > innerHeight) continue;

      card.angle += dt * 0.5;
      this._render(card);
    }
  }

  _render(card) {
    const g = card.model.group;
    this.pivot.clear();
    this.pivot.add(g);

    // frame the aircraft on its own size, so a bomber and a trainer both fill
    // the card rather than the bomber overflowing it
    // `span` in the catalogue is the semi-span, so the full wingspan is 2x. The
    // 0.44 leaves a margin for the aircraft swinging broadside as it turns.
    const reach = Math.max(card.spec.model.span * 2, card.spec.model.length) * 0.44;
    const dist = reach / Math.tan((this.camera.fov * Math.PI) / 360);

    g.rotation.set(0.12, card.angle, 0.06);
    g.position.set(0, 0, 0);

    this.camera.position.set(0, reach * 0.34, dist);
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);

    card.ctx.clearRect(0, 0, W, H);
    card.ctx.drawImage(this.renderer.domElement, 0, 0, W, H);

    this.pivot.remove(g);
  }
}
