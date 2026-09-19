import {
  BUTTON_DIR,
  DELTA,
  MAX_EFFECT_ITERATIONS,
  type Button,
  type Cell,
  type Dir,
  type EntityState,
  type Level,
  type Rules,
  type StepResult,
} from './types.ts';

export const DEFAULT_RULES: Rules = { swapped: false };
export const CHANGED_RULES: Rules = { swapped: true };

/** Which surface ends the room, and which one kills, under a given rule set. */
export function goalGlyph(rules: Rules): Cell {
  return rules.swapped ? 'X' : 'O';
}
export function lethalGlyph(rules: Rules): Cell {
  return rules.swapped ? 'O' : 'X';
}

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
 * Effects fire on entry only, i.e. only when the press actually changed the
 * entity's cell — so a blocked press triggers nothing, with no special case.
 *
 * Resolution stops the moment the entity lands on the lethal surface. A
 * deflector that throws the entity onto it is a real hazard, and one the agent
 * can only see coming if it has understood both rules at once.
 */
function resolveEffects(
  level: Level,
  start: EntityState,
  d0: readonly [number, number],
  rules: Rules,
  path: EntityState[],
): { state: EntityState; autoMoved: number; guardTripped: boolean; died: boolean } {
  let { x, y } = start;
  let dir = start.dir;
  let d = d0;
  let autoMoved = 0;
  let guardTripped = false;
  const seen = new Set<string>();
  const lethal = lethalGlyph(rules);

  if (level.grid[y][x] === lethal) return { state: { x, y, dir }, autoMoved, guardTripped, died: true };

  let i = 0;
  for (; i < MAX_EFFECT_ITERATIONS; i++) {
    const key = `${x},${y},${d[0]},${d[1]}`;
    if (seen.has(key)) {
      guardTripped = true;
      break;
    }
    seen.add(key);

    if (level.grid[y][x] !== '/') break; // inert surface

    // Deflector: travel turns 90 degrees clockwise and carries on one cell.
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
    if (level.grid[y][x] === lethal)
      return { state: { x, y, dir }, autoMoved, guardTripped, died: true };
  }
  if (i >= MAX_EFFECT_ITERATIONS) guardTripped = true;

  return { state: { x, y, dir }, autoMoved, guardTripped, died: false };
}

/**
 * Execute exactly one button press.
 *
 * Fixed order: apply the action -> test collision -> apply surface effects on
 * entry -> run automatic movement to completion -> test the lethal and success
 * conditions against the FINAL state. One press is one action however far the
 * entity is subsequently carried, and a blocked attempt still consumes it.
 *
 * Death returns the entity to the room's start. The action is still spent and
 * the room's budget keeps draining, so dying is genuinely costly rather than a
 * free retry — that is what makes a careful probe worth paying for.
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
  let died = false;

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
    died = r.died;
  } else {
    blocked = true;
  }

  const complete = !died && level.grid[y][x] === goalGlyph(rules);
  const state = died ? { ...level.start } : { x, y, dir };
  if (died) path.push({ ...level.start });

  return { state, path, blocked, autoMoved, cycleGuardTripped, died, complete };
}

export function parseGrid(rows: string[]): Level['grid'] {
  return rows.map((r) => Array.from(r) as Level['grid'][number]);
}
