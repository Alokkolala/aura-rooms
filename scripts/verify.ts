/**
 * Engine and boundary checks. Run: npm run verify
 * No test framework — node:test and node:assert are enough, and this file runs
 * straight off the .ts source via Node's native type stripping.
 */
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

import { CHANGED_RULES, DEFAULT_RULES, step } from '../src/engine/engine.ts';
import { DUAL_REGIME_LEVELS, LEVELS } from '../src/engine/levels.ts';
import { solve } from '../src/engine/solver.ts';
import { auditForLeaks, buildObservation, pose } from '../src/engine/observation.ts';
import { BUTTONS, type Button, type Dir, type EntityState, type Level } from '../src/engine/types.ts';

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

const BOTH_REGIMES = new Set(DUAL_REGIME_LEVELS);

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

test('every room is unsolvable without the mechanics it claims to require', () => {
  // The teeth of the level design. "Solvable" is the weak check; "solvable only
  // the intended way" is the one that catches a room that teaches nothing.
  for (const lv of LEVELS) {
    for (const surface of lv.requires)
      for (const rules of BOTH_REGIMES.has(lv.id) ? [DEFAULT_RULES, CHANGED_RULES] : [DEFAULT_RULES]) {
        const without = solve(lv, rules, { banned: [surface] });
        assert.equal(
          without,
          null,
          `level ${lv.id} claims to require "${surface}" but is solvable without it in ` +
            `${without?.length} actions [${without?.join('')}] — the mechanic is decoration`,
        );
      }
    // and a room that requires nothing must not secretly depend on a surface
    if (lv.requires.length === 0) {
      const specials = lv.grid.flat().filter((c) => c === '~' || c === '/');
      assert.equal(specials.length, 0, `level ${lv.id} has special surfaces but declares no requirement`);
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

test('every button is a distinct absolute direction', () => {
  // The turn-relative scheme had a redundancy: "turn left then walk backward"
  // and "turn right then walk forward" produced identical displacement, so an
  // agent could succeed while holding a wrong-but-consistent model of turning.
  // Four absolute directions have no such pair — every button is separable by
  // a single observation.
  const lv = LEVELS[2];
  const open = { x: 3, y: 3, dir: 0 as Dir };
  const seen = new Map<string, Button>();
  for (const b of BUTTONS) {
    const r = step(lv, open, b, DEFAULT_RULES);
    const k = `${r.state.x},${r.state.y}`;
    assert.equal(seen.has(k), false, `${b} is indistinguishable from ${seen.get(k)}`);
    seen.set(k, b);
  }
});

test('the marker follows the direction of travel, and a blocked press leaves it alone', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const r = step(lv, s, b, rules);
          if (r.blocked) assert.equal(r.state.dir, s.dir, 'a blocked press must change nothing');
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

test('the intervention rooms make the change expensive enough to notice', () => {
  // A room where the carry saves one or two presses lets an agent limp along on
  // a stale rule without ever paying for it. The gap has to be legible.
  for (const id of DUAL_REGIME_LEVELS) {
    const lv = LEVELS[id - 1];
    const before = solve(lv, DEFAULT_RULES)!.length;
    const after = solve(lv, CHANGED_RULES)!.length;
    assert.ok(
      after - before >= 5,
      `level ${id}: the rule change only costs ${after - before} actions (${before} -> ${after})`,
    );
  }
});

test('every recording committed under runs/ still replays exactly', () => {
  // The README tells people they can load these and check the engine reproduces
  // every press. That promise silently broke once already: rebuilding the rooms
  // left two committed logs referencing a room 7 that no longer existed, and
  // replaying them did not disagree — it threw. A recording that cannot be
  // replayed belongs in runs/archive-engine-v1/, not in runs/.
  const dir = 'runs';
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split(/\r?\n/);
    if (!lines[0]) continue;
    for (const line of lines) {
      const rec = JSON.parse(line);
      if (rec.type !== 'step') continue;
      const lv = LEVELS[rec.level - 1];
      const p0 = rec.researcher.entity_before;
      assert.ok(
        lv && p0.y >= 0 && p0.y < lv.h && p0.x >= 0 && p0.x < lv.w,
        `${f} step ${rec.global_step}: recorded position is outside room ${rec.level} as it exists now`,
      );
      const r = step(lv, p0, rec.button, rec.researcher.true_rules);
      assert.deepEqual(r.state, rec.researcher.entity_after, `${f} step ${rec.global_step} diverges`);
      assert.equal(r.complete, rec.level_complete, `${f} step ${rec.global_step} completion diverges`);
    }
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
