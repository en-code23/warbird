/**
 * Callsign registry.
 *
 * Players choose a callsign once and keep it. To stop anyone simply typing
 * someone else's name, a callsign is bound on first claim to a secret the
 * client generated and stores locally; reclaiming it later requires presenting
 * the same secret. Only a SHA-256 of the secret is written to disk, so the
 * database never holds anything worth stealing.
 *
 * Be clear about what this is and is not. It stops casual impersonation on a
 * given server. It is **not** an account system: there is no password recovery,
 * no email, no proof of who a person is, and anyone who copies your browser's
 * localStorage can be you. Putting this on a hostile network without real
 * authentication in front of it would be a mistake.
 *
 * Storage is SQLite via node:sqlite where available (Node 22+), falling back to
 * a JSON file so the server still runs on older runtimes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const NAME_RE = /^[A-Za-z0-9 _.\-]{3,14}$/;

/** Names nobody gets to claim, because they read as authority in a killfeed. */
const RESERVED = new Set([
  'admin', 'administrator', 'server', 'system', 'host', 'mod', 'moderator',
  'warbird', 'root', 'owner', 'staff', 'null', 'undefined', 'you'
]);

const hash = (s) => createHash('sha256').update(String(s)).digest('hex');

/** Case-insensitive identity, so `Ace` and `ace` cannot both exist. */
const key = (name) => name.trim().toLowerCase();

export function validateName(raw) {
  const name = String(raw ?? '').trim();
  if (!NAME_RE.test(name)) {
    return { ok: false, reason: '3–14 characters, letters and numbers only' };
  }
  if (RESERVED.has(key(name))) return { ok: false, reason: 'That callsign is reserved' };
  return { ok: true, name };
}

/* ------------------------------------------------------------------ store */

function jsonStore(file) {
  let data = { names: {} };
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data.names) data.names = {};
  } catch {
    /* first run */
  }

  const flush = () => {
    // write-then-rename so a crash mid-write cannot truncate the registry
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };

  return {
    kind: 'json',
    get: (k) => data.names[k] ?? null,
    put(k, row) {
      data.names[k] = row;
      flush();
    },
    touch(k, at) {
      if (data.names[k]) {
        data.names[k].lastSeen = at;
        flush();
      }
    },
    count: () => Object.keys(data.names).length
  };
}

function sqliteStore(file) {
  // Imported lazily: it is experimental, and the JSON store is a fine fallback.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS callsigns (
      key       TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      secret    TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastSeen  INTEGER NOT NULL
    )
  `);
  const selectOne = db.prepare('SELECT * FROM callsigns WHERE key = ?');
  const insertOne = db.prepare(
    'INSERT INTO callsigns (key, name, secret, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?)'
  );
  const touchOne = db.prepare('UPDATE callsigns SET lastSeen = ? WHERE key = ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM callsigns');

  return {
    kind: 'sqlite',
    get: (k) => selectOne.get(k) ?? null,
    put: (k, row) => insertOne.run(k, row.name, row.secret, row.createdAt, row.lastSeen),
    touch: (k, at) => touchOne.run(at, k),
    count: () => countAll.get().n
  };
}

/**
 * @param {string} file path to the database
 */
export function openRegistry(file = join(process.cwd(), 'data', 'callsigns.db')) {
  mkdirSync(dirname(file), { recursive: true });

  let store;
  try {
    store = sqliteStore(file);
  } catch {
    store = jsonStore(`${file}.json`);
  }

  return {
    kind: store.kind,
    count: () => store.count(),

    /**
     * Claims or reclaims a callsign.
     *
     * @param {string} rawName
     * @param {string} [secret] the client's stored secret; a new one is issued
     *   when the name is free and the caller has none
     * @returns {{ok: true, name: string, secret: string, returning: boolean}
     *          | {ok: false, reason: string}}
     */
    claim(rawName, secret) {
      const check = validateName(rawName);
      if (!check.ok) return check;

      const k = key(check.name);
      const now = Date.now();
      const row = store.get(k);

      if (!row) {
        const issued = secret || randomUUID();
        store.put(k, {
          name: check.name,
          secret: hash(issued),
          createdAt: now,
          lastSeen: now
        });
        return { ok: true, name: check.name, secret: issued, returning: false };
      }

      if (!secret || row.secret !== hash(secret)) {
        return { ok: false, reason: 'That callsign is already taken' };
      }

      store.touch(k, now);
      // the stored spelling wins, so capitalisation stays stable
      return { ok: true, name: row.name, secret, returning: true };
    }
  };
}
