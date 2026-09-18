import { parseGrid } from './engine.ts';
import type { Dir, Level } from './types.ts';

// Glyph legend (engine + researcher view only — never shown to the agent):
//   . ,  two plain floors that look different and behave identically
//   #    solid block
//   ~    striped surface   (carries the entity along its travel direction)
//   /    diagonal surface  (rotates the entity 90 deg clockwise on entry)
//   O    concentric surface (ends the level when the entity finishes on it)
//
// Out of bounds is impassable, so no wall border is needed and no grid space
// is wasted on one.

interface Spec {
  name: string;
  rows: string[];
  start: [number, number, Dir];
}

const SPECS: Spec[] = [
  {
    // 1 — first discovery. Two presses of one button is enough, so the agent
    // can stumble into the completion signal and learn that it exists.
    name: 'first contact',
    rows: [
      '.,.,.',
      ',.O.,',
      '.,.,.',
      ',.,.,',
      '.,.,.',
    ],
    start: [2, 3, 0],
  },
  {
    // 2 — direction. Target is off the starting axis, so movement alone
    // cannot reach it; some turn button has to be found.
    name: 'off axis',
    rows: [
      '.,.,.',
      ',.,.,',
      '.,.,O',
      ',.,.,',
      '.,.,.',
    ],
    start: [2, 3, 0],
  },
  {
    // 3 — obstacles. The straight line is walled off; the agent must route.
    name: 'detour',
    rows: [
      '.,.,.,.',
      ',.,.,.,',
      '.,.,O,.',
      ',###.#,',
      '.,.,.,.',
      ',.,.,.,',
      '.,.,.,.',
    ],
    start: [3, 4, 0],
  },
  {
    // 4 — striped surface, introduced safely. Entering it northbound does
    // nothing (wedged against the blocks), entering it eastbound carries the
    // entity two cells. Nothing is lost either way, so the contrast is free
    // to discover.
    name: 'the strip',
    rows: [
      '#######',
      '.~~~~O,',
      ',.,.,.,',
      '.,.,.,.',
    ],
    start: [2, 3, 0],
  },
  {
    // 5 — diagonal surface. A corridor forces contact with it, and afterwards
    // the button that used to go "up the corridor" goes sideways instead.
    name: 'reorientation',
    rows: [
      '.,.O.,.',
      ',.,.,.,',
      '###.###',
      ',.,/.,,',
      '###.###',
      ',.,.,.,',
      '.,.,.,.',
    ],
    start: [3, 6, 0],
  },
  {
    // 6 — combination. The solid mass leaves exactly one way north, and it is
    // the strip; riding it northbound is the only way to reach the top row,
    // where it deposits the entity onto the diagonal. An earlier draft of this
    // map had an open column on the right and the solver went straight up it,
    // touching neither special surface — see RESEARCH_LOG E2.
    name: 'assembly',
    rows: [
      '/.,.,.O,.',
      '~########',
      '~########',
      '~########',
      '~########',
      '.,.,.,.,.',
      ',.,.,.,.,',
    ],
    start: [4, 6, 0],
  },
  {
    // 7 — the intervention level. Identical geometry in every condition and
    // solvable under both rule sets: with the carry, one press crosses the
    // room and completes; without it, the same press advances one cell and
    // the room is crossed on foot. That makes the first press onto the strip
    // the discriminating observation.
    name: 'the same strip',
    rows: [
      '.,.,.,.,.',
      ',.,.,.,.,',
      '.~~~~~~O,',
      ',.,.,.,.,',
      '.,.,.,.,.',
      ',.,.,.,.,',
      '.,.,.,.,.',
    ],
    start: [0, 6, 0],
  },
  {
    // 8 — transfer. New geometry that needs the corrected strip rule together
    // with the diagonal rule, which never changed. Solvable under both rule
    // sets; only the cost differs.
    name: 'transfer',
    rows: [
      '.,.,.,.,.',
      ',.,.,.,O,',
      '.,.,.,#,.',
      ',~~~~~/,.',
      '.,.,.,.,.',
      ',.,.,.,.,',
      '.,.,.,.,.',
    ],
    start: [0, 6, 0],
  },
];

export const LEVELS: Level[] = SPECS.map((s, i) => ({
  id: i + 1,
  name: s.name,
  grid: parseGrid(s.rows),
  w: s.rows[0].length,
  h: s.rows.length,
  start: { x: s.start[0], y: s.start[1], dir: s.start[2] },
}));

/** Level index (1-based) at which a scheduled rule change takes effect. */
export const INTERVENTION_BEFORE_LEVEL = 7;
