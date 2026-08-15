/**
 * Minimal WebAudio kit: a piston-engine drone whose pitch tracks RPM, a wind
 * layer that tracks airspeed, and noise-burst explosions. Everything is
 * synthesised — no assets to load. Must be started from a user gesture.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.4;
    this.master.connect(ctx.destination);

    // --- shared noise source ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // --- engine ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    this.engineGain.connect(engineFilter).connect(this.master);

    this.oscs = [];
    for (const [type, mult, gain] of [
      ['sawtooth', 1, 0.5],
      ['square', 2.01, 0.16],
      ['sine', 0.5, 0.32]
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.engineGain);
      o.start();
      this.oscs.push({ o, mult });
    }

    // engine "chug" — amplitude modulation at blade-pass frequency
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sawtooth';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    this.lfo.connect(lfoGain).connect(this.engineGain.gain);
    this.lfo.start();

    // --- wind ---
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** @param {number} rpm 0..1  @param {number} speed01 0..1  @param {boolean} alive */
  update(rpm, speed01, alive = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const base = 42 + rpm * 78;
    for (const { o, mult } of this.oscs) {
      o.frequency.setTargetAtTime(base * mult, t, 0.08);
    }
    this.lfo.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(alive ? 0.11 + rpm * 0.2 : 0, t, 0.12);
    this.windGain.gain.setTargetAtTime(speed01 * 0.075, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(420 + speed01 * 900, t, 0.2);
  }

  /** @param {number} size 0.4 (bomb) .. 1.4 (aircraft) */
  boom(size = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.55 + Math.random() * 0.2;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600 * size, t);
    filter.frequency.exponentialRampToValueAtTime(90, t + 1.1 * size);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85 * Math.min(1, size), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.5 * size);

    // sub thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120 * size, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.6 * size, t);
    subG.gain.exponentialRampToValueAtTime(0.0008, t + 0.8);

    src.connect(filter).connect(g).connect(this.master);
    sub.connect(subG).connect(this.master);
    src.start(t);
    sub.start(t);
    src.stop(t + 2 * size);
    sub.stop(t + 1);
  }

  /**
   * Gunfire. Individual rounds are far too fast to synthesise one at a time, so
   * this plays a rate-limited impulse whose weight and pitch track the weapon —
   * a Gatling reads as a saw, a 30mm as slow heavy thumps.
   * @param {object} gun a GUNS[] entry
   * @param {number} spin 0..1 spin-up factor
   */
  gun(gun, spin = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // one impulse per audible "chug" rather than one per round
    const interval = Math.max(0.035, 60 / gun.rpm);
    if (t - (this._lastGun ?? 0) < interval) return;
    this._lastGun = t;

    const heavy = gun.damage > 20;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = heavy ? 0.5 : 1.1;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = (heavy ? 420 : 1400) * (0.85 + spin * 0.3);
    filter.Q.value = 0.9;

    const g = ctx.createGain();
    const peak = (heavy ? 0.3 : 0.14) * (0.5 + spin * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (heavy ? 0.16 : 0.07));

    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.25);

    if (heavy) {
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(150, t);
      thump.frequency.exponentialRampToValueAtTime(52, t + 0.1);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.2, t);
      tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
      thump.connect(tg).connect(this.master);
      thump.start(t);
      thump.stop(t + 0.16);
    }
  }

  /** short mechanical click when a bomb leaves the rack */
  release() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }
}
