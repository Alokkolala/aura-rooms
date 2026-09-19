/**
 * Engine and boundary checks. Run: npm run verify
 * No test framework — node:test and node:assert are enough, and this file runs
 * straight off the .ts source via Node's native type stripping.
 */
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

import { CHANGED_RULES, DEFAULT_RULES, goalGlyph, lethalGlyph, step } from '../src/engine/engine.ts';
import { DUAL_REGIME_LEVELS, LEVELS } from '../src/engine/levels.ts';
import { canReach, solve } from '../src/engine/solver.ts';
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
    const rings = lv.grid.flat().filter((c) => c === 'O').length;
    const radial = lv.grid.flat().filter((c) => c === 'X').length;
    assert.equal(rings, 1, `${lv.id} must have exactly one concentric tile`);
    assert.ok(radial >= 1, `${lv.id} must have at least one radial tile`);
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
  // Checked under the ORIGINAL rules only, and deliberately so. `requires` is a
  // claim about the route to the room's objective, and the swap changes which
  // surface that is — a room built so the deflector is the only way to the
  // rings says nothing about the way to the radial. The claim that matters is
  // the teaching one, and all the teaching happens before the change.
  for (const lv of LEVELS)
    for (const surface of lv.requires) {
      const without = solve(lv, DEFAULT_RULES, { banned: [surface] });
      assert.equal(
        without,
        null,
        `level ${lv.id} claims to require "${surface}" but is solvable without it in ` +
          `${without?.length} actions [${without?.join('')}] — the mechanic is decoration`,
      );
    }
});

test('both marked surfaces can actually be stepped on, in both rule sets', () => {
  // If the agent can never touch the lethal surface it cannot learn what that
  // surface does, and the swap stops being a hard problem and becomes an
  // impossible one. If it can never touch the other, the room is unwinnable.
  for (const lv of LEVELS)
    for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
      assert.ok(canReach(lv, rules, 'O'), `level ${lv.id}: concentric unreachable`);
      assert.ok(canReach(lv, rules, 'X'), `level ${lv.id}: radial unreachable`);
    }
});

test('death returns the entity to the start and still costs the action', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS)
        for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
          const r = step(lv, s, b, rules);
          if (!r.died) continue;
          assert.deepEqual(r.state, lv.start, `level ${lv.id}: death must reset to the room start`);
          assert.equal(r.complete, false, 'a death is never also a completion');
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
  const lv = LEVELS[3]; // room 4 is open ground with no walls to confound this
  const open = { x: 3, y: 2, dir: 0 as Dir };
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

test('the rule change alters only the two marked surfaces', () => {
  for (const lv of LEVELS)
    for (const s of allStates(lv))
      for (const b of BUTTONS) {
        const before = step(lv, s, b, DEFAULT_RULES);
        const after = step(lv, s, b, CHANGED_RULES);
        const touchedMarked = [...before.path, ...after.path].some(
          (p) => lv.grid[p.y][p.x] === 'O' || lv.grid[p.y][p.x] === 'X',
        );
        if (!touchedMarked) assert.deepEqual(before, after);
      }
});

test('the winning surface and the lethal one are never the same cell', () => {
  for (const lv of LEVELS)
    for (const rules of [DEFAULT_RULES, CHANGED_RULES]) {
      const g = goalGlyph(rules);
      const l = lethalGlyph(rules);
      assert.notEqual(g, l);
      for (const row of lv.grid) for (const c of row) assert.ok(c !== g || c !== l);
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
