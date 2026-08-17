import { MAPS, drawPreview } from './maps.js';
import { MODES } from './modes.js';
import { PLANES, GUNS, BOMBS, displaySpeed, bombCount } from './catalog.js';
import { identity, validateName } from './identity.js';
import { ShopPreview } from './shopPreview.js';

/**
 * Overlay screens: menu, map picker, hangar/shop, multiplayer lobby, results.
 *
 * The markup shells live in index.html; this class fills the dynamic lists and
 * routes between screens. Only one screen is ever visible, and the whole
 * overlay is hidden while flying.
 */

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-GB');

/** Little labelled bar used all over the shop to compare stats. */
function statBar(label, value, max, suffix = '') {
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  const row = document.createElement('div');
  row.className = 'stat';
  row.innerHTML = `
    <span class="stat-label"></span>
    <span class="stat-track"><span class="stat-fill" style="width:${pct}%"></span></span>
    <span class="stat-value"></span>`;
  row.querySelector('.stat-label').textContent = label;
  row.querySelector('.stat-value').textContent = `${fmt(Math.round(value))}${suffix}`;
  return row;
}

export class UI {
  /**
   * @param {object} deps {economy, net, onLaunch, onResume}
   */
  constructor({ economy, net, onLaunch, onResume, quality }) {
    this.economy = economy;
    this.net = net;
    this.onLaunch = onLaunch;
    this.onResume = onResume;
    this.quality = quality;

    this.root = $('overlay');
    this.screens = new Map();
    for (const el of this.root.querySelectorAll('.screen')) {
      this.screens.set(el.dataset.screen, el);
    }

    this.mode = MODES[0];
    this.duration = MODES[0].defaultDuration;
    this.shopKind = 'planes';
    this.preview = new ShopPreview();
    this.visible = true;
    this.canResume = false;

    this.buildModes();
    this.buildMaps();
    this.buildDurations();
    this.wireNav();
    this.wireShop();
    this.wireLobby();
    this.buildQuality();

    economy.onChange(() => this.refreshWallet());
    this.refreshWallet();

    this.wireCallsign();
    // First run gets the callsign prompt instead of the menu; every run after
    // goes straight to the menu and is never asked again.
    this.show(identity.chosen() ? 'menu' : 'callsign');
  }

  /* ================= callsign ================= */

  wireCallsign() {
    const form = $('callsign-form');
    const input = $('callsign-input');
    const error = $('callsign-error');
    if (!form || !input) return;

    const fail = (reason) => {
      error.textContent = reason;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const check = validateName(input.value);
      if (!check.ok) return fail(check.reason);

      error.textContent = '';
      input.removeAttribute('aria-invalid');
      identity.set(check.name);
      this.refreshCallsign();
      this.show('menu');
    });

    // clear the error as soon as they start fixing it
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });

    this.refreshCallsign();
  }

  /** Paints the chosen callsign wherever it is shown. */
  refreshCallsign() {
    const name = identity.name;
    if (!name) return;
    for (const el of document.querySelectorAll('[data-callsign]')) {
      el.textContent = name;
    }
  }

  /**
   * The server rejected the callsign — someone else registered it there first.
   * Send them back to the prompt with the reason; this is the one path that
   * can reopen it after first run.
   */
  callsignRejected(reason) {
    const input = $('callsign-input');
    const error = $('callsign-error');
    if (input) input.value = identity.name ?? '';
    if (error) error.textContent = reason;
    this.show('callsign');
  }

  /* ================= graphics ================= */

  /**
   * Quality picker on the Controls screen.
   *
   * `Auto` is the default and the honest recommendation: the governor already
   * measures the real frame time and steps down when it has to, which beats any
   * guess made from a user-agent string. The manual tiers exist because
   * someone on a laptop may prefer a locked-low picture to a fluctuating one.
   */
  buildQuality() {
    const row = $('quality-opts');
    if (!row || !this.quality) return;
    this.qualityRow = row;
    row.textContent = '';

    const options = [['auto', 'Auto'], ...Object.entries(this.quality.tiers).map(
      ([id, t]) => [id, t.name]
    ).reverse()];

    for (const [id, label] of options) {
      const b = document.createElement('button');
      b.className = 'dur';
      b.dataset.tier = id;
      b.textContent = label;
      b.title = id === 'auto'
        ? 'Measures the frame rate and lowers detail only when it has to.'
        : this.quality.tiers[id].blurb;
      b.addEventListener('click', () => this.quality.set(id));
      row.appendChild(b);
    }

    this.setTier(this.quality.pref, this.quality.active);
  }

  /** @param {string} pref what the player chose  @param {string} active what is running */
  setTier(pref, active) {
    if (!this.qualityRow) return;
    for (const b of this.qualityRow.children) {
      b.classList.toggle('active', b.dataset.tier === pref);
    }
    const note = $('quality-note');
    if (note) {
      note.textContent = pref === 'auto'
        ? `Auto — running ${this.quality.tiers[active].name.toLowerCase()} detail.`
        : this.quality.tiers[pref].blurb;
    }
  }

  /* ================= navigation ================= */

  wireNav() {
    for (const btn of this.root.querySelectorAll('[data-goto]')) {
      btn.addEventListener('click', () => this.show(btn.dataset.goto));
    }
  }

  show(name) {
    for (const [key, el] of this.screens) el.hidden = key !== name;
    this.current = name;
    this.root.classList.remove('gone');
    this.visible = true;
    // Leaving the hangar gives the preview's WebGL context back rather than
    // holding a second one open behind the game for the rest of the session.
    if (name !== 'hangar') this.preview.dispose();
    if (name === 'hangar') this.renderShop();
    if (name === 'menu') this.renderMenuSub();
  }

  hide() {
    this.root.classList.add('gone');
    this.visible = false;
    this.preview.dispose();
  }

  renderMenuSub() {
    $('menu-sub').textContent = this.canResume
      ? 'Choose a game mode — or press M to resume'
      : 'Choose a game mode';
  }

  refreshWallet() {
    $('v-coins').textContent = fmt(this.economy.coins);
  }

  /* ================= mode cards ================= */

  buildModes() {
    const list = $('mode-list');
    list.textContent = '';
    for (const mode of MODES) {
      const card = document.createElement('button');
      card.className = 'mode-card';
      card.type = 'button';

      const tag = document.createElement('span');
      tag.className = 'mode-tag';
      tag.textContent = mode.tag;

      const name = document.createElement('span');
      name.className = 'mode-name';
      name.textContent = mode.name;

      const blurb = document.createElement('p');
      blurb.className = 'mode-blurb';
      blurb.textContent = mode.blurb;

      card.append(tag, name, blurb);
      card.addEventListener('click', () => this.pickMode(mode));
      list.appendChild(card);
    }
  }

  pickMode(mode) {
    this.mode = mode;
    this.duration = mode.defaultDuration ?? 0;

    if (mode.multiplayer) {
      this.show('lobby');
      return;
    }
    if (mode.infinite) {
      // Free flight generates its own endless world — no map to pick
      this.launch(null);
      return;
    }
    $('maps-title').textContent = 'Choose a target';
    $('duration-row').hidden = !mode.timed;
    this.buildDurations();
    this.show('maps');
  }

  /* ================= duration picker ================= */

  buildDurations() {
    const row = $('dur-opts');
    row.textContent = '';
    if (!this.mode.durations) return;
    for (const secs of this.mode.durations) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dur' + (secs === this.duration ? ' active' : '');
      b.textContent = secs >= 60 ? `${secs / 60} min` : `${secs}s`;
      b.addEventListener('click', () => {
        this.duration = secs;
        this.buildDurations();
      });
      row.appendChild(b);
    }
  }

  /* ================= map picker ================= */

  buildMaps() {
    const list = $('map-list');
    list.textContent = '';
    for (const map of MAPS) {
      const card = document.createElement('button');
      card.className = 'map-card';
      card.type = 'button';

      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 140;
      canvas.className = 'map-prev';
      drawPreview(canvas, map);
      card.appendChild(canvas);

      const meta = document.createElement('div');
      meta.className = 'map-meta';
      const name = document.createElement('span');
      name.className = 'map-name';
      name.textContent = map.name;
      const diff = document.createElement('span');
      diff.className = `map-diff ${map.difficulty.toLowerCase()}`;
      diff.textContent = map.difficulty;
      meta.append(name, diff);
      card.appendChild(meta);

      const blurb = document.createElement('p');
      blurb.className = 'map-blurb';
      blurb.textContent = map.blurb;
      card.appendChild(blurb);

      card.addEventListener('click', () => this.launch(map));
      list.appendChild(card);
    }

    // the lobby's map dropdown draws from the same list
    const select = $('create-map');
    select.textContent = '';
    for (const map of MAPS) {
      const opt = document.createElement('option');
      opt.value = map.id;
      opt.textContent = map.name;
      select.appendChild(opt);
    }
  }

  launch(map) {
    this.hide();
    this.canResume = true;
    this.onLaunch({ mode: this.mode, map, duration: this.duration });
  }

  /* ================= shop ================= */

  wireShop() {
    for (const tab of $('shop-tabs').querySelectorAll('.tab')) {
      tab.addEventListener('click', () => {
        this.shopKind = tab.dataset.kind;
        for (const t of $('shop-tabs').querySelectorAll('.tab')) {
          t.classList.toggle('active', t === tab);
        }
        this.renderShop();
      });
    }
  }

  renderShop() {
    const list = $('shop-list');
    list.textContent = '';
    // Every rebuild throws the old canvases away, so the previews attached to
    // them have to go too or they keep drawing into detached nodes forever.
    this.preview.dispose();
    const kind = this.shopKind;
    const table = { planes: PLANES, guns: GUNS, bombs: BOMBS }[kind];
    const slot = { planes: 'plane', guns: 'gun', bombs: 'bomb' }[kind];
    const equipped = this.economy.data.loadout[slot];

    for (const item of table) {
      const owned = this.economy.owns(kind, item.id);
      const isEquipped = equipped === item.id;

      const card = document.createElement('article');
      card.className = 'shop-card' + (isEquipped ? ' equipped' : '');

      const head = document.createElement('header');
      head.className = 'shop-head';
      const title = document.createElement('div');
      title.className = 'shop-title';
      title.textContent = item.name;
      const role = document.createElement('div');
      role.className = 'shop-role';
      role.textContent = item.role ?? item.calibre ?? `${item.weight} kg`;
      head.append(title, role);
      card.appendChild(head);

      // Aircraft get a live turntable of the model they will actually fly.
      if (kind === 'planes') {
        const view = document.createElement('canvas');
        view.className = 'shop-view';
        view.setAttribute('role', 'img');
        view.setAttribute('aria-label', `${item.name}, rotating view`);
        card.appendChild(view);
        this.preview.add(view, item.id, item);
      }

      const blurb = document.createElement('p');
      blurb.className = 'shop-blurb';
      blurb.textContent = item.blurb;
      card.appendChild(blurb);

      const stats = document.createElement('div');
      stats.className = 'shop-stats';
      for (const bar of this.statsFor(kind, item)) stats.appendChild(bar);
      card.appendChild(stats);

      const foot = document.createElement('footer');
      foot.className = 'shop-foot';

      const price = document.createElement('span');
      price.className = 'shop-price';
      price.textContent = owned ? 'Owned' : item.price === 0 ? 'Free' : `● ${fmt(item.price)}`;
      foot.appendChild(price);

      const action = document.createElement('button');
      action.className = 'btn small';
      action.type = 'button';
      if (isEquipped) {
        action.textContent = 'Equipped';
        action.disabled = true;
      } else if (owned) {
        action.textContent = 'Equip';
        action.addEventListener('click', () => {
          this.economy.equip(kind, item.id);
          this.renderShop();
        });
      } else {
        const affordable = this.economy.coins >= item.price;
        action.textContent = affordable ? 'Buy' : 'Not enough coins';
        action.disabled = !affordable;
        action.addEventListener('click', () => {
          const res = this.economy.buy(kind, item.id);
          if (res.ok) this.economy.equip(kind, item.id);
          this.renderShop();
        });
      }
      foot.appendChild(action);
      card.appendChild(foot);
      list.appendChild(card);
    }
  }

  /**
   * The stat bars for one catalogue entry. Scales are fixed across each
   * category so bars are comparable card to card.
   */
  statsFor(kind, item) {
    if (kind === 'planes') {
      const plane = this.economy.loadout.plane;
      return [
        statBar('Top speed', displaySpeed(item.maxSpeed), 320, ' kt'),
        statBar('Stall', displaySpeed(item.stall), 320, ' kt'),
        statBar('Climb rate', item.thrust, 260),
        statBar('Roll rate', item.roll * 100, 320, '°/s'),
        statBar('Armour', item.armour, 340, ' hp'),
        statBar('Bomb load', item.bombLoad, 90),
        statBar('Gun mounts', item.guns, 8),
        statBar('Ceiling', item.ceiling * 3.28, 4800, ' ft'),
        statBar('Handling', item.handling * 100, 100, '%'),
        void plane
      ].filter(Boolean);
    }

    if (kind === 'guns') {
      const mounts = this.economy.loadout.plane.guns;
      return [
        statBar('Damage / round', item.damage, 60),
        statBar('Rate of fire', item.rpm, 3600, ' rpm'),
        statBar('Muzzle velocity', item.velocity, 950, ' m/s'),
        statBar('Accuracy', (0.022 - item.spread) * 4500, 100, '%'),
        statBar('Ammo / mount', item.ammo, 1800),
        statBar(`Burst DPS (×${mounts})`, (item.damage * item.rpm * mounts) / 60, 6000)
      ];
    }

    const plane = this.economy.loadout.plane;
    return [
      statBar('Blast radius', item.blast, 55, ' m'),
      statBar('Damage', item.damage, 140),
      statBar('Weight', item.weight, 520, ' kg'),
      statBar('Carried', bombCount(plane, item), 90),
      ...(item.cluster ? [statBar('Bomblets', item.cluster, 20)] : []),
      ...(item.incendiary ? [statBar('Fire spread', item.incendiary.spread, 60, ' m')] : [])
    ];
  }

  /* ================= multiplayer lobby ================= */

  wireLobby() {
    const serverInput = $('lobby-server');
    const nameInput = $('lobby-name');

    // sensible defaults: a ?server= override, then the last one used
    const params = new URLSearchParams(location.search);
    serverInput.value =
      params.get('server') ||
      localStorage.getItem('warbird.server') ||
      'ws://localhost:8080';
    // The callsign is chosen once on first run and is not editable here.
    if (nameInput) {
      nameInput.value = identity.name ?? '';
      nameInput.readOnly = true;
      nameInput.tabIndex = -1;
      nameInput.setAttribute('data-callsign', '');
    }

    $('create-private').addEventListener('change', (e) => {
      $('create-pass-field').hidden = !e.target.checked;
    });

    $('lobby-connect').addEventListener('click', () => {
      const url = serverInput.value.trim();
      localStorage.setItem('warbird.server', url);
      this.setLobbyStatus('Connecting…');
      this.net.connect(url, identity.name ?? 'Pilot');
    });

    $('create-go').addEventListener('click', () => {
      this.net.createLobby({
        name: $('create-name').value.trim() || 'Dogfight',
        map: $('create-map').value,
        max: Number($('create-max').value),
        password: $('create-private').checked ? $('create-pass').value : null
      });
    });

    $('room-start').addEventListener('click', () => this.net.startMatch());
    $('room-leave').addEventListener('click', () => {
      this.net.leaveLobby();
      this.show('lobby');
    });

    // --- events from the network client ---
    this.net.on('status', (text) => this.setLobbyStatus(text));
    this.net.on('connected', () => {
      this.setLobbyStatus('Connected');
      $('create-go').disabled = false;
    });
    this.net.on('disconnected', (why) => {
      this.setLobbyStatus(why || 'Disconnected');
      $('create-go').disabled = true;
      this.renderLobbies([]);
    });
    // The server owns the spelling and issues the secret on a first claim.
    this.net.on('claimed', ({ name, secret, returning }) => {
      identity.confirm(name, secret);
      this.refreshCallsign();
      this.setLobbyStatus(returning ? `Welcome back, ${name}` : `Registered as ${name}`);
    });
    this.net.on('claimFailed', (reason) => {
      this.setLobbyStatus(reason);
      this.callsignRejected(`${reason} — pick another.`);
    });
    this.net.on('lobbies', (list) => this.renderLobbies(list));
    this.net.on('joined', (room) => this.renderRoom(room));
    this.net.on('room', (room) => this.renderRoom(room));
    this.net.on('start', (room) => {
      const map = MAPS.find((m) => m.id === room.map) ?? MAPS[0];
      this.mode = MODES.find((m) => m.multiplayer);
      this.duration = room.duration ?? 600;
      this.hide();
      this.canResume = true;
      this.onLaunch({ mode: this.mode, map, duration: this.duration, room });
    });
  }

  setLobbyStatus(text) {
    $('lobby-status').textContent = text;
  }

  renderLobbies(list) {
    const wrap = $('lobby-list');
    wrap.textContent = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No lobbies yet — create one.';
      wrap.appendChild(p);
      return;
    }

    for (const room of list) {
      const row = document.createElement('div');
      row.className = 'lobby-row';

      const info = document.createElement('div');
      info.className = 'lobby-info';
      const nm = document.createElement('span');
      nm.className = 'lobby-name';
      nm.textContent = room.name;
      const meta = document.createElement('span');
      meta.className = 'lobby-meta';
      meta.textContent = `${room.mapName} · ${room.players}/${room.max}${room.locked ? ' · private' : ''}`;
      info.append(nm, meta);

      const join = document.createElement('button');
      join.className = 'btn small';
      join.type = 'button';
      join.textContent = room.locked ? 'Join 🔒' : 'Join';
      join.disabled = room.players >= room.max || room.running;
      join.addEventListener('click', () => {
        const password = room.locked ? prompt(`Password for "${room.name}"`) : null;
        if (room.locked && password === null) return;
        this.net.joinLobby(room.id, password);
      });

      row.append(info, join);
      wrap.appendChild(row);
    }
  }

  renderRoom(room) {
    if (!room) return;
    this.show('room');
    $('room-name').textContent = room.name;
    $('room-sub').textContent = `${room.mapName} · ${room.players.length}/${room.max} pilots${room.locked ? ' · private' : ''}`;

    const roster = $('room-roster');
    roster.textContent = '';
    for (const p of room.players) {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const nm = document.createElement('span');
      nm.textContent = p.name;
      const tag = document.createElement('span');
      tag.className = 'roster-tag';
      tag.textContent = p.host ? 'host' : '';
      row.append(nm, tag);
      roster.appendChild(row);
    }
    $('room-start').disabled = !room.isHost;
    $('room-start').textContent = room.isHost ? 'Launch' : 'Waiting for host';
  }

  /* ================= results ================= */

  showResults(summary) {
    this.show('results');
    $('results-title').textContent = summary.title;
    $('results-sub').textContent = summary.subtitle ?? '';

    const body = $('results-body');
    body.textContent = '';
    for (const [label, value] of summary.rows) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('b');
      v.textContent = value;
      row.append(l, v);
      body.appendChild(row);
    }

    if (summary.coins) {
      const row = document.createElement('div');
      row.className = 'result-row payout';
      const l = document.createElement('span');
      l.textContent = 'Coins earned';
      const v = document.createElement('b');
      v.textContent = `● ${fmt(summary.coins)}`;
      row.append(l, v);
      body.appendChild(row);
    }
  }
}
