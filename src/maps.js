/**
 * Map definitions. Pure data — `world.js` turns one of these into a scene.
 *
 * Runways are always axis-aligned (along X or Z). That keeps every collision
 * box axis-aligned, which is what the bomb and airframe tests assume; variety
 * comes from where the field sits relative to the town and what is in the way.
 */

export const MAPS = [
  {
    id: 'midtown',
    name: 'Midtown',
    blurb: 'A dense grid on open farmland. Long runway, clear approach, nothing in the way.',
    difficulty: 'Easy',
    env: {
      skyTop: 0x2f6fb0,
      skyHorizon: 0xbcd4e2,
      fogDensity: 0.00052,
      sunDir: [0.42, 0.62, -0.66],
      sunColor: 0xfff2dc,
      sunIntensity: 2.5,
      hemiSky: 0xbdd7ef,
      hemiGround: 0x4a5a3a,
      hemiIntensity: 1.15,
      ambient: 0.18,
      exposure: 1.05,
      clouds: { count: 46, opacity: 0.85, color: 0xffffff, baseY: 200, spread: 320 }
    },
    ground: 0x5f7a45,
    town: {
      grid: 9, block: 76, road: 18,
      minH: 7, maxH: 29, downtown: 3.4,
      vacancy: 0.12, bigLotChance: 0.25,
      park: [2, 6],
      style: 'office',
      facades: [0xa89f92, 0x8f9aa3, 0xb0857a, 0x9aa08d, 0xc2b7a4, 0x7f8a92],
      roadColor: 0x2f3235,
      roofColor: 0x4a4a4c,
      lawnColor: 0x4e7d3a
    },
    runway: { x: 0, z: 620, length: 300, width: 30, axis: 'z', dir: -1, hangars: 2 },
    scatter: [{ kind: 'tree', count: 140, spread: 1600, offset: [0, 60] }]
  },

  {
    id: 'bayside',
    name: 'Bayside',
    blurb: 'A harbour city on the water. The field is a causeway across the bay, and it runs crosswise.',
    difficulty: 'Moderate',
    env: {
      skyTop: 0x2a6ea8,
      skyHorizon: 0xcfe0e6,
      fogDensity: 0.00058,
      sunDir: [-0.5, 0.55, -0.55],
      sunColor: 0xfff4e2,
      sunIntensity: 2.4,
      hemiSky: 0xc6e2f2,
      hemiGround: 0x486070,
      hemiIntensity: 1.2,
      ambient: 0.2,
      exposure: 1.08,
      clouds: { count: 54, opacity: 0.8, color: 0xffffff, baseY: 180, spread: 300 }
    },
    ground: 0x6d7c4c,
    town: {
      grid: 8, block: 82, road: 20,
      minH: 9, maxH: 34, downtown: 4.4,
      vacancy: 0.10, bigLotChance: 0.3,
      park: [1, 5],
      style: 'office',
      facades: [0x9aa7b0, 0xb9b0a2, 0x8894a0, 0xa8b2b8, 0xc0b49f],
      roadColor: 0x33383c,
      roofColor: 0x444a4e,
      lawnColor: 0x4f7f3c
    },
    runway: { x: 0, z: 700, length: 280, width: 32, axis: 'x', dir: 1, hangars: 1 },
    water: { at: 470, level: 0.3, color: 0x1e5070, opacity: 0.9 },
    piers: 4,
    scatter: [{ kind: 'tree', count: 90, spread: 1300, offset: [0, -140] }]
  },

  {
    id: 'dustbasin',
    name: 'Dust Basin',
    blurb: 'A low adobe town on a desert floor, hemmed in by buttes. Rock does not fall down when you bomb it.',
    difficulty: 'Hard',
    env: {
      skyTop: 0x4b86b4,
      skyHorizon: 0xe6d2ae,
      fogDensity: 0.00082,
      sunDir: [0.3, 0.78, -0.54],
      sunColor: 0xfff0cc,
      sunIntensity: 3.1,
      hemiSky: 0xf0dfc0,
      hemiGround: 0x8a6b45,
      hemiIntensity: 1.0,
      ambient: 0.22,
      exposure: 1.0,
      clouds: { count: 16, opacity: 0.5, color: 0xfff2dd, baseY: 320, spread: 260 }
    },
    ground: 0xb59263,
    town: {
      grid: 8, block: 60, road: 15,
      minH: 5, maxH: 13, downtown: 1.5,
      vacancy: 0.2, bigLotChance: 0.4,
      park: null,
      style: 'adobe',
      facades: [0xd8b98c, 0xc9a578, 0xe0c79c, 0xbf9468, 0xd2ad84],
      roadColor: 0x8a7350,
      roofColor: 0x9a7c55,
      lawnColor: 0x8f9a5a
    },
    runway: { x: -40, z: 600, length: 260, width: 28, axis: 'z', dir: -1, hangars: 1 },
    mesas: { count: 16, minR: 26, maxR: 62, minH: 55, maxH: 150, color: 0xa8703f, ring: [330, 900] },
    scatter: [{ kind: 'cactus', count: 120, spread: 1700, offset: [0, 0] }]
  },

  {
    id: 'kranzberg',
    name: 'Kranzberg',
    blurb: 'A valley town at dusk, ringed by peaks. Short strip, high ground on both sides of the approach.',
    difficulty: 'Hard',
    env: {
      skyTop: 0x27406e,
      skyHorizon: 0xe8a06a,
      fogDensity: 0.00072,
      sunDir: [-0.72, 0.2, -0.66],
      sunColor: 0xffcf9a,
      sunIntensity: 2.2,
      hemiSky: 0x9fb4d6,
      hemiGround: 0x50564e,
      hemiIntensity: 0.85,
      ambient: 0.24,
      exposure: 1.12,
      clouds: { count: 30, opacity: 0.62, color: 0xffd9b4, baseY: 260, spread: 260 }
    },
    ground: 0x6b7a5e,
    town: {
      grid: 7, block: 68, road: 16,
      minH: 8, maxH: 20, downtown: 2.0,
      vacancy: 0.14, bigLotChance: 0.35,
      park: [2, 4],
      style: 'chalet',
      facades: [0xd8cbb4, 0xc4b49a, 0xb9a288, 0xded2bc],
      roadColor: 0x3a3a38,
      roofColor: 0x6b4a3a,
      lawnColor: 0x5d7a48
    },
    runway: { x: 0, z: 560, length: 220, width: 26, axis: 'z', dir: -1, hangars: 1 },
    mountains: { count: 13, minR: 190, maxR: 340, minH: 260, maxH: 460, color: 0x5d6357, snow: 0xe8eef2, ring: [640, 1150] },
    scatter: [{ kind: 'pine', count: 200, spread: 1500, offset: [0, 0] }]
  },

  {
    id: 'steelworks',
    name: 'Steelworks',
    blurb:
      'A sprawling industrial city under permanent overcast. Big flat sheds and ' +
      'almost no landmarks — easy to get lost over, and very easy to hit.',
    difficulty: 'Moderate',
    env: {
      skyTop: 0x5a6470,
      skyHorizon: 0x9aa2a8,
      fogDensity: 0.00088,
      sunDir: [0.2, 0.5, -0.84],
      sunColor: 0xd8dde0,
      sunIntensity: 1.5,
      hemiSky: 0xa8b2ba,
      hemiGround: 0x4a4a46,
      hemiIntensity: 1.3,
      ambient: 0.3,
      exposure: 1.0,
      clouds: { count: 70, opacity: 0.9, color: 0xb8bec4, baseY: 150, spread: 200 }
    },
    ground: 0x5c6250,
    town: {
      grid: 9, block: 88, road: 20,
      minH: 6, maxH: 26, downtown: 2.2,
      vacancy: 0.08, bigLotChance: 0.5,
      park: [6, 1],
      style: 'office',
      facades: [0x8a8d8f, 0x7b6f63, 0x92918c, 0x6f7a80, 0x87796b],
      roadColor: 0x35383a,
      roofColor: 0x53565a,
      lawnColor: 0x5f7a45
    },
    runway: { x: 0, z: 700, length: 320, width: 32, axis: 'z', dir: -1, hangars: 2 },
    scatter: [{ kind: 'tree', count: 70, spread: 1800, offset: [0, 0] }]
  },

  {
    id: 'nightfall',
    name: 'Nightfall',
    blurb:
      'The same kind of city at two in the morning. Every window is lit and nothing ' +
      'else is — you fly the approach on the PAPI and the instruments alone.',
    difficulty: 'Hard',
    night: true,
    env: {
      skyTop: 0x05070f,
      skyHorizon: 0x1b2436,
      fogDensity: 0.00068,
      sunDir: [-0.4, 0.35, -0.85],
      sunColor: 0x8fa4d0,
      sunIntensity: 0.32,
      hemiSky: 0x2a3550,
      hemiGround: 0x14161c,
      hemiIntensity: 0.5,
      ambient: 0.1,
      exposure: 1.25,
      clouds: { count: 24, opacity: 0.3, color: 0x3d4450, baseY: 220, spread: 260 }
    },
    ground: 0x1d2422,
    town: {
      grid: 9, block: 78, road: 18,
      minH: 8, maxH: 30, downtown: 3.6,
      vacancy: 0.1, bigLotChance: 0.25,
      park: [3, 6],
      style: 'office',
      facades: [0x5a5f66, 0x4e565e, 0x63605a, 0x555a60],
      roadColor: 0x1a1c1f,
      roofColor: 0x2a2d30,
      lawnColor: 0x24331f
    },
    runway: { x: 0, z: 640, length: 300, width: 30, axis: 'z', dir: -1, hangars: 2 },
    scatter: [{ kind: 'tree', count: 90, spread: 1700, offset: [0, 0] }]
  }
];

export const DEFAULT_MAP = MAPS[0];

export const mapById = (id) => MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;

/* ------------------------------------------------------------------ */

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Stylised top-down thumbnail for the map picker, drawn from the same config
 * the world is built from so the preview can't drift from the real layout.
 */
export function drawPreview(canvas, map) {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d');
  const t = map.town;

  // world coordinates -> canvas, framed on the town plus the field
  const span = 1150;
  const px = (x) => W / 2 + (x / span) * W;
  const pz = (z) => H / 2 + (z / span) * H;

  g.fillStyle = hex(map.ground);
  g.fillRect(0, 0, W, H);

  if (map.water) {
    g.fillStyle = hex(map.water.color);
    g.fillRect(0, pz(map.water.at), W, H - pz(map.water.at));
  }

  if (map.mountains || map.mesas) {
    const h = map.mountains ?? map.mesas;
    g.fillStyle = map.mountains ? hex(map.mountains.color) : hex(map.mesas.color);
    for (let i = 0; i < h.count; i++) {
      const a = (i / h.count) * Math.PI * 2 + 0.4;
      const r = (h.ring[0] + h.ring[1]) / 2;
      const rad = ((h.minR + h.maxR) / 2 / span) * W;
      g.beginPath();
      g.arc(px(Math.cos(a) * r), pz(Math.sin(a) * r), rad, 0, Math.PI * 2);
      g.fill();
    }
  }

  // town blocks
  const cell = t.block + t.road;
  const half = (t.grid * cell) / 2;
  const bw = (t.block / span) * W;
  for (let i = 0; i < t.grid; i++) {
    for (let j = 0; j < t.grid; j++) {
      const x = -half + t.road / 2 + i * cell + t.block / 2;
      const z = -half + t.road / 2 + j * cell + t.block / 2;
      const isPark = t.park && t.park[0] === i && t.park[1] === j;
      g.fillStyle = isPark ? hex(t.lawnColor) : hex(t.facades[(i * 3 + j) % t.facades.length]);
      g.fillRect(px(x) - bw / 2, pz(z) - bw / 2, bw, bw);
    }
  }

  // runway
  const r = map.runway;
  g.fillStyle = '#e9e6dd';
  const rl = (r.length / span) * W;
  const rw = Math.max(2, (r.width / span) * W);
  if (r.axis === 'z') g.fillRect(px(r.x) - rw / 2, pz(r.z) - rl / 2, rw, rl);
  else g.fillRect(px(r.x) - rl / 2, pz(r.z) - rw / 2, rl, rw);
}
