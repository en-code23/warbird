import { isTouchDevice } from './quality.js';

/**
 * Touch controls.
 *
 * The design brief for this layer was: it should read as cockpit furniture,
 * not as a mobile game overlay. Three decisions follow from that, and each is
 * also the better control, which is why they are worth the extra work:
 *
 *  - **The throttle is a slide lever**, not a pair of +/- buttons. A real
 *    throttle is analogue and it stays where you leave it. You set power once
 *    on the climb-out and never touch it again, which is exactly what a lever
 *    affords and what tap-to-nudge does not.
 *
 *  - **The stick has no fixed base.** Touch anywhere in the control area and
 *    that point becomes centre; drag from there deflects. A fixed on-screen
 *    joystick forces you to look at your thumb to find it — fatal when the
 *    thing you must be looking at is the horizon.
 *
 *  - **Deflection is analogue and squared.** Small movements near centre are
 *    gentle, which is what makes a landing flyable on a touchscreen at all.
 *
 * Everything runs on Pointer Events with per-control pointer capture, so the
 * throttle, stick and triggers all work simultaneously under different fingers.
 */

/** Deflection in pixels for full control travel. */
const STICK_TRAVEL = 78;

/** Squared response: gentle near centre, full authority at the edge. */
const shape = (v) => Math.sign(v) * v * v;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Pointer capture is best-effort.
 *
 * `setPointerCapture` throws NotFoundError if the pointer has already been
 * released — which happens for real on Safari when a touch ends between the
 * event firing and the handler running. An uncaught throw here aborts the rest
 * of the handler, so the control silently stops responding. Capture is an
 * improvement, not a requirement: without it a drag that leaves the element
 * stops tracking, which is survivable; losing the whole handler is not.
 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* keep going without capture */
  }
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {() => void} opts.onBomb
   * @param {() => void} opts.onView
   * @param {(on:boolean) => void} opts.onScope
   * @param {() => void} opts.onMenu
   * @param {(on:boolean) => void} opts.onFire
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.active = false;

    /** Analogue axes, all -1..1, read by the flight model each frame. */
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.throttle = 0.7;
    this.braking = false;

    this.root = document.getElementById('touch');
    if (!this.root) return;

    this.stickArea = document.getElementById('t-stick');
    this.stickRing = document.getElementById('t-stick-ring');
    this.stickDot = document.getElementById('t-stick-dot');
    this.lever = document.getElementById('t-lever');
    this.leverGate = document.getElementById('t-quadrant');
    this.leverValue = document.getElementById('t-thr-value');

    this._stickId = null;
    this._stickOrigin = { x: 0, y: 0 };
    this._leverId = null;

    this.wireStick();
    this.wireThrottle();
    this.wireRudder();
    this.wireButtons();
  }

  /** Shows the layer and takes over from the keyboard. */
  enable() {
    if (!this.root) return;
    this.active = true;
    this.root.hidden = false;
    document.body.classList.add('touch-mode');
  }

  disable() {
    if (!this.root) return;
    this.active = false;
    this.root.hidden = true;
    this.release();
    document.body.classList.remove('touch-mode');
  }

  /** Drops every axis — used on pause, death and menu open. */
  release() {
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
    this.braking = false;
    this._stickId = null;
    this.opts.onFire?.(false);
    if (this.stickRing) this.stickRing.classList.remove('on');
    for (const el of this.root?.querySelectorAll('.t-btn.held') ?? []) {
      el.classList.remove('held');
    }
  }

  /* ---------------------------------------------------------- stick ---- */

  wireStick() {
    const area = this.stickArea;
    if (!area) return;

    area.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      this._stickOrigin.x = e.clientX;
      this._stickOrigin.y = e.clientY;
      capture(area, e.pointerId);

      // The ring appears where your thumb landed, so the control is always
      // exactly where you put it rather than where the layout decided.
      const r = area.getBoundingClientRect();
      this.stickRing.style.left = `${e.clientX - r.left}px`;
      this.stickRing.style.top = `${e.clientY - r.top}px`;
      this.stickRing.classList.add('on');
      this.stickDot.style.transform = 'translate(-50%, -50%)';
      e.preventDefault();
    });

    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      const dx = clamp((e.clientX - this._stickOrigin.x) / STICK_TRAVEL, -1, 1);
      const dy = clamp((e.clientY - this._stickOrigin.y) / STICK_TRAVEL, -1, 1);

      // Screen down = stick back = nose up. `pitch` here matches the keyboard
      // axis, where positive is the S key (nose up).
      this.pitch = shape(dy);
      this.roll = shape(dx);

      this.stickDot.style.transform =
        `translate(calc(-50% + ${dx * 34}px), calc(-50% + ${dy * 34}px))`;
      e.preventDefault();
    });

    const end = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      this.pitch = 0;
      this.roll = 0;
      this.stickRing.classList.remove('on');
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------- throttle ---- */

  wireThrottle() {
    const gate = this.leverGate;
    if (!gate) return;

    const set = (clientY) => {
      const r = gate.getBoundingClientRect();
      // top of the gate is full power, like a real quadrant pushed forward
      const t = clamp(1 - (clientY - r.top) / r.height, 0, 1);
      this.throttle = t;
      this.paintThrottle();
    };

    gate.addEventListener('pointerdown', (e) => {
      if (this._leverId !== null) return;
      this._leverId = e.pointerId;
      capture(gate, e.pointerId);
      gate.classList.add('held');
      set(e.clientY);
      e.preventDefault();
    });

    gate.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._leverId) return;
      set(e.clientY);
      e.preventDefault();
    });

    const end = (e) => {
      if (e.pointerId !== this._leverId) return;
      this._leverId = null;
      gate.classList.remove('held');
    };
    gate.addEventListener('pointerup', end);
    gate.addEventListener('pointercancel', end);

    this.paintThrottle();
  }

  paintThrottle() {
    if (!this.lever) return;
    this.lever.style.bottom = `${this.throttle * 100}%`;
    if (this.leverValue) this.leverValue.textContent = Math.round(this.throttle * 100);
  }

  /** Lets the flight code push the throttle back (respawn, rearm). */
  setThrottle(v) {
    this.throttle = clamp(v, 0, 1);
    this.paintThrottle();
  }

  /* --------------------------------------------------------- rudder ---- */

  wireRudder() {
    for (const [id, sign] of [['t-rud-l', -1], ['t-rud-r', 1]]) {
      const el = document.getElementById(id);
      if (!el) continue;
      let held = null;

      el.addEventListener('pointerdown', (e) => {
        held = e.pointerId;
        capture(el, e.pointerId);
        el.classList.add('held');
        this.yaw = sign;
        e.preventDefault();
        e.stopPropagation();
      });
      const end = (e) => {
        if (e.pointerId !== held) return;
        held = null;
        el.classList.remove('held');
        this.yaw = 0;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }

  /* -------------------------------------------------------- buttons ---- */

  /**
   * @param {string} id
   * @param {object} handlers {onDown, onUp, toggle}
   */
  button(id, { onDown, onUp, toggle } = {}) {
    const el = document.getElementById(id);
    if (!el) return null;
    let held = null;
    let on = false;

    el.addEventListener('pointerdown', (e) => {
      held = e.pointerId;
      capture(el, e.pointerId);
      el.classList.add('held');
      if (toggle) {
        on = !on;
        el.classList.toggle('lit', on);
        toggle(on);
      } else {
        onDown?.();
      }
      e.preventDefault();
      e.stopPropagation();
    });

    const end = (e) => {
      if (e.pointerId !== held) return;
      held = null;
      el.classList.remove('held');
      onUp?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    return {
      el,
      set(v) {
        on = v;
        el.classList.toggle('lit', v);
      }
    };
  }

  wireButtons() {
    const o = this.opts;

    // Trigger is press-and-hold: guns fire while your finger is down.
    this.button('t-guns', {
      onDown: () => o.onFire?.(true),
      onUp: () => o.onFire?.(false)
    });

    this.button('t-bomb', { onDown: () => o.onBomb?.() });

    this.button('t-brake', {
      onDown: () => { this.braking = true; },
      onUp: () => { this.braking = false; }
    });

    this.scopeBtn = this.button('t-scope', { toggle: (on) => o.onScope?.(on) });
    this.button('t-view', { onDown: () => o.onView?.() });
    this.button('t-menu', { onDown: () => o.onMenu?.() });
  }

  /** Keeps the scope button lit in sync when the state changes elsewhere. */
  setScoped(on) {
    this.scopeBtn?.set(on);
  }
}

/**
 * Landscape nag and fullscreen.
 *
 * A flight sim in portrait is unusable — there is nowhere to put the stick that
 * is not also where the horizon needs to be. Rather than trying to lay out for
 * it, ask for the rotation and explain why.
 */
export function setupOrientation() {
  if (!isTouchDevice()) return;
  const nag = document.getElementById('rotate');
  if (!nag) return;

  const check = () => {
    const portrait = innerHeight > innerWidth;
    nag.hidden = !portrait;
  };
  addEventListener('resize', check);
  addEventListener('orientationchange', check);
  check();
}

/**
 * Goes fullscreen and locks landscape on the first real interaction.
 *
 * This is a genuine performance measure, not polish: with the browser chrome
 * gone the compositor stops blending the page against a scrolling toolbar every
 * frame, and the viewport stops resizing as the address bar hides and shows.
 */
export async function goFullscreen() {
  if (!isTouchDevice()) return;
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    }
    await screen.orientation?.lock?.('landscape');
  } catch {
    // Both are best-effort: iOS Safari has neither, and the game is still
    // playable without them.
  }
}
