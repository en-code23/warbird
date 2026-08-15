const $ = (id) => document.getElementById(id);

/**
 * HUD.
 *
 * Every value is diffed against the previous frame before touching the DOM —
 * writing text into a dozen elements at 60fps is otherwise a real cost, and
 * most of these numbers only change a few times a second.
 */
export class Hud {
  constructor() {
    this.root = $('hud');
    this.speed = $('v-speed');
    this.alt = $('v-alt');
    this.vs = $('v-vs');
    this.hdg = $('v-hdg');
    this.ammo = $('v-ammo');
    this.bombs = $('v-bombs');
    this.score = $('v-score');
    this.field = $('v-field');
    this.mapName = $('v-map');
    this.thr = $('v-thr');
    this.thrBar = $('v-thrbar');
    this.hpBar = $('v-hpbar');
    this.stall = $('v-stall');
    this.brake = $('v-brake');
    this.dmg = $('v-dmg');
    this.bannerEl = $('v-banner');
    this.reticle = $('v-reticle');
    this.scope = $('v-scope');
    this.feed = $('v-killfeed');
    this.coinpop = $('v-coinpop');

    this.modebar = $('v-modebar');
    this.mbLabel = $('v-mblabel');
    this.mbValue = $('v-mbvalue');

    this.approach = $('v-approach');
    this.apDist = $('v-apdist');
    this.apGs = $('v-apgs');
    this.apMark = $('v-apmark');

    this._bannerTimer = 0;
    this._dmgTimer = 0;
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

  setMode(mode) {
    this.mbLabel.textContent = mode.timed ? 'TIME' : 'MODE';
    this.modebar.classList.toggle('untimed', !mode.timed);
    this._last.mb = null;
  }

  setScoped(on) {
    this.scope.classList.toggle('hidden', !on);
    this.reticle.classList.toggle('hidden', on);
    this.root.classList.toggle('scoped', on);
  }

  flashDamage() {
    this._dmgTimer = 0.55;
    this.dmg.classList.add('on');
    this.root.classList.add('hurt');
  }

  killFeed(killer, victim) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const a = document.createElement('b');
    a.textContent = killer;
    const mid = document.createElement('span');
    mid.textContent = ' shot down ';
    const b = document.createElement('i');
    b.textContent = victim;
    row.append(a, mid, b);
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  /** Small floating "+points" beside the score. */
  coinPop(text) {
    const el = document.createElement('span');
    el.className = 'pop';
    el.textContent = text;
    this.coinpop.appendChild(el);
    setTimeout(() => el.remove(), 900);
    // a heavy bombing run must not pile up hundreds of nodes
    while (this.coinpop.children.length > 8) this.coinpop.firstChild.remove();
  }

  update(s) {
    this.set(this.speed, 'spd', Math.round(s.speed * 1.15));
    this.set(this.alt, 'alt', Math.round(s.altitude * 3.28));
    this.set(this.vs, 'vs', Math.round((s.verticalSpeed * 196.85) / 10) * 10);
    this.set(this.hdg, 'hdg', String(Math.round(s.heading) % 360).padStart(3, '0'));
    this.set(this.ammo, 'amo', s.ammo);
    this.set(this.bombs, 'bmb', s.bombs);
    this.set(this.score, 'scr', s.score);
    this.set(this.field, 'fld', Math.round(s.fieldDistance));
    this.set(this.mapName, 'map', s.mapName);
    this.set(this.mbValue, 'mb', s.modeValue);

    const thr = Math.round(s.throttle * 100);
    if (this._last.thr !== thr) {
      this._last.thr = thr;
      this.thr.textContent = thr;
      this.thrBar.style.width = `${thr}%`;
    }

    const hp = Math.round(Math.max(0, s.hp) * 100);
    if (this._last.hp !== hp) {
      this._last.hp = hp;
      this.hpBar.style.width = `${hp}%`;
      this.hpBar.classList.toggle('low', hp < 35);
      this.hpBar.classList.toggle('mid', hp >= 35 && hp < 70);
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
    if (this._dmgTimer > 0) {
      this._dmgTimer -= dt;
      if (this._dmgTimer <= 0) {
        this.dmg.classList.remove('on');
        this.root.classList.remove('hurt');
      }
    }
  }
}
