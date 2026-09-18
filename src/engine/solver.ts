import { step } from './engine.ts';
import { BUTTONS, type Button, type Level, type Rules } from './types.ts';

/**
 * Exact shortest button sequence, by breadth-first search over engine states.
 * The state space is (w * h * 4), so this is cheap and needs no heuristic.
 *
 * Used for two things only: proving every map is solvable under every rule set
 * it must support, and reporting a reference path length next to what the
 * agent actually spent. It is NOT an opponent — it is handed the true rules,
 * which is exactly the information the agent has to earn.
 */
export function solve(level: Level, rules: Rules): Button[] | null {
  const key = (x: number, y: number, d: number) => (y * level.w + x) * 4 + d;
  const s0 = level.start;
  if (level.grid[s0.y][s0.x] === 'O') return [];

  const prev = new Map<number, { from: number; button: Button }>();
  const seen = new Set<number>([key(s0.x, s0.y, s0.dir)]);
  let frontier = [s0];

  while (frontier.length) {
    const next: typeof frontier = [];
    for (const s of frontier) {
      for (const b of BUTTONS) {
        const r = step(level, s, b, rules);
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
