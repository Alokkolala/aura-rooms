import { parseGrid } from './engine.ts';
import type { Cell, Dir, Level } from './types.ts';

// Glyph legend (engine + researcher view only — never shown to the agent):
//   . ,  two plain floors that look different and behave identically
//   #    solid block
//   /    diagonal surface — deflects travel 90 deg clockwise, one more cell
//   O    concentric surface (rings)
//   X    radial surface     (spokes)
//
// Under the original rules O ends the room and X kills. The rule change swaps
// them. Neither changes appearance.
//
// TEMPTATION, BY CONSTRUCTION. The agent sees two centred, symmetrical figures
// and has no way to know which one it wants. It needs no contrived shortcut to
// be lured onto the lethal one — it only needs the lethal one to be the nearer
// of the two, which is how the early rooms are laid out. A greedy agent walks
// into it and learns what it does; a cautious one may not, and then arrives at
// the intervention never having seen that surface do anything. That risk is
// deliberate and is part of what this design is testing.
//
// EVERY room declares `requires`: surfaces without which it must be UNSOLVABLE.
// `npm run verify` bans each one and re-solves. Every room must also be
// solvable under BOTH rule sets, so the swap can be applied anywhere.

interface Spec {
  name: string;
  rows: string[];
  start: [number, number, Dir];
  requires: Cell[];
}

const SPECS: Spec[] = [
  {
    // 1 — that rooms end, and that one of these two surfaces is not the way to
    // end them. The radial sits directly between the start and the rings, two
    // presses away against four. Pressing one button twice reaches it.
    name: 'two targets',
    rows: [
      '##O##',
      '#...#',
      '#.X.#',
      '#...#',
      '#...#',
    ],
    start: [2, 4, 0],
    requires: [],
  },
  {
    // 2 — a second direction, with the lethal surface one press from the start
    // and the rings a long way round an L. Maximum lure, no coercion.
    name: 'the corner',
    rows: [
      '#####',
      '#...O',
      '#.###',
      '#.#X#',
      '#...#',
    ],
    start: [3, 4, 0],
    requires: [],
  },
  {
    // 3 — the deflector, and being deflected is the only way into the pocket
    // holding the rings. A radial sits in plain view on the way there.
    name: 'reorientation',
    rows: [
      '#######',
      '#/..O##',
      '#.#####',
      '#.##X##',
      '.,.,.,.',
    ],
    start: [5, 4, 0],
    requires: ['/'],
  },
  {
    // 4 — open ground, both surfaces visible, nothing forced. Which one the
    // agent walks to is entirely its own call, and by now it should have a
    // reason for the choice.
    name: 'open ground',
    rows: [
      '.,.,.,O',
      ',.,.,.,',
      '.,.X.,.',
      ',.,.,.,',
      '.,.,.,.',
    ],
    start: [0, 4, 0],
    requires: [],
  },
  {
    // 5 — a clean forced choice. Two identical corridors, one surface at the end
    // of each, exactly the same distance away. Nothing about the room favours
    // either. An agent that has learned which is which walks straight to it; one
    // that has not is guessing, and the room says so.
    //
    // The first draft of this room put the radial behind the rings, so after the
    // swap the winning surface sat on the far side of a lethal one and the room
    // became unwinnable. The reachability check caught it.
    name: 'two doors',
    rows: [
      '#######',
      '#X###O#',
      '#.###.#',
      '#.###.#',
      '#..,..#',
    ],
    start: [3, 4, 0],
    requires: [],
  },
  {
    // 6 — everything in one room, with a long way round and a short way that
    // ends badly.
    name: 'assembly',
    rows: [
      '.,.,.,.##',
      ',.####.,#',
      '.,#OX#.,#',
      ',.#..#.,#',
      '.,./#,.,.',
    ],
    start: [8, 4, 0],
    requires: ['/'],
  },
  {
    // 7 — the intervention room. Both surfaces sit side by side at the end of
    // the same corridor, equally reachable, so the room is solvable under
    // either rule set and the geometry is identical in every condition.
    //
    // An agent still carrying the original rule walks onto the rings and dies.
    // The room stays winnable afterwards — the other surface is one cell away —
    // so what this measures is recovery, not luck.
    // The first draft put the two surfaces side by side in a dead end, so the
    // radial was reachable only by walking over the rings. After the swap that
    // left the winning surface behind a lethal one and the room was unwinnable.
    // Now each sits at the end of its own branch.
    //
    // The result is the sharpest room in the campaign. Under the original rules
    // the short route up the right-hand column ends on the lethal surface and
    // the rings must be reached the long way round. After the swap those two
    // facts trade places exactly: the short route is now correct and the long
    // one is fatal.
    name: 'the same two',
    rows: [
      '#########',
      '#.,.,.O.#',
      '#.#####.#',
      '#.#####X#',
      '.,.,.,.,.',
    ],
    start: [4, 4, 0],
    requires: [],
  },
  {
    // 8 — transfer. New geometry, both surfaces behind a deflector, so the
    // corrected knowledge of which one to aim for has to be combined with the
    // deflector rule that never changed.
    name: 'transfer',
    rows: [
      '##XO#####',
      '##..#####',
      '##/######',
      '#..######',
      '.,.,.,.,.',
      ',.,.,.,.,',
    ],
    start: [7, 5, 0],
    requires: ['/'],
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

/** Rooms that must stay solvable under both rule sets — here, all of them. */
export const DUAL_REGIME_LEVELS = LEVELS.map((l) => l.id);
