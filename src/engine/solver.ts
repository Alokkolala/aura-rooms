import { step } from './engine.ts';
import { BUTTONS, type Button, type Cell, type Level, type Rules } from './types.ts';

export interface SolveOptions {
  /**
   * Surfaces the solver is forbidden to stand on, as if they were solid.
   *
   * This is how "this room requires its mechanic" becomes a checkable claim
   * rather than a comment. Ban a surface and re-solve: if the room is still
   * solvable, the mechanic was decoration and the room teaches nothing. Level 6
   * shipped with exactly that defect once, and level 8 shipped with it twice —
   * both were found this way and not by playing, because playing only ever
   * walks the route the author already had in mind.
   */
  banned?: Cell[];
}

/**
 * Exact shortest button sequence, by breadth-first search over engine states.
 * The state space is (w * h * 4), so this is cheap and needs no heuristic.
 *
 * Handed the true rules, which is precisely the information the agent has to
 * earn — so this is a reference length, never an opponent.
 */
export function solve(level: Level, rules: Rules, options: SolveOptions = {}): Button[] | null {
  const banned = new Set<Cell>(options.banned ?? []);

  // A banned surface is unenterable. Rather than thread a predicate through the
  // engine, hand the search a level whose banned cells are solid: identical
  // semantics, and the engine stays a single code path with no test-only mode.
  const lv: Level = banned.size
    ? { ...level, grid: level.grid.map((row) => row.map((c) => (banned.has(c) ? '#' : c))) }
    : level;

  const key = (x: number, y: number, d: number) => (y * lv.w + x) * 4 + d;
  const s0 = lv.start;
  if (lv.grid[s0.y][s0.x] === '#') return null; // start itself was banned
  if (lv.grid[s0.y][s0.x] === 'O') return [];

  const prev = new Map<number, { from: number; button: Button }>();
  const seen = new Set<number>([key(s0.x, s0.y, s0.dir)]);
  let frontier = [s0];

  while (frontier.length) {
    const next: typeof frontier = [];
    for (const s of frontier) {
      for (const b of BUTTONS) {
        const r = step(lv, s, b, rules);
        const k = key(r.state.x, r.state.y, r.state.dir);
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, { from: key(s.x, s.y, s.dir), button: b });
        if (r.complete) {
          const path: Button[] = [];
          let cur = k;
          const root = key(s0.x, s0.y, s0.dir);
          while (cur !== root) {
            const p = prev.get(cur)!;
            path.push(p.button);
            cur = p.from;
          }
          return path.reverse();
        }
        next.push(r.state);
      }
    }
    frontier = next;
  }
  return null;
}
