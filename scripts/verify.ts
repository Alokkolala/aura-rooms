/**
 * Engine and boundary checks. Run: npm run verify
 * No test framework — node:test and node:assert are enough, and this file runs
 * straight off the .ts source via Node's native type stripping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CHANGED_RULES, DEFAULT_RULES, step } from '../src/engine/engine.ts';
import { LEVELS } from '../src/engine/levels.ts';
import { solve } from '../src/engine/solver.ts';
import { auditForLeaks, buildObservation, pose } from '../src/engine/observation.ts';
import { BUTTONS, type Dir, type EntityState, type Level } from '../src/engine/types.ts';

/** Every (cell, facing) an entity could legitimately occupy on a level. */
function allStates(level: Level): EntityState[] {
  const out: EntityState[] = [];
  for (let y = 0; y < level.h; y++)
    for (let x = 0; x < level.w; x++) {
      if (level.grid[y][x] === '#') continue;
      for (let d = 0; d < 4; d++) out.push({ x, y, dir: d as Dir });
    }
  return out;
}

const BOTH_REGIMES = new Set([7, 8]);

test('maps are well formed', () => {
  for (const lv of LEVELS) {
    assert.equal(lv.grid.length, lv.h, `${lv.id} height`);
    for (const row of lv.grid)
      assert.equal(row.length, lv.w, `${lv.id} ragged row`);
    const targets = lv.grid.flat().filter((c) => c === 'O').length;
    assert.equal(targets, 1, `${lv.id} must have exactly one concentric tile`);
    const s = lv.start;
    assert.ok(s.x >= 0 && s.x < lv.w && s.y >= 0 && s.y < lv.h, `${lv.id} start in bounds`);
    assert.ok(
      lv.grid[s.y][s.x] === '.' || lv.grid[s.y][s.x] === ',',
      `${lv.id} must start on plain floor, not on a special surface or the target`,
    );
  }
});

test('every map is solvable in every rule set it must support', () => {
  for (const lv of LEVELS) {
    const base = solve(lv, DEFAULT_RULES);
    assert.ok(base, `level ${lv.id} unsolvable under the original rules`);
    if (BOTH_REGIMES.has(lv.id)) {
      const changed = solve(lv, CHANGED_RULES);
      assert.ok(changed, `level ${lv.id} unsolvable after the rule change`);
    }
  }
});

test('stepping is deterministic', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const a = step(lv, s, b, rules);
          const c = step(lv, s, b, rules);
          assert.deepEqual(a, c);
        }
});

test('rotating in place never triggers a surface effect', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of ['A', 'C'] as const)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const r = step(lv, s, b, rules);
          assert.equal(r.state.x, s.x);
          assert.equal(r.state.y, s.y);
          assert.equal(r.autoMoved, 0);
        }
});

test('a blocked attempt changes nothing but still costs the action', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of ['B', 'D'] as const)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const r = step(lv, s, b, rules);
          if (!r.blocked) continue;
          assert.deepEqual(r.state, s);
          assert.equal(r.autoMoved, 0);
          assert.equal(r.path.length, 1);
        }
});

test('the rule change alters striped surfaces and nothing else', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS) {
        const before = step(lv, s, b, DEFAULT_RULES);
        const after = step(lv, s, b, CHANGED_RULES);
        const touchedStripes = [...before.path, ...after.path].some(
          (p) => lv.grid[p.y][p.x] === '~',
        );
        if (!touchedStripes) assert.deepEqual(before, after);
      }
});

test('the target can never be skidded over', () => {
  // A slide halts on the first non-striped cell, so any entry onto the
  // concentric surface must terminate movement there.
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const r = step(lv, s, b, rules);
          // path[0] is the pre-action pose; only entries matter here.
          const entered = r.path.slice(1);
          const idx = entered.findIndex((p) => lv.grid[p.y][p.x] === 'O');
          if (idx >= 0) assert.equal(idx, entered.length - 1);
        }
});

test('effect resolution never trips its cycle guard on shipped maps', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES])
          assert.equal(step(lv, s, b, rules).cycleGuardTripped, false);
});

test('no reachable observation leaks a forbidden token', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS) {
        const r = step(lv, s, b, DEFAULT_RULES);
        const obs = buildObservation({
          level: lv,
          roomIndex: lv.id,
          state: r.state,
          lastAction: {
            button: b,
            before: pose(s),
            after: pose(r.state),
            level_complete: r.complete,
          },
          actionsUsed: 1,
          actionsRemaining: 10,
          notice: 'One of the rules of this world has changed.',
        });
        const leaks = auditForLeaks(obs);
        assert.deepEqual(leaks, [], `level ${lv.id} leaked ${leaks.join()}`);
      }
});

test('reference path lengths', () => {
  const rows: string[] = [];
  for (const lv of LEVELS) {
    const a = solve(lv, DEFAULT_RULES);
    const b = BOTH_REGIMES.has(lv.id) ? solve(lv, CHANGED_RULES) : null;
    rows.push(
      `  level ${lv.id} (${lv.w}x${lv.h}) ${lv.name.padEnd(16)} ` +
        `original ${String(a?.length).padStart(2)} [${a?.join('')}]` +
        (b ? `   after change ${String(b.length).padStart(2)} [${b.join('')}]` : ''),
    );
  }
  console.log('\n' + rows.join('\n') + '\n');
});
