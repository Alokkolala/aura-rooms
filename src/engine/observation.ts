import type { Button, Cell, EntityState, Level } from './types.ts';

/**
 * THE BOUNDARY.
 *
 * Everything the agent is ever allowed to see is built here and nowhere else.
 * Codes describe appearance, never function, so that the name of a surface
 * cannot hand the agent the rule it is supposed to discover. `verify.ts`
 * re-serialises the output of this module for every reachable state of every
 * shipped level and fails the build if a forbidden token appears in it.
 */

const APPEARANCE: Record<Cell, string> = {
  '.': 'tile_0',
  ',': 'tile_1',
  '#': 'solid_tile',
  '~': 'striped_tile',
  '/': 'diagonal_tile',
  O: 'concentric_tile',
};

const MARKER = ['up', 'right', 'down', 'left'] as const;

export interface Pose {
  x: number;
  y: number;
  marker: (typeof MARKER)[number];
}

export interface LastAction {
  button: Button;
  before: Pose;
  after: Pose;
  level_complete: boolean;
}

/**
 * How the room the agent was just in came to an end.
 *
 * Without this the agent never learns what its winning press did. The old code
 * advanced the room and cleared `last_action` in the same breath, so the press
 * that finished a room produced a next-observation of a DIFFERENT room with
 * nothing attached — the agent was asked to work out what ends a room while
 * being denied the single observation that shows it. Worse, running out of
 * actions moved it on too, so success and failure were indistinguishable from
 * the inside.
 *
 * This reports what happened, not why it happened: the final press, where the
 * entity ended up, and whether the room closed or the actions ran out. All of
 * it is on the screen a human player would be looking at.
 */
export interface PreviousRoom {
  room_index: number;
  outcome: 'completed' | 'ran_out_of_actions';
  final_action: LastAction;
}

export interface Observation {
  /** How many rooms have been entered so far. Visible on screen anyway. */
  room_index: number;
  grid: { width: number; height: number; cells: string[][] };
  entities: Array<{ id: string; x: number; y: number; marker: string }>;
  buttons: Button[];
  last_action: LastAction | null;
  /** Present on the first observation of a room, describing the one before it. */
  previous_room?: PreviousRoom;
  budget: { actions_used: number; actions_remaining: number };
  /** Present only in the announced-change condition. Never names the rule. */
  notice?: string;
}

export function pose(s: EntityState): Pose {
  return { x: s.x, y: s.y, marker: MARKER[s.dir] };
}

export function buildObservation(args: {
  level: Level;
  roomIndex: number;
  state: EntityState;
  lastAction: LastAction | null;
  actionsUsed: number;
  actionsRemaining: number;
  previousRoom?: PreviousRoom;
  notice?: string;
}): Observation {
  const { level, state } = args;
  const obs: Observation = {
    room_index: args.roomIndex,
    grid: {
      width: level.w,
      height: level.h,
      cells: level.grid.map((row) => row.map((c) => APPEARANCE[c])),
    },
    entities: [
      { id: 'entity_0', x: state.x, y: state.y, marker: MARKER[state.dir] },
    ],
    buttons: ['A', 'B', 'C', 'D'],
    last_action: args.lastAction,
    budget: {
      actions_used: args.actionsUsed,
      actions_remaining: args.actionsRemaining,
    },
  };
  if (args.previousRoom) obs.previous_room = args.previousRoom;
  if (args.notice) obs.notice = args.notice;
  return obs;
}

/**
 * Tokens that must never reach the agent. The first eight are named in the
 * specification; the rest are English words that would give away a surface's
 * function, a map's identity, or the experiment's condition.
 */
export const FORBIDDEN_TOKENS = [
  'goal_position',
  'player',
  'slippery',
  'turn_right_tile',
  'true_rules',
  'changed_rule',
  'regime',
  'optimal_path',
  'goal',
  'target',
  'wall',
  'exit',
  'finish',
  'slide',
  'slip',
  'rotate',
  'north',
  'south',
  'east',
  'west',
  'solution',
  'level_name',
  'intervention',
];

/** Returns the forbidden tokens present in a serialised payload, if any. */
export function auditForLeaks(payload: unknown): string[] {
  const text = JSON.stringify(payload).toLowerCase();
  return FORBIDDEN_TOKENS.filter((t) => text.includes(t));
}
