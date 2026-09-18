import {
  BUTTON_DIR,
  DELTA,
  MAX_EFFECT_ITERATIONS,
  type Button,
  type Dir,
  type EntityState,
  type Level,
  type Rules,
  type StepResult,
} from './types.ts';

export const DEFAULT_RULES: Rules = { slipperyEnabled: true };
export const CHANGED_RULES: Rules = { slipperyEnabled: false };

export function passable(level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= level.w || y >= level.h) return false;
  return level.grid[y][x] !== '#';
}

function turn(dir: Dir, amount: number): Dir {
  return (((dir + amount) % 4) + 4) % 4 as Dir;
}

function dirOf(d: readonly [number, number]): Dir {
  return DELTA.findIndex((e) => e[0] === d[0] && e[1] === d[1]) as Dir;
}

/**
 * Resolve automatic surface effects after the entity ENTERED a new cell.
 *
 * Effects fire on entry only. A rotation in place is not an entry, so it never
 * re-triggers the surface under the entity — that single rule is what makes
 * "turns don't retrigger" and "a blocked move has no effect" both fall out for
 * free, rather than needing special cases.
 *
 * `d` is the delta of the move that brought the entity here; it is the
 * direction a striped surface carries it.
 */
function resolveEffects(
  level: Level,
  start: EntityState,
  d0: readonly [number, number],
  rules: Rules,
  path: EntityState[],
): { state: EntityState; autoMoved: number; guardTripped: boolean } {
  let { x, y } = start;
  let dir = start.dir;
  let d = d0;
  let autoMoved = 0;
  let guardTripped = false;
  const seen = new Set<string>();

  let i = 0;
  for (; i < MAX_EFFECT_ITERATIONS; i++) {
    const key = `${x},${y},${d[0]},${d[1]}`;
    if (seen.has(key)) {
      guardTripped = true;
      break;
    }
    seen.add(key);

    const cell = level.grid[y][x];

    if (cell === '~' && rules.slipperyEnabled) {
      // Carried along the current direction of travel until standing on the
      // first non-striped cell, or until the next cell is not passable.
      let moved = 0;
      while (level.grid[y][x] === '~') {
        const nx = x + d[0];
        const ny = y + d[1];
        if (!passable(level, nx, ny)) break;
        x = nx;
        y = ny;
        moved++;
        path.push({ x, y, dir });
      }
      autoMoved += moved;
      if (moved === 0) break; // wedged against an obstacle, still on stripes
      continue; // re-examine whatever we landed on
    }

    if (cell === '/') {
      // Deflector: travel turns 90 degrees clockwise and carries on one cell.
      // With no heading to rotate, this is what "reorientation" has to mean —
      // and it composes, since a deflected entity can be deflected again or
      // handed straight onto a strip running the new way.
      const nd = DELTA[turn(dirOf(d), 1)];
      const nx = x + nd[0];
      const ny = y + nd[1];
      if (!passable(level, nx, ny)) break; // deflected into a wall: it rests here
      d = nd;
      dir = dirOf(nd);
      x = nx;
      y = ny;
      autoMoved++;
      path.push({ x, y, dir });
      continue;
    }

    break; // inert surface
  }
  if (i >= MAX_EFFECT_ITERATIONS) guardTripped = true;

  return { state: { x, y, dir }, autoMoved, guardTripped };
}

/**
 * Execute exactly one button press.
 *
 * Fixed order: apply the action -> test collision -> apply surface effects on
 * entry -> run automatic movement to completion -> test the success condition
 * against the FINAL state. One press is one action however far the entity is
 * subsequently carried, and a blocked attempt still consumes the action.
 *
 * Surface effects fire on ENTRY only, i.e. only when the press actually changed
 * the entity's cell. A press that is blocked therefore triggers nothing, with
 * no special case needed.
 */
export function step(
  level: Level,
  s0: EntityState,
  button: Button,
  rules: Rules,
): StepResult {
  let { x, y, dir } = s0;
  const path: EntityState[] = [{ x, y, dir }];
  let blocked = false;
  let autoMoved = 0;
  let cycleGuardTripped = false;

  const d = DELTA[BUTTON_DIR[button]];
  const nx = x + d[0];
  const ny = y + d[1];

  if (passable(level, nx, ny)) {
    x = nx;
    y = ny;
    dir = BUTTON_DIR[button]; // the marker just shows the way it last travelled
    path.push({ x, y, dir });
    const r = resolveEffects(level, { x, y, dir }, d, rules, path);
    x = r.state.x;
    y = r.state.y;
    dir = r.state.dir;
    autoMoved = r.autoMoved;
    cycleGuardTripped = r.guardTripped;
  } else {
    blocked = true;
  }

  return {
    state: { x, y, dir },
    path,
    blocked,
    autoMoved,
    cycleGuardTripped,
    complete: level.grid[y][x] === 'O',
  };
}

export function parseGrid(rows: string[]): Level['grid'] {
  return rows.map((r) => Array.from(r) as Level['grid'][number]);
}
