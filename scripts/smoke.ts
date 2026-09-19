/**
 * Offline stepper for driving the agent loop by hand.
 *
 * It exists so a model that cannot be reached over HTTP — a sealed subagent, a
 * person, anything — can still be put through the EXACT protocol the app uses.
 * It imports the real prompt, observation, validation and memory modules rather
 * than reimplementing them, so a smoke test cannot quietly drift away from what
 * the app actually sends.
 *
 *   node scripts/smoke.ts init [--strategy=flat|structured] [--level=N]
 *                             [--changed] [--seed-memory=file.json] [--tag=name]
 *   node scripts/smoke.ts prompt          > prompt.txt
 *   node scripts/smoke.ts apply reply.json
 *   node scripts/smoke.ts status
 *
 * Runs written here are tagged `driver: "manual-subagent"` so they can never be
 * confused with an automated experiment.
 */
import fs from 'node:fs';
import path from 'node:path';

import { CHANGED_RULES, DEFAULT_RULES, goalGlyph, lethalGlyph, step } from '../src/engine/engine.ts';
import { INTERVENTIONS_BEFORE_LEVELS, LEVELS, swappedAt } from '../src/engine/levels.ts';
import { buildObservation, lastActionOf, pose, auditForLeaks } from '../src/engine/observation.ts';
import { ENGINE_VERSION, type Button, type EntityState, type Rules } from '../src/engine/types.ts';
import { applyMemory, emptyMemory, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate, PREDICTION_FIELDS, type Prediction } from '../src/agent/schema.ts';
import { resolveBoth, scoreField } from '../src/metrics.ts';
import { CHANGE_NOTICE } from '../src/runner.ts';

const RUNS = path.resolve('runs');
const STATE = path.join(RUNS, 'smoke-state.json');

interface State {
  runId: string;
  tag: string;
  strategy: StrategyName;
  levelIndex: number;
  entity: EntityState;
  rules: Rules;
  memory: Memory;
  globalStep: number;
  levelStep: number;
  budget: number;
  lastAction: ReturnType<typeof pose> extends never ? never : any;
  memoryRejected: string | null;
  lastInvalid: string | null;
  lastPrediction: string | null;
  lastExpect: Prediction | null;
  previousRoom: any;
  condition: 'stable' | 'hidden' | 'notified';
  interventionAtStep: number | null;
  seededMemory: boolean;
}

const arg = (k: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const flag = (k: string) => process.argv.includes(`--${k}`);

function load(): State {
  if (!fs.existsSync(STATE)) throw new Error('no smoke run — run `init` first');
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function save(s: State) {
  fs.mkdirSync(RUNS, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}
function append(s: State, record: unknown) {
  fs.appendFileSync(path.join(RUNS, `${s.runId}.jsonl`), JSON.stringify(record) + '\n');
}

function observation(s: State) {
  return buildObservation({
    level: LEVELS[s.levelIndex],
    roomIndex: s.levelIndex + 1,
    state: s.entity,
    lastAction: s.lastAction,
    actionsUsed: s.levelStep,
    actionsRemaining: s.budget - s.levelStep,
    previousRoom: s.previousRoom ?? undefined,
    notice:
      s.condition === 'notified' &&
      INTERVENTIONS_BEFORE_LEVELS.includes(s.levelIndex + 1) &&
      s.levelStep === 0
        ? CHANGE_NOTICE
        : undefined,
  });
}

/**
 * Apply the scheduled hidden change on entering the intervention room.
 *
 * This function used to be declared INSIDE `observation()` — a stray brace put
 * it there — so nothing could reach it and no hand-driven run ever swapped the
 * surfaces, whatever condition it was started in. The stepper silently ran
 * every condition as `stable`. Nothing caught it because `scripts/` was not
 * typechecked; it is now, and the unused-symbol check found this in one pass.
 */
function maybeIntervene(s: State) {
  if (s.condition === 'stable') return;
  const level = s.levelIndex + 1;
  const swapped = swappedAt(level);
  if (s.rules.swapped === swapped) return;
  s.rules = { swapped };
  if (s.interventionAtStep === null) s.interventionAtStep = s.globalStep;
  console.log(`  [researcher] RULES ${swapped ? 'SWAPPED' : 'SWAPPED BACK'} on entering room ${level}`);
}

function init() {
  const strategy = (arg('strategy') as StrategyName) ?? 'structured';
  const levelIndex = Number(arg('level') ?? 1) - 1;
  const tag = arg('tag') ?? 'smoke';
  const seedFile = arg('seed-memory');
  let memory = emptyMemory(strategy);
  if (seedFile) memory = JSON.parse(fs.readFileSync(seedFile, 'utf8'));

  const s: State = {
    runId: `${tag}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`,
    tag,
    strategy,
    levelIndex,
    entity: { ...LEVELS[levelIndex].start },
    rules: flag('changed') ? { ...CHANGED_RULES } : { ...DEFAULT_RULES },
    memory,
    globalStep: 0,
    levelStep: 0,
    budget: Number(arg('budget') ?? 20),
    lastAction: null,
    memoryRejected: null,
    lastInvalid: null,
    lastPrediction: null,
    lastExpect: null,
    previousRoom: null,
    condition: (arg('condition') as State['condition']) ?? (flag('changed') ? 'hidden' : 'stable'),
    interventionAtStep: null,
    seededMemory: Boolean(seedFile),
  };
  fs.mkdirSync(RUNS, { recursive: true });
  append(s, {
    type: 'run_start',
    at: new Date().toISOString(),
    engine_version: ENGINE_VERSION,
    config: {
      runId: s.runId,
      strategy,
      condition: flag('changed') ? 'changed-rules-at-start' : 'stable',
      driver: 'manual-subagent',
      actionBudgetPerLevel: s.budget,
      seed: 0,
    },
    note:
      'Hand-stepped smoke test, not an automated experiment. ' +
      (s.seededMemory ? 'Memory was AUTHOR-SEEDED, not learned in this run. ' : '') +
      'Starting room: ' + (levelIndex + 1),
  });
  save(s);
  console.log(`started ${s.runId} — room ${levelIndex + 1}, ${strategy} memory, rules ${s.rules.swapped ? 'CHANGED' : 'original'}`);
}

function prompt() {
  const s = load();
  const obs = observation(s);
  const leaks = auditForLeaks(obs);
  if (leaks.length) throw new Error(`observation leaked: ${leaks.join(', ')}`);
  console.log(systemPrompt(s.strategy));
  console.log('\n----\n');
  console.log(
    userPrompt({
      observation: obs,
      memory: s.memory,
      stepNumber: s.globalStep + 1,
      memoryRejected: s.memoryRejected,
      lastInvalid: s.lastInvalid,
      lastPrediction: s.lastPrediction,
      lastExpect: s.lastExpect,
    }),
  );
}

function apply(file: string) {
  const s = load();
  const raw = fs.readFileSync(file, 'utf8');

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e: any) {
    s.lastInvalid = String(e.message);
    append(s, { type: 'invalid_reply', global_step: s.globalStep, error: s.lastInvalid, raw: raw.slice(0, 4000) });
    save(s);
    console.log(`REJECTED (${s.lastInvalid}) — no button pressed, nothing changed`);
    return;
  }
  const v = validate(parsed, s.strategy);
  if (!v.ok) {
    s.lastInvalid = v.error;
    append(s, { type: 'invalid_reply', global_step: s.globalStep, error: v.error, raw: raw.slice(0, 4000) });
    save(s);
    console.log(`REJECTED (${v.error}) — no button pressed, nothing changed`);
    return;
  }
  s.lastInvalid = null;

  // capture what the model actually saw BEFORE the update lands
  const memInPrompt = renderMemory(s.memory);
  const applied = applyMemory(s.memory, v.reply.memory);
  s.memoryRejected = applied.rejected;
  s.memory = applied.memory;

  const level = LEVELS[s.levelIndex];
  const before = { ...s.entity };
  const obsBefore = observation(s);
  const r = step(level, before, v.reply.button as Button, s.rules);
  s.entity = r.state;
  s.globalStep++;
  s.levelStep++;
  const roomChanged = r.complete || s.levelStep >= s.budget;
  const both = resolveBoth(level, before, v.reply.button as Button, s.rules, s.levelStep, s.budget);
  const discriminating = both.divergent.length > 0;
  s.previousRoom = null;
  s.lastPrediction = v.reply.prediction;
  s.lastExpect = v.reply.expect;
  s.lastAction = lastActionOf({
    button: v.reply.button,
    before,
    after: r.state,
    path: r.path,
    roomChanged,
  });

  const lethal = lethalGlyph(s.rules);
  const originalObjective = goalGlyph(DEFAULT_RULES);

  append(s, {
    type: 'step',
    run_id: s.runId,
    level: s.levelIndex + 1,
    global_step: s.globalStep,
    level_step: s.levelStep,
    observation_before: obsBefore,
    memory_in_prompt: memInPrompt,
    memory_proposed: renderMemory(v.reply.memory),
    memory_accepted: renderMemory(applied.memory),
    memory_update_rejected: applied.rejected,
    button: v.reply.button,
    hypothesis: v.reply.hypothesis,
    prediction: v.reply.prediction,
    expect: v.reply.expect,
    model_response_raw: raw,
    contradiction: v.reply.contradiction,
    observation_after: observation(s),
    level_complete: r.complete,
    researcher: {
      true_rules: s.rules,
      entity_before: before,
      entity_after: r.state,
      path: r.path,
      blocked: r.blocked,
      died: r.died,
      died_at: r.diedAt,
      auto_moved: r.autoMoved,
      outcome: both.outcome,
      outcome_under_other_rules: both.other,
      divergent_fields: both.divergent,
      discriminating_under_rule_change: discriminating,
      intervention_applied: s.interventionAtStep !== null,
      touched_lethal: r.path.some((q) => level.grid[q.y][q.x] === lethal),
      touched_original_objective: r.path.some((q) => level.grid[q.y][q.x] === originalObjective),
      manual_intervention: true,
    },
  });

  console.log(`press ${v.reply.button}`);
  console.log(`  hypothesis : ${v.reply.hypothesis}`);
  console.log(`  predicted  : ${v.reply.prediction}`);
  console.log(
    `  happened   : ` +
      (r.died
        ? `SENT BACK from ${level.grid[r.diedAt!.y][r.diedAt!.x]} at ${r.diedAt!.x},${r.diedAt!.y} -> ${r.state.x},${r.state.y}`
        : r.blocked
        ? 'nothing moved'
        : `${before.x},${before.y} ${pose(before).marker} -> ${r.state.x},${r.state.y} ${pose(r.state).marker}` +
          (r.autoMoved ? ` (carried ${r.autoMoved})` : '')) +
      (r.complete ? '  ** ROOM SOLVED **' : ''),
  );
  const scored = PREDICTION_FIELDS.map((f) => [f, scoreField(v.reply.expect, both.outcome, f)] as const)
    .filter(([, ok]) => ok !== null);
  if (scored.length)
    console.log(
      `  verdict    : ${scored.map(([f, ok]) => `${f}=${ok ? 'HIT' : 'MISS'}`).join(' ')}`,
    );
  else console.log('  verdict    : committed to nothing');
  if (v.reply.contradiction) console.log(`  agent flags: ${v.reply.contradiction}`);
  if (discriminating) console.log(`  [researcher] this press distinguishes the two rule sets`);
  if (applied.rejected) console.log(`  [harness] ${applied.rejected}`);

  if (r.complete) {
    if (s.levelIndex + 1 < LEVELS.length) {
      // the room that just ENDED, captured before the index moves on
      s.previousRoom = { room_index: s.levelIndex + 1, outcome: 'ended_by_action', final_action: s.lastAction };
      advance(s);
    } else {
      console.log('  -> campaign finished');
    }
  } else if (s.levelStep >= s.budget) {
    console.log(`  budget for room ${s.levelIndex + 1} exhausted`);
    if (s.levelIndex + 1 < LEVELS.length) {
      s.previousRoom = {
        room_index: s.levelIndex + 1,
        outcome: 'actions_exhausted',
        final_action: s.lastAction,
      };
      advance(s);
    } else console.log('  -> campaign finished');
  }
  save(s);
}

/**
 * Move into the next room and apply the scheduled change if it is due.
 *
 * Running out of actions used to leave the stepper parked in a room it could
 * no longer act in, so a hand-driven run could never reach the intervention by
 * failing a room — only by solving every one of them.
 */
function advance(s: State) {
  s.levelIndex++;
  s.levelStep = 0;
  s.entity = { ...LEVELS[s.levelIndex].start };
  s.lastAction = null;
  maybeIntervene(s);
  console.log(`  -> now in room ${s.levelIndex + 1}`);
}

function status() {
  const s = load();
  console.log(
    JSON.stringify(
      {
        runId: s.runId,
        room: s.levelIndex + 1,
        step: s.globalStep,
        levelStep: `${s.levelStep}/${s.budget}`,
        rules: s.rules.swapped ? 'CHANGED' : 'original',
        entity: s.entity,
        memoryChars: renderMemory(s.memory).length,
        seededMemory: s.seededMemory,
      },
      null,
      2,
    ),
  );
}

const cmd = process.argv[2];
if (cmd === 'init') init();
else if (cmd === 'prompt') prompt();
else if (cmd === 'apply') apply(process.argv[3]);
else if (cmd === 'status') status();
else console.log('commands: init | prompt | apply <file> | status');
