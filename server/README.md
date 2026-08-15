# Warbird lobby server

A small Node WebSocket relay. It owns lobby membership and match lifecycle and
fans out player state; it does **not** simulate flight.

```bash
npm install
npm run server        # :8080, or set PORT
```

Then in the game's Multiplayer screen, point **Server** at `ws://localhost:8080`
(or `wss://…` once deployed) and connect. You can also preselect it with a query
parameter: `?server=wss://your-host`.

## Deploying

GitHub Pages is static hosting and cannot run this. Any free Node host works —
Render, Fly.io, Railway. Deploy the repo, set the start command to
`node server/index.js`, and use the resulting `wss://` URL in the client.

## Protocol

JSON messages, one object per frame. `→` is client to server.

| → | Meaning |
|---|---------|
| `{t:'hello', name}` | announce callsign |
| `{t:'list'}` | request the public lobby list |
| `{t:'create', name, map, max, password, duration}` | open a lobby; `password` makes it private |
| `{t:'join', id, password}` | join by id |
| `{t:'leave'}` | leave the current lobby |
| `{t:'start'}` | host only: begin the match |
| `{t:'state', p, q, s, hp, alive, plane}` | own aircraft state, ~15 Hz |
| `{t:'score', n}` | add to own score |
| `{t:'hit', target, damage}` | report damage dealt |
| `{t:'died', by}` | report own death and who caused it |

| ← | Meaning |
|---|---------|
| `{t:'welcome', id}` | your connection id |
| `{t:'lobbies', list}` | public lobby list |
| `{t:'joined', room}` / `{t:'room', room}` | room state |
| `{t:'start', room}` | match beginning |
| `{t:'states', players}` | everyone's latest state, ~15 Hz |
| `{t:'damaged', by, damage}` | you were hit |
| `{t:'killed', victim, killer, …}` | kill feed entry |
| `{t:'left', id}` | someone disconnected |
| `{t:'over', standings}` | match ended |
| `{t:'error', message}` | e.g. wrong password |

## Trust model

Damage and deaths are reported by clients, so a modified client can lie. This is
a hobby dogfight server for people who know each other. Making it authoritative
means moving flight integration and hit resolution server-side — a much larger
job, and the reason it was not done here.
