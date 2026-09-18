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

import { CHANGED_RULES, DEFAULT_RULES, step } from '../src/engine/engine.ts';
import { LEVELS } from '../src/engine/levels.ts';
import { buildObservation, pose, auditForLeaks } from '../src/engine/observation.ts';
import type { Button, EntityState, Rules } from '../src/engine/types.ts';
import { applyMemory, emptyMemory, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate } from '../src/agent/schema.ts';

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
  });
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
    seededMemory: Boolean(seedFile),
  };
  fs.mkdirSync(RUNS, { recursive: true });
  append(s, {
    type: 'run_start',
    at: new Date().toISOString(),
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
  console.log(`started ${s.runId} — room ${levelIndex + 1}, ${strategy} memory, rules ${s.rules.slipperyEnabled ? 'original' : 'CHANGED'}`);
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

  const applied = applyMemory(s.memory, v.reply.memory);
  s.memoryRejected = applied.rejected;
  s.memory = applied.memory;

  const level = LEVELS[s.levelIndex];
  const before = { ...s.entity };
  const obsBefore = observation(s);
  const a = step(level, before, v.reply.button as Button, DEFAULT_RULES);
  const b = step(level, before, v.reply.button as Button, CHANGED_RULES);
  const discriminating = JSON.stringify(a.state) !== JSON.stringify(b.state) || a.complete !== b.complete;

  const r = step(level, before, v.reply.button as Button, s.rules);
  s.entity = r.state;
  s.globalStep++;
  s.levelStep++;
  s.lastPrediction = v.reply.prediction;
  s.lastAction = {
    button: v.reply.button,
    before: pose(before),
    after: pose(r.state),
    level_complete: r.complete,
  };

  append(s, {
    type: 'step',
    run_id: s.runId,
    level: s.levelIndex + 1,
    global_step: s.globalStep,
    level_step: s.levelStep,
    observation_before: obsBefore,
    memory_before: renderMemory(applied.memory),
    button: v.reply.button,
    hypothesis: v.reply.hypothesis,
    prediction: v.reply.prediction,
    contradiction: v.reply.contradiction,
    observation_after: observation(s),
    memory_after: renderMemory(s.memory),
    level_complete: r.complete,
    researcher: {
      true_rules: s.rules,
      entity_before: before,
      entity_after: r.state,
      path: r.path,
      blocked: r.blocked,
      auto_moved: r.autoMoved,
      discriminating_under_rule_change: discriminating,
      intervention_applied: !s.rules.slipperyEnabled,
      manual_intervention: true,
    },
  });

  console.log(`press ${v.reply.button}`);
  console.log(`  hypothesis : ${v.reply.hypothesis}`);
  console.log(`  predicted  : ${v.reply.prediction}`);
  console.log(
    `  happened   : ` +
      (r.blocked
        ? 'nothing moved'
        : `${before.x},${before.y} ${pose(before).marker} -> ${r.state.x},${r.state.y} ${pose(r.state).marker}` +
          (r.autoMoved ? ` (carried ${r.autoMoved})` : '')) +
      (r.complete ? '  ** ROOM COMPLETE **' : ''),
  );
  if (v.reply.contradiction) console.log(`  agent flags: ${v.reply.contradiction}`);
  if (discriminating) console.log(`  [researcher] this press distinguishes the two rule sets`);
  if (applied.rejected) console.log(`  [harness] ${applied.rejected}`);

  if (r.complete) {
    if (s.levelIndex + 1 < LEVELS.length) {
      s.levelIndex++;
      s.levelStep = 0;
      s.entity = { ...LEVELS[s.levelIndex].start };
      s.lastAction = null;
      s.lastPrediction = null;
      console.log(`  -> now in room ${s.levelIndex + 1}`);
    } else {
      console.log('  -> campaign finished');
    }
  } else if (s.levelStep >= s.budget) {
    console.log(`  budget for room ${s.levelIndex + 1} exhausted`);
  }
  save(s);
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
        rules: s.rules.slipperyEnabled ? 'original' : 'CHANGED',
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
