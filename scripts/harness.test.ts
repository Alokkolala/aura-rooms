/**
 * Agent-loop checks that need no model and no browser.
 *
 * These cover the boundary between what the researcher knows and what the agent
 * is told, plus the invariants that make the two memory arms comparable. Run:
 *   npm run verify:harness
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS } from '../src/engine/levels.ts';
import { buildObservation, FORBIDDEN_TOKENS } from '../src/engine/observation.ts';
import { applyMemory, emptyMemory, MEMORY_BUDGET_CHARS, renderMemory, type Memory } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate } from '../src/agent/schema.ts';
import { Run, CHANGE_NOTICE, type RunConfig } from '../src/runner.ts';

const noop = () => {};

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

function fullPrompt(strategy: 'flat' | 'structured', memory: Memory) {
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
        notice: CHANGE_NOTICE,
      }),
      memory,
      stepNumber: 1,
      memoryRejected: null,
      lastInvalid: null,
      lastPrediction: 'the marker will change',
    })
  );
}

test('no forbidden token reaches the agent, in either strategy', () => {
  for (const s of ['flat', 'structured'] as const) {
    const text = fullPrompt(s, emptyMemory(s)).toLowerCase();
    for (const t of FORBIDDEN_TOKENS)
      assert.ok(!text.includes(t), `${s} prompt leaked "${t}"`);
  }
});

test('the prompt never names the rule that changed, even when announcing a change', () => {
  const text = fullPrompt('structured', emptyMemory('structured')).toLowerCase();
  assert.ok(text.includes(CHANGE_NOTICE.toLowerCase()), 'notice should be present');
  // The announced-change condition says that SOMETHING changed and nothing more;
  // naming the rule would collapse it into a third, much easier condition.
  assert.ok(!/striped|carries|carry|no longer|disabled/.test(CHANGE_NOTICE.toLowerCase()));
  for (const phrase of ['striped_tile carries', 'no longer', 'disabled', 'has changed to'])
    assert.ok(!text.includes(phrase), `prompt leaked "${phrase}"`);
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

test('the prompt is a pure function of its arguments — no hidden history', () => {
  const m = emptyMemory('structured');
  const a = fullPrompt('structured', m);
  const b = fullPrompt('structured', m);
  assert.equal(a, b);
});

test("the agent's own previous prediction is echoed back, and only when there is one", () => {
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
});

test('a malformed reply is rejected and performs no action', () => {
  const bad: Array<[unknown, string]> = [
    [{ hypothesis: 'x', prediction: 'y', memory: [] }, 'missing button'],
    [{ button: 'E', hypothesis: '', prediction: '', memory: [] }, 'button out of range'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: 'text' }, 'wrong memory shape'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [{ id: 'a', claim: 'b', status: 'maybe' }] }, 'bad status'],
    [{ button: 'A', hypothesis: 'x', prediction: 'y', memory: [{ claim: 'no id', status: 'hypothesis' }] }, 'missing id'],
  ];
  for (const [raw, why] of bad) assert.equal(validate(raw, 'structured').ok, false, why);

  const run = new Run(cfg({ driver: 'llm' }), noop);
  const before = { ...run.state.entity };
  assert.equal(run.state.globalStep, 0);
  assert.deepEqual(run.state.entity, before); // nothing moved on a rejected reply
});

test('JSON is extracted from a fenced or chatty response', () => {
  const r = extractJson('Sure!\n```json\n{"button":"A","n":{"deep":[1,2]}}\n```\nhope that helps');
  assert.equal((r as any).button, 'A');
  assert.throws(() => extractJson('no object here'));
  assert.throws(() => extractJson('{"unterminated": '));
  // a brace inside a string must not end the object early
  assert.equal((extractJson('{"s":"}"} tail') as any).s, '}');
});

test('an over-budget memory update is rejected and the previous memory kept', () => {
  const prev: Memory = { kind: 'flat', text: 'keep me' };
  const huge: Memory = { kind: 'flat', text: 'x'.repeat(MEMORY_BUDGET_CHARS + 1) };
  const r = applyMemory(prev, huge);
  assert.deepEqual(r.memory, prev);
  assert.match(r.rejected!, /over the .* limit/);
  // and a within-budget update goes through
  const ok = applyMemory(prev, { kind: 'flat', text: 'new' });
  assert.equal(ok.rejected, null);
  assert.equal(renderMemory(ok.memory), 'new');
});

test('the budget binds on neither arm at a realistic knowledge load', () => {
  // Nine learned rules is roughly a full campaign's worth.
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
  run.pressManual('B');
  run.pressManual('B'); // room 1 solves in BB
  assert.equal(run.state.levelIndex, 1, 'should have advanced a room');
  assert.match(renderMemory(run.state.memory), /kept/, 'memory must survive the room change');

  const fresh = new Run(cfg(), noop);
  assert.equal(renderMemory(fresh.state.memory), '[]', 'a new run must start empty');
  assert.equal(fresh.state.levelIndex, 0);
});

test('a new room resets the pose but not the knowledge', () => {
  const run = new Run(cfg(), noop);
  run.pressManual('B');
  run.pressManual('B');
  assert.deepEqual(run.state.entity, LEVELS[1].start);
  assert.equal(run.state.lastAction, null, 'nothing has been tried in the new room yet');
});

test('the change notice appears only in the announced condition, only once', () => {
  const hidden = new Run(cfg({ condition: 'hidden' }), noop);
  (hidden as any).state.levelIndex = 6;
  assert.equal(hidden.observation().notice, undefined);

  const notified = new Run(cfg({ condition: 'notified' }), noop);
  (notified as any).state.levelIndex = 6;
  assert.equal(notified.observation().notice, CHANGE_NOTICE);
  (notified as any).state.levelStep = 1;
  assert.equal(notified.observation().notice, undefined, 'notice must not repeat every turn');

  const stable = new Run(cfg({ condition: 'stable' }), noop);
  (stable as any).state.levelIndex = 6;
  assert.equal(stable.observation().notice, undefined);
});

test('the intervention fires on entering room 7, and never in the stable condition', () => {
  for (const condition of ['hidden', 'notified'] as const) {
    const run = new Run(cfg({ condition }), noop);
    assert.equal(run.state.rules.slipperyEnabled, true);
    (run as any).state.levelIndex = 5;
    (run as any).advanceLevel(true);
    assert.equal(run.state.levelIndex, 6, 'should be in room 7');
    assert.equal(run.state.rules.slipperyEnabled, false, `${condition} must apply the change`);
    assert.notEqual(run.state.interventionAtStep, null);
  }
  const stable = new Run(cfg({ condition: 'stable' }), noop);
  (stable as any).state.levelIndex = 5;
  (stable as any).advanceLevel(true);
  assert.equal(stable.state.rules.slipperyEnabled, true);
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
  assert.equal(branch.state.rules.slipperyEnabled, false, 'the change must be live on arrival');

  // and the branches must not share memory objects
  (branch as any).state.memory.entries[0].claim = 'mutated';
  assert.match(renderMemory(prefix.state.memory), /from the prefix/);
});

test('a manual rule change tags the run so it cannot pool with experiments', () => {
  const run = new Run(cfg(), noop);
  assert.ok(!run.summary().manual_intervention);
  run.forceRuleChange();
  assert.equal(run.state.rules.slipperyEnabled, false);
  assert.equal(run.summary().manual_intervention, true);
});

test('a room that exhausts its budget is recorded as a failure, not skipped', () => {
  const run = new Run(cfg({ actionBudgetPerLevel: 3 }), noop);
  run.pressManual('A');
  run.pressManual('A');
  run.pressManual('A');
  assert.equal(run.state.levelIndex, 1, 'should move on');
  assert.deepEqual(run.state.levelOutcomes[0], { level: 1, solved: false, actions: 3 });
  assert.equal(run.state.levelsCompleted, 0);
});
