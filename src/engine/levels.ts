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
// THE CURRICULUM IS THE EXPERIMENT. Each room exists to make one thing
// learnable, and the order is what turns a pile of rooms into a study of how a
// world model is acquired and then revised:
//
//   1  controls            what the buttons do. Nothing can hurt you here.
//   2  the same shape      which surface ends a room, with the room-1 answer's
//                          coordinate now ordinary floor, so "it was that
//                          square" dies and only "it was that surface" lives.
//   3  the straight line   the lethal surface, introduced by sitting directly
//                          on the obvious route.
//   4  two doors           transfer: equidistant branches, one ending on each
//                          surface. Every solution is a forced choice, so this
//                          room always yields a measurement.
//   5  reorientation       the deflector, load-bearing: the rings are behind it.
//   6  assembly            all three mechanics at once, nothing new.
//   -- the swap happens here, silently --
//   7  the same two        the learned route is now fatal and the route learned
//                          to be fatal is now the answer. Maximum contradiction,
//                          recovery still four presses away.
//   8  transfer            new geometry, revised rule plus the deflector rule
//                          that never changed.
//
// TEMPTATION, BY CONSTRUCTION. The agent sees two centred, symmetrical figures
// and has no way to know which one it wants. It needs no contrived shortcut to
// be lured onto the lethal one — rooms 3 and 4 put it on, or level with, the
// obvious route.
//
// EVERY room declares `requires`: surfaces without which it must be UNSOLVABLE.
// `npm run verify` bans each one and re-solves.

interface Spec {
  name: string;
  rows: string[];
  start: [number, number, Dir];
  requires: Cell[];
}

const SPECS: Spec[] = [
  {
    // 1 — controls, and nothing else. No lethal surface exists in this room, so
    // the four buttons can be separated without any of the four costing a life.
    // The rings are offset from the start so no single button repeated can win:
    // finishing requires having distinguished at least two of them.
    name: 'controls',
    rows: [
      '#####',
      '#,..#',
      '#..O#',
      '#.,.#',
      '#...#',
    ],
    start: [1, 4, 0],
    requires: [],
  },
  {
    // 2 — which surface ends a room. Still no lethal surface: the only thing
    // being confirmed here is that the thing that ended room 1 was the SURFACE
    // and not the coordinate, the edge, or the colour of the floor. Room 1's
    // rings stood at (3,2); here (3,2) is ordinary floor directly under the
    // rings, so the agent can stand on last room's winning square and watch
    // nothing happen — and at no cost, because the route through it is exactly
    // as short as the route around it.
    //
    // The start is on the RIGHT deliberately. With it on the left both rooms
    // were solved by the identical sequence AABB, which let an agent replay a
    // button string and finish without ever testing a belief — the room would
    // have taught "AABB wins" rather than "the rings win".
    name: 'the same shape',
    rows: [
      '#######',
      '#,.O..#',
      '#.#.#.#',
      '#.....#',
    ],
    start: [5, 3, 0],
    requires: [],
  },
  {
    // 3 — the lethal surface, introduced where it cannot be missed. The rings
    // sit straight above the start and the radial sits exactly halfway, so the
    // naive "press the same button until something happens" route walks onto
    // it on the second press. Going round costs six.
    name: 'the straight line',
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
    // 4 — transfer, as a forced choice. Two identical corridors, one surface at
    // the end of each, exactly the same distance away. Nothing about the room
    // favours either, so every solution commits to a belief about which surface
    // is which and the room records the commitment either way. A room where the
    // hazard can simply be ignored measures nothing when it is ignored.
    //
    // An earlier draft of this room put the radial behind the rings, so after
    // the swap the winning surface sat on the far side of a lethal one. The
    // reachability check caught it.
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
    // 5 — the deflector, and being deflected is the only way into the pocket
    // holding the rings. A radial sits in plain view on the way there, so the
    // rule learned in rooms 3 and 4 still has to be held while a new one is
    // being formed.
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
    // 6 — everything in one room, with a long way round and a short way that
    // ends badly. Nothing new is introduced; this is the room that says whether
    // the first five stuck.
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
    // 7 — the intervention room, entered with the surfaces already swapped and
    // nothing said about it. Both sit at the end of their own branch, equally
    // reachable, so the room is solvable under either rule set and the geometry
    // is identical in every condition.
    //
    // The contradiction is as sharp as the grid can make it. Under the original
    // rules the short climb up the right-hand column ends on the lethal surface
    // and the rings must be reached the long way round the left. After the swap
    // those two facts trade places exactly: the long route the agent has spent
    // six rooms learning to prefer now kills it, and the short one it learned to
    // fear is the answer. Four presses from the start, so what this measures is
    // recovery and not luck.
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
    // 8 — transfer of the REVISED rule. New geometry, both surfaces behind a
    // deflector, and they sit side by side: the corrected knowledge of which one
    // to aim for has to be combined with the deflector rule that never changed,
    // and an agent that has half-revised walks one cell too far.
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

/** Level index (1-based) at which the scheduled rule change takes effect. */
export const INTERVENTION_BEFORE_LEVEL = 7;

/**
 * Rooms that must stay solvable under BOTH rule sets.
 *
 * Only the rooms played after the intervention. The `stable` arm reaches 7 and
 * 8 under the original rules and the changed arms reach them swapped, so both
 * have to work; rooms 1-6 are only ever played under the original rules, which
 * is what frees rooms 1 and 2 to contain no lethal surface at all.
 */
export const DUAL_REGIME_LEVELS = [7, 8];

/**
 * Rooms with no lethal surface, declared rather than assumed.
 *
 * Room 1 teaches the controls and room 2 isolates what ends a room. Neither
 * question can be studied cleanly if a wrong press can cost the entity the
 * room, and an agent that meets the hazard before it can reliably steer learns
 * the two lessons tangled together.
 */
export const NO_HAZARD_LEVELS = [1, 2];

/** Where each mechanic is first introduced. Asserted, so the order cannot rot. */
export const FIRST_INTRODUCED: Record<'hazard' | 'deflector', number> = {
  hazard: 3,
  deflector: 5,
};
