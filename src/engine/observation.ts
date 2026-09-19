import type { Button, Cell, EntityState, Level } from './types.ts';

/**
 * THE BOUNDARY.
 *
 * Everything the agent is ever allowed to see is built here and nowhere else.
 * Codes describe appearance, never function, so that the name of a surface
 * cannot hand the agent the rule it is supposed to discover. `verify.ts`
 * re-serialises the output of this module for every reachable state of every
 * shipped level and fails the build if a forbidden token appears in it.
 *
 * The same discipline now applies to EVENTS, not just to surfaces. An earlier
 * version reported `died: true` and `level_complete: true`, which named the
 * cause of what had happened rather than describing it — and the names sat in
 * the schema from the first turn, so a room-1 agent was told that dying and
 * ending a room were possible before it had met either. Every field here is
 * something a person watching the screen could read off without knowing a
 * single rule: where it was, where it ended up, the last cell it stood on, and
 * whether it is now somewhere else.
 */

const APPEARANCE: Record<Cell, string> = {
  '.': 'tile_0',
  ',': 'tile_1',
  '#': 'solid_tile',
  '/': 'diagonal_tile',
  O: 'concentric_tile',
  X: 'radial_tile',
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
  /**
   * The last cell the entity occupied before it came to rest.
   *
   * Always present, for every press, with no special case: on an ordinary move
   * it is the cell stepped out of, and when something threw the entity across
   * the room it is the cell it was standing on when that happened.
   *
   * It is here because without it the experiment is unwinnable. The entity can
   * end a press a long way from where it began, and `before`/`after` alone say
   * only "I was here, now I am there" — an agent once concluded it had been
   * punished for returning to the starting position. A person watching would
   * have seen exactly where it last stood, so the agent is shown that too. What
   * it is NOT shown is why, or that a cause exists at all.
   */
  came_from: { x: number; y: number };
  /** The entity is in a different room from the one it pressed the button in. */
  room_changed: boolean;
}

/**
 * How the room the agent was just in came to an end.
 *
 * Without this the agent never learns what its last press did. The old code
 * advanced the room and cleared `last_action` in the same breath, so the press
 * that ended a room produced a next-observation of a DIFFERENT room with
 * nothing attached — the agent was asked to work out what ends a room while
 * being denied the single observation that shows it. Worse, running out of
 * actions moved it on too, so the two ways of leaving a room were
 * indistinguishable from the inside.
 *
 * `outcome` distinguishes them without interpreting either. Both are readable
 * off the screen: the budget is shown every turn, so "the room ended while I
 * still had actions left" and "I used my last action" are observations, not
 * verdicts. Neither is called a success.
 */
export interface PreviousRoom {
  room_index: number;
  outcome: 'ended_by_action' | 'actions_exhausted';
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

/**
 * Build the observable record of one press.
 *
 * `path` is the engine's full trace, which the agent never sees; only its
 * second-to-last entry is exposed, as `came_from`. A press that moved nothing
 * has a one-entry path, and then the entity came from where it already was.
 */
export function lastActionOf(args: {
  button: Button;
  before: EntityState;
  after: EntityState;
  path: EntityState[];
  roomChanged: boolean;
}): LastAction {
  const p = args.path;
  const prior = p.length >= 2 ? p[p.length - 2] : args.before;
  return {
    button: args.button,
    before: pose(args.before),
    after: pose(args.after),
    came_from: { x: prior.x, y: prior.y },
    room_changed: args.roomChanged,
  };
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
 * Tokens that must never reach the agent — in an observation, in the system
 * prompt, or in the response schema.
 *
 * The first eight are named in the specification. The rest are English words
 * that would give away a surface's function, an event's cause, a map's
 * identity, or the experiment's condition. The second group matters as much as
 * the first: a schema that asks the agent to predict `death` or `room_complete`
 * has told it, on turn one of a room that contains no lethal surface, that
 * dying is a thing this world does.
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
  'lethal',
  'kills',
  'deadly',
  'destroy',
  'hazard',
  'swap',
  'restart',
  'north',
  'south',
  'east',
  'west',
  'solution',
  'level_name',
  'intervention',
  // added in v4: event causes, not just surface functions
  'die',
  'death',
  'dead',
  'kill',
  'deflect',
  'carried',
  'complete',
  'danger',
  'safe',
  'harm',
  'trap',
  'reset',
  'respawn',
  'teleport',
  'win',
  'lose',
  'reward',
  'punish',
];

/**
 * Returns the forbidden tokens present in a serialised payload, if any.
 *
 * A token matches at the START of a word but not in the middle of one. Plain
 * substring matching was unusable once ordinary English words entered the list:
 * "knowing" contains win, "audience" contains die, "close" contains lose. Those
 * are false alarms, and a check that cries wolf gets the prose rewritten around
 * it or gets deleted. Anchoring only the front keeps every inflection — kills,
 * killing, deadly, deflected, completed — while letting the innocent words
 * through.
 */
export function auditForLeaks(payload: unknown): string[] {
  const text = JSON.stringify(payload).toLowerCase();
  return FORBIDDEN_TOKENS.filter((t) =>
    new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text),
  );
}
