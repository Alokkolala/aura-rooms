// Core engine types. Kept "erasable-only" (no enums/namespaces) so Node can run
// these files directly via native type-stripping, with no build step.

/** 0=up 1=right 2=down 3=left — screen-relative. */
export type Dir = 0 | 1 | 2 | 3;
export type Button = 'A' | 'B' | 'C' | 'D';

/**
 * Each button moves the entity one cell in a fixed absolute direction. There is
 * no turning: the entity has no heading to steer, and the marker it carries is
 * cosmetic, showing the way it last travelled.
 *
 * The labels are arbitrary and carry no hint — discovering which is which is
 * the agent's first job, and it takes about four presses. That is the point:
 * an earlier turn-relative scheme (turn left / forward / turn right / back)
 * cost most of a room's budget just to pin down, and the budget is better spent
 * on the surface rules, since a surface rule is what the experiment changes.
 */
export const BUTTON_DIR: Record<Button, Dir> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Map cell glyphs.
 *   '.' ',' two visually distinct but functionally identical plain floors
 *   '#'     solid block
 *   '/'     diagonal surface — deflects travel 90 deg clockwise, one more cell
 *   'O'     concentric surface  (rings)
 *   'X'     radial surface      (spokes)
 *
 * O and X are deliberately drawn as siblings: both are centred, symmetrical
 * figures that differ only in their pattern. One ends the room and the other
 * kills; which is which is exactly what the rule change swaps. Making them look
 * like a matched pair is what makes "perhaps those two traded places" a
 * hypothesis an agent can actually reach.
 */
export type Cell = '.' | ',' | '#' | '/' | 'O' | 'X';

export interface Level {
  id: number;
  name: string;
  grid: Cell[][];
  w: number;
  h: number;
  start: { x: number; y: number; dir: Dir };
  /**
   * Surfaces this room claims to require. Banning any one of them must make the
   * room unsolvable — checked in `npm run verify`, so the claim cannot rot.
   */
  requires: Cell[];
}

export interface EntityState {
  x: number;
  y: number;
  dir: Dir;
}

/** The mutable part of world physics. This is what a hidden change edits. */
export interface Rules {
  /**
   * false: concentric ends the room, radial is lethal.
   * true:  they have swapped meanings.
   *
   * Nothing about either surface's appearance changes. This is a harsher change
   * than the one it replaced: the old rule change cost the agent moves, this one
   * costs it the room. Acting on stale knowledge is no longer expensive, it is
   * fatal, which is the point.
   */
  swapped: boolean;
}

export interface StepResult {
  /** landed on the lethal surface; the entity is returned to the room start */
  died: boolean;
  /**
   * The cell the entity was standing on when it died.
   *
   * Reported because it is plainly visible — the death happens THERE, in front
   * of you. Without it the agent sees only "I was here, now I am back at the
   * start", which makes the lethal surface impossible to identify and so makes
   * the whole experiment unwinnable. Found the hard way: an agent concluded it
   * died from "returning to the starting position".
   */
  diedAt: { x: number; y: number } | null;
  state: EntityState;
  /** every intermediate pose, for animation. path[0] is the pre-action pose. */
  path: EntityState[];
  /** the action could not begin: target cell was solid or out of bounds */
  blocked: boolean;
  /** cells traversed by automatic surface movement, after the initial move */
  autoMoved: number;
  /** effect resolution hit its iteration cap or revisited a pose */
  cycleGuardTripped: boolean;
  complete: boolean;
}

export const BUTTONS: Button[] = ['A', 'B', 'C', 'D'];

/** dx,dy per Dir. */
export const DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Bumped whenever button semantics, surface behaviour, or the level set change
 * in a way that makes older recordings unreplayable.
 *
 * v1: turn-relative buttons (turn left / forward / turn right / back), diagonal
 *     rotated the entity in place.
 * v2: four absolute directions, diagonal deflects travel, all eight rooms
 *     rebuilt. See runs/archive-engine-v1/.
 * v3: striped surface removed entirely. The rule change is now a swap between
 *     the goal surface and a lethal one. See runs/archive-engine-v2/.
 */
export const ENGINE_VERSION = 3;

/** Hard cap on automatic effect resolution so the engine can never hang. */
export const MAX_EFFECT_ITERATIONS = 64;
