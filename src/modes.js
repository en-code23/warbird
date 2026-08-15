/**
 * Game modes.
 *
 * A mode is mostly a set of rules the main loop consults: does the sortie end,
 * is ammunition finite, is the world bounded, and what does a point mean.
 */

export const MODES = [
  {
    id: 'strike',
    name: 'Strike',
    tag: 'Singleplayer',
    blurb:
      'A timed sortie against one city. Destroy as much as you can before the ' +
      'clock runs out — buildings are worth the most, people and vehicles less. ' +
      'Everything you score converts to coins for the shop.',
    timed: true,
    durations: [120, 300, 600],
    defaultDuration: 300,
    finiteAmmo: true,
    bounded: true,
    scoring: { building: 10, pedestrian: 2, kill: 0, landing: 25 }
  },
  {
    id: 'freeflight',
    name: 'Free Flight',
    tag: 'Creative',
    blurb:
      'An endless procedurally generated world with no timer, no limits and ' +
      'unlimited ordnance. Terrain and towns stream in around you as you fly, so ' +
      'there is no edge to the map and nothing to run out of.',
    timed: false,
    infinite: true,
    finiteAmmo: false,
    bounded: false,
    scoring: { building: 0, pedestrian: 0, kill: 0, landing: 0 }
  },
  {
    id: 'multiplayer',
    name: 'Dogfight',
    tag: 'Multiplayer',
    blurb:
      'Public and private lobbies over the network. Shoot each other down or ram ' +
      'them out of the sky, and bomb the city for points on the side. Private ' +
      'lobbies are password protected.',
    timed: true,
    durations: [300, 600, 900],
    defaultDuration: 600,
    finiteAmmo: true,
    bounded: true,
    multiplayer: true,
    scoring: { building: 4, pedestrian: 1, kill: 100, landing: 10 }
  }
];

export const modeById = (id) => MODES.find((m) => m.id === id) ?? MODES[0];

/** mm:ss for the HUD countdown. */
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
