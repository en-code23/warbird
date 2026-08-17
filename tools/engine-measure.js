// Renders the old and new engine models offline and compares them on the
// measures that actually correspond to "annoying": modulation energy in the
// roughness band, spectral peakiness, brightness, and wasted sub-bass.
export async function measure(AudioClass) {
  const SR = 48000;
  const DUR = 3;

  /* --------------------------------------------------------------- FFT --- */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  function spectrum(samples, n) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); // Hann
      re[i] = (samples[i] ?? 0) * w;
    }
    fft(re, im);
    const mag = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
  }

  /* ---------------------------------------------------------- analysis --- */
  function analyse(chan, sr) {
    // steady-state window only: skip the filter/ramp settling
    const start = Math.floor(sr * 1.2);
    const N = 16384;
    const seg = chan.subarray(start, start + N);

    const mag = spectrum(seg, N);
    const binHz = sr / N;
    let total = 0, sub = 0, centroidNum = 0, magSum = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = i * binHz;
      if (f > 12000) break;
      const p = mag[i] * mag[i];
      total += p;
      if (f < 40) sub += p;
      centroidNum += f * mag[i];
      magSum += mag[i];
    }

    // Discrete partials: local maxima well above the local floor. Broadband
    // noise produces no stable peaks, so this isolates the tonal skeleton.
    let maxMag = 0;
    for (let i = 1; i < mag.length; i++) if (i * binHz <= 6000 && mag[i] > maxMag) maxMag = mag[i];
    const floor = maxMag * 0.02; // -34 dB
    const peaks = [];
    for (let i = 2; i < mag.length - 2; i++) {
      const f = i * binHz;
      if (f < 30 || f > 6000) continue;
      if (mag[i] > floor && mag[i] > mag[i - 1] && mag[i] > mag[i + 1]
          && mag[i] >= mag[i - 2] && mag[i] >= mag[i + 2]) {
        peaks.push([f, mag[i]]);
      }
    }
    peaks.sort((a, b) => b[1] - a[1]);
    const top = peaks.slice(0, 24);

    // Sensory dissonance (Plomp & Levelt via Sethares): every pair of partials
    // close enough in frequency to share a critical band beats against the
    // other. This is the measure that actually tracks "harsh", and unlike a
    // modulation-band metric it ignores broadband noise entirely.
    let dissonance = 0;
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const f1 = Math.min(top[i][0], top[j][0]);
        const f2 = Math.max(top[i][0], top[j][0]);
        const s = 0.24 / (0.0207 * f1 + 18.96);
        const d = s * (f2 - f1);
        dissonance += top[i][1] * top[j][1]
          * (Math.exp(-3.5 * d) - Math.exp(-5.75 * d));
      }
    }
    // normalise by total tonal power so level does not decide the score
    let tonalPower = 0;
    for (const [, m] of top) tonalPower += m * m;
    dissonance = tonalPower > 0 ? dissonance / tonalPower : 0;

    // how much of the energy sits in discrete partials vs broadband
    const tonality = tonalPower / (total || 1);

    // Roughness proxy: rectify to get the amplitude envelope, decimate to 1 kHz,
    // then measure how much of that envelope's energy sits in the 20-150 Hz
    // modulation band — the band the ear hears as harshness rather than tremolo.
    const decim = Math.round(sr / 1000);
    const envN = 4096;
    const env = new Float64Array(envN);
    let acc = 0, k = 0, o = 0;
    for (let i = start; i < chan.length && o < envN; i++) {
      acc += Math.abs(chan[i]);
      if (++k === decim) { env[o++] = acc / decim; acc = 0; k = 0; }
    }
    let dc = 0;
    for (let i = 0; i < envN; i++) dc += env[i];
    dc /= envN;
    for (let i = 0; i < envN; i++) env[i] -= dc;

    const emag = spectrum(env, envN);
    const ebin = 1000 / envN;
    let rough = 0, envTotal = 0;
    for (let i = 1; i < emag.length; i++) {
      const f = i * ebin;
      const p = emag[i] * emag[i];
      envTotal += p;
      if (f >= 20 && f <= 150) rough += p;
    }

    let peak = 0, rms = 0;
    for (let i = start; i < chan.length; i++) {
      const v = Math.abs(chan[i]);
      if (v > peak) peak = v;
      rms += chan[i] * chan[i];
    }
    rms = Math.sqrt(rms / (chan.length - start));

    return {
      dissonance,
      tonality,
      partials: top.length,
      modulation: rough / (dc * dc * envN * envN) * 1e3,
      centroidHz: centroidNum / magSum,
      subFraction: sub / total,
      rms,
      peak
    };
  }

  /* ------------------------------------------------------------ models --- */
  function buildOld(ctx, rpm) {
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.11 + rpm * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    engineGain.connect(f).connect(master);

    const base = 42 + rpm * 78;
    for (const [type, mult, gain] of [
      ['sawtooth', 1, 0.5], ['square', 2.01, 0.16], ['sine', 0.5, 0.32]
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = base * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(engineGain);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.type = 'sawtooth';
    lfo.frequency.value = base * 0.5;
    const lg = ctx.createGain();
    lg.gain.value = 0.05;
    lfo.connect(lg).connect(engineGain.gain);
    lfo.start();
  }

  async function renderOld(rpm) {
    const ctx = new OfflineAudioContext(2, SR * DUR, SR);
    buildOld(ctx, rpm);
    return ctx.startRendering();
  }

  async function renderNew(rpm) {
    const ctx = new OfflineAudioContext(2, SR * DUR, SR);
    const Real = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    const a = new AudioClass();
    a.start();
    window.AudioContext = Real;
    a.update(rpm, 0, true);
    return ctx.startRendering();
  }

  function mono(buf) {
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    const out = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) * 0.5;
    return out;
  }

  const results = {};
  for (const rpm of [0.35, 0.75, 1.0]) {
    const [oldBuf, newBuf] = await Promise.all([renderOld(rpm), renderNew(rpm)]);
    results[`rpm${rpm}`] = {
      old: analyse(mono(oldBuf), SR),
      new: analyse(mono(newBuf), SR)
    };
  }
  return results;
}
