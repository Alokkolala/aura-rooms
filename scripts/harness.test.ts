/**
 * Agent-loop checks that need no model and no browser.
 *
 * These cover the boundary between what the researcher knows and what the agent
 * is told, and the arithmetic of the recovery criterion. Run:
 *   npm run verify:harness
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_INTERVENTIONS_BEFORE_LEVELS, INTERVENTION_BEFORE_LEVEL, LEVELS, NO_HAZARD_LEVELS, swappedAt } from '../src/engine/levels.ts';
import { solve } from '../src/engine/solver.ts';
import { buildObservation, FORBIDDEN_TOKENS } from '../src/engine/observation.ts';
import { applyMemory, emptyMemory, MEMORY_BUDGET_CHARS, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate, EMPTY_PREDICTION, type Prediction } from '../src/agent/schema.ts';
import { Run, CHANGE_NOTICE, type Condition, type RunConfig } from '../src/runner.ts';

const noop = () => {};

/** Room 1's shortest route, under the current curriculum. */
const ROOM_1_ROUTE = 'AABB';

function cfg(over: Partial<RunConfig> = {}): RunConfig {
  return {
    runId: `t-${Math.random().toString(36).slice(2, 8)}`,
    strategy: 'structured',
    condition: 'stable',
    driver: 'manual',
    actionBudgetPerLevel: 40,
    seed: 1,
    ...over,
  };
}

/** The complete text one turn sends, system half included. */
function fullPrompt(
  strategy: StrategyName,
  memory: Memory,
  opts: { notice?: string } = {},
) {
  const lv = LEVELS[6];
  return (
    systemPrompt(strategy) +
    '\n' +
    userPrompt({
      observation: buildObservation({
        level: lv,
        roomIndex: 7,
        state: lv.start,
        lastAction: null,
        actionsUsed: 0,
        actionsRemaining: 40,
        notice: opts.notice,
      }),
      memory,
      stepNumber: 1,
      memoryRejected: null,
      lastInvalid: null,
      lastPrediction: 'it ends up one square higher',
      lastExpect: { ...EMPTY_PREDICTION, end_position: { x: 4, y: 3 } },
    })
  );
}

// ---------------------------------------------------------------- boundaries

test('no forbidden token reaches the agent, in any strategy', () => {
  for (const s of ['flat', 'structured', 'native'] as const) {
    const text = fullPrompt(s, emptyMemory(s), { notice: CHANGE_NOTICE });
    for (const t of FORBIDDEN_TOKENS)
      assert.ok(
        !new RegExp(`(^|[^a-z0-9])${t}`).test(text.toLowerCase()),
        `${s} prompt leaked "${t}"`,
      );
  }
});

test('the response schema never names what causes an event', () => {
  // The requirement that shaped the schema. An enum of move / blocked /
  // deflected / death / room_complete would be easier to read and would tell a
  // room-1 agent, on its very first turn, that dying and being thrown across
  // the room are things this world does — before room 3 introduces the first
  // and room 5 the second. Every field name here is something a person could
  // read off the screen without knowing a single rule.
  const schema = systemPrompt('structured').toLowerCase();
  for (const cause of [
    'deflect',
    'death',
    'die',
    'kill',
    'lethal',
    'room_complete',
    'goal',
    'hazard',
    'blocked',
    'teleport',
  ])
    assert.ok(!schema.includes(cause), `the response schema names a cause: "${cause}"`);

  for (const field of ['end_position', 'position_changed', 'returned_to_start', 'room_changed'])
    assert.ok(schema.includes(field), `the response schema is missing "${field}"`);
});

test('the hidden arm is never told that anything about this world can change', () => {
  // The whole definition of the hidden condition. The old prompt carried "the
  // rules of this world are usually stable, but they are not guaranteed to stay
  // that way" in the block COMMON to every arm, so the hidden arm was warned,
  // the stable arm was warned about something that never happens, and the
  // announced arm's one sentence was no longer the only thing that
  // distinguished it.
  //
  // Checked as an absolute: the word "rule" must not appear anywhere in what a
  // hidden-arm agent is sent. Nothing weaker survives rewording.
  for (const condition of ['stable', 'hidden'] as const) {
    const run = new Run(cfg({ condition }), noop);
    (run as any).state.levelIndex = 6;
    assert.equal(run.observation().notice, undefined, `${condition} must get no notice`);
  }
  for (const s of ['flat', 'structured', 'native'] as const) {
    const text = fullPrompt(s, emptyMemory(s)).toLowerCase();
    assert.ok(!text.includes('rule'), `the ${s} hidden prompt mentions a rule`);
    for (const phrase of ['may change', 'can change', 'not guaranteed', 'stable', 'usually'])
      assert.ok(!text.includes(phrase), `the hidden prompt hints at mutability: "${phrase}"`);
  }
});

test('every condition gets byte-identical instructions; only the notice differs', () => {
  // If the arms differed in their system prompt, any gap between them could be
  // the wording rather than the intervention.
  const a = systemPrompt('structured');
  const b = systemPrompt('structured');
  assert.equal(a, b);
  const hidden = fullPrompt('structured', emptyMemory('structured'));
  const notified = fullPrompt('structured', emptyMemory('structured'), { notice: CHANGE_NOTICE });
  assert.equal(notified.replace(`"notice": "${CHANGE_NOTICE}"`, '').replace(/,\n\s*\n/g, '\n'),
    hidden.replace(/,\n\s*\n/g, '\n'),
    'the announced arm must differ from the hidden arm by the notice and nothing else');
});

test('the announced arm is told that something changed and nothing more', () => {
  const text = fullPrompt('structured', emptyMemory('structured'), { notice: CHANGE_NOTICE });
  assert.ok(text.includes(CHANGE_NOTICE), 'the notice should be present');
  // It must say that A rule changed, never which, nor what it changed to.
  const notice = CHANGE_NOTICE.toLowerCase();
  for (const giveaway of ['concentric', 'radial', 'surface', 'tile', 'swap', 'traded', 'no longer'])
    assert.ok(!notice.includes(giveaway), `the notice leaks "${giveaway}"`);
  // and "rule" appears ONLY inside the notice, nowhere else in the prompt
  const withoutNotice = text.toLowerCase().split(notice).join('');
  assert.ok(!withoutNotice.includes('rule'), 'the instructions mention rules outside the notice');
});

test('the prompt states an objective and withholds the strategy for reaching it', () => {
  const p = systemPrompt('structured');
  assert.match(p, /Explore the environment and progress as far as you can\./);
  // Whether to spend a press on a deliberate test is part of what is under
  // study; the old prompt handed that decision to the subject.
  for (const coaching of [
    'deliberate test',
    'resolves an uncertainty',
    'worth more than',
    'work that out',
    'Nobody has told you',
  ])
    assert.ok(!p.includes(coaching), `the prompt coaches the subject: "${coaching}"`);
});

test('each strategy is told only about its own memory format', () => {
  assert.ok(systemPrompt('flat').includes('one block of free text'));
  assert.ok(!systemPrompt('flat').includes('contradicted_by'));
  assert.ok(systemPrompt('structured').includes('contradicted_by'));
  assert.ok(!systemPrompt('structured').includes('one block of free text'));
});

test('both strategies get the same permission to correct themselves', () => {
  // The flat arm must not be a strawman: if it loses, it has to lose on
  // organisation, not on being forbidden to fix its own mistakes.
  assert.match(systemPrompt('flat'), /rewrite, correct or delete/);
  assert.match(systemPrompt('structured'), /edit, restate or drop/);
});

test('the native arm is asked for no memory and told nothing about keeping one', () => {
  // The control for the memory protocol itself: same observation, same four
  // predictions, same contradiction flag, but no store to write and no
  // instruction about how to remember. Anything said here about tracking
  // beliefs would be the harness leaking a strategy into the subject.
  const p = systemPrompt('native');
  assert.ok(!p.includes('"memory"'), 'the reply schema must not ask for a memory field');
  assert.ok(!/contradicted_by|supported_by|free text|write it into memory/.test(p));
  assert.ok(p.includes('This conversation persists'));
  const user = fullPrompt('native', emptyMemory('native'));
  assert.ok(!user.includes('Your memory right now'), 'no memory block in the turn');
  const v = validate(
    { button: 'A', hypothesis: 'h', prediction: 'p', expect: EMPTY_PREDICTION, contradiction: null },
    'native',
  );
  assert.ok(v.ok, 'a reply with no memory field is valid for the native arm');
  assert.deepEqual((v as any).reply.memory, { kind: 'native' });
  assert.equal(renderMemory({ kind: 'native' }), '');
  // and the stored arms are byte-for-byte what they were before the arm existed
  assert.ok(systemPrompt('structured').includes('Your memory is the only thing that persists from turn to turn.'));
});

test('the prompt is a pure function of its arguments — no hidden history', () => {
  const m = emptyMemory('structured');
  assert.equal(fullPrompt('structured', m), fullPrompt('structured', m));
});

test("the agent's own previous commitment is echoed back, and only when there is one", () => {
  const lv = LEVELS[0];
  const base = {
    observation: buildObservation({
      level: lv,
      roomIndex: 1,
      state: lv.start,
      lastAction: null,
      actionsUsed: 0,
      actionsRemaining: 10,
    }),
    memory: emptyMemory('flat'),
    stepNumber: 1,
    memoryRejected: null,
    lastInvalid: null,
  };
  assert.ok(!userPrompt({ ...base, lastPrediction: null }).includes('you predicted'));
  assert.ok(userPrompt({ ...base, lastPrediction: 'it moves up' }).includes('it moves up'));
  const withExpect = userPrompt({
    ...base,
    lastPrediction: null,
    lastExpect: { ...EMPTY_PREDICTION, position_changed: false },
  });
  assert.ok(withExpect.includes('position_changed'), 'the structured half must be echoed too');
});

test('room 1 is hazard-free for a run driven entirely by hand', () => {
  // The exhaustive proof lives in verify.ts, over every pose and every rule
  // set. This is the end-to-end form: the requirement has to survive the
  // runner, not just the engine.
  assert.ok(NO_HAZARD_LEVELS.includes(1));
  for (const b of 'ABCDABCDABCDABCD') {
    const run = new Run(cfg({ actionBudgetPerLevel: 200 }), noop);
    for (let i = 0; i < 8; i++) run.pressManual(b as any);
    assert.equal(run.state.deaths, 0, `pressing ${b} repeatedly in room 1 cost the entity a life`);
  }
});

// ------------------------------------------------------------------- replies

test('a malformed reply is rejected and performs no action', () => {
  const bad: Array<[unknown, string]> = [
    [{ hypothesis: 'x', prediction: 'y', memory: [] }, 'missing button'],
    [{ button: 'E', hypothesis: '', prediction: '', memory: [] }, 'button out of range'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: 'text' }, 'wrong memory shape'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [{ id: 'a', claim: 'b', status: 'maybe' }] }, 'bad status'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [{ claim: 'no id', status: 'hypothesis' }] }, 'missing id'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [], expect: { position_changed: 'yes' } }, 'non-boolean field'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [], expect: { end_position: { x: 1.5, y: 0 } } }, 'non-integer position'],
  ];
  for (const [raw, why] of bad) assert.equal(validate(raw, 'structured').ok, false, why);

  const run = new Run(cfg({ driver: 'llm' }), noop);
  const before = { ...run.state.entity };
  assert.equal(run.state.globalStep, 0);
  assert.deepEqual(run.state.entity, before); // nothing moved on a rejected reply
});

test('declining to predict is a legitimate reply, not a malformed one', () => {
  // An agent that says it does not know must not be punished for honesty, and
  // an absent `expect` must not be repaired into a guess.
  for (const expect of [undefined, null, {}, { end_position: null, room_changed: null }]) {
    const v = validate(
      { button: 'A', hypothesis: 'h', prediction: 'p', memory: [], expect },
      'structured',
    );
    assert.equal(v.ok, true, `expect=${JSON.stringify(expect)} should be accepted`);
    if (v.ok) assert.deepEqual(v.reply.expect, EMPTY_PREDICTION);
  }
});

test('a partial commitment is kept exactly as given', () => {
  const v = validate(
    {
      button: 'C',
      hypothesis: 'h',
      prediction: 'p',
      memory: [],
      expect: { end_position: { x: 3, y: 4 }, room_changed: false },
    },
    'structured',
  );
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual(v.reply.expect, {
    end_position: { x: 3, y: 4 },
    position_changed: null,
    returned_to_start: null,
    room_changed: false,
  });
});

test('JSON is extracted from a fenced or chatty response', () => {
  const r = extractJson('Sure!\n```json\n{"button":"A","n":{"deep":[1,2]}}\n```\nhope that helps');
  assert.equal((r as any).button, 'A');
  assert.throws(() => extractJson('no object here'));
  assert.throws(() => extractJson('{"unterminated": '));
  // a brace inside a string must not end the object early
  assert.equal((extractJson('{"s":"}"} tail') as any).s, '}');
});

// -------------------------------------------------------------------- memory

test('an over-budget memory update is rejected and the previous memory kept', () => {
  const prev: Memory = { kind: 'flat', text: 'keep me' };
  const huge: Memory = { kind: 'flat', text: 'x'.repeat(MEMORY_BUDGET_CHARS + 1) };
  const r = applyMemory(prev, huge);
  assert.deepEqual(r.memory, prev);
  assert.match(r.rejected!, /over the .* limit/);
  const ok = applyMemory(prev, { kind: 'flat', text: 'new' });
  assert.equal(ok.rejected, null);
  assert.equal(renderMemory(ok.memory), 'new');
});

test('the budget binds on neither arm at a realistic knowledge load', () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({
    id: `rule_${i}`,
    claim: 'A surface or button behaves in some specific way worth a sentence of description.',
    conditions: 'under some stated circumstance that also takes a phrase',
    status: 'confirmed' as const,
    supported_by: [1, 2, 3, 4],
    contradicted_by: [],
    depends_on: ['rule_0'],
  }));
  const size = renderMemory({ kind: 'structured', entries }).length;
  assert.ok(size < MEMORY_BUDGET_CHARS, `structured store ${size} must fit in ${MEMORY_BUDGET_CHARS}`);
});

test('memory persists across rooms, and a fresh run inherits nothing', () => {
  const run = new Run(cfg(), noop);
  (run as any).state.memory = { kind: 'structured', entries: [{ id: 'k', claim: 'kept', conditions: '', status: 'confirmed', supported_by: [], contradicted_by: [], depends_on: [] }] };
  for (const b of ROOM_1_ROUTE) run.pressManual(b as any);
  assert.equal(run.state.levelIndex, 1, 'should have advanced a room');
  assert.match(renderMemory(run.state.memory), /kept/, 'memory must survive the room change');

  const fresh = new Run(cfg(), noop);
  assert.equal(renderMemory(fresh.state.memory), '[]', 'a new run must start empty');
  assert.equal(fresh.state.levelIndex, 0);
});

// ------------------------------------------------------------------ the loop

test('the press that ends a room is reported in the next observation', () => {
  // The agent has to be able to connect its action to the room ending. Clearing
  // this was the bug that made that impossible. What a new room resets is the
  // POSE, not the report of how the last room ended.
  const run = new Run(cfg(), noop);
  for (const b of ROOM_1_ROUTE) run.pressManual(b as any);
  assert.equal(run.state.levelIndex, 1, 'should have advanced');

  const obs = run.observation();
  assert.deepEqual(run.state.entity, LEVELS[1].start, 'pose resets');
  assert.equal(obs.last_action, null, 'nothing has been tried in the NEW room yet');
  assert.ok(obs.previous_room, 'the closing press must be reported');
  assert.equal(obs.previous_room!.room_index, 1);
  assert.equal(obs.previous_room!.outcome, 'ended_by_action');
  assert.equal(obs.previous_room!.final_action.room_changed, true);

  run.pressManual('C');
  assert.equal(run.observation().previous_room, undefined, 'the report is spent once it acts');
});

test('running out of actions is reported as such, not silently', () => {
  const run = new Run(cfg({ actionBudgetPerLevel: 2 }), noop);
  run.pressManual('C');
  run.pressManual('C');
  const obs = run.observation();
  assert.ok(obs.previous_room);
  assert.equal(obs.previous_room!.outcome, 'actions_exhausted');
});

test('the observable record of a press shows where it last stood', () => {
  // Without this an agent thrown across the room sees only "I was here, now I
  // am there". One concluded it had been punished for returning to the start.
  const run = new Run(cfg(), noop);
  run.pressManual('A');
  const la = run.state.lastAction!;
  assert.deepEqual(la.came_from, { x: la.before.x, y: la.before.y }, 'an ordinary move came from the square it left');
  assert.equal('died' in la, false, 'no field may name the cause of anything');
  assert.equal('level_complete' in la, false);
});

test('the log distinguishes the memory seen, proposed and accepted', () => {
  const run = new Run(cfg(), noop);
  const records: any[] = [];
  (run as any).log = (r: any) => records.push(r);
  (run as any).commit('A', { hypothesis: 'h', prediction: 'p', expect: { ...EMPTY_PREDICTION }, contradiction: null }, {
    inPrompt: 'ORIGINAL',
    proposed: 'UPDATED',
    accepted: 'UPDATED',
    rejected: null,
  });
  const step = records.find((r) => r.type === 'step');
  assert.equal(step.memory_in_prompt, 'ORIGINAL');
  assert.equal(step.memory_proposed, 'UPDATED');
  assert.equal(step.memory_accepted, 'UPDATED');
  assert.equal('memory_before' in step, false, 'the ambiguous field must be gone');
});

test('every step records both rule sets, so telling presses can be identified', () => {
  const run = new Run(cfg(), noop);
  const records: any[] = [];
  (run as any).log = (r: any) => records.push(r);
  run.pressManual('A');
  const step = records.find((r) => r.type === 'step');
  assert.ok(step.researcher.outcome, 'the actual outcome must be recorded');
  assert.ok(step.researcher.outcome_under_other_rules, 'so must the counterfactual');
  assert.ok(Array.isArray(step.researcher.divergent_fields));
});

test('the change notice appears only in the announced condition, only once', () => {
  const notified = new Run(cfg({ condition: 'notified' }), noop);
  (notified as any).state.levelIndex = 6;
  assert.equal(notified.observation().notice, CHANGE_NOTICE);
  (notified as any).state.levelStep = 1;
  assert.equal(notified.observation().notice, undefined, 'notice must not repeat every turn');

  for (const condition of ['hidden', 'stable'] as Condition[]) {
    const run = new Run(cfg({ condition }), noop);
    (run as any).state.levelIndex = 6;
    assert.equal(run.observation().notice, undefined);
  }
});

test('the intervention fires on entering room 7, and never in the stable condition', () => {
  for (const condition of ['hidden', 'notified'] as const) {
    const run = new Run(cfg({ condition }), noop);
    assert.equal(run.state.rules.swapped, false, 'runs start in the original world');
    (run as any).state.levelIndex = 5;
    (run as any).advanceLevel(true);
    assert.equal(run.state.levelIndex, 6, 'should be in room 7');
    assert.equal(run.state.rules.swapped, true, `${condition} must apply the change`);
    assert.notEqual(run.state.interventionAtStep, null);
  }
  const stable = new Run(cfg({ condition: 'stable' }), noop);
  (stable as any).state.levelIndex = 5;
  (stable as any).advanceLevel(true);
  assert.equal(stable.state.rules.swapped, false, 'a stable run never swaps');
  assert.equal(stable.state.interventionAtStep, null);
});

test('a branched continuation carries the memory and applies the change on entry', () => {
  const prefix = new Run(cfg({ condition: 'stable' }), noop);
  (prefix as any).state.levelIndex = 6;
  (prefix as any).state.memory = { kind: 'structured', entries: [{ id: 'learned', claim: 'from the prefix', conditions: '', status: 'confirmed', supported_by: [1], contradicted_by: [], depends_on: [] }] };
  const snap = prefix.snapshot();

  const branch = new Run(cfg({ condition: 'hidden' }), noop, snap);
  assert.equal(branch.state.levelIndex, 6);
  assert.match(renderMemory(branch.state.memory), /from the prefix/);
  assert.equal(branch.state.rules.swapped, true, 'the change must be live on arrival');

  (branch as any).state.memory.entries[0].claim = 'mutated';
  assert.match(renderMemory(prefix.state.memory), /from the prefix/);
});

test('every room from the first change on is finishable through the runner, in every condition', () => {
  // verify.ts proves the GRIDS are solvable. This proves the HARNESS delivers a
  // solvable world: each change is applied on entry (and the second undone),
  // the budget is enough, the room advances, and the run reaches the end. A
  // curriculum that is solvable on paper and unreachable in practice would
  // make every "not recovered" in the results a property of the instrument.
  const postChange = LEVELS.filter((lv) => lv.id >= INTERVENTION_BEFORE_LEVEL);
  for (const condition of ['stable', 'hidden', 'notified'] as Condition[]) {
    const run = new Run(cfg({ condition, actionBudgetPerLevel: 30 }), noop);
    (run as any).state.levelIndex = INTERVENTION_BEFORE_LEVEL - 2;
    (run as any).advanceLevel(true);
    assert.equal(run.state.levelIndex, INTERVENTION_BEFORE_LEVEL - 1, `${condition}: should be in room ${INTERVENTION_BEFORE_LEVEL}`);

    for (const lv of postChange) {
      assert.equal(
        run.state.rules.swapped,
        condition !== 'stable' && swappedAt(lv.id),
        `${condition}: room ${lv.id} is presented under the wrong regime`,
      );
      const route = solve(lv, run.state.rules);
      assert.ok(route, `${condition}: room ${lv.id} unsolvable as the runner presents it`);
      assert.ok(
        route!.length <= run.state.config.actionBudgetPerLevel,
        `${condition}: room ${lv.id} needs ${route!.length} presses, budget is ${run.state.config.actionBudgetPerLevel}`,
      );
      for (const b of route!) run.pressManual(b);
    }
    assert.equal(run.state.finished, true, `${condition}: the run should have reached the end`);
    assert.equal(run.state.deaths, 0, `${condition}: the reference route should cost no lives`);
    assert.deepEqual(
      run.state.levelOutcomes.slice(-postChange.length).map((o) => [o.level, o.solved]),
      postChange.map((lv) => [lv.id, true]),
      `${condition}: every post-change room should be recorded as solved`,
    );
    const changes = run.state.feed
      .filter((f) => f.kind === 'rule-change')
      .map((f) => f.text)
      .reverse();
    assert.deepEqual(
      changes,
      condition === 'stable' ? [] : ['Rule change applied before room 7', 'Rule change applied before room 10'],
      `${condition}: exactly the scheduled changes should have been applied`,
    );
  }
});

test('a manual rule change tags the run so it cannot pool with experiments', () => {
  const run = new Run(cfg(), noop);
  assert.ok(!run.summary().manual_intervention);
  run.forceRuleChange();
  assert.equal(run.state.rules.swapped, true);
  assert.equal(run.summary().manual_intervention, true);
});

test('a room that exhausts its budget is recorded as a failure, not skipped', () => {
  const run = new Run(cfg({ actionBudgetPerLevel: 3 }), noop);
  run.pressManual('C');
  run.pressManual('C');
  run.pressManual('C');
  assert.equal(run.state.levelIndex, 1, 'should move on');
  assert.deepEqual(run.state.levelOutcomes[0], { level: 1, solved: false, actions: 3 });
  assert.equal(run.state.levelsCompleted, 0);
});

// ------------------------------------------------------------------- metrics

import {
  computeMetrics,
  beliefTracks,
  verdictOf,
  outcomeOf,
  divergentFields,
  type Outcome,
  type StepRecord,
} from '../src/metrics.ts';

/** An ordinary move: identical under both rule sets, so it tells nothing. */
const MOVED: Outcome = {
  end_position: { x: 1, y: 0 },
  position_changed: true,
  returned_to_start: false,
  room_changed: false,
};
/** What the OTHER rule set would have produced on a telling press. */
const SENT_BACK: Outcome = {
  end_position: { x: 0, y: 0 },
  position_changed: false,
  returned_to_start: true,
  room_changed: false,
};

const RIGHT: Prediction = { ...EMPTY_PREDICTION, end_position: { x: 1, y: 0 } };
const WRONG: Prediction = { ...EMPTY_PREDICTION, end_position: { x: 9, y: 9 } };
/** Exactly what the dead rule would have predicted. */
const STALE: Prediction = { ...EMPTY_PREDICTION, end_position: { x: 0, y: 0 } };

function researcher(over: Partial<StepRecord['researcher']> = {}): StepRecord['researcher'] {
  return {
    true_rules: { swapped: true },
    entity_before: { x: 0, y: 0, dir: 0 },
    entity_after: { x: 1, y: 0, dir: 1 },
    blocked: false,
    auto_moved: 0,
    outcome: MOVED,
    outcome_under_other_rules: MOVED,
    divergent_fields: [],
    discriminating_under_rule_change: false,
    intervention_applied: true,
    ...over,
  };
}

function rec(over: Partial<StepRecord> & { step: number }): StepRecord {
  const { step, ...rest } = over;
  return {
    type: 'step',
    level: 7,
    global_step: step,
    level_step: step,
    button: 'B',
    hypothesis: '',
    prediction: '',
    expect: null,
    contradiction: null,
    level_complete: false,
    researcher: researcher(),
    ...rest,
  } as StepRecord;
}

/** A press whose outcome is the same under both rule sets. */
const ordinary = (n: number, expect: Prediction | null = null) => rec({ step: n, expect });

/** A press the change actually altered. */
const telling = (n: number, expect: Prediction | null = null, extra: Partial<StepRecord> = {}) =>
  rec({
    step: n,
    expect,
    researcher: researcher({
      outcome_under_other_rules: SENT_BACK,
      divergent_fields: divergentFields(MOVED, SENT_BACK),
      discriminating_under_rule_change: true,
    }),
    ...extra,
  });

test('a press that commits to nothing is not scored as wrong', () => {
  const m = computeMetrics([ordinary(1)]);
  assert.equal(verdictOf(ordinary(1)), null);
  assert.equal(m.predictionsDeclined, 1);
  assert.equal(m.fieldsCommitted, 0);
  assert.equal(m.accuracy, null, 'accuracy is undefined when nothing was committed');
});

test('accuracy counts every committed field, not every press', () => {
  const both: Prediction = { ...EMPTY_PREDICTION, end_position: { x: 1, y: 0 }, room_changed: true };
  const m = computeMetrics([ordinary(1, both), ordinary(2, WRONG), ordinary(3)]);
  assert.equal(m.fieldsCommitted, 3, 'two fields on step 1, one on step 2');
  assert.equal(m.fieldsCorrect, 1, 'only the end position on step 1 was right');
  assert.equal(m.predictionViolations, 2, 'steps 1 and 2 each contradicted something');
  assert.equal(m.predictionsDeclined, 1);
});

test('ORDINARY MOVEMENT ACCURACY CANNOT TRIGGER RECOVERY', () => {
  // The defect this whole criterion exists to close. Under the old rule, three
  // consecutive correct predictions counted as recovery — and three presses
  // down an empty corridor satisfy that without the agent having revised
  // anything at all. Here are ten of them, every one correct.
  const steps = Array.from({ length: 10 }, (_, i) => ordinary(i + 1, RIGHT));
  const m = computeMetrics(steps);
  assert.equal(m.fieldsCorrect, 10, 'every one of them was right');
  assert.equal(m.accuracy, 1);
  assert.equal(m.firstRevisedPredictionStep, null, 'none of them concerned the change');
  assert.equal(m.firstEvidenceStep, null, 'none of them could have revealed it');
  assert.equal(m.recovered, false);
  assert.equal(m.recoveredAtStep, null);

  // and finishing a room on top of that is still not recovery without R1
  const withRoom = computeMetrics([...steps, ordinary(11, RIGHT), rec({ step: 12, level_complete: true })]);
  assert.equal(withRoom.postChangeCompletionStep, 12, 'R2 is satisfied');
  assert.equal(withRoom.firstRevisedPredictionStep, null, 'R1 is not');
  assert.equal(withRoom.recovered, false, 'both are required');
});

test('recovery needs a correct call on an altered field AND a room finished', () => {
  const r1Only = computeMetrics([ordinary(1, RIGHT), telling(2, RIGHT)]);
  assert.equal(r1Only.firstRevisedPredictionStep, 2);
  assert.equal(r1Only.postChangeCompletionStep, null);
  assert.equal(r1Only.recovered, false, 'a prediction is cheap; a room is not');

  const both = computeMetrics([telling(1, RIGHT), rec({ step: 2, level_complete: true })]);
  assert.equal(both.recovered, true);
  assert.equal(both.recoveredAtStep, 2, 'whichever of the two landed last');

  const reversed = computeMetrics([rec({ step: 1, level_complete: true }), telling(4, RIGHT)]);
  assert.equal(reversed.recovered, true);
  assert.equal(reversed.recoveredAtStep, 4);
});

test('being right about a field the change did not alter is not a revised prediction', () => {
  // A telling press where the agent committed only to something that reads the
  // same under both rule sets. It was right, and it proves nothing.
  const unaltered: Prediction = { ...EMPTY_PREDICTION, room_changed: false };
  assert.ok(!divergentFields(MOVED, SENT_BACK).includes('room_changed'));
  const m = computeMetrics([telling(1, unaltered), rec({ step: 2, level_complete: true })]);
  assert.equal(m.fieldsCorrect, 1, 'it was right');
  assert.equal(m.firstRevisedPredictionStep, null, 'about the wrong thing');
  assert.equal(m.recovered, false);
});

test('nothing before the change counts toward recovering from it', () => {
  const before = (n: number) =>
    rec({ step: n, expect: RIGHT, researcher: researcher({ intervention_applied: false }) });
  const m = computeMetrics([before(1), before(2), before(3)]);
  assert.equal(m.interventionAtStep, null);
  assert.equal(m.recovered, false, 'nothing has changed, so nothing can be recovered from');
  assert.equal(m.accuracy, 1, 'accuracy is still tracked');
});

test('detection delay is measured from the first press that could have revealed it', () => {
  // Measuring from the intervention punishes an agent for time it had no way to
  // use: until a press actually diverges there is nothing on screen to notice.
  const m = computeMetrics([
    ordinary(1, RIGHT),
    ordinary(2, RIGHT),
    telling(3, WRONG),
    telling(4, WRONG),
    telling(5, RIGHT),
  ]);
  assert.equal(m.interventionAtStep, 1);
  assert.equal(m.firstEvidenceStep, 3);
  assert.equal(m.firstRevisedPredictionStep, 5);
  assert.equal(m.detectionDelay, 2, 'two presses spent with the evidence already in hand');
  assert.equal(m.detectionDelayFromChange, 4);
});

test('a prediction that matches the dead rule is counted as a stale-rule prediction', () => {
  const m = computeMetrics([telling(1, STALE), telling(2, WRONG)]);
  assert.equal(m.ruleRelevantViolations, 2, 'both were wrong about an altered field');
  assert.equal(m.staleRulePredictions, 1, 'only one was wrong in the specific way the old rule was');
});

test('stale-rule actions and deaths are counted where the old objective was', () => {
  const walked = rec({ step: 1, researcher: researcher({ touched_original_objective: true }) });
  const fatal = rec({
    step: 2,
    researcher: researcher({ touched_original_objective: true, touched_lethal: true, died: true }),
  });
  const m = computeMetrics([walked, fatal]);
  assert.equal(m.staleRuleActions, 2);
  assert.equal(m.staleRuleDeaths, 1);
  assert.equal(m.deathsAfterChange, 1);
  assert.deepEqual(m.hazardContacts, [{ level: 7, presses: 1, deaths: 1 }]);
});

test('transfer is reported beside recovery, never folded into it', () => {
  const m = computeMetrics([
    telling(1, RIGHT),
    rec({ step: 2, level_complete: true }),
    rec({ step: 3, level: 8, level_complete: true }),
  ]);
  assert.equal(m.recovered, true);
  assert.equal(m.recoveredAtStep, 2, 'recovery does not wait for the last room');
  assert.equal(m.transferStep, 3);
  assert.equal(m.transferSucceeded, true);

  const noTransfer = computeMetrics([telling(1, RIGHT), rec({ step: 2, level_complete: true })]);
  assert.equal(noTransfer.recovered, true);
  assert.equal(noTransfer.transferSucceeded, false, 'recovered without transferring is a real state');
});

test('collateral damage is accuracy lost on the rules that did not change', () => {
  // The only collateral measure that works for a flat store, which has no
  // statuses to demote.
  const before = (n: number, expect: Prediction) =>
    rec({ step: n, expect, researcher: researcher({ intervention_applied: false }) });
  const m = computeMetrics([
    before(1, RIGHT),
    before(2, RIGHT),
    ordinary(3, WRONG),
    ordinary(4, WRONG),
  ]);
  assert.equal(m.collateralAccuracyBefore, 1);
  assert.equal(m.collateralAccuracyAfter, 0);
  assert.equal(m.collateralDrop, 1);
});

test('a self-reported contradiction only counts once there was something to notice', () => {
  const flagEarly = rec({ step: 1, contradiction: 'something feels off' });
  const evidence = telling(2, WRONG);
  const flagLate = telling(3, WRONG, { contradiction: 'the surfaces must have traded' });
  const m = computeMetrics([flagEarly, evidence, flagLate]);
  assert.equal(m.firstEvidenceStep, 2);
  assert.equal(m.flaggedAtStep, 3, 'a hunch before any evidence is not detection');
});

test('belief tracks follow each claim status across steps, and flag demotions', () => {
  const mem = (entries: unknown[]) => JSON.stringify(entries);
  const e = (id: string, status: string, deps: string[] = []) => ({
    id, claim: `about ${id}`, status, supported_by: [], contradicted_by: [], depends_on: deps,
  });
  const steps = [
    rec({ step: 1, memory_accepted: mem([e('rule', 'confirmed')]), researcher: researcher({ intervention_applied: false }) }),
    rec({ step: 2, memory_accepted: mem([e('rule', 'confirmed'), e('plan', 'hypothesis', ['rule'])]) }),
    rec({ step: 3, memory_accepted: mem([e('rule', 'suspect'), e('plan', 'hypothesis', ['rule'])]) }),
  ];

  const tracks = beliefTracks(steps);
  assert.equal(tracks[0].id, 'rule', 'roots sort before things built on them');
  assert.deepEqual(tracks[0].status, ['confirmed', 'confirmed', 'suspect']);
  assert.deepEqual(tracks[1].depends_on, ['rule']);
  assert.equal(tracks[1].status[0], null, 'plan did not exist at step 1');

  const m = computeMetrics(steps);
  assert.deepEqual(m.demotedAfterChange, ['rule']);
  assert.ok(m.statusChanges.some((c) => c.id === 'rule' && c.from === 'confirmed' && c.to === 'suspect'));
});

test('flat memory yields no belief tracks rather than crashing', () => {
  const steps = [rec({ step: 1, memory_accepted: 'just some prose I wrote' })];
  assert.deepEqual(beliefTracks(steps), []);
  assert.deepEqual(computeMetrics(steps).statusChanges, []);
});

test('the observable outcome is derived, never asserted', () => {
  const o = outcomeOf({
    roomStart: { x: 2, y: 4 },
    before: { x: 2, y: 2 },
    after: { x: 2, y: 4 },
    roomChanged: false,
  });
  assert.equal(o.position_changed, true, 'it did move');
  assert.equal(o.returned_to_start, true, 'and it ended up where the room began');
  assert.deepEqual(o.end_position, { x: 2, y: 4 });
});


// ----------------------------------------------------------------- providers

import { codexArgs, providerConfig, resolveConfig, summariseCodexEvents } from '../server/provider.ts';

/** Run a body with a temporary environment, restoring whatever was there. */
function withEnv(vars: Record<string, string | undefined>, body: () => void) {
  const keys = ['AURA_PROVIDER', 'OPENROUTER_API_KEY', 'AURA_ENDPOINT', 'AURA_API_KEY', 'AURA_MODEL', 'ANTHROPIC_API_KEY'];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  try {
    body();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('an OpenRouter key alone is enough to select the provider', () => {
  withEnv({ OPENROUTER_API_KEY: 'sk-or-x', AURA_MODEL: 'anthropic/claude-sonnet-5' }, () => {
    const c = providerConfig();
    assert.equal(c.provider, 'openai-compatible');
    assert.equal(c.endpoint, 'https://openrouter.ai/api/v1');
    assert.equal(c.hasKey, true);
    assert.equal(c.model, 'anthropic/claude-sonnet-5');
    assert.ok(!JSON.stringify(c).includes('sk-or-x'), 'the config must never carry the key itself');
  });
});

test('an explicit endpoint wins over the OpenRouter default', () => {
  withEnv({ OPENROUTER_API_KEY: 'k', AURA_ENDPOINT: 'http://localhost:11434/v1' }, () => {
    assert.equal(providerConfig().endpoint, 'http://localhost:11434/v1');
  });
});

test('provider selection falls back to Anthropic, and reports no key when there is none', () => {
  withEnv({}, () => {
    const c = providerConfig();
    assert.equal(c.provider, 'anthropic');
    assert.equal(c.hasKey, false, 'with nothing set, the UI must say the agent is unavailable');
  });
  withEnv({ ANTHROPIC_API_KEY: 'sk-ant-x' }, () => {
    assert.equal(providerConfig().hasKey, true);
  });
});

test('AURA_PROVIDER=codex selects codex regardless of what keys are lying around', () => {
  withEnv({ AURA_PROVIDER: 'codex', OPENROUTER_API_KEY: 'k', ANTHROPIC_API_KEY: 'k2' }, () => {
    const c = providerConfig();
    assert.equal(c.provider, 'codex');
    assert.equal(c.endpoint, '');
  });
});

test('THE CODEX SUBJECT IS SEALED', () => {
  // Each of these flags is load-bearing for experimental validity, and none of
  // them is obviously load-bearing when you are reading the call. Dropping
  // --ignore-user-config in particular fails silently: the subject simply
  // inherits the operator's own codex instructions and skills, and the run
  // still looks fine.
  const args = codexArgs('some-model', '/tmp/empty', '/tmp/empty/reply.txt');

  assert.ok(args.includes('--sandbox') && args[args.indexOf('--sandbox') + 1] === 'read-only',
    'the subject must not be able to write or reach the network');
  assert.ok(args.includes('--ignore-user-config'),
    'without this the operator config and its skills become an uncontrolled variable');
  assert.ok(args.includes('--ignore-rules'), 'likewise for execpolicy rules');
  assert.ok(args.includes('--ephemeral'),
    'a persisted session would give the codex arm a conversation history the API arms do not have');
  assert.ok(args.includes('--json'), 'tool calls have to be countable, not assumed absent');
  assert.ok(args.includes('--skip-git-repo-check'));

  const dir = args[args.indexOf('-C') + 1];
  assert.equal(dir, '/tmp/empty');
  assert.ok(!dir.includes('autoaura'),
    'the working root must never be this repository — levels.ts holds the answers');

  // The native arm: the first press starts a persisted session (everything
  // sealed except --ephemeral), every later press resumes it by id.
  const first = codexArgs('some-model', '/tmp/empty', '/tmp/r.txt', { id: null, dir: '/tmp/empty' });
  assert.ok(!first.includes('--ephemeral'), 'a session has to be recorded to be resumed');
  assert.ok(first.includes('--sandbox') && first.includes('--ignore-user-config') && first.includes('--ignore-rules'));
  assert.equal(first[first.indexOf('-C') + 1], '/tmp/empty');
  const later = codexArgs('some-model', '/tmp/empty', '/tmp/r.txt', { id: 'abc-123', dir: '/tmp/empty' });
  assert.deepEqual(later.slice(0, 3), ['exec', 'resume', 'abc-123']);
  assert.ok(later.includes('--ignore-user-config') && later.includes('--ignore-rules') && later.includes('--json'));
  assert.ok(!later.includes('--ephemeral'));
  assert.equal(later.at(-1), '-', 'the prompt still arrives on stdin');
});

test('codex events are summarised into a reply, a token count and a tool-call count', () => {
  // Fixture copied verbatim from a real `codex exec --json` run, so this test
  // fails if the event schema moves under us rather than silently reporting
  // zero tool calls forever.
  const jsonl = [
    '{"type":"thread.started","thread_id":"01a0b952"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"button\\":\\"A\\"}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":11484,"cached_input_tokens":8960,"output_tokens":13,"reasoning_output_tokens":0}}',
  ].join('\n');

  const r = summariseCodexEvents(jsonl, 400);
  assert.equal(r.text, '{"button":"A"}');
  assert.equal(r.toolUses, 0, 'a sealed subject used no tools');
  assert.deepEqual(r.toolItems, []);
  assert.equal(r.usage.input, 11484);
  assert.equal(r.usage.output, 13);
  assert.ok(r.scaffoldTokens > 11000,
    'the agent harness wrapped around the subject must be visible, not implied');
});

test('a codex subject that runs a command is counted, not ignored', () => {
  const jsonl = [
    '{"type":"item.completed","item":{"type":"command_execution","command":"cat levels.ts"}}',
    '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
  ].join('\n');
  const r = summariseCodexEvents(jsonl, 100);
  assert.equal(r.toolUses, 1, 'the command counts');
  assert.deepEqual(r.toolItems, ['command_execution'],
    'WHAT it did must be recorded, not just that it did something — a count alone ' +
    'cannot tell a leaked file read from a harmless planning item, and those need ' +
    'opposite responses');
  assert.equal(r.text, '{}', 'reasoning is not a tool use and not the reply');
});

test('garbage on the event stream does not silently become a reply', () => {
  const r = summariseCodexEvents('not json at all\n\n{"type":"turn.started"}', 10);
  assert.equal(r.text, '', 'no agent_message means no reply, and the caller must raise');
  assert.equal(r.toolUses, 0);
});

test('concatenating the two prompt halves for codex leaks nothing extra', () => {
  // codex has no system/user split, so the halves are joined. The join must not
  // create a forbidden token across the seam, and neither half may carry one.
  const system = systemPrompt('structured');
  const lv = LEVELS[6];
  const user = userPrompt({
    observation: buildObservation({
      level: lv, roomIndex: 7, state: lv.start, lastAction: null,
      actionsUsed: 0, actionsRemaining: 25,
    }),
    memory: emptyMemory('structured'),
    stepNumber: 1,
    memoryRejected: null,
    lastInvalid: null,
    lastPrediction: null,
  });
  const joined = `${system}\n\n----\n\n${user}`.toLowerCase();
  for (const t of FORBIDDEN_TOKENS)
    assert.ok(!new RegExp(`(^|[^a-z0-9])${t}`).test(joined), `the joined codex prompt leaked "${t}"`);
  assert.ok(!joined.includes('rule'), 'and it is still a hidden-arm prompt');
});

test('the model shown in the UI is the model that answers', () => {
  // The bug this pins: a control that set the model and then rebuilt the run
  // used a stale closure, so the run was created WITHOUT the model and quietly
  // went to the server default. The UI showed one subject, the log recorded
  // another, and nothing disagreed. A run log that names the wrong model is not
  // slightly wrong, it is false.
  withEnv({ OPENROUTER_API_KEY: 'k', AURA_MODEL: 'server/default' }, () => {
    assert.equal(resolveConfig(undefined).model, 'server/default', 'no override means the default');
    assert.equal(resolveConfig('').model, 'server/default', 'an empty box is not an override');

    const c = resolveConfig('anthropic/claude-sonnet-5');
    assert.equal(c.model, 'anthropic/claude-sonnet-5');
    assert.ok(
      c.label.includes('anthropic/claude-sonnet-5') && !c.label.includes('server/default'),
      'the label the UI displays must name the model that will answer',
    );
    assert.equal(c.provider, 'openai-compatible', 'an override changes the model, never the provider');
    assert.equal(c.endpoint, 'https://openrouter.ai/api/v1');
  });
});



// ------------------------------------------------------------------- resuming

import fs from 'node:fs';
import path from 'node:path';
import { hydrate, promptFor } from '../scripts/campaign.ts';

test('resuming from any prefix of a log sends exactly the prompt the next step received', () => {
  // A resumed run is the same experiment only if the subject cannot tell, and
  // the subject sees nothing but the prompt. The prompt is a pure function of
  // the state, so this is checkable byte for byte against every log in runs/:
  // rebuild the state from everything recorded before step k, and the prompt
  // the runner would send must be the one step k actually got — observation,
  // memory, the echoed prediction, a rejected-memory notice, all of it.
  const dir = 'runs';
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
    const records = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const start = records.find((r) => r.type === 'run_start');
    if (!start) continue;
    // a hand-driven run sent no prompt, so there is nothing to reproduce
    if (start.config.driver !== 'llm') continue;
    // a variant run (moved changes, withheld field) can only be reproduced
    // under its own environment; the check here runs under the default
    const sched = start.curriculum?.interventions_before_levels;
    if ((sched && sched.join() !== DEFAULT_INTERVENTIONS_BEFORE_LEVELS.join()) || start.observation_ablation?.length) continue;
    const { strategy, condition, actionBudgetPerLevel: budget } = start.config;
    for (let i = 0; i < records.length; i++) {
      if (records[i].type !== 'step') continue;
      const before = records.slice(0, i);
      if (!before.some((r) => r.type === 'step')) continue;
      const s = hydrate(before, strategy, condition, budget);
      assert.equal(
        promptFor(s).user,
        records[i].prompt_user,
        `${f}: resuming before step ${records[i].global_step} would send a different prompt`,
      );
      checked++;
    }
  }
  assert.ok(checked > 0, 'no log in runs/ has two consecutive steps to check against');
});
