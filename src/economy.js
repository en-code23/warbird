import { PLANES, GUNS, BOMBS, planeById, gunById, bombById } from './catalog.js';

/**
 * Coins, ownership and loadout, persisted to localStorage.
 *
 * The save is deliberately tiny and forward-compatible: unknown ids are dropped
 * on load rather than throwing, so adding or renaming catalogue entries can
 * never brick an existing save.
 */

const KEY = 'warbird.save.v1';

const STARTER = {
  coins: 300,
  planes: ['sparrow'],
  guns: ['rifle'],
  bombs: ['light'],
  loadout: { plane: 'sparrow', gun: 'rifle', bomb: 'light' },
  stats: { sorties: 0, buildings: 0, kills: 0, bestRun: 0, landings: 0 }
};

/** Coins awarded for each scoring event. Also used by the HUD to show payouts. */
export const REWARD = {
  building: 6,
  pedestrian: 1,
  kill: 120,
  landing: 40,
  greased: 60
};

export class Economy {
  constructor() {
    this.data = this.load();
    this.listeners = new Set();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || typeof raw !== 'object') return structuredClone(STARTER);

      const valid = (list, table) =>
        (Array.isArray(list) ? list : []).filter((id) => table.some((t) => t.id === id));

      const data = {
        coins: Number.isFinite(raw.coins) ? Math.max(0, raw.coins) : STARTER.coins,
        planes: valid(raw.planes, PLANES),
        guns: valid(raw.guns, GUNS),
        bombs: valid(raw.bombs, BOMBS),
        loadout: { ...STARTER.loadout, ...(raw.loadout ?? {}) },
        stats: { ...STARTER.stats, ...(raw.stats ?? {}) }
      };

      // free items are always owned, even if the save predates them
      for (const [list, table] of [
        ['planes', PLANES], ['guns', GUNS], ['bombs', BOMBS]
      ]) {
        for (const item of table) {
          if (item.price === 0 && !data[list].includes(item.id)) data[list].push(item.id);
        }
      }

      // a loadout can't point at something not owned
      if (!data.planes.includes(data.loadout.plane)) data.loadout.plane = data.planes[0];
      if (!data.guns.includes(data.loadout.gun)) data.loadout.gun = data.guns[0];
      if (!data.bombs.includes(data.loadout.bomb)) data.loadout.bomb = data.bombs[0];

      return data;
    } catch {
      return structuredClone(STARTER);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private browsing, quota — not worth interrupting the game over */
    }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /* ---------- currency ---------- */

  get coins() {
    return this.data.coins;
  }

  addCoins(n) {
    this.data.coins = Math.max(0, this.data.coins + Math.round(n));
    this.save();
    return this.data.coins;
  }

  /* ---------- ownership ---------- */

  owns(kind, id) {
    return this.data[kind].includes(id);
  }

  /** @returns {{ok: boolean, reason?: string}} */
  buy(kind, id) {
    const table = { planes: PLANES, guns: GUNS, bombs: BOMBS }[kind];
    const item = table?.find((t) => t.id === id);
    if (!item) return { ok: false, reason: 'No such item' };
    if (this.owns(kind, id)) return { ok: false, reason: 'Already owned' };
    if (this.data.coins < item.price) {
      return { ok: false, reason: `Need ${item.price - this.data.coins} more coins` };
    }
    this.data.coins -= item.price;
    this.data[kind].push(id);
    this.save();
    return { ok: true };
  }

  /* ---------- loadout ---------- */

  equip(kind, id) {
    if (!this.owns(kind, id)) return false;
    const slot = { planes: 'plane', guns: 'gun', bombs: 'bomb' }[kind];
    this.data.loadout[slot] = id;
    this.save();
    return true;
  }

  /** The resolved catalogue objects for the current loadout. */
  get loadout() {
    return {
      plane: planeById(this.data.loadout.plane),
      gun: gunById(this.data.loadout.gun),
      bomb: bombById(this.data.loadout.bomb)
    };
  }

  /* ---------- stats ---------- */

  record(key, n = 1) {
    this.data.stats[key] = (this.data.stats[key] ?? 0) + n;
    this.save();
  }

  recordBest(key, value) {
    if (value > (this.data.stats[key] ?? 0)) {
      this.data.stats[key] = value;
      this.save();
    }
  }

  reset() {
    this.data = structuredClone(STARTER);
    this.save();
  }
}
