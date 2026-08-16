/**
 * Quality tiers and the adaptive governor.
 *
 * Why this module exists: the sim was profiled at 669 draw calls and ~115k
 * triangles a frame, with a 0.05ms JS budget. Nothing here is CPU bound — the
 * cost is draw-call submission and fragment work. A phone overheats because it
 * is asked to shade (DPR 2)^2 = 4x the pixels of a logical viewport and to
 * re-render every one of those buildings a second time for the shadow map.
 *
 * So the levers that matter, in order of effect:
 *   1. pixel ratio      — quadratic in fragment cost, by far the biggest one
 *   2. shadows          — doubles the draw calls when on
 *   3. frame cap        — a 120Hz phone burns 2x the power for no visible gain
 *   4. scene population — crowds, vehicles, clouds, particles, chunk radius
 *
 * The governor watches frame time and walks the render scale down before it
 * drops a whole tier, because resolution is the cheapest thing to give up and
 * the least noticeable in motion.
 */

/** Tier definitions. Everything that costs frame time is a knob here. */
export const TIERS = {
  low: {
    name: 'Low',
    blurb: 'For phones and integrated graphics. No shadows, half resolution.',
    maxPixelRatio: 1.0,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    shadowDistance: 0,
    anisotropy: 1,
    pedestrians: 70,
    vehicles: 26,
    clouds: 5,
    particleScale: 0.4,
    chunkRadius: 2,
    drawDistance: 2600,
    fogScale: 1.5,
    vegetationScale: 0.35,
    toneMapping: false
  },
  medium: {
    name: 'Medium',
    blurb: 'Shadows on, trimmed crowds. A good default for laptops.',
    maxPixelRatio: 1.35,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    shadowDistance: 190,
    anisotropy: 4,
    pedestrians: 150,
    vehicles: 60,
    clouds: 14,
    particleScale: 0.72,
    chunkRadius: 2,
    drawDistance: 5200,
    fogScale: 1.15,
    vegetationScale: 0.7,
    toneMapping: true
  },
  high: {
    name: 'High',
    blurb: 'Everything on. Soft shadows, full crowds, full draw distance.',
    maxPixelRatio: 2.0,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 260,
    anisotropy: 8,
    pedestrians: 260,
    vehicles: 110,
    clouds: 26,
    particleScale: 1,
    chunkRadius: 3,
    drawDistance: 9000,
    fogScale: 1,
    vegetationScale: 1,
    toneMapping: true
  }
};

export const TIER_ORDER = ['low', 'medium', 'high'];

/**
 * Is this a touch device we should treat as a phone?
 *
 * Deliberately not user-agent sniffing for a device list: what actually matters
 * is "the input is a finger" and "the screen is small", both of which are
 * directly observable and stay true for devices that do not exist yet.
 */
export function isTouchDevice() {
  if (typeof matchMedia !== 'function') return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const noHover = matchMedia('(hover: none)').matches;
  return (coarse && noHover) || navigator.maxTouchPoints > 1 && coarse;
}

/** Best guess at a starting tier before we have measured anything. */
export function detectTier() {
  const stored = localStorage.getItem('warbird.quality');
  if (stored && (stored in TIERS || stored === 'auto')) return stored;
  return 'auto';
}

export function storeTier(tier) {
  localStorage.setItem('warbird.quality', tier);
}

/** The tier `auto` resolves to on this device, before any measurement. */
export function guessTier() {
  if (isTouchDevice()) return 'low';
  // A hard-capped low core count is a decent proxy for a thermally limited
  // laptop; there is no reliable GPU query in a browser.
  if ((navigator.hardwareConcurrency ?? 8) <= 4) return 'medium';
  return 'high';
}

/**
 * Frame-time governor.
 *
 * Keeps an exponential moving average of frame time and nudges a render scale
 * multiplier so the average lands under budget. Scale moves in small steps with
 * a dead band, so it settles instead of oscillating; tier changes need a much
 * longer run of evidence because they are visible.
 */
export class Governor {
  /**
   * @param {object} opts
   * @param {number} opts.targetFps  frame rate to aim for
   * @param {(scale:number)=>void} opts.onScale  called when render scale changes
   * @param {(tier:string)=>void} opts.onTier    called when the tier should change
   */
  constructor({ targetFps = 60, onScale, onTier } = {}) {
    this.budget = 1000 / targetFps;
    this.onScale = onScale;
    this.onTier = onTier;
    this.enabled = true;

    this.avg = this.budget;
    this.scale = 1;
    this.minScale = 0.6;
    this.maxScale = 1;
    this._cooldown = 0;
    this._overrun = 0;
    this._headroom = 0;
    this.tier = null;
  }

  setTier(tier) {
    this.tier = tier;
    this._overrun = 0;
    this._headroom = 0;
    // Switching tier recompiles shaders and reallocates the shadow map, which
    // costs a few very slow frames. Without this the governor reads that stall
    // as "too heavy" and immediately drops resolution it did not need to.
    this.avg = this.budget;
    this._cooldown = 1.2;
  }

  reset() {
    this.avg = this.budget;
    this.scale = this.maxScale;
    this._cooldown = 0.8;
    this._overrun = 0;
    this._headroom = 0;
    this.onScale?.(this.scale);
  }

  /**
   * @param {number} frameMs  wall time of the frame just rendered
   * @param {number} dt       the same in seconds, clamped
   */
  update(frameMs, dt) {
    if (!this.enabled) return;

    // Ignore obvious outliers: a world build or a tab switch is not evidence
    // that the renderer is too slow.
    if (frameMs > 200) return;
    this.avg += (frameMs - this.avg) * 0.06;

    if (this._cooldown > 0) {
      this._cooldown -= dt;
      return;
    }

    const over = this.avg > this.budget * 1.18;
    const under = this.avg < this.budget * 0.72;

    if (over) {
      this._headroom = 0;
      this._overrun += dt;
      if (this.scale > this.minScale) {
        this.scale = Math.max(this.minScale, this.scale - 0.08);
        this.onScale?.(this.scale);
        this._cooldown = 0.7;
        return;
      }
      // Resolution is already as low as it goes: the scene itself is too heavy.
      if (this._overrun > 4 && this.tier) {
        const i = TIER_ORDER.indexOf(this.tier);
        if (i > 0) {
          this._overrun = 0;
          this._cooldown = 2.5;
          this.onTier?.(TIER_ORDER[i - 1]);
        }
      }
    } else if (under) {
      this._overrun = 0;
      this._headroom += dt;
      if (this.scale < this.maxScale && this._headroom > 1.5) {
        this.scale = Math.min(this.maxScale, this.scale + 0.05);
        this.onScale?.(this.scale);
        this._cooldown = 1.2;
        this._headroom = 0;
      }
    } else {
      this._overrun = 0;
      this._headroom = 0;
    }
  }
}
