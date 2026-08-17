/**
 * WebAudio kit: engine, wind, weapons, explosions, and the menu theme.
 *
 * Routing is master -> { music, sfx }, so the two can be balanced and muted
 * independently. Everything except the music is synthesised — no assets to
 * load, and the engine tracks RPM continuously instead of pitch-shifting a
 * sample, which is what keeps a slow throttle change from sounding stepped.
 *
 * The engine is the sound you hear for the entire session, so it is the one
 * worth getting right. Four things were making the old one fatiguing:
 *
 *  - **A square at 2.01x the fundamental.** That 1% detune against the saw's
 *    own second harmonic beats several times a second. Beating in that range
 *    is the textbook recipe for acoustic roughness, and the ear locks onto it
 *    and will not let go. It is gone.
 *
 *  - **A fixed 900 Hz lowpass.** Harmonic count therefore fell as revs rose,
 *    so the timbre changed character across the range and got buzzier at the
 *    top. The cutoff now tracks the firing frequency, holding a roughly
 *    constant number of harmonics — the engine gets higher, not harsher.
 *
 *  - **A sawtooth LFO on the gain, in the audible band.** A sawtooth has a
 *    discontinuity once per cycle, and at 20-60 Hz that is not a chug, it is
 *    ring modulation adding inharmonic sidebands. It is now a sine, shallower.
 *
 *  - **No broadband layer at all.** A real cockpit is dominated by propeller
 *    and airflow noise, which is far easier to listen to for an hour than a
 *    harmonic stack. Adding it lets the tonal part sit much lower in the mix.
 *
 * There is also a 42 Hz highpass on the engine bus. Content below that is
 * inaudible on a phone speaker but still costs headroom and drives the tiny
 * driver into distortion, which reads as "cheap and buzzy" on exactly the
 * devices this had to run well on.
 */

/** Musical length of the loop, independent of any codec padding. */
const MUSIC_LOOP_SECONDS = 53.3333333;
const MUSIC_URL = new URL('../assets/audio/menu.mp3', import.meta.url).href;

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.musicEnabled = true;
    this._musicBuffer = null;
    this._musicNode = null;
    this._musicWanted = false;
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

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);

    // --- shared noise source ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    /* ---------------------------------------------------------- engine --- */

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    // Bus shaping: lose the sub-bass a phone cannot produce, then take the
    // fizz off the top so the exhaust reads as weight rather than as edge.
    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 42;
    rumbleCut.Q.value = 0.6;

    const fizzCut = ctx.createBiquadFilter();
    fizzCut.type = 'highshelf';
    fizzCut.frequency.value = 1700;
    fizzCut.gain.value = -17;

    this.engineGain.connect(rumbleCut).connect(fizzCut).connect(this.sfx);

    // Exhaust: one saw through a filter that tracks the firing frequency.
    this.exhaust = ctx.createOscillator();
    this.exhaust.type = 'sawtooth';
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = 'lowpass';
    this.exhaustFilter.frequency.value = 500;
    this.exhaustFilter.Q.value = 1.4;
    const exhaustGain = ctx.createGain();
    exhaustGain.gain.value = 0.34;
    this.exhaust
      .connect(this.exhaustFilter)
      .connect(exhaustGain)
      .connect(this.pan(-0.35))
      .connect(this.engineGain);
    this.exhaust.start();

    // Sub: the weight under the exhaust, an octave down.
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.30;
    this.sub.connect(subGain).connect(this.engineGain);
    this.sub.start();

    // Prop wash: broadband, and the reason the tonal layer can sit low.
    const wash = ctx.createBufferSource();
    wash.buffer = buf;
    wash.loop = true;
    this.washFilter = ctx.createBiquadFilter();
    this.washFilter.type = 'bandpass';
    this.washFilter.frequency.value = 240;
    this.washFilter.Q.value = 0.9;
    const washGain = ctx.createGain();
    washGain.gain.value = 0.42;
    wash
      .connect(this.washFilter)
      .connect(washGain)
      .connect(this.pan(0.35))
      .connect(this.engineGain);
    wash.start();

    // Chug: shallow sine AM at half the firing rate.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    this.lfo.connect(lfoGain).connect(this.engineGain.gain);
    this.lfo.start();

    /* ------------------------------------------------------------ wind --- */

    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    wind.start();

    this.ready = true;
    if (this._musicWanted) this.playMusic();
  }

  /** StereoPanner where available, a plain pass-through where it is not. */
  pan(amount) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = amount;
      return p;
    }
    return ctx.createGain();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ============================== music ================================= */

  /**
   * Fetches and decodes the theme once. Safe to call repeatedly.
   * @returns {Promise<AudioBuffer|null>}
   */
  async loadMusic() {
    if (this._musicBuffer) return this._musicBuffer;
    if (!this.ctx) return null;
    if (this._musicLoad) return this._musicLoad;

    this._musicLoad = (async () => {
      try {
        const res = await fetch(MUSIC_URL);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(bytes);
        this._musicBuffer = buffer;
        this._musicLead = leadingSilence(buffer);
        return buffer;
      } catch {
        return null; // music is decoration; never let it break the game
      }
    })();

    return this._musicLoad;
  }

  /**
   * Starts the theme, fading in. Loop points are set from the known musical
   * length rather than the decoded duration: every MP3 decoder pads the start
   * and end of the file, and looping on the padded bounds puts a hole in the
   * middle of a sustained chord.
   */
  async playMusic() {
    this._musicWanted = true;
    if (!this.ready || !this.musicEnabled || this._musicNode) return;

    const buffer = await this.loadMusic();
    // another call may have started playback while we were decoding
    if (!buffer || this._musicNode || !this._musicWanted) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = this._musicLead;
    src.loopEnd = Math.min(buffer.duration, this._musicLead + MUSIC_LOOP_SECONDS);
    src.connect(this.music);
    src.start(0, this._musicLead);
    this._musicNode = src;

    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(this.muted ? 0 : 0.55, t + 1.4);
  }

  /** Fades the theme out and releases the node. */
  stopMusic(fade = 1.0) {
    this._musicWanted = false;
    const src = this._musicNode;
    if (!src || !this.ctx) return;
    this._musicNode = null;

    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(0.0001, t + fade);
    try {
      src.stop(t + fade + 0.05);
    } catch {
      /* already stopped */
    }
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (on) this.playMusic();
    else this.stopMusic(0.4);
  }

  setMuted(on) {
    this.muted = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0 : 0.4, t, 0.05);
  }

  /* ============================== engine ================================ */

  /** @param {number} rpm 0..1  @param {number} speed01 0..1  @param {boolean} alive */
  update(rpm, speed01, alive = true) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;

    // cylinder firing frequency
    const base = 38 + rpm * 66;

    this.exhaust.frequency.setTargetAtTime(base, t, 0.08);
    // The weight sine sits in unison with the exhaust fundamental, not an
    // octave under it. An octave down is 19-52 Hz across the throttle range:
    // inaudible on a phone, and it only burned headroom. Clamping it to a fixed
    // floor instead was worse — that puts it a beating interval away from the
    // fundamental. Unison reinforces cleanly and cannot beat.
    this.sub.frequency.setTargetAtTime(base, t, 0.08);
    this.lfo.frequency.setTargetAtTime(base * 0.5, t, 0.08);

    // Track the cutoff to the fundamental: a constant harmonic count means the
    // engine changes pitch without changing character.
    const cutoff = Math.min(900, Math.max(220, base * 5));
    this.exhaustFilter.frequency.setTargetAtTime(cutoff, t, 0.1);
    this.washFilter.frequency.setTargetAtTime(150 + rpm * 260, t, 0.12);

    this.engineGain.gain.setTargetAtTime(alive ? 0.136 + rpm * 0.184 : 0, t, 0.12);
    this.windGain.gain.setTargetAtTime(speed01 * 0.065, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(420 + speed01 * 900, t, 0.2);
  }

  /* ============================ one-shots =============================== */

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

    src.connect(filter).connect(g).connect(this.sfx);
    sub.connect(subG).connect(this.sfx);
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

    src.connect(filter).connect(g).connect(this.sfx);
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
      thump.connect(tg).connect(this.sfx);
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
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.15);
  }
}

/**
 * How much digital silence a decoder put in front of the first sample.
 *
 * Every MP3 decoder pads the start of the stream, and the amount differs
 * between browsers, so it has to be measured rather than assumed.
 */
function leadingSilence(buffer) {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, buffer.sampleRate);
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]) > 1e-4) return i / buffer.sampleRate;
  }
  return 0;
}
