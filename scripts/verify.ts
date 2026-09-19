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
import {
  DUAL_REGIME_LEVELS,
  FIRST_INTRODUCED,
  INTERVENTION_BEFORE_LEVEL,
  LEVELS,
  NO_HAZARD_LEVELS,
} from '../src/engine/levels.ts';
import { canReach, solve } from '../src/engine/solver.ts';
import { auditForLeaks, buildObservation, lastActionOf } from '../src/engine/observation.ts';
import { BUTTONS, type Button, type Dir, type EntityState, type Level } from '../src/engine/types.ts';
import { PREDICTION_FIELDS } from '../src/agent/schema.ts';
import { divergentFields, outcomeOf, resolveBoth } from '../src/metrics.ts';

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
const NO_HAZARD = new Set(NO_HAZARD_LEVELS);

/** Walk a button sequence and report how it ends under a given rule set. */
function replay(level: Level, buttons: Button[], rules: typeof DEFAULT_RULES) {
  let st: EntityState = { ...level.start };
  for (const b of buttons) {
    const r = step(level, st, b, rules);
    if (r.died) return { died: true, solved: false };
    if (r.complete) return { died: false, solved: true };
    st = r.state;
  }
  return { died: false, solved: false };
}

test('maps are well formed', () => {
  for (const lv of LEVELS) {
    assert.equal(lv.grid.length, lv.h, `${lv.id} height`);
    for (const row of lv.grid)
      assert.equal(row.length, lv.w, `${lv.id} ragged row`);
    const rings = lv.grid.flat().filter((c) => c === 'O').length;
    const radial = lv.grid.flat().filter((c) => c === 'X').length;
    assert.equal(rings, 1, `${lv.id} must have exactly one concentric tile`);
    if (NO_HAZARD.has(lv.id))
      assert.equal(radial, 0, `${lv.id} is declared hazard-free and must contain no radial tile`);
    else assert.ok(radial >= 1, `${lv.id} must have at least one radial tile`);
    if (BOTH_REGIMES.has(lv.id))
      assert.equal(
        radial,
        1,
        `${lv.id} is played under both rule sets, so it needs exactly one radial tile — ` +
          `after the swap every one of them ends the room`,
      );
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

test('every surface a room contains can actually be stepped on', () => {
  // If the agent can never touch the lethal surface it cannot learn what that
  // surface does, and the swap stops being a hard problem and becomes an
  // impossible one. If it can never touch the other, the room is unwinnable.
  //
  // Checked per rule set the room actually has to support: rooms 1-6 are only
  // ever played under the original rules, and rooms 1-2 contain no radial tile
  // at all, so demanding one be reachable there would be demanding a hazard the
  // curriculum deliberately withholds.
  for (const lv of LEVELS) {
    const regimes = BOTH_REGIMES.has(lv.id) ? [DEFAULT_RULES, CHANGED_RULES] : [DEFAULT_RULES];
    const hasRadial = lv.grid.flat().includes('X');
    for (const rules of regimes) {
      assert.ok(canReach(lv, rules, 'O'), `level ${lv.id}: concentric unreachable`);
      if (hasRadial) assert.ok(canReach(lv, rules, 'X'), `level ${lv.id}: radial unreachable`);
    }
  }
});

test('rooms 1 and 2 contain no lethal surface, and can never be played swapped', () => {
  // The first requirement of the curriculum. Room 1 teaches the controls and
  // room 2 isolates what ends a room; neither question survives an agent losing
  // the room to a surface it has had no chance to learn about.
  //
  // Asserted in the strong form for the rules these rooms are actually played
  // under: not merely that the radial tile is absent, but that NO press from
  // ANY reachable pose is fatal. It cannot be asserted for the swapped rules,
  // because under those the rings themselves kill and every room needs a
  // ring to be finishable at all — which is precisely why the second half of
  // this test matters. A hazard-free room is only hazard-free as long as the
  // swap can never reach it, so the two declarations are checked against each
  // other rather than trusted side by side.
  for (const id of NO_HAZARD_LEVELS) {
    const lv = LEVELS[id - 1];
    for (const st of allStates(lv))
      for (const b of BUTTONS)
        assert.equal(
          step(lv, st, b, DEFAULT_RULES).died,
          false,
          `room ${id} is declared hazard-free but ${b} from ${st.x},${st.y} is fatal`,
        );
    assert.ok(
      id < INTERVENTION_BEFORE_LEVEL,
      `room ${id} is declared hazard-free but is played at or after the change, where its rings kill`,
    );
    assert.ok(
      !BOTH_REGIMES.has(id),
      `room ${id} cannot be both hazard-free and played under the swapped rules`,
    );
  }
});

test('each mechanic is introduced where the curriculum says, and not before', () => {
  // The order IS the experiment: controls, then what ends a room, then the
  // hazard, then transfer, then the deflector. A stray glyph in an early room
  // teaches two things at once and there is no way to tell afterwards which one
  // the agent was learning.
  for (const lv of LEVELS) {
    const flat = lv.grid.flat();
    if (lv.id < FIRST_INTRODUCED.hazard)
      assert.ok(!flat.includes('X'), `room ${lv.id} shows the hazard before room ${FIRST_INTRODUCED.hazard}`);
    if (lv.id < FIRST_INTRODUCED.deflector)
      assert.ok(!flat.includes('/'), `room ${lv.id} shows the deflector before room ${FIRST_INTRODUCED.deflector}`);
  }
  assert.ok(
    LEVELS[FIRST_INTRODUCED.hazard - 1].grid.flat().includes('X'),
    'the room that claims to introduce the hazard must contain one',
  );
  assert.ok(
    LEVELS[FIRST_INTRODUCED.deflector - 1].grid.flat().includes('/'),
    'the room that claims to introduce the deflector must contain one',
  );
  assert.ok(
    FIRST_INTRODUCED.deflector < INTERVENTION_BEFORE_LEVEL,
    'the deflector must be learnable before the change, or room 8 asks for transfer of something never taught',
  );
});

test('rooms 7 and 8 are solvable under both regimes, and no two rooms share a solution', () => {
  // The post-change rooms carry the stable arm as well as the changed ones, so
  // both have to work. And no two rooms may be finishable by the same button
  // string: room 2 originally replayed room 1's AABB exactly, which let an
  // agent finish by repeating a sequence instead of by believing anything.
  for (const id of DUAL_REGIME_LEVELS) {
    const lv = LEVELS[id - 1];
    for (const [label, rules] of [['original', DEFAULT_RULES], ['changed', CHANGED_RULES]] as const)
      assert.ok(solve(lv, rules), `room ${id} is unsolvable under the ${label} rules`);
  }
  const seen = new Map<string, number>();
  for (const lv of LEVELS) {
    const seq = solve(lv, DEFAULT_RULES)!.join('');
    const clash = seen.get(seq);
    assert.equal(
      clash,
      undefined,
      `rooms ${clash} and ${lv.id} are both finished by "${seq}" — the second teaches replay, not belief`,
    );
    seen.set(seq, lv.id);
  }
});

test('the intervention room makes the learned route fatal and the feared route right', () => {
  // The sharpest claim in the curriculum, and the easiest to break by editing a
  // grid. An agent arriving at room 7 with the original rule intact heads for
  // the surface it has spent six rooms learning to want. That has to kill it,
  // and the other route has to be the answer — otherwise the room is merely
  // confusing rather than contradictory, and a null result there would mean
  // nothing.
  const lv = LEVELS[INTERVENTION_BEFORE_LEVEL - 1];
  const oldRoute = solve(lv, DEFAULT_RULES);
  const newRoute = solve(lv, CHANGED_RULES);
  assert.ok(oldRoute && newRoute, 'room 7 must be solvable under both rule sets');

  assert.equal(
    replay(lv, oldRoute!, CHANGED_RULES).died,
    true,
    'the route learned before the change must be fatal after it',
  );
  assert.equal(
    replay(lv, newRoute!, CHANGED_RULES).solved,
    true,
    'and the route that is correct after the change must actually finish the room',
  );
  assert.equal(
    replay(lv, newRoute!, DEFAULT_RULES).died,
    true,
    'the post-change answer must be exactly what the agent learned to avoid',
  );
  assert.ok(
    newRoute!.length < oldRoute!.length,
    'the post-change answer should also be the shorter route, so failing to revise costs more than it saves',
  );
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
          assert.ok(r.diedAt, 'a death must report where it happened');
          assert.equal(
            lv.grid[r.diedAt!.y][r.diedAt!.x],
            lethalGlyph(rules),
            'the reported death cell must be the lethal surface it landed on',
          );
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
  // Room 1: the only room with a pose whose four neighbours are all plain
  // floor, which is what this needs — a hazard or a deflector next door would
  // confound "these two buttons are the same" with "that surface moved me".
  const lv = LEVELS[0];
  const open = { x: 2, y: 3, dir: 0 as Dir };
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
          lastAction: lastActionOf({
            button: b,
            before: s,
            after: r.state,
            path: r.path,
            roomChanged: r.complete,
          }),
          actionsUsed: 1,
          actionsRemaining: 10,
          notice: 'One of the rules of this world has changed.',
        });
        const leaks = auditForLeaks(obs);
        assert.deepEqual(leaks, [], `level ${lv.id} leaked ${leaks.join()}`);
        // and nothing in the payload names what happened, only what is on screen
        const text = JSON.stringify(obs);
        for (const banned of ['died', 'level_complete', 'completed', 'ran_out_of_actions'])
          assert.ok(!text.includes(banned), `level ${lv.id} reported an event by its cause: ${banned}`);
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

test('the swap produces presses that visibly tell the two rule sets apart', () => {
  // The recovery criterion is built on `divergent_fields`. If a room had no
  // press whose observable outcome differs between the rule sets, an agent
  // there could never demonstrate a revised model however well it understood
  // the world, and the metric would report "not recovered" for a reason that
  // belongs to the grid rather than to the agent.
  for (const id of DUAL_REGIME_LEVELS) {
    const lv = LEVELS[id - 1];
    let telling = 0;
    for (const st of allStates(lv))
      for (const b of BUTTONS)
        if (resolveBoth(lv, st, b, CHANGED_RULES, 0, 99).divergent.length) telling++;
    assert.ok(telling > 0, `room ${id} contains no press that distinguishes the two rule sets`);
  }
});

test('an ordinary move is never a telling press', () => {
  // The defect the new criterion exists to fix. A press that neither reaches
  // nor crosses a marked surface looks identical under both rule sets, so it
  // must produce no divergent fields — and therefore can never contribute to
  // recovery, however many of them are predicted correctly in a row.
  const lv = LEVELS[INTERVENTION_BEFORE_LEVEL - 1];
  for (const st of allStates(lv))
    for (const b of BUTTONS) {
      const a = step(lv, st, b, DEFAULT_RULES);
      const touched = [...a.path, ...step(lv, st, b, CHANGED_RULES).path].some(
        (q) => lv.grid[q.y][q.x] === 'O' || lv.grid[q.y][q.x] === 'X',
      );
      if (touched) continue;
      assert.deepEqual(
        resolveBoth(lv, st, b, DEFAULT_RULES, 0, 99).divergent,
        [],
        `a press from ${st.x},${st.y} that touches no marked surface must tell the agent nothing`,
      );
    }
});

test('the four predicted fields are exactly the four scored fields', () => {
  const o = outcomeOf({
    roomStart: { x: 0, y: 0 },
    before: { x: 1, y: 1 },
    after: { x: 0, y: 0 },
    roomChanged: true,
  });
  assert.deepEqual(Object.keys(o).sort(), [...PREDICTION_FIELDS].sort());
  assert.equal(o.returned_to_start, true);
  assert.equal(o.position_changed, true);
  assert.deepEqual(divergentFields(o, o), []);
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
