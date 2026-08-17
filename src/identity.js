/**
 * Player identity.
 *
 * A callsign is chosen once, on first run, and then kept. It lives in
 * localStorage alongside a secret this client generates; the lobby server binds
 * the name to a hash of that secret the first time it is claimed, so nobody
 * else can turn up under it later. See `server/registry.js`.
 *
 * The game is entirely playable offline — singleplayer never talks to a server
 * — so the callsign is stored locally first and only registered when you
 * actually connect to a lobby. Being unable to reach a server must never stop
 * someone flying.
 */

const KEY = 'warbird.identity.v1';

/** Same rule the server enforces; checked here too so errors are instant. */
export const NAME_RE = /^[A-Za-z0-9 _.\-]{3,14}$/;

export const RESERVED = new Set([
  'admin', 'administrator', 'server', 'system', 'host', 'mod', 'moderator',
  'warbird', 'root', 'owner', 'staff', 'null', 'undefined', 'you'
]);

/**
 * @param {string} raw
 * @returns {{ok: true, name: string} | {ok: false, reason: string}}
 */
export function validateName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < 3) return { ok: false, reason: 'At least 3 characters' };
  if (name.length > 14) return { ok: false, reason: 'At most 14 characters' };
  if (!NAME_RE.test(name)) {
    return { ok: false, reason: 'Letters, numbers, spaces, . _ - only' };
  }
  if (RESERVED.has(name.toLowerCase())) {
    return { ok: false, reason: 'That callsign is reserved' };
  }
  return { ok: true, name };
}

function randomSecret() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data.name === 'string' && data.name ? data : null;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private browsing — the session still works, it just will not be remembered */
  }
}

export const identity = {
  /** @returns {{name: string, secret: string} | null} */
  get() {
    return read();
  },

  /** True once a callsign has been chosen, so the prompt never comes back. */
  chosen() {
    return !!read();
  },

  get name() {
    return read()?.name ?? null;
  },

  get secret() {
    return read()?.secret ?? null;
  },

  /**
   * Stores a chosen callsign, minting a secret if this is the first one.
   * @param {string} name
   */
  set(name) {
    const existing = read();
    const data = { name, secret: existing?.secret ?? randomSecret(), at: Date.now() };
    write(data);
    return data;
  },

  /**
   * The server is the authority on spelling and may hand back a different
   * secret than we sent (it issues one when the name was free).
   */
  confirm(name, secret) {
    write({ name, secret: secret ?? read()?.secret ?? randomSecret(), at: Date.now() });
  }
};
