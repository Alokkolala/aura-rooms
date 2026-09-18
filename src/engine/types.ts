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
 *   '~'     striped surface
 *   '/'     diagonal surface
 *   'O'     concentric surface
 */
export type Cell = '.' | ',' | '#' | '~' | '/' | 'O';

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
  /** striped surface carries the entity along its direction of travel */
  slipperyEnabled: boolean;
}

export interface StepResult {
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
 *     rebuilt. v1 recordings reference rooms that no longer exist and will not
 *     replay — see runs/archive-engine-v1/.
 */
export const ENGINE_VERSION = 2;

/** Hard cap on automatic effect resolution so the engine can never hang. */
export const MAX_EFFECT_ITERATIONS = 64;
