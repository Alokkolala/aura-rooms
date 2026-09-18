// Core engine types. Kept "erasable-only" (no enums/namespaces) so Node can run
// these files directly via native type-stripping, with no build step.

/** 0=north(up) 1=east(right) 2=south(down) 3=west(left) — screen-relative. */
export type Dir = 0 | 1 | 2 | 3;
export type Button = 'A' | 'B' | 'C' | 'D';

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

/** Hard cap on automatic effect resolution so the engine can never hang. */
export const MAX_EFFECT_ITERATIONS = 64;
