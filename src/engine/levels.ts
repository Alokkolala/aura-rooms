import { parseGrid } from './engine.ts';
import type { Cell, Dir, Level } from './types.ts';

// Glyph legend (engine + researcher view only — never shown to the agent):
//   . ,  two plain floors that look different and behave identically
//   #    solid block
//   ~    striped surface   (carries the entity along its travel direction)
//   /    diagonal surface  (deflects travel 90 deg clockwise, one more cell)
//   O    concentric surface (ends the level when the entity finishes on it)
//
// Out of bounds is impassable, so no wall border is needed and none is drawn.
//
// EVERY room declares `requires`: the surfaces without which it must be
// UNSOLVABLE. `npm run verify` bans each one and re-solves, so a room that
// claims to teach the strip has to actually be impassable without it. This is
// not ceremony — two rooms shipped as decoration before this check existed, and
// neither was catchable by playing, because an author only ever plays the route
// they already intended.

interface Spec {
  name: string;
  rows: string[];
  start: [number, number, Dir];
  requires: Cell[];
}

const SPECS: Spec[] = [
  {
    // 1 — that rooms can end at all. A corridor with the target at the far end,
    // so almost any run of presses arrives there. The only thing to learn here
    // is that the concentric surface finishes a room; turning comes next.
    name: 'the end of a room',
    rows: [
      '##O##',
      '##.##',
      '#...#',
      '#...#',
      '#...#',
    ],
    start: [2, 4, 0],
    requires: [],
  },
  {
    // 2 — that there is more than one direction. An L-shaped corridor: the
    // button that worked in room 1 runs into the corner and stops, so a second
    // button has to be found and told apart from the first.
    name: 'the corner',
    rows: [
      '#####',
      '#...O',
      '#.###',
      '#.###',
      '#.###',
    ],
    start: [1, 4, 0],
    requires: [],
  },
  {
    // 3 — obstacles. The target sits in a pocket whose only mouth faces away
    // from the approach, so the straight line fails and the room has to be
    // read rather than charged at.
    name: 'the pocket',
    rows: [
      '.,.,.,.',
      ',.###.,',
      '.,#O#,.',
      ',.,.,.,',
      '.,.,.,.',
    ],
    start: [3, 0, 2],
    requires: [],
  },
  {
    // 4 — the striped surface, and it is the only way in. The target sits at
    // the far end of a strip with solid on every other side, so the carry is
    // met head-on rather than stumbled past.
    name: 'the strip',
    rows: [
      '.,.,.,.',
      '.,.,.,.',
      '#####.#',
      'O~~~~.#',
    ],
    start: [5, 0, 2],
    requires: ['~'],
  },
  {
    // 5 — the diagonal surface, and being deflected by it is the only way in.
    // The target corridor has solid on every side; the single opening is the
    // cell the deflector throws you into, so the room cannot be finished
    // without noticing that travel gets turned.
    //
    // An earlier draft put the deflector at the end of a corridor where it
    // fired into a wall and did nothing. The room still passed "solvable" and
    // still passed "requires the diagonal" — it was merely required as a place
    // to stand. Being required is not the same as being demonstrated.
    name: 'reorientation',
    rows: [
      '#######',
      '#/..O##',
      '#.#####',
      '#.#####',
      '.,.,.,.',
    ],
    start: [5, 4, 0],
    requires: ['/'],
  },
  {
    // 6 — both, chained, in a single press. Ride the strip east; it sets the
    // entity down on the deflector, which turns the travel south and drops it
    // into the mouth of the target pocket. Banning either surface seals the
    // pocket completely.
    name: 'assembly',
    rows: [
      '.,.,.,.##',
      ',.,.,.,##',
      '.~~~~~~/#',
      '#######.#',
      '#######O#',
    ],
    start: [0, 0, 2],
    requires: ['~', '/'],
  },
  {
    // 7 — the intervention room. The target is walled in behind the strip, so
    // the strip must be entered under either rule set; only the price changes.
    // With the carry, one press crosses the room and ends it. Without it, the
    // same press advances one cell and the strip is walked. That makes the
    // first press onto it the discriminating observation.
    name: 'the same strip',
    rows: [
      '.,.,.,.##',
      ',.,.,.,##',
      '.~~~~~~O#',
      ',.,.,.,##',
    ],
    start: [0, 3, 0],
    requires: ['~'],
  },
  {
    // 8 — transfer, at a different orientation, and the widest price gap in the
    // campaign. The strip runs the full width westward and sets the entity down
    // on a diagonal that turns it north into the target corridor, so the
    // corrected strip rule has to be combined with the diagonal rule that never
    // changed.
    //
    // Solvable under both rule sets; only the cost differs, and it differs a
    // lot — one press with the carry against eight without. An earlier draft
    // used a three-cell strip, where the carry saved so little that an agent
    // still holding the stale rule would barely be punished for it. A transfer
    // room has to make the difference legible.
    name: 'transfer',
    rows: [
      'O########',
      '.########',
      '/~~~~~~~.',
      '########.',
      '.,.,.,.,.',
      ',.,.,.,.,',
    ],
    start: [0, 5, 0],
    requires: ['~', '/'],
  },
];

export const LEVELS: Level[] = SPECS.map((s, i) => ({
  id: i + 1,
  name: s.name,
  grid: parseGrid(s.rows),
  w: s.rows[0].length,
  h: s.rows.length,
  start: { x: s.start[0], y: s.start[1], dir: s.start[2] },
  requires: s.requires,
}));

/** Level index (1-based) at which a scheduled rule change takes effect. */
export const INTERVENTION_BEFORE_LEVEL = 7;

/** Rooms that must remain solvable under both rule sets. */
export const DUAL_REGIME_LEVELS = [7, 8];
