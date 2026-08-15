const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.root = $('hud');
    this.speed = $('v-speed');
    this.alt = $('v-alt');
    this.vs = $('v-vs');
    this.hdg = $('v-hdg');
    this.bombs = $('v-bombs');
    this.score = $('v-score');
    this.field = $('v-field');
    this.mapName = $('v-map');
    this.thr = $('v-thr');
    this.thrBar = $('v-thrbar');
    this.stall = $('v-stall');
    this.brake = $('v-brake');
    this.bannerEl = $('v-banner');

    this.approach = $('v-approach');
    this.apDist = $('v-apdist');
    this.apGs = $('v-apgs');
    this.apMark = $('v-apmark');

    this._bannerTimer = 0;
    this._last = {};
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  /** Only touch the DOM when a value actually changes. */
  set(el, key, value) {
    if (this._last[key] === value) return;
    this._last[key] = value;
    el.textContent = value;
  }

  flag(el, key, on) {
    if (this._last[key] === on) return;
    this._last[key] = on;
    el.classList.toggle('on', on);
  }

  update(s) {
    this.set(this.speed, 'spd', Math.round(s.speed * 1.15));
    this.set(this.alt, 'alt', Math.round(s.altitude * 3.28));
    this.set(this.vs, 'vs', Math.round((s.verticalSpeed * 196.85) / 10) * 10);
    this.set(this.hdg, 'hdg', String(Math.round(s.heading) % 360).padStart(3, '0'));
    this.set(this.bombs, 'bmb', s.bombs);
    this.set(this.score, 'scr', s.score);
    this.set(this.field, 'fld', Math.round(s.fieldDistance));
    this.set(this.mapName, 'map', s.mapName);

    const thr = Math.round(s.throttle * 100);
    if (this._last.thr !== thr) {
      this._last.thr = thr;
      this.thr.textContent = thr;
      this.thrBar.style.width = `${thr}%`;
    }

    this.flag(this.stall, 'stall', s.stalling);
    this.flag(this.brake, 'brake', s.braking);

    // approach guidance
    const showAp = s.approach != null;
    if (this._last.apShown !== showAp) {
      this._last.apShown = showAp;
      this.approach.classList.toggle('hidden', !showAp);
    }
    if (showAp) {
      const a = s.approach;
      this.set(this.apDist, 'apd', Math.round(a.distance));
      this.set(this.apGs, 'apg', `${a.angle.toFixed(1)}°`);
      // -1 (well low) .. +1 (well high) mapped onto the track, inverted for screen
      const dev = Math.max(-1, Math.min(1, (a.angle - a.target) / 2.4));
      const top = `${50 - dev * 46}%`;
      if (this._last.apMark !== top) {
        this._last.apMark = top;
        this.apMark.style.top = top;
      }
      this.flag(this.apMark, 'apOff', Math.abs(dev) > 0.55);
    }
  }

  banner(html, kind = '', seconds = 2.2) {
    this.bannerEl.innerHTML = html;
    this.bannerEl.className = `banner show ${kind}`;
    this._bannerTimer = seconds;
  }

  clearBanner() {
    this._bannerTimer = 0;
    this.bannerEl.classList.remove('show');
  }

  tick(dt) {
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
  }
}
