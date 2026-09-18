import {
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
  d: readonly [number, number],
  rules: Rules,
  path: EntityState[],
): { state: EntityState; autoMoved: number; guardTripped: boolean } {
  let { x, y, dir } = start;
  let autoMoved = 0;
  let guardTripped = false;
  const seen = new Set<string>();

  let i = 0;
  for (; i < MAX_EFFECT_ITERATIONS; i++) {
    const key = `${x},${y},${dir}`;
    if (seen.has(key)) {
      guardTripped = true;
      break;
    }
    seen.add(key);

    const cell = level.grid[y][x];

    if (cell === '~' && rules.slipperyEnabled) {
      // Carry along d until standing on the first non-striped cell, or until
      // the next cell is not passable.
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
      dir = turn(dir, 1);
      path.push({ x, y, dir });
      break; // a rotation is not an entry, so nothing further can trigger
    }

    break; // inert surface
  }
  if (i >= MAX_EFFECT_ITERATIONS) guardTripped = true;

  return { state: { x, y, dir }, autoMoved, guardTripped };
}

/**
 * Execute exactly one button press.
 *
 * Fixed order: apply action -> test collision -> apply surface effects on
 * entry -> run automatic movement to completion -> test the success condition
 * against the FINAL state. One press is one action even if a slide crossed
 * several cells, and a blocked attempt still consumes the action.
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

  if (button === 'A' || button === 'C') {
    dir = turn(dir, button === 'A' ? -1 : 1);
    path.push({ x, y, dir });
  } else {
    // B walks along the facing; D walks against it without changing facing.
    const f = DELTA[dir];
    const d: readonly [number, number] =
      button === 'B' ? f : [-f[0], -f[1]];
    const nx = x + d[0];
    const ny = y + d[1];
    if (passable(level, nx, ny)) {
      x = nx;
      y = ny;
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
