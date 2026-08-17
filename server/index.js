/**
 * Warbird lobby + relay server.
 *
 * Deliberately small: it owns lobby membership and match lifecycle, and relays
 * player state to everyone else in the same room. It does not simulate flight
 * and does not verify hits — the shooting client reports damage. That is fine
 * for a friendly dogfight game and wide open to cheating in a hostile one; see
 * the README before putting this anywhere competitive.
 *
 *   npm install
 *   npm run server          # listens on :8080, or $PORT
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { openRegistry } from './registry.js';

const PORT = Number(process.env.PORT) || 8080;
/** Persistent callsign registry — see registry.js for what it does and does not protect. */
const registry = openRegistry(process.env.WARBIRD_DB);
/** Broadcast rate for aggregated player state. */
const TICK_MS = 66;
/** Drop a connection that has not said anything in this long. */
const TIMEOUT_MS = 30_000;

const MAP_NAMES = {
  midtown: 'Midtown',
  bayside: 'Bayside',
  dustbasin: 'Dust Basin',
  kranzberg: 'Kranzberg',
  steelworks: 'Steelworks',
  nightfall: 'Nightfall'
};

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Set<Client>} */
const clients = new Set();

const wss = new WebSocketServer({ port: PORT });
console.log(`[warbird] lobby server listening on :${PORT}`);
console.log(`[warbird] callsign registry: ${registry.kind}, ${registry.count()} registered`);

/* ------------------------------------------------------------------ */

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => !r.running || r.members.size < r.max)
    .map((r) => ({
      id: r.id,
      name: r.name,
      map: r.map,
      mapName: MAP_NAMES[r.map] ?? r.map,
      players: r.members.size,
      max: r.max,
      locked: !!r.password,
      running: r.running
    }));
}

function roomView(room) {
  return {
    id: room.id,
    name: room.name,
    map: room.map,
    mapName: MAP_NAMES[room.map] ?? room.map,
    max: room.max,
    host: room.host,
    locked: !!room.password,
    running: room.running,
    duration: room.duration,
    players: [...room.members].map((c) => ({
      id: c.id,
      name: c.name,
      host: c.id === room.host,
      score: c.score,
      kills: c.kills
    }))
  };
}

function broadcastRoom(room) {
  const view = roomView(room);
  for (const c of room.members) send(c.ws, { t: 'room', room: view });
}

function broadcastLobbies() {
  const list = publicRooms();
  for (const c of clients) {
    if (!c.room) send(c.ws, { t: 'lobbies', list });
  }
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  room.members.delete(client);
  client.room = null;

  for (const c of room.members) send(c.ws, { t: 'left', id: client.id });

  if (room.members.size === 0) {
    clearInterval(room.timer);
    rooms.delete(room.id);
  } else {
    // hand the room to whoever has been there longest
    if (room.host === client.id) room.host = [...room.members][0].id;
    broadcastRoom(room);
  }
  broadcastLobbies();
}

/* ------------------------------------------------------------------ */

wss.on('connection', (ws) => {
  const client = {
    id: randomUUID().slice(0, 8),
    ws,
    name: 'Pilot',
    verified: false,
    room: null,
    state: null,
    score: 0,
    kills: 0,
    deaths: 0,
    lastSeen: Date.now()
  };
  clients.add(client);
  send(ws, { t: 'welcome', id: client.id });

  // A client only sends application messages during a running match. Someone
  // sitting in a lobby waiting for a friend sends nothing at all, so without
  // this they were reaped after TIMEOUT_MS and silently dropped — which is
  // exactly the situation every real session starts in.
  //
  // Protocol-level pings are the right tool: the browser answers them in the
  // network layer, so they keep working when the tab is backgrounded and its
  // JavaScript timers are throttled.
  ws.on('pong', () => {
    client.lastSeen = Date.now();
  });

  ws.on('message', (raw) => {
    client.lastSeen = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      /**
       * Claim a callsign. The client sends the secret it stored the first time;
       * the server issues one when the name is free. A client that fails here
       * is not admitted to any lobby under that name.
       */
      case 'claim': {
        const result = registry.claim(msg.name, msg.secret);
        if (!result.ok) {
          send(ws, { t: 'claimFailed', reason: result.reason });
          return;
        }
        client.name = result.name;
        client.verified = true;
        send(ws, {
          t: 'claimed',
          name: result.name,
          secret: result.secret,
          returning: result.returning
        });
        break;
      }

      case 'hello':
        // Legacy path for a client with no stored identity yet. Unverified
        // names are still usable for a casual game, but they are never written
        // to the registry, so they cannot squat on someone else's callsign.
        if (!client.verified) {
          client.name = String(msg.name ?? 'Pilot').slice(0, 14) || 'Pilot';
        }
        break;

      case 'list':
        send(ws, { t: 'lobbies', list: publicRooms() });
        break;

      case 'create': {
        leaveRoom(client);
        const room = {
          id: randomUUID().slice(0, 6),
          name: String(msg.name ?? 'Dogfight').slice(0, 24) || 'Dogfight',
          map: MAP_NAMES[msg.map] ? msg.map : 'midtown',
          max: Math.min(16, Math.max(2, Number(msg.max) || 8)),
          password: msg.password ? String(msg.password).slice(0, 32) : null,
          duration: Math.min(1800, Math.max(60, Number(msg.duration) || 600)),
          host: client.id,
          running: false,
          members: new Set([client]),
          timer: null
        };
        rooms.set(room.id, room);
        client.room = room;
        client.score = 0;
        client.kills = 0;
        send(ws, { t: 'joined', room: roomView(room) });
        broadcastLobbies();
        break;
      }

      case 'join': {
        const room = rooms.get(msg.id);
        if (!room) return send(ws, { t: 'error', message: 'That lobby is gone' });
        if (room.members.size >= room.max) {
          return send(ws, { t: 'error', message: 'Lobby is full' });
        }
        if (room.password && msg.password !== room.password) {
          return send(ws, { t: 'error', message: 'Wrong password' });
        }
        leaveRoom(client);
        room.members.add(client);
        client.room = room;
        client.score = 0;
        client.kills = 0;
        send(ws, { t: 'joined', room: roomView(room) });
        broadcastRoom(room);
        broadcastLobbies();
        break;
      }

      case 'leave':
        leaveRoom(client);
        send(ws, { t: 'lobbies', list: publicRooms() });
        break;

      case 'start': {
        const room = client.room;
        if (!room || room.host !== client.id || room.running) return;
        room.running = true;
        room.endsAt = Date.now() + room.duration * 1000;
        const view = roomView(room);
        for (const c of room.members) {
          c.score = 0;
          c.kills = 0;
          send(c.ws, { t: 'start', room: view });
        }

        // aggregate and fan out player state
        room.timer = setInterval(() => {
          const players = [...room.members]
            .filter((c) => c.state)
            .map((c) => ({ id: c.id, name: c.name, ...c.state }));
          for (const c of room.members) send(c.ws, { t: 'states', players });

          if (Date.now() >= room.endsAt) {
            room.running = false;
            clearInterval(room.timer);
            const standings = [...room.members]
              .map((c) => ({ id: c.id, name: c.name, score: c.score, kills: c.kills }))
              .sort((a, b) => b.score - a.score);
            for (const c of room.members) send(c.ws, { t: 'over', standings });
            broadcastLobbies();
          }
        }, TICK_MS);
        broadcastLobbies();
        break;
      }

      case 'state':
        client.state = {
          p: msg.p, q: msg.q, s: msg.s, hp: msg.hp,
          alive: msg.alive, plane: msg.plane
        };
        break;

      case 'score':
        client.score += Number(msg.n) || 0;
        break;

      case 'hit': {
        const room = client.room;
        if (!room) return;
        const target = [...room.members].find((c) => c.id === msg.target);
        if (!target) return;
        // forward to the victim, who applies it and decides if they died
        send(target.ws, { t: 'damaged', by: client.id, damage: Number(msg.damage) || 0 });
        break;
      }

      case 'died': {
        const room = client.room;
        if (!room) return;
        client.deaths++;
        const killer = [...room.members].find((c) => c.id === msg.by);
        if (killer && killer !== client) {
          killer.kills++;
          killer.score += 100;
        }
        for (const c of room.members) {
          send(c.ws, {
            t: 'killed',
            victim: client.id,
            victimName: client.name,
            killer: killer?.id ?? null,
            killerName: killer?.name ?? null
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveRoom(client);
    clients.delete(client);
  });

  ws.on('error', () => {
    leaveRoom(client);
    clients.delete(client);
  });
});

/* Keep connections alive, and reap the ones that have genuinely gone away. */
setInterval(() => {
  const now = Date.now();
  for (const c of clients) {
    if (now - c.lastSeen > TIMEOUT_MS) {
      c.ws.terminate();
      continue;
    }
    // ping every sweep; the pong handler refreshes lastSeen
    if (c.ws.readyState === c.ws.OPEN) {
      try {
        c.ws.ping();
      } catch {
        /* the close handler will clean up */
      }
    }
  }
}, 10_000);
