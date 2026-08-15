/**
 * Multiplayer client.
 *
 * A thin event-emitting wrapper around a WebSocket. The server is a relay: it
 * owns lobby membership and match start, and forwards player state and hit
 * reports. Hits are reported by the shooter rather than resolved server-side —
 * fine for a hobby dogfight game, and documented as such in the README.
 *
 * The protocol is JSON, one message per frame-ish. See server/README.md.
 */

/** How often we push our own state to the server (seconds). */
const STATE_HZ = 15;

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.name = 'Pilot';
    this.room = null;
    this.players = new Map(); // id -> {id, name, plane, p, q, hp, alive, last}
    this.handlers = new Map();
    this._stateAccum = 0;
  }

  /* ---------- tiny event bus ---------- */

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.handlers.get(event) ?? []) fn(payload);
  }

  /* ---------- connection ---------- */

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url, name) {
    this.disconnect();
    this.name = name || 'Pilot';

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.emit('disconnected', `Bad server address: ${err.message}`);
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.send({ t: 'hello', name: this.name });
      this.emit('connected');
      this.send({ t: 'list' });
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handle(msg);
    });

    ws.addEventListener('error', () => {
      this.emit('disconnected', 'Could not reach that server');
    });

    ws.addEventListener('close', () => {
      this.players.clear();
      this.room = null;
      this.emit('disconnected', 'Disconnected');
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.players.clear();
    this.room = null;
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  /* ---------- lobby ---------- */

  createLobby({ name, map, max, password, duration = 600 }) {
    this.send({ t: 'create', name, map, max, password, duration });
  }

  joinLobby(id, password) {
    this.send({ t: 'join', id, password });
  }

  leaveLobby() {
    this.send({ t: 'leave' });
    this.room = null;
    this.players.clear();
  }

  startMatch() {
    this.send({ t: 'start' });
  }

  refreshLobbies() {
    this.send({ t: 'list' });
  }

  /* ---------- in-match ---------- */

  /** Push our own aircraft state, rate limited to STATE_HZ. */
  pushState(dt, state) {
    if (!this.connected || !this.room?.running) return;
    this._stateAccum += dt;
    if (this._stateAccum < 1 / STATE_HZ) return;
    this._stateAccum = 0;

    this.send({
      t: 'state',
      p: [round(state.position.x), round(state.position.y), round(state.position.z)],
      q: [
        round(state.quaternion.x, 3), round(state.quaternion.y, 3),
        round(state.quaternion.z, 3), round(state.quaternion.w, 3)
      ],
      s: Math.round(state.speed),
      hp: Math.round(state.hp),
      alive: state.alive ? 1 : 0,
      plane: state.plane
    });
  }

  reportHit(targetId, damage) {
    this.send({ t: 'hit', target: targetId, damage: Math.round(damage) });
  }

  reportDeath(killerId) {
    this.send({ t: 'died', by: killerId ?? null });
  }

  /* ---------- inbound ---------- */

  handle(msg) {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        break;

      case 'lobbies':
        this.emit('lobbies', msg.list);
        break;

      case 'joined':
        this.room = this.decorate(msg.room);
        this.emit('joined', this.room);
        break;

      case 'room':
        this.room = this.decorate(msg.room);
        this.emit('room', this.room);
        break;

      case 'start':
        this.room = this.decorate(msg.room);
        this.room.running = true;
        this.players.clear();
        this.emit('start', this.room);
        break;

      case 'states':
        for (const p of msg.players) {
          if (p.id === this.id) continue;
          const existing = this.players.get(p.id);
          if (existing) {
            Object.assign(existing, p, { last: performance.now() });
          } else {
            this.players.set(p.id, { ...p, last: performance.now() });
          }
        }
        break;

      case 'left':
        this.players.delete(msg.id);
        this.emit('left', msg.id);
        break;

      case 'killed':
        this.emit('killed', msg);
        break;

      case 'over':
        if (this.room) this.room.running = false;
        this.emit('over', msg);
        break;

      case 'error':
        this.emit('status', msg.message);
        break;
    }
  }

  decorate(room) {
    if (!room) return null;
    return { ...room, isHost: room.host === this.id, running: !!room.running };
  }
}

const round = (n, p = 1) => Number(n.toFixed(p));
