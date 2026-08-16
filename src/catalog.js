/**
 * Content catalogue: aircraft, guns and bombs.
 *
 * Everything here is plain data. The flight model, the shop and the model
 * factory all read from these tables, so adding content never means touching
 * game logic — add an entry, give it a price, and it appears in the shop.
 *
 * UNITS
 *   Distances are world units, and the sim treats 1 unit as roughly 1 metre.
 *   Speeds in the tables are the raw numbers the physics uses; the HUD shows
 *   `speed * 1.15` as "kt" so the displayed figures land in a believable range
 *   for piston fighters. `displaySpeed()` below does that conversion so the shop
 *   and the HUD never disagree.
 */

export const KT = 1.15;

/** Physics speed -> the knots figure shown to the player. */
export const displaySpeed = (v) => Math.round(v * KT);

/* ==========================================================================
   Aircraft
   ==========================================================================

   thrust     engine power; fights `drag * v^2`, so top speed is sqrt(thrust/drag)
   stall      below this the wing stops supporting the aircraft and it sinks
   pitch/roll/yaw   control rates in radians per second at full authority
   armour     hit points; a 20mm shell does ~12, a heavy bomb blast ~60
   bombLoad   bombs carried per sortie
   guns       number of gun mounts — total damage scales with this
   handling   0..1 summary used only for the shop bar graphs
*/

export const PLANES = [
  {
    id: 'sparrow',
    name: 'Sparrow T.1',
    role: 'Trainer',
    price: 0,
    blurb:
      'A forgiving two-seat trainer. Slow, docile and almost impossible to depart ' +
      'from controlled flight — which is exactly why every pilot starts here. ' +
      'Carries a light bomb load and a single rifle-calibre gun.',
    maxSpeed: 132,
    stall: 34,
    thrust: 72,
    drag: 0.0041,
    pitch: 1.05,
    roll: 2.0,
    yaw: 0.55,
    armour: 55,
    bombLoad: 8,
    guns: 1,
    ceiling: 720,
    handling: 0.78,
    model: {
      length: 8.2, span: 5.0, chord: 2.6, tail: 'single', engines: 1,
      body: 0x6f7f5c, trim: 0xd8cdb0, wing: 0x77875f, spinner: 0xb8483a
    }
  },
  {
    id: 'falcon',
    name: 'Falcon Mk.V',
    role: 'Fighter',
    price: 900,
    blurb:
      'The workhorse single-seat fighter. Balanced across the board: quick enough ' +
      'to catch anything it needs to, agile enough to turn with most of it, and ' +
      'tough enough to bring you home. Four gun mounts.',
    maxSpeed: 168,
    stall: 42,
    thrust: 96,
    drag: 0.0052,
    pitch: 1.15,
    roll: 2.35,
    yaw: 0.55,
    armour: 100,
    bombLoad: 24,
    guns: 4,
    ceiling: 900,
    handling: 0.72,
    model: {
      length: 9.0, span: 5.6, chord: 2.9, tail: 'single', engines: 1,
      body: 0x4b5d3a, trim: 0xb9b295, wing: 0x4b5d3a, spinner: 0x8e2f27
    }
  },
  {
    id: 'comet',
    name: 'Comet R.2',
    role: 'Interceptor',
    price: 2100,
    blurb:
      'Built around one very large engine and not much else. Blistering in a ' +
      'straight line and vicious in the vertical, but it rolls into a turn faster ' +
      'than it recovers from one, and the airframe is thin. Land it fast or not at all.',
    maxSpeed: 214,
    stall: 56,
    thrust: 168,
    drag: 0.0037,
    pitch: 1.35,
    roll: 3.1,
    yaw: 0.5,
    armour: 78,
    bombLoad: 12,
    guns: 4,
    ceiling: 1100,
    handling: 0.55,
    model: {
      length: 9.6, span: 5.2, chord: 2.5, tail: 'single', engines: 1,
      body: 0x37506b, trim: 0xd6dbe0, wing: 0x37506b, spinner: 0xe0c04a
    }
  },
  {
    id: 'hammer',
    name: 'Hammer A.3',
    role: 'Ground attack',
    price: 3200,
    blurb:
      'An armoured gun platform for working low over a target. It will not win a ' +
      'turning fight, but it absorbs punishment that would fold a fighter, carries ' +
      'a heavy bomb load, and mounts six guns in the nose.',
    maxSpeed: 152,
    stall: 46,
    thrust: 104,
    drag: 0.0068,
    pitch: 0.92,
    roll: 1.75,
    yaw: 0.6,
    armour: 210,
    bombLoad: 40,
    guns: 6,
    ceiling: 780,
    handling: 0.5,
    model: {
      length: 10.2, span: 6.4, chord: 3.3, tail: 'twin', engines: 1,
      body: 0x5a5348, trim: 0x9aa0a4, wing: 0x4f4a41, spinner: 0x2f3235
    }
  },
  {
    id: 'fortress',
    name: 'Fortress B.9',
    role: 'Heavy bomber',
    price: 5400,
    blurb:
      'Four engines, an enormous bay, and the turning circle of a container ship. ' +
      'Flown properly it flattens a district in one pass. Flown badly it is the ' +
      'largest target in the sky.',
    maxSpeed: 146,
    stall: 52,
    thrust: 118,
    drag: 0.0074,
    pitch: 0.7,
    roll: 1.15,
    yaw: 0.45,
    armour: 320,
    bombLoad: 80,
    guns: 4,
    ceiling: 950,
    handling: 0.3,
    model: {
      length: 13.5, span: 9.5, chord: 4.2, tail: 'twin', engines: 4,
      body: 0x8d9299, trim: 0xc9ced2, wing: 0x8d9299, spinner: 0x3a3f42
    }
  },
  {
    id: 'vector',
    name: 'Vector J.1',
    role: 'Jet',
    price: 9800,
    blurb:
      'The first of the turbojets. No propeller, no torque, and acceleration that ' +
      'makes everything else feel moored. The catch is inertia: it does not slow ' +
      'down when you want it to, and the approach speed is brutal.',
    maxSpeed: 268,
    stall: 68,
    thrust: 240,
    drag: 0.0033,
    pitch: 1.2,
    roll: 2.9,
    yaw: 0.42,
    armour: 130,
    bombLoad: 20,
    guns: 4,
    ceiling: 1400,
    handling: 0.48,
    jet: true,
    model: {
      length: 10.8, span: 5.4, chord: 2.4, tail: 'single', engines: 2,
      body: 0x3f474d, trim: 0xb0b6ba, wing: 0x3f474d, spinner: 0x1e2225
    }
  }
];

/* ==========================================================================
   Guns
   ==========================================================================

   damage    per hit, per mount
   rpm       rounds per minute, per mount
   velocity  muzzle velocity in units/sec — decides lead and drop
   spread    cone half-angle in radians; smaller is tighter
   ammo      rounds per mount for the whole sortie
*/

export const GUNS = [
  {
    id: 'rifle',
    name: '7.9mm MG',
    price: 0,
    blurb:
      'Rifle-calibre machine gun. Very high rate of fire, very little weight of ' +
      'shot — it will shred a pedestrian or a fuel drum but barely scratches ' +
      'masonry. Generous ammunition.',
    damage: 4,
    rpm: 1150,
    velocity: 760,
    spread: 0.016,
    ammo: 900,
    tracer: 0xffe066,
    calibre: '7.9 mm'
  },
  {
    id: 'fifty',
    name: '12.7mm HMG',
    price: 600,
    blurb:
      'The standard heavy machine gun. Enough punch to matter against aircraft, ' +
      'flat trajectory, and still plenty of rounds. The safe default.',
    damage: 9,
    rpm: 780,
    velocity: 870,
    spread: 0.012,
    ammo: 600,
    tracer: 0xffd24a,
    calibre: '12.7 mm'
  },
  {
    id: 'cannon20',
    name: '20mm Cannon',
    price: 1500,
    blurb:
      'Explosive shells. A short burst downs a fighter and a sustained one opens ' +
      'up a building. Slower firing and much less ammunition, so it rewards ' +
      'holding fire until the shot is there.',
    damage: 22,
    rpm: 600,
    velocity: 800,
    spread: 0.010,
    ammo: 280,
    tracer: 0xff9a3c,
    calibre: '20 mm'
  },
  {
    id: 'cannon30',
    name: '30mm Cannon',
    price: 3200,
    blurb:
      'Anti-armour autocannon. Two or three hits will end almost anything flying. ' +
      'It fires slowly, the shells drop noticeably at range, and you get very few ' +
      'of them — every trigger pull is a decision.',
    damage: 52,
    rpm: 380,
    velocity: 690,
    spread: 0.009,
    ammo: 140,
    tracer: 0xff5a2a,
    calibre: '30 mm'
  },
  {
    id: 'gatling',
    name: 'Rotary Gatling',
    price: 5600,
    blurb:
      'Six barrels spun by an electric motor. A wall of fire that saws through ' +
      'structures and aircraft alike, with a short spin-up before the first round ' +
      'leaves. Empties itself alarmingly quickly.',
    damage: 11,
    rpm: 3600,
    velocity: 910,
    spread: 0.020,
    ammo: 1800,
    spinUp: 0.45,
    tracer: 0xff3b1f,
    calibre: '20 mm rotary'
  }
];

/* ==========================================================================
   Bombs
   ==========================================================================

   blast     radius in units that structures inside are destroyed
   damage    applied to aircraft caught in the blast
   drag      air resistance — heavier bombs fall straighter and truer
   cluster   if set, the bomb splits into this many bomblets before impact
*/

export const BOMBS = [
  {
    id: 'light',
    name: '50kg Light',
    price: 0,
    blurb:
      'A small general-purpose bomb. Small blast, but you carry a great many of ' +
      'them, so it suits fast repeat passes down a street rather than one big hit.',
    blast: 20,
    damage: 40,
    weight: 50,
    dragCoef: 0.11,
    countMult: 1.6,
    colour: 0x4a5157
  },
  {
    id: 'gp250',
    name: '250kg GP',
    price: 400,
    blurb:
      'The standard general-purpose bomb, and the one the bomb sight is calibrated ' +
      'around. Reliable blast radius, predictable fall, no surprises.',
    blast: 30,
    damage: 70,
    weight: 250,
    dragCoef: 0.09,
    countMult: 1.0,
    colour: 0x3d4247
  },
  {
    id: 'heavy500',
    name: '500kg Heavy',
    price: 1300,
    blurb:
      'Takes out a whole block corner in one. Falls fast and true, but you carry ' +
      'barely half as many, and dropping one below about 60 m puts you inside your ' +
      'own blast.',
    blast: 48,
    damage: 130,
    weight: 500,
    dragCoef: 0.06,
    countMult: 0.55,
    colour: 0x33383c
  },
  {
    id: 'cluster',
    name: 'Cluster Munition',
    price: 2400,
    blurb:
      'Opens at altitude and scatters twelve bomblets across a wide footprint. ' +
      'Poor against a single hard target, devastating against a densely built ' +
      'district. Aim upwind of where you actually want it.',
    blast: 18,
    damage: 35,
    weight: 300,
    dragCoef: 0.13,
    countMult: 0.7,
    cluster: 12,
    clusterAt: 70,
    colour: 0x5a6068
  },
  {
    id: 'incendiary',
    name: 'Incendiary',
    price: 3600,
    blurb:
      'Sets everything inside the blast alight. The initial radius is modest, but ' +
      'the fire keeps spreading to neighbouring buildings for a while after the ' +
      'hit — one well-placed stick can take a whole block over the next minute.',
    blast: 26,
    damage: 55,
    weight: 220,
    dragCoef: 0.10,
    countMult: 0.9,
    incendiary: { spread: 46, interval: 1.4, waves: 6 },
    colour: 0x7a4a2a
  }
];

/* ------------------------------------------------------------------ */

export const byId = (list, id) => list.find((x) => x.id === id) ?? list[0];
export const planeById = (id) => byId(PLANES, id);
export const gunById = (id) => byId(GUNS, id);
export const bombById = (id) => byId(BOMBS, id);

/** Rounds per second across every mount on the aircraft. */
export const fireRate = (gun, mounts) => (gun.rpm / 60) * mounts;

/** Bombs actually carried, once the airframe's bay and the bomb size are combined. */
export const bombCount = (plane, bomb) =>
  Math.max(1, Math.round(plane.bombLoad * bomb.countMult));
